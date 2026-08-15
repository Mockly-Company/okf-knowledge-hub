use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};

use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;
use uuid::{Uuid, Variant};

use crate::error::{AppError, ErrorCode, RecoveryAction};

use super::cache::{CacheError, DocumentCache};
use super::contract::{
    DocumentCatalog, DocumentEvent, DocumentSessionSnapshot, IndexStatus, SearchResponse,
};
use super::discovery::discover_documents;
use super::indexer::{catalog_from_summaries, BodyReadCoordinator};
use super::reconcile::{ReconcileDecision, ReconcileGate};
use super::watcher::{
    native_watcher_factory, WatcherFactory, WatcherGuard, WatcherMessage, WATCH_COALESCE_WINDOW,
};

#[derive(Debug, Clone)]
pub struct DocumentWorkspace {
    pub workspace_id: Uuid,
    pub repository_root: PathBuf,
    pub document_roots: Vec<String>,
    pub cache_path: PathBuf,
}

#[async_trait]
pub trait DocumentSource: Send + Sync {
    fn discover(&self, workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError>;

    async fn read_body(
        &self,
        workspace: &DocumentWorkspace,
        path: &str,
    ) -> Result<Vec<u8>, AppError>;
}

type CacheOpener =
    dyn Fn(PathBuf, Uuid) -> Result<DocumentCache, CacheError> + Send + Sync + 'static;

#[cfg(test)]
#[derive(Clone)]
struct StartupReservationPause {
    session_id: Uuid,
    reached: Arc<tokio::sync::Semaphore>,
    release: Arc<tokio::sync::Semaphore>,
}

#[cfg(test)]
#[derive(Clone)]
struct ReconcileWorkerPause {
    session_id: Uuid,
    reached: Arc<tokio::sync::Semaphore>,
    release: Arc<tokio::sync::Semaphore>,
}

#[derive(Default)]
pub struct FileSystemDocumentSource;

#[async_trait]
impl DocumentSource for FileSystemDocumentSource {
    fn discover(&self, workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
        discover_documents(&workspace.repository_root, &workspace.document_roots)
    }

    async fn read_body(
        &self,
        workspace: &DocumentWorkspace,
        path: &str,
    ) -> Result<Vec<u8>, AppError> {
        let full_path = workspace.repository_root.join(path);
        tokio::fs::read(&full_path).await.map_err(|error| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                "문서 본문을 읽을 수 없습니다.",
            )
            .with_detail("path", path)
            .with_detail("reason", error.to_string())
        })
    }
}

#[derive(Clone)]
pub struct DocumentRuntime {
    inner: Arc<RuntimeInner>,
}

struct RuntimeInner {
    source: Arc<dyn DocumentSource>,
    body_reads: BodyReadCoordinator,
    body_read_batches: Arc<AsyncMutex<()>>,
    cache_opener: Arc<CacheOpener>,
    watcher_factory: Arc<WatcherFactory>,
    state: Mutex<RuntimeState>,
    startup_mutations: Arc<AsyncMutex<()>>,
    events: broadcast::Sender<DocumentEvent>,
    #[cfg(test)]
    startup_pause: Mutex<Option<StartupReservationPause>>,
    #[cfg(test)]
    reconcile_worker_pause: Mutex<Option<ReconcileWorkerPause>>,
}

struct RuntimeState {
    generation: Option<Generation>,
    next_nonce: u64,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            generation: None,
            next_nonce: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SessionOwner {
    session_id: Uuid,
    nonce: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DocumentRuntimeGeneration(SessionOwner);

pub(crate) struct DocumentRuntimeStart {
    runtime: DocumentRuntime,
    owner: Option<SessionOwner>,
}

impl DocumentRuntimeStart {
    fn owner(&self) -> SessionOwner {
        self.owner
            .expect("runtime start reservation already completed")
    }

    pub(crate) fn complete(mut self) -> DocumentRuntimeGeneration {
        DocumentRuntimeGeneration(
            self.owner
                .take()
                .expect("runtime start reservation already completed"),
        )
    }
}

impl Drop for DocumentRuntimeStart {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.take() {
            self.runtime.cancel_owner(owner);
        }
    }
}

enum Generation {
    Starting {
        owner: SessionOwner,
        cancellation: CancellationToken,
    },
    Active(Box<ActiveSession>),
}

struct ActiveSession {
    owner: SessionOwner,
    cancellation: CancellationToken,
    workspace: DocumentWorkspace,
    cache: DocumentCache,
    snapshot: DocumentSessionSnapshot,
    reconcile: ReconcileGate,
    watcher_degraded: Option<String>,
    watcher_degradation_id: Option<Uuid>,
    current_watcher_recovery_id: Option<Uuid>,
    pending_watcher_recovery_id: Option<Uuid>,
    watcher: Option<Box<dyn WatcherGuard>>,
}

impl Default for DocumentRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentRuntime {
    pub fn new() -> Self {
        Self::with_source(Arc::new(FileSystemDocumentSource))
    }

    pub fn with_source(source: Arc<dyn DocumentSource>) -> Self {
        Self::with_cache_opener(source, Arc::new(DocumentCache::open))
    }

    fn with_cache_opener(source: Arc<dyn DocumentSource>, cache_opener: Arc<CacheOpener>) -> Self {
        let watcher_factory: Arc<WatcherFactory> = Arc::new(native_watcher_factory);
        Self::with_dependencies(source, cache_opener, watcher_factory)
    }

    #[cfg(test)]
    fn with_source_and_watcher_factory(
        source: Arc<dyn DocumentSource>,
        watcher_factory: Arc<WatcherFactory>,
    ) -> Self {
        Self::with_dependencies(source, Arc::new(DocumentCache::open), watcher_factory)
    }

    fn with_dependencies(
        source: Arc<dyn DocumentSource>,
        cache_opener: Arc<CacheOpener>,
        watcher_factory: Arc<WatcherFactory>,
    ) -> Self {
        let (events, _) = broadcast::channel(64);
        Self {
            inner: Arc::new(RuntimeInner {
                source,
                body_reads: BodyReadCoordinator::default(),
                body_read_batches: Arc::new(AsyncMutex::new(())),
                cache_opener,
                watcher_factory,
                state: Mutex::new(RuntimeState::default()),
                startup_mutations: Arc::new(AsyncMutex::new(())),
                events,
                #[cfg(test)]
                startup_pause: Mutex::new(None),
                #[cfg(test)]
                reconcile_worker_pause: Mutex::new(None),
            }),
        }
    }

    #[cfg(test)]
    fn with_source_and_startup_controls(
        source: Arc<dyn DocumentSource>,
        cache_opener: Arc<CacheOpener>,
        startup_pause: StartupReservationPause,
    ) -> Self {
        let runtime = Self::with_cache_opener(source, cache_opener);
        *runtime
            .inner
            .startup_pause
            .lock()
            .expect("document runtime poisoned") = Some(startup_pause);
        runtime
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DocumentEvent> {
        self.inner.events.subscribe()
    }

    pub async fn start_session(
        &self,
        session_id: Uuid,
        workspace: DocumentWorkspace,
    ) -> Result<DocumentSessionSnapshot, AppError> {
        let start = self.reserve_session(session_id).await?;
        let snapshot = self.finish_reserved_session(&start, workspace).await?;
        let _generation = start.complete();
        Ok(snapshot)
    }

    pub(crate) async fn reserve_session(
        &self,
        session_id: Uuid,
    ) -> Result<DocumentRuntimeStart, AppError> {
        validate_session_id(session_id)?;
        let cancellation = CancellationToken::new();
        let owner = {
            let _mutation_guard = self.inner.startup_mutations.lock().await;
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            if state
                .generation
                .as_ref()
                .is_some_and(|generation| generation.owner().session_id == session_id)
            {
                return Err(session_conflict());
            }
            let owner = SessionOwner {
                session_id,
                nonce: state.next_nonce,
            };
            state.next_nonce = state
                .next_nonce
                .checked_add(1)
                .ok_or_else(session_conflict)?;
            if let Some(mut previous) = state.generation.take() {
                previous.close();
            }
            state.generation = Some(Generation::Starting {
                owner,
                cancellation: cancellation.clone(),
            });
            owner
        };

        Ok(DocumentRuntimeStart {
            runtime: self.clone(),
            owner: Some(owner),
        })
    }

    pub(crate) async fn finish_reserved_session(
        &self,
        start: &DocumentRuntimeStart,
        workspace: DocumentWorkspace,
    ) -> Result<DocumentSessionSnapshot, AppError> {
        let owner = start.owner();
        let session_id = owner.session_id;
        let cancellation = {
            let state = self.inner.state.lock().expect("document runtime poisoned");
            match state.generation.as_ref() {
                Some(Generation::Starting {
                    owner: current,
                    cancellation,
                }) if *current == owner => cancellation.clone(),
                _ => return Err(session_conflict()),
            }
        };

        #[cfg(test)]
        self.pause_after_reservation(owner).await;

        let result = self
            .prepare_session(owner, workspace, cancellation.clone())
            .await;
        let (snapshot, catalog) = match result {
            Ok(prepared) => prepared,
            Err(error) => {
                self.clear_if_owned(owner);
                return Err(error);
            }
        };

        self.publish_if_owned(
            owner,
            DocumentEvent::TreeChanged {
                session_id,
                catalog: catalog.clone(),
            },
        );
        self.publish_if_owned(
            owner,
            DocumentEvent::IndexStatusChanged {
                session_id,
                status: snapshot.index_status.clone(),
            },
        );

        self.start_watcher(owner);

        let started_snapshot = {
            let state = self.inner.state.lock().expect("document runtime poisoned");
            match state.generation.as_ref() {
                Some(Generation::Active(session)) if session.owner == owner => {
                    session.snapshot.clone()
                }
                _ => snapshot,
            }
        };

        let _ = self.request_reconcile(owner);
        Ok(started_snapshot)
    }

    pub(crate) fn stop_generation(
        &self,
        generation: DocumentRuntimeGeneration,
    ) -> Result<(), AppError> {
        if self.cancel_owner(generation.0) {
            Ok(())
        } else {
            Err(session_conflict())
        }
    }

    fn cancel_owner(&self, owner: SessionOwner) -> bool {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        if state
            .generation
            .as_ref()
            .is_none_or(|generation| generation.owner() != owner)
        {
            return false;
        }
        let mut generation = state.generation.take().expect("generation checked above");
        generation.close();
        true
    }

    #[cfg(test)]
    async fn pause_after_reservation(&self, owner: SessionOwner) {
        let pause = {
            self.inner
                .startup_pause
                .lock()
                .expect("document runtime poisoned")
                .clone()
        };
        let Some(pause) = pause.filter(|pause| pause.session_id == owner.session_id) else {
            return;
        };
        pause.reached.add_permits(1);
        pause.release.acquire().await.unwrap().forget();
    }

    pub async fn stop_session(&self, session_id: Uuid) -> Result<(), AppError> {
        let _mutation_guard = self.inner.startup_mutations.lock().await;
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(generation) = state.generation.as_ref() else {
            return Err(session_conflict());
        };
        if generation.owner().session_id != session_id {
            return Err(session_conflict());
        }
        let generation = state.generation.as_mut().expect("generation checked above");
        generation.close();
        state.generation = None;
        Ok(())
    }

    pub fn snapshot(&self, session_id: Uuid) -> Result<DocumentSessionSnapshot, AppError> {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        match state.generation.as_ref() {
            Some(Generation::Active(session)) if session.owner.session_id == session_id => {
                Ok(session.snapshot.clone())
            }
            _ => Err(session_conflict()),
        }
    }

    pub(crate) fn publish_resync_barrier(
        &self,
        generation: DocumentRuntimeGeneration,
    ) -> Result<Uuid, AppError> {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_ref() else {
            return Err(session_conflict());
        };
        if session.owner != generation.0 {
            return Err(session_conflict());
        }
        let barrier_id = Uuid::new_v4();
        let _ = self.inner.events.send(DocumentEvent::Resynced {
            session_id: session.owner.session_id,
            barrier_id,
            snapshot: session.snapshot.clone(),
        });
        Ok(barrier_id)
    }

    pub async fn search(
        &self,
        session_id: Uuid,
        query: &str,
        limit: usize,
    ) -> Result<SearchResponse, AppError> {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        match state.generation.as_ref() {
            Some(Generation::Active(session)) if session.owner.session_id == session_id => {
                session.cache.search(query, limit).map_err(cache_error)
            }
            _ => Err(session_conflict()),
        }
    }

    pub fn set_open_document(&self, session_id: Uuid, path: &str) -> Result<(), AppError> {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return Err(session_conflict());
        };
        if session.owner.session_id != session_id {
            return Err(session_conflict());
        }
        if !session
            .snapshot
            .catalog
            .documents
            .iter()
            .any(|document| document.path == path)
        {
            return Err(AppError::new(
                ErrorCode::DocumentPathInvalid,
                "열려는 문서가 현재 카탈로그에 없습니다.",
            )
            .with_detail("path", path));
        }
        session
            .cache
            .set_last_opened_path(Some(path))
            .map_err(cache_error)?;
        session.snapshot.last_opened_path = Some(path.to_owned());
        let _ = self.inner.events.send(DocumentEvent::OpenDocumentChanged {
            session_id,
            path: path.to_owned(),
        });
        Ok(())
    }

    pub async fn refresh(&self, session_id: Uuid) -> Result<(), AppError> {
        let (owner, decision) = {
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            match state.generation.as_mut() {
                Some(Generation::Active(session)) if session.owner.session_id == session_id => {
                    let recovery_id =
                        if session.watcher.is_some() && session.watcher_degraded.is_some() {
                            session.watcher_degradation_id
                        } else {
                            None
                        };
                    let decision = session.reconcile.request();
                    match decision {
                        ReconcileDecision::Start => {
                            session.current_watcher_recovery_id = recovery_id;
                            session.pending_watcher_recovery_id = None;
                        }
                        ReconcileDecision::Wait => {
                            if recovery_id.is_some() {
                                session.pending_watcher_recovery_id = recovery_id;
                            }
                        }
                    }
                    (session.owner, decision)
                }
                _ => return Err(session_conflict()),
            }
        };
        self.spawn_reconcile_worker_if_needed(owner, decision);
        Ok(())
    }

    fn request_reconcile(&self, owner: SessionOwner) -> Result<(), AppError> {
        let decision = {
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_mut() else {
                return Err(session_conflict());
            };
            if session.owner != owner {
                return Err(session_conflict());
            }
            let decision = session.reconcile.request();
            if decision == ReconcileDecision::Start {
                session.current_watcher_recovery_id = None;
                session.pending_watcher_recovery_id = None;
            }
            decision
        };
        self.spawn_reconcile_worker_if_needed(owner, decision);
        Ok(())
    }

    fn spawn_reconcile_worker_if_needed(&self, owner: SessionOwner, decision: ReconcileDecision) {
        if decision == ReconcileDecision::Start {
            let runtime = Arc::downgrade(&self.inner);
            tokio::spawn(async move {
                Self::run_reconcile_worker(runtime, owner).await;
            });
        }
    }

    async fn run_reconcile_worker(runtime: Weak<RuntimeInner>, owner: SessionOwner) {
        #[cfg(test)]
        Self::pause_reconcile_worker(&runtime, owner).await;

        loop {
            if let Err(error) = Self::run_reconcile_once(&runtime, owner).await {
                Self::publish_failure_if_owned(&runtime, owner, error);
            }
            if Self::finish_reconcile(&runtime, owner) == ReconcileDecision::Wait {
                return;
            }
        }
    }

    #[cfg(test)]
    async fn pause_reconcile_worker(runtime: &Weak<RuntimeInner>, owner: SessionOwner) {
        let pause = {
            let Some(inner) = runtime.upgrade() else {
                return;
            };
            let pause = inner
                .reconcile_worker_pause
                .lock()
                .expect("document runtime poisoned")
                .clone();
            pause
        };
        let Some(pause) = pause.filter(|pause| pause.session_id == owner.session_id) else {
            return;
        };
        pause.reached.add_permits(1);
        pause.release.acquire().await.unwrap().forget();
    }

    async fn run_reconcile_once(
        runtime: &Weak<RuntimeInner>,
        owner: SessionOwner,
    ) -> Result<(), AppError> {
        let (source, workspace, body_reads, body_read_batches, watcher_recovery_id) = {
            let Some(inner) = runtime.upgrade() else {
                return Ok(());
            };
            let mut state = inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_mut() else {
                return Ok(());
            };
            if session.owner != owner {
                return Ok(());
            }
            (
                inner.source.clone(),
                session.workspace.clone(),
                inner.body_reads.clone(),
                inner.body_read_batches.clone(),
                session.current_watcher_recovery_id.take(),
            )
        };

        let catalog = Self::discover(source.clone(), workspace.clone()).await?;
        let to_read = {
            let Some(inner) = runtime.upgrade() else {
                return Ok(());
            };
            let state = inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_ref() else {
                return Ok(());
            };
            if session.owner != owner {
                return Ok(());
            }
            let delta = session
                .cache
                .plan_reconcile(&catalog.documents)
                .map_err(cache_error)?;
            delta
                .to_index
                .iter()
                .filter_map(|path| {
                    catalog
                        .documents
                        .iter()
                        .find(|document| document.path == *path)
                        .cloned()
                })
                .collect::<Vec<_>>()
        };

        let contents = if to_read.is_empty() {
            Vec::new()
        } else {
            let _batch = body_read_batches.lock_owned().await;
            if !Self::is_owned(runtime, owner) {
                return Ok(());
            }
            let results = body_reads.read_changed(source, workspace, to_read).await;
            results.into_iter().collect::<Result<Vec<_>, AppError>>()?
        };

        let Some(inner) = runtime.upgrade() else {
            return Ok(());
        };
        let mut state = inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return Ok(());
        };
        if session.owner != owner {
            return Ok(());
        }
        session
            .cache
            .apply_reconcile(&catalog.documents, &contents)
            .map_err(cache_error)?;
        let migrated_open_path = reconcile_open_document(session, &catalog)?;
        session.snapshot.catalog = catalog.clone();
        if watcher_recovery_id.is_some() && watcher_recovery_id == session.watcher_degradation_id {
            session.watcher_degraded = None;
            session.watcher_degradation_id = None;
        }
        let degraded = session.watcher_degraded.clone();
        let status = update_effective_index_status(
            &mut session.snapshot.index_status,
            degraded.as_deref(),
            IndexStatus::Ready,
        );
        let _ = inner.events.send(DocumentEvent::TreeChanged {
            session_id: owner.session_id,
            catalog,
        });
        if let Some(status) = status {
            let _ = inner.events.send(DocumentEvent::IndexStatusChanged {
                session_id: owner.session_id,
                status,
            });
        }
        if let Some(path) = migrated_open_path {
            let _ = inner.events.send(DocumentEvent::OpenDocumentChanged {
                session_id: owner.session_id,
                path,
            });
        }
        Ok(())
    }

    fn is_owned(runtime: &Weak<RuntimeInner>, owner: SessionOwner) -> bool {
        let Some(inner) = runtime.upgrade() else {
            return false;
        };
        let state = inner.state.lock().expect("document runtime poisoned");
        matches!(state.generation.as_ref(), Some(Generation::Active(session)) if session.owner == owner)
    }

    fn finish_reconcile(runtime: &Weak<RuntimeInner>, owner: SessionOwner) -> ReconcileDecision {
        let Some(inner) = runtime.upgrade() else {
            return ReconcileDecision::Wait;
        };
        let mut state = inner.state.lock().expect("document runtime poisoned");
        match state.generation.as_mut() {
            Some(Generation::Active(session)) if session.owner == owner => {
                let decision = session.reconcile.finish();
                match decision {
                    ReconcileDecision::Start => {
                        session.current_watcher_recovery_id =
                            session.pending_watcher_recovery_id.take();
                    }
                    ReconcileDecision::Wait => {
                        session.current_watcher_recovery_id = None;
                        session.pending_watcher_recovery_id = None;
                    }
                }
                decision
            }
            _ => ReconcileDecision::Wait,
        }
    }

    fn publish_failure_if_owned(
        runtime: &Weak<RuntimeInner>,
        owner: SessionOwner,
        error: AppError,
    ) {
        let Some(inner) = runtime.upgrade() else {
            return;
        };
        let state = inner.state.lock().expect("document runtime poisoned");
        if matches!(state.generation.as_ref(), Some(Generation::Active(session)) if session.owner == owner)
        {
            let _ = inner.events.send(DocumentEvent::Failed {
                session_id: owner.session_id,
                error,
            });
        }
    }

    async fn discover(
        source: Arc<dyn DocumentSource>,
        workspace: DocumentWorkspace,
    ) -> Result<DocumentCatalog, AppError> {
        tokio::task::spawn_blocking(move || source.discover(&workspace))
            .await
            .map_err(join_error)?
    }

    fn start_watcher(&self, owner: SessionOwner) {
        let Some(workspace) = self.workspace_if_owned(owner) else {
            return;
        };
        let (sender, receiver) = mpsc::unbounded_channel();
        match (self.inner.watcher_factory)(
            &workspace.repository_root,
            &workspace.document_roots,
            sender,
        ) {
            Ok(watcher) => {
                let cancellation = {
                    let mut state = self.inner.state.lock().expect("document runtime poisoned");
                    let Some(Generation::Active(session)) = state.generation.as_mut() else {
                        return;
                    };
                    if session.owner != owner {
                        return;
                    }
                    session.watcher = Some(watcher);
                    session.cancellation.clone()
                };
                let runtime = Arc::downgrade(&self.inner);
                tokio::spawn(async move {
                    Self::watch_changes(runtime, owner, receiver, cancellation).await;
                });
            }
            Err(_) => self.mark_watcher_degraded(owner),
        }
    }

    async fn watch_changes(
        runtime: Weak<RuntimeInner>,
        owner: SessionOwner,
        mut receiver: mpsc::UnboundedReceiver<WatcherMessage>,
        cancellation: CancellationToken,
    ) {
        loop {
            let message = tokio::select! {
                _ = cancellation.cancelled() => return,
                message = receiver.recv() => match message {
                    Some(message) => message,
                    None => return,
                },
            };
            match message {
                WatcherMessage::RepositoryChanged => {}
                WatcherMessage::BackendError => {
                    let Some(inner) = runtime.upgrade() else {
                        return;
                    };
                    DocumentRuntime { inner }.mark_watcher_degraded(owner);
                    continue;
                }
            };
            let deadline = tokio::time::Instant::now() + WATCH_COALESCE_WINDOW;
            loop {
                let next = tokio::select! {
                    _ = cancellation.cancelled() => return,
                    next = tokio::time::timeout_at(deadline, receiver.recv()) => next,
                };
                match next {
                    Ok(Some(WatcherMessage::RepositoryChanged)) => {}
                    Ok(Some(WatcherMessage::BackendError)) => {
                        let Some(inner) = runtime.upgrade() else {
                            return;
                        };
                        DocumentRuntime { inner }.mark_watcher_degraded(owner);
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            let Some(inner) = runtime.upgrade() else {
                return;
            };
            let _ = DocumentRuntime { inner }.request_reconcile(owner);
        }
    }

    fn mark_watcher_degraded(&self, owner: SessionOwner) {
        const MESSAGE: &str =
            "파일 변경 감시를 사용할 수 없습니다. 수동 새로 고침은 계속 사용할 수 있습니다.";
        self.mark_watcher_degraded_with_message(owner, MESSAGE);
    }

    fn mark_watcher_degraded_with_message(&self, owner: SessionOwner, message: &str) {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return;
        };
        if session.owner != owner {
            return;
        }
        session.watcher_degraded = Some(message.to_owned());
        session.watcher_degradation_id = Some(Uuid::new_v4());
        session.current_watcher_recovery_id = None;
        session.pending_watcher_recovery_id = None;
        let requested = session.snapshot.index_status.clone();
        let degraded = session.watcher_degraded.clone();
        if let Some(status) = update_effective_index_status(
            &mut session.snapshot.index_status,
            degraded.as_deref(),
            requested,
        ) {
            let _ = self.inner.events.send(DocumentEvent::IndexStatusChanged {
                session_id: owner.session_id,
                status,
            });
        }
    }

    async fn prepare_session(
        &self,
        owner: SessionOwner,
        workspace: DocumentWorkspace,
        cancellation: CancellationToken,
    ) -> Result<(DocumentSessionSnapshot, DocumentCatalog), AppError> {
        let cache_path = workspace.cache_path.clone();
        let workspace_id = workspace.workspace_id;
        let cache_opener = self.inner.cache_opener.clone();
        let mut cache = {
            let mutation_guard = self.inner.startup_mutations.clone().lock_owned().await;
            {
                let state = self.inner.state.lock().expect("document runtime poisoned");
                if !matches!(state.generation.as_ref(), Some(Generation::Starting { owner: current, .. }) if *current == owner)
                {
                    return Err(session_conflict());
                }
            }
            tokio::task::spawn_blocking(move || {
                let _mutation_guard = mutation_guard;
                cache_opener(cache_path, workspace_id)
            })
            .await
            .map_err(join_error)?
            .map_err(cache_error)?
        };
        let cached = cache.cached_summaries().map_err(cache_error)?;
        let warm_start = !cached.is_empty();
        let catalog = if warm_start {
            catalog_from_summaries(&workspace.document_roots, cached)
        } else {
            Self::discover(self.inner.source.clone(), workspace.clone()).await?
        };
        let _mutation_guard = self.inner.startup_mutations.lock().await;
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        if !matches!(state.generation.as_ref(), Some(Generation::Starting { owner: current, .. }) if *current == owner)
        {
            return Err(session_conflict());
        }
        if warm_start {
            cache
                .reconcile_metadata(&catalog.documents)
                .map_err(cache_error)?;
        }
        let last_opened_path = cache.last_opened_path().map_err(cache_error)?;
        let last_opened_path = match last_opened_path {
            Some(path)
                if catalog
                    .documents
                    .iter()
                    .any(|document| document.path == path)
                    && workspace.repository_root.join(&path).is_file() =>
            {
                Some(path)
            }
            Some(_) => {
                cache.set_last_opened_path(None).map_err(cache_error)?;
                None
            }
            None => None,
        };
        let snapshot = DocumentSessionSnapshot {
            session_id: owner.session_id,
            index_status: IndexStatus::Preparing {
                indexed: 0,
                total: catalog.documents.len(),
            },
            catalog: catalog.clone(),
            last_opened_path,
        };
        let active = ActiveSession {
            owner,
            cancellation,
            workspace,
            cache,
            snapshot: snapshot.clone(),
            reconcile: ReconcileGate::default(),
            watcher_degraded: None,
            watcher_degradation_id: None,
            current_watcher_recovery_id: None,
            pending_watcher_recovery_id: None,
            watcher: None,
        };
        state.generation = Some(Generation::Active(Box::new(active)));
        Ok((snapshot, catalog))
    }

    fn workspace_if_owned(&self, owner: SessionOwner) -> Option<DocumentWorkspace> {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        match state.generation.as_ref() {
            Some(Generation::Active(session)) if session.owner == owner => {
                Some(session.workspace.clone())
            }
            _ => None,
        }
    }

    fn publish_if_owned(&self, owner: SessionOwner, event: DocumentEvent) {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        if matches!(state.generation.as_ref(), Some(Generation::Active(session)) if session.owner == owner)
        {
            let _ = self.inner.events.send(event);
        }
    }

    fn clear_if_owned(&self, owner: SessionOwner) {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        if state
            .generation
            .as_ref()
            .is_some_and(|generation| generation.owner() == owner)
        {
            state.generation = None;
        }
    }
}

impl Generation {
    fn owner(&self) -> SessionOwner {
        match self {
            Self::Starting { owner, .. } => *owner,
            Self::Active(session) => session.owner,
        }
    }

    fn close(&mut self) {
        match self {
            Self::Starting { cancellation, .. } => cancellation.cancel(),
            Self::Active(session) => {
                session.reconcile.close();
                session.cancellation.cancel();
            }
        }
    }
}

fn validate_session_id(session_id: Uuid) -> Result<(), AppError> {
    if session_id.get_version_num() == 4 && session_id.get_variant() == Variant::RFC4122 {
        Ok(())
    } else {
        Err(session_conflict())
    }
}

fn update_effective_index_status(
    current: &mut IndexStatus,
    watcher_degraded: Option<&str>,
    requested: IndexStatus,
) -> Option<IndexStatus> {
    let effective = watcher_degraded.map_or(requested, |message| IndexStatus::Degraded {
        message: message.to_owned(),
    });
    if *current == effective {
        return None;
    }
    *current = effective.clone();
    Some(effective)
}

fn session_conflict() -> AppError {
    AppError::new(
        ErrorCode::DocumentSessionConflict,
        "문서 세션이 더 이상 활성 상태가 아닙니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn cache_error(error: CacheError) -> AppError {
    AppError::new(
        ErrorCode::DocumentIndexUnavailable,
        "문서 검색 색인을 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("reason", error.to_string())
}

fn join_error(error: tokio::task::JoinError) -> AppError {
    AppError::new(
        ErrorCode::DocumentIndexUnavailable,
        "문서 색인 작업을 완료할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("reason", error.to_string())
}

fn reconcile_open_document(
    session: &mut ActiveSession,
    catalog: &DocumentCatalog,
) -> Result<Option<String>, AppError> {
    let Some(open_path) = session.snapshot.last_opened_path.clone() else {
        return Ok(None);
    };
    if catalog
        .documents
        .iter()
        .any(|document| document.path == open_path)
    {
        return Ok(None);
    }

    let previous_id = session
        .snapshot
        .catalog
        .documents
        .iter()
        .find(|document| document.path == open_path)
        .and_then(|document| document.document_id)
        .filter(|document_id| {
            session
                .snapshot
                .catalog
                .documents
                .iter()
                .filter(|document| document.document_id == Some(*document_id))
                .count()
                == 1
        });
    let renamed_path = previous_id.and_then(|document_id| {
        let mut matches = catalog
            .documents
            .iter()
            .filter(|document| document.document_id == Some(document_id));
        let first = matches.next()?;
        matches.next().is_none().then(|| first.path.clone())
    });
    session
        .cache
        .set_last_opened_path(renamed_path.as_deref())
        .map_err(cache_error)?;
    session.snapshot.last_opened_path = renamed_path.clone();
    Ok(renamed_path)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    use async_trait::async_trait;
    use notify::event::{AccessKind, AccessMode, DataChange, ModifyKind};
    use notify::{Event, EventKind};
    use tempfile::TempDir;
    use tokio::sync::{mpsc, Notify, Semaphore};
    use uuid::Uuid;

    use crate::documents::cache::{CacheError, DocumentCache};
    use crate::documents::contract::{
        DocumentCatalog, DocumentEvent, DocumentSummary, DocumentTreeEntry, FrontmatterStatus,
        IndexStatus,
    };
    use crate::documents::watcher::{
        dispatch_notify_result, WatcherFactory, WatcherGuard, WatcherMessage, WATCH_COALESCE_WINDOW,
    };
    use crate::error::{AppError, ErrorCode};

    use super::{
        update_effective_index_status, DocumentRuntime, DocumentSource, DocumentWorkspace,
        Generation, ReconcileWorkerPause, StartupReservationPause,
    };

    #[test]
    fn effective_status_suppresses_identical_degradation_but_publishes_message_changes() {
        let mut current = IndexStatus::Ready;
        let degraded_a = IndexStatus::Degraded {
            message: "watcher A".to_owned(),
        };
        let degraded_b = IndexStatus::Degraded {
            message: "watcher B".to_owned(),
        };

        assert_eq!(
            update_effective_index_status(&mut current, Some("watcher A"), IndexStatus::Ready),
            Some(degraded_a.clone())
        );
        assert_eq!(
            update_effective_index_status(
                &mut current,
                Some("watcher A"),
                IndexStatus::Preparing {
                    indexed: 1,
                    total: 2,
                },
            ),
            None
        );
        assert_eq!(current, degraded_a);
        assert_eq!(
            update_effective_index_status(&mut current, Some("watcher B"), IndexStatus::Ready),
            Some(degraded_b.clone())
        );
        assert_eq!(current, degraded_b);
    }

    #[derive(Clone)]
    struct SequencedDocumentSource {
        reads: Arc<AtomicUsize>,
        first_started: Arc<Notify>,
        first_release: Arc<Notify>,
    }

    impl SequencedDocumentSource {
        fn new() -> Self {
            Self {
                reads: Arc::new(AtomicUsize::new(0)),
                first_started: Arc::new(Notify::new()),
                first_release: Arc::new(Notify::new()),
            }
        }

        async fn wait_for_first_read(&self) {
            if self.reads.load(Ordering::SeqCst) == 0 {
                self.first_started.notified().await;
            }
        }

        async fn wait_for_read_count(&self, expected: usize) {
            tokio::time::timeout(Duration::from_secs(2), async {
                while self.reads.load(Ordering::SeqCst) < expected {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        }
    }

    #[async_trait]
    impl DocumentSource for SequencedDocumentSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            let summary = summary("docs/session.md");
            Ok(DocumentCatalog {
                documents: vec![summary.clone()],
                roots: vec![DocumentTreeEntry::Folder {
                    name: "docs".to_owned(),
                    path: "docs".to_owned(),
                    children: vec![DocumentTreeEntry::Document { summary }],
                }],
            })
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            let read = self.reads.fetch_add(1, Ordering::SeqCst);
            if read == 0 {
                self.first_started.notify_waiters();
                self.first_release.notified().await;
                Ok(b"stale generation body".to_vec())
            } else {
                Ok(b"current generation body".to_vec())
            }
        }
    }

    #[tokio::test]
    async fn starting_a_new_session_cancels_and_rejects_the_previous_generation() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = SequencedDocumentSource::new();
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();

        runtime
            .start_session(first, workspace.clone())
            .await
            .unwrap();
        source.wait_for_first_read().await;
        runtime
            .start_session(second, workspace.clone())
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), source.wait_for_read_count(2))
                .await
                .is_err()
        );
        source.first_release.notify_waiters();
        source.wait_for_read_count(2).await;
        wait_until_idle(&runtime, second).await;

        assert!(runtime
            .search(second, "current generation", 20)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/session.md"));
        assert!(runtime
            .search(second, "stale generation", 20)
            .await
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            runtime.snapshot(first).unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );
    }

    #[tokio::test]
    async fn duplicate_or_non_v4_session_ids_are_rejected() {
        let temp = TempDir::new().unwrap();
        let runtime = DocumentRuntime::with_source(Arc::new(SequencedDocumentSource::new()));
        let id = Uuid::new_v4();
        runtime.start_session(id, workspace(&temp)).await.unwrap();

        assert_eq!(
            runtime
                .start_session(id, workspace(&temp))
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionConflict
        );
        assert_eq!(
            runtime
                .start_session(Uuid::nil(), workspace(&temp))
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionConflict
        );
        assert_eq!(runtime.snapshot(id).unwrap().session_id, id);
    }

    #[derive(Clone)]
    struct MutableDocumentSource {
        documents: Arc<Mutex<Vec<DocumentSummary>>>,
        discoveries: Arc<AtomicUsize>,
        reads: Arc<Mutex<Vec<String>>>,
        bodies: Arc<Mutex<HashMap<String, Vec<u8>>>>,
        body_started: Arc<Notify>,
        body_release: Arc<Notify>,
        block_bodies: bool,
    }

    impl MutableDocumentSource {
        fn new(documents: Vec<DocumentSummary>) -> Self {
            let bodies = documents
                .iter()
                .map(|summary| {
                    (
                        summary.path.clone(),
                        format!("body for {}", summary.path).into_bytes(),
                    )
                })
                .collect();
            Self {
                documents: Arc::new(Mutex::new(documents)),
                discoveries: Arc::new(AtomicUsize::new(0)),
                reads: Arc::new(Mutex::new(Vec::new())),
                bodies: Arc::new(Mutex::new(bodies)),
                body_started: Arc::new(Notify::new()),
                body_release: Arc::new(Notify::new()),
                block_bodies: false,
            }
        }

        fn blocking(document: DocumentSummary) -> Self {
            Self {
                block_bodies: true,
                ..Self::new(vec![document])
            }
        }

        fn replace_documents(&self, documents: Vec<DocumentSummary>) {
            *self.documents.lock().unwrap() = documents;
        }

        fn take_reads(&self) -> Vec<String> {
            std::mem::take(&mut *self.reads.lock().unwrap())
        }

        fn discovery_count(&self) -> usize {
            self.discoveries.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl DocumentSource for MutableDocumentSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            self.discoveries.fetch_add(1, Ordering::SeqCst);
            Ok(catalog(self.documents.lock().unwrap().clone()))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            self.reads.lock().unwrap().push(path.to_owned());
            if self.block_bodies {
                self.body_started.notify_waiters();
                self.body_release.notified().await;
            }
            Ok(self
                .bodies
                .lock()
                .unwrap()
                .get(path)
                .cloned()
                .unwrap_or_else(|| format!("body for {path}").into_bytes()))
        }
    }

    #[tokio::test]
    async fn initial_tree_is_available_before_body_indexing_finishes() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::blocking(summary("docs/large.md"));
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));

        let snapshot = runtime
            .start_session(Uuid::new_v4(), workspace(&temp))
            .await
            .unwrap();

        assert_eq!(snapshot.catalog.documents[0].path, "docs/large.md");
        assert_eq!(
            snapshot.index_status,
            IndexStatus::Preparing {
                indexed: 0,
                total: 1
            }
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(100), source.body_release.notified())
                .await
                .is_err()
        );
    }

    #[derive(Clone)]
    struct BlockingDiscoverySource {
        discoveries: Arc<AtomicUsize>,
        reconciles: Arc<AtomicUsize>,
        active_reconciles: Arc<AtomicUsize>,
        max_active_reconciles: Arc<AtomicUsize>,
        released: Arc<(Mutex<bool>, Condvar)>,
    }

    impl BlockingDiscoverySource {
        fn new() -> Self {
            Self {
                discoveries: Arc::new(AtomicUsize::new(0)),
                reconciles: Arc::new(AtomicUsize::new(0)),
                active_reconciles: Arc::new(AtomicUsize::new(0)),
                max_active_reconciles: Arc::new(AtomicUsize::new(0)),
                released: Arc::new((Mutex::new(false), Condvar::new())),
            }
        }

        async fn wait_until_reconcile_count(&self, expected: usize) {
            tokio::time::timeout(Duration::from_secs(2), async {
                while self.reconciles.load(Ordering::SeqCst) < expected {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        }

        fn release_reconciles(&self) {
            let (released, wake) = &*self.released;
            *released.lock().unwrap() = true;
            wake.notify_all();
        }

        fn reconcile_count(&self) -> usize {
            self.reconciles.load(Ordering::SeqCst)
        }

        fn max_concurrent_reconciles(&self) -> usize {
            self.max_active_reconciles.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl DocumentSource for BlockingDiscoverySource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.discoveries.fetch_add(1, Ordering::SeqCst) == 0 {
                return Ok(catalog(vec![summary("docs/blocked.md")]));
            }

            self.reconciles.fetch_add(1, Ordering::SeqCst);
            let active = self.active_reconciles.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active_reconciles
                .fetch_max(active, Ordering::SeqCst);
            let (released, wake) = &*self.released;
            let mut released = released.lock().unwrap();
            while !*released {
                released = wake.wait(released).unwrap();
            }
            self.active_reconciles.fetch_sub(1, Ordering::SeqCst);
            Ok(catalog(vec![summary("docs/blocked.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(b"blocked body".to_vec())
        }
    }

    #[tokio::test]
    async fn changes_during_a_blocked_run_produce_one_follow_up_run() {
        let temp = TempDir::new().unwrap();
        let source = BlockingDiscoverySource::new();
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        source.wait_until_reconcile_count(1).await;

        let requests = (0..3)
            .map(|_| {
                let runtime = runtime.clone();
                tokio::spawn(async move { runtime.refresh(session_id).await })
            })
            .collect::<Vec<_>>();
        tokio::task::yield_now().await;
        source.release_reconciles();
        for request in requests {
            request.await.unwrap().unwrap();
        }
        source.wait_until_reconcile_count(2).await;
        wait_until_idle(&runtime, session_id).await;

        assert_eq!(source.max_concurrent_reconciles(), 1);
        assert_eq!(source.reconcile_count(), 2);
    }

    #[tokio::test]
    async fn manual_refresh_and_watcher_change_share_the_same_gate() {
        let temp = TempDir::new().unwrap();
        let source = BlockingDiscoverySource::new();
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        source.wait_until_reconcile_count(1).await;

        let manual_runtime = runtime.clone();
        let manual = tokio::spawn(async move { manual_runtime.refresh(session_id).await });
        watcher_sender
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .send(WatcherMessage::RepositoryChanged)
            .unwrap();
        tokio::time::sleep(WATCH_COALESCE_WINDOW + Duration::from_millis(25)).await;
        source.release_reconciles();
        manual.await.unwrap().unwrap();
        source.wait_until_reconcile_count(2).await;
        wait_until_idle(&runtime, session_id).await;

        assert_eq!(source.max_concurrent_reconciles(), 1);
        assert_eq!(source.reconcile_count(), 2);
    }

    #[derive(Clone)]
    struct FailOnceBlockingSource {
        discoveries: Arc<AtomicUsize>,
        reconciles: Arc<AtomicUsize>,
        active_reconciles: Arc<AtomicUsize>,
        max_active_reconciles: Arc<AtomicUsize>,
        failure_release: Arc<(Mutex<bool>, Condvar)>,
    }

    impl FailOnceBlockingSource {
        fn new() -> Self {
            Self {
                discoveries: Arc::new(AtomicUsize::new(0)),
                reconciles: Arc::new(AtomicUsize::new(0)),
                active_reconciles: Arc::new(AtomicUsize::new(0)),
                max_active_reconciles: Arc::new(AtomicUsize::new(0)),
                failure_release: Arc::new((Mutex::new(false), Condvar::new())),
            }
        }

        async fn wait_until_reconcile_count(&self, expected: usize) {
            tokio::time::timeout(Duration::from_secs(2), async {
                while self.reconciles.load(Ordering::SeqCst) < expected {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        }
    }

    #[async_trait]
    impl DocumentSource for FailOnceBlockingSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            let discovery = self.discoveries.fetch_add(1, Ordering::SeqCst);
            if discovery == 0 {
                return Ok(catalog(vec![summary("docs/retry.md")]));
            }
            self.reconciles.fetch_add(1, Ordering::SeqCst);
            let active = self.active_reconciles.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_active_reconciles
                .fetch_max(active, Ordering::SeqCst);
            if discovery == 1 {
                let (released, wake) = &*self.failure_release;
                let mut released = released.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
                self.active_reconciles.fetch_sub(1, Ordering::SeqCst);
                return Err(AppError::new(
                    ErrorCode::DocumentIndexUnavailable,
                    "injected first reconciliation failure",
                ));
            }
            self.active_reconciles.fetch_sub(1, Ordering::SeqCst);
            Ok(catalog(vec![summary("docs/retry.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(b"retry body".to_vec())
        }
    }

    #[tokio::test]
    async fn failed_run_with_pending_change_retries_once() {
        let temp = TempDir::new().unwrap();
        let source = FailOnceBlockingSource::new();
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        source.wait_until_reconcile_count(1).await;

        let refresh_runtime = runtime.clone();
        let refresh = tokio::spawn(async move { refresh_runtime.refresh(session_id).await });
        tokio::task::yield_now().await;
        let (released, wake) = &*source.failure_release;
        *released.lock().unwrap() = true;
        wake.notify_all();
        refresh.await.unwrap().unwrap();
        source.wait_until_reconcile_count(2).await;
        wait_until_idle(&runtime, session_id).await;

        assert_eq!(source.max_active_reconciles.load(Ordering::SeqCst), 1);
        assert_eq!(source.reconciles.load(Ordering::SeqCst), 2);
        assert_eq!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Ready
        );
    }

    #[derive(Clone)]
    struct BlockingSessionBodySource {
        stale_workspace_id: Uuid,
        active_reads: Arc<AtomicUsize>,
        max_active_reads: Arc<AtomicUsize>,
        stale_started: Arc<Semaphore>,
        stale_release: Arc<Semaphore>,
        current_started: Arc<Semaphore>,
    }

    #[async_trait]
    impl DocumentSource for BlockingSessionBodySource {
        fn discover(&self, workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            let path = if workspace.workspace_id == self.stale_workspace_id {
                "docs/stale.md"
            } else {
                "docs/current.md"
            };
            Ok(catalog(vec![summary(path)]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            struct ActiveRead(Arc<AtomicUsize>);
            impl Drop for ActiveRead {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }

            let active = self.active_reads.fetch_add(1, Ordering::SeqCst) + 1;
            let _active = ActiveRead(self.active_reads.clone());
            self.max_active_reads.fetch_max(active, Ordering::SeqCst);
            if path == "docs/stale.md" {
                self.stale_started.add_permits(1);
                self.stale_release.acquire().await.unwrap().forget();
                Ok(b"stale body".to_vec())
            } else {
                self.current_started.add_permits(1);
                Ok(b"current body".to_vec())
            }
        }
    }

    #[tokio::test]
    async fn stale_session_result_never_updates_cache_or_events() {
        let stale_temp = TempDir::new().unwrap();
        let current_temp = TempDir::new().unwrap();
        let stale_workspace = workspace(&stale_temp);
        let mut current_workspace = workspace(&current_temp);
        current_workspace.workspace_id = Uuid::new_v4();
        let source = BlockingSessionBodySource {
            stale_workspace_id: stale_workspace.workspace_id,
            active_reads: Arc::new(AtomicUsize::new(0)),
            max_active_reads: Arc::new(AtomicUsize::new(0)),
            stale_started: Arc::new(Semaphore::new(0)),
            stale_release: Arc::new(Semaphore::new(0)),
            current_started: Arc::new(Semaphore::new(0)),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let mut events = runtime.subscribe();
        let first = Uuid::new_v4();
        runtime.start_session(first, stale_workspace).await.unwrap();
        source.stale_started.acquire().await.unwrap().forget();
        runtime.stop_session(first).await.unwrap();

        let second = Uuid::new_v4();
        runtime
            .start_session(second, current_workspace)
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), source.current_started.acquire())
                .await
                .is_err()
        );
        source.stale_release.add_permits(1);
        source.current_started.acquire().await.unwrap().forget();
        wait_until_idle(&runtime, second).await;

        assert_eq!(source.max_active_reads.load(Ordering::SeqCst), 1);
        assert!(!runtime
            .snapshot(second)
            .unwrap()
            .catalog
            .documents
            .iter()
            .any(|document| document.path == "docs/stale.md"));
        assert!(!std::iter::from_fn(|| events.try_recv().ok()).any(|event| {
            matches!(
                event,
                DocumentEvent::IndexStatusChanged {
                    session_id,
                    status: IndexStatus::Ready,
                } if session_id == first
            )
        }));
    }

    #[derive(Clone)]
    struct WatcherHandoffSource {
        discoveries: Arc<AtomicUsize>,
        reads: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait]
    impl DocumentSource for WatcherHandoffSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            let path = if self.discoveries.fetch_add(1, Ordering::SeqCst) == 0 {
                "docs/before-watch.md"
            } else {
                "docs/after-watch.md"
            };
            Ok(catalog(vec![summary(path)]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            self.reads.lock().unwrap().push(path.to_owned());
            Ok(format!("body for {path}").into_bytes())
        }
    }

    #[tokio::test]
    async fn cold_start_reconciles_after_watcher_install_to_close_the_handoff_window() {
        let temp = TempDir::new().unwrap();
        let source = WatcherHandoffSource {
            discoveries: Arc::new(AtomicUsize::new(0)),
            reads: Arc::new(Mutex::new(Vec::new())),
        };
        let discoveries_at_install = source.discoveries.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  _sender: mpsc::UnboundedSender<WatcherMessage>| {
                assert_eq!(discoveries_at_install.load(Ordering::SeqCst), 1);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();

        let initial = runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();

        assert_eq!(initial.catalog.documents[0].path, "docs/before-watch.md");
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = runtime.snapshot(session_id).unwrap();
                if snapshot.catalog.documents[0].path == "docs/after-watch.md"
                    && snapshot.index_status == IndexStatus::Ready
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(source.discoveries.load(Ordering::SeqCst), 2);
        assert_eq!(*source.reads.lock().unwrap(), ["docs/after-watch.md"]);
    }

    #[tokio::test]
    async fn refresh_re_reads_only_the_changed_document() {
        let temp = TempDir::new().unwrap();
        let mut first = summary("docs/first.md");
        let second = summary("docs/second.md");
        let source = MutableDocumentSource::new(vec![first.clone(), second.clone()]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.take_reads();

        first.modified_at_unix_ms = 2;
        source.replace_documents(vec![first, second]);
        let discoveries_before_refresh = source.discovery_count();
        runtime.refresh(session_id).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.discovery_count() == discoveries_before_refresh
                || source.reads.lock().unwrap().is_empty()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert_eq!(source.take_reads(), ["docs/first.md"]);
    }

    #[tokio::test]
    async fn access_open_from_native_watcher_does_not_start_a_second_refresh() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        let workspace = workspace(&temp);
        runtime
            .start_session(session_id, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.take_reads();
        let baseline_discoveries = source.discovery_count();
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();
        let watched_path = workspace.repository_root.join("docs/guide.md");

        dispatch_notify_result(
            &sender,
            Ok(
                Event::new(EventKind::Access(AccessKind::Open(AccessMode::Read)))
                    .add_path(watched_path.clone()),
            ),
        );
        tokio::time::sleep(WATCH_COALESCE_WINDOW + Duration::from_millis(75)).await;

        assert_eq!(source.discovery_count(), baseline_discoveries);
        assert!(source.take_reads().is_empty());
        assert!(events.try_recv().is_err());

        dispatch_notify_result(
            &sender,
            Ok(
                Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
                    .add_path(watched_path),
            ),
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(events.recv().await, Ok(DocumentEvent::TreeChanged { .. })) {
                    return;
                }
            }
        })
        .await
        .unwrap();

        tokio::time::sleep(WATCH_COALESCE_WINDOW + Duration::from_millis(75)).await;
        assert_eq!(source.discovery_count(), baseline_discoveries + 1);
        assert!(source.take_reads().is_empty());
        let refreshes = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|event| matches!(event, DocumentEvent::TreeChanged { .. }))
            .count();
        assert_eq!(refreshes, 0);
    }

    #[tokio::test]
    async fn native_directory_rename_burst_causes_one_full_rescan() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        let workspace = workspace(&temp);
        runtime
            .start_session(session_id, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.take_reads();
        let baseline_discoveries = source.discovery_count();
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();
        let old_directory = workspace.repository_root.join("docs/old-guides");
        let new_directory = workspace.repository_root.join("docs/new-guides");

        for event in [
            Event::new(EventKind::Modify(ModifyKind::Name(
                notify::event::RenameMode::From,
            )))
            .add_path(old_directory.clone()),
            Event::new(EventKind::Modify(ModifyKind::Name(
                notify::event::RenameMode::To,
            )))
            .add_path(new_directory.clone()),
            Event::new(EventKind::Modify(ModifyKind::Name(
                notify::event::RenameMode::Both,
            )))
            .add_path(old_directory)
            .add_path(new_directory),
        ] {
            dispatch_notify_result(&sender, Ok(event));
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.discovery_count() == baseline_discoveries {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        wait_until_idle(&runtime, session_id).await;
        tokio::time::sleep(WATCH_COALESCE_WINDOW + Duration::from_millis(75)).await;

        assert_eq!(source.discovery_count(), baseline_discoveries + 1);
        assert!(source.take_reads().is_empty());
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(event, DocumentEvent::TreeChanged { .. }))
                .count(),
            1
        );
    }

    #[derive(Clone)]
    struct ManualRecoveryRaceSource {
        discoveries: Arc<AtomicUsize>,
        follow_up_started: Arc<std::sync::atomic::AtomicBool>,
        follow_up_gate: Arc<(Mutex<bool>, Condvar)>,
    }

    #[async_trait]
    impl DocumentSource for ManualRecoveryRaceSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.discoveries.fetch_add(1, Ordering::SeqCst) == 3 {
                self.follow_up_started.store(true, Ordering::SeqCst);
                let (released, wake) = &*self.follow_up_gate;
                let mut released = released.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
            }
            Ok(catalog(vec![summary("docs/guide.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(b"guide body".to_vec())
        }
    }

    #[tokio::test]
    async fn manual_recovery_wait_claim_is_not_consumed_by_a_paused_watcher_run() {
        let temp = TempDir::new().unwrap();
        let source = ManualRecoveryRaceSource {
            discoveries: Arc::new(AtomicUsize::new(0)),
            follow_up_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            follow_up_gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();
        sender.send(WatcherMessage::BackendError).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(
                    events.recv().await,
                    Ok(DocumentEvent::IndexStatusChanged {
                        status: IndexStatus::Degraded { .. },
                        ..
                    })
                ) {
                    return;
                }
            }
        })
        .await
        .unwrap();

        let worker_pause = ReconcileWorkerPause {
            session_id,
            reached: Arc::new(Semaphore::new(0)),
            release: Arc::new(Semaphore::new(0)),
        };
        *runtime
            .inner
            .reconcile_worker_pause
            .lock()
            .expect("document runtime poisoned") = Some(worker_pause.clone());
        sender.send(WatcherMessage::RepositoryChanged).unwrap();
        worker_pause.reached.acquire().await.unwrap().forget();

        runtime.refresh(session_id).await.unwrap();
        worker_pause.release.add_permits(1);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !source.follow_up_started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let status_before_follow_up = runtime.snapshot(session_id).unwrap().index_status;
        let (released, wake) = &*source.follow_up_gate;
        *released.lock().unwrap() = true;
        wake.notify_all();
        tokio::time::timeout(Duration::from_secs(2), async {
            while runtime.snapshot(session_id).unwrap().index_status != IndexStatus::Ready {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(matches!(
            status_before_follow_up,
            IndexStatus::Degraded { .. }
        ));
        assert_eq!(source.discoveries.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn rename_removes_the_old_document_and_indexes_the_new_path() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/old.md")]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        runtime
            .set_open_document(session_id, "docs/old.md")
            .unwrap();

        source.replace_documents(vec![summary("docs/new.md")]);
        runtime.refresh(session_id).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while runtime.snapshot(session_id).unwrap().catalog.documents[0].path != "docs/new.md" {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        let snapshot = runtime.snapshot(session_id).unwrap();
        assert_eq!(
            snapshot
                .catalog
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/new.md"]
        );
        assert_eq!(snapshot.last_opened_path, None);
        assert!(runtime
            .search(session_id, "docs/old.md", 20)
            .await
            .unwrap()
            .items
            .is_empty());
        assert!(runtime
            .search(session_id, "docs/new.md", 20)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/new.md"));
    }

    #[tokio::test]
    async fn warm_start_returns_cached_tree_before_slow_filesystem_reconciliation() {
        let temp = TempDir::new().unwrap();
        let source = BlockedWarmReconciliationSource {
            blocked: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let first = Uuid::new_v4();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, first).await;
        runtime.stop_session(first).await.unwrap();
        source.started.store(false, Ordering::SeqCst);
        source.blocked.store(true, Ordering::SeqCst);
        let second = Uuid::new_v4();

        let warm_start = tokio::time::timeout(
            Duration::from_secs(2),
            runtime.start_session(second, workspace(&temp)),
        )
        .await;
        if warm_start.is_err() {
            let (lock, wake) = &*source.gate;
            *lock.lock().unwrap() = true;
            wake.notify_all();
            panic!("warm start waited for filesystem reconciliation");
        }
        let snapshot = warm_start.unwrap().unwrap();
        let reconcile_started = tokio::time::timeout(Duration::from_secs(2), async {
            while !source.started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await;
        let (lock, wake) = &*source.gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        assert!(
            reconcile_started.is_ok(),
            "warm reconciliation did not start"
        );

        assert_eq!(snapshot.catalog.documents[0].path, "docs/kept.md");
        wait_until_idle(&runtime, second).await;
        runtime.stop_session(second).await.unwrap();
    }

    #[derive(Clone)]
    struct BlockedWarmReconciliationSource {
        blocked: Arc<std::sync::atomic::AtomicBool>,
        started: Arc<std::sync::atomic::AtomicBool>,
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    #[async_trait]
    impl DocumentSource for BlockedWarmReconciliationSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.blocked.load(Ordering::SeqCst) {
                self.started.store(true, Ordering::SeqCst);
                let (lock, wake) = &*self.gate;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
            }
            Ok(catalog(vec![summary("docs/kept.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(b"kept current body".to_vec())
        }
    }

    #[tokio::test]
    async fn warm_start_filters_changed_roots_and_clears_out_of_scope_selection() {
        let temp = TempDir::new().unwrap();
        let mut workspace = workspace(&temp);
        workspace.document_roots = vec!["./docs".to_owned()];
        std::fs::create_dir_all(workspace.repository_root.join("legacy")).unwrap();
        std::fs::write(
            workspace.repository_root.join("legacy/old.md"),
            "legacy physical body",
        )
        .unwrap();
        std::fs::write(
            workspace.repository_root.join("docs/kept.md"),
            "kept physical body",
        )
        .unwrap();
        let mut cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();
        cache
            .upsert_content(&summary("legacy/old.md"), b"legacy cached token")
            .unwrap();
        cache
            .upsert_content(&summary("docs/kept.md"), b"kept cached token")
            .unwrap();
        cache.set_last_opened_path(Some("legacy/old.md")).unwrap();
        drop(cache);
        let source = BlockedWarmReconciliationSource {
            blocked: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();

        let snapshot = runtime
            .start_session(session_id, workspace.clone())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !source.started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let open_result = runtime.set_open_document(session_id, "legacy/old.md");
        let legacy_search = runtime.search(session_id, "legacy cached", 20).await;
        let kept_search = runtime.search(session_id, "kept cached", 20).await;
        let (lock, wake) = &*source.gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        wait_until_idle(&runtime, session_id).await;
        runtime.stop_session(session_id).await.unwrap();
        let cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();

        assert_eq!(
            snapshot
                .catalog
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/kept.md"]
        );
        assert!(matches!(
            snapshot.catalog.roots.as_slice(),
            [DocumentTreeEntry::Folder { path, children, .. }]
                if path == "docs" && children.len() == 1
        ));
        assert_eq!(
            snapshot.index_status,
            IndexStatus::Preparing {
                indexed: 0,
                total: 1
            }
        );
        assert_eq!(snapshot.last_opened_path, None);
        assert_eq!(
            open_result.unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
        assert!(legacy_search.unwrap().items.is_empty());
        assert!(kept_search
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/kept.md"));
        assert_eq!(cache.last_opened_path().unwrap(), None);
        assert_eq!(
            cache
                .cached_summaries()
                .unwrap()
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/kept.md"]
        );
    }

    #[tokio::test]
    async fn missing_last_opened_document_is_cleared_from_the_next_session_snapshot() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let document_path = workspace.repository_root.join("docs/guide.md");
        std::fs::write(&document_path, "# Guide").unwrap();
        let runtime = DocumentRuntime::new();
        let first = Uuid::new_v4();
        runtime
            .start_session(first, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, first).await;
        runtime.set_open_document(first, "docs/guide.md").unwrap();
        runtime.stop_session(first).await.unwrap();
        let second = Uuid::new_v4();
        let restored = runtime
            .start_session(second, workspace.clone())
            .await
            .unwrap();
        assert_eq!(restored.last_opened_path.as_deref(), Some("docs/guide.md"));
        runtime.stop_session(second).await.unwrap();
        std::fs::remove_file(document_path).unwrap();

        let snapshot = runtime
            .start_session(Uuid::new_v4(), workspace)
            .await
            .unwrap();

        assert_eq!(snapshot.last_opened_path, None);
    }

    #[tokio::test]
    async fn newer_watcher_failure_invalidates_a_paused_manual_recovery_claim() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime =
            DocumentRuntime::with_source_and_watcher_factory(Arc::new(source), watcher_factory);
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();
        sender.send(WatcherMessage::BackendError).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(
                    events.recv().await,
                    Ok(DocumentEvent::IndexStatusChanged {
                        status: IndexStatus::Degraded { .. },
                        ..
                    })
                ) {
                    return;
                }
            }
        })
        .await
        .unwrap();
        let first_degradation_id = {
            let state = runtime
                .inner
                .state
                .lock()
                .expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_ref() else {
                panic!("expected active session");
            };
            session.watcher_degradation_id.unwrap()
        };

        let worker_pause = ReconcileWorkerPause {
            session_id,
            reached: Arc::new(Semaphore::new(0)),
            release: Arc::new(Semaphore::new(0)),
        };
        *runtime
            .inner
            .reconcile_worker_pause
            .lock()
            .expect("document runtime poisoned") = Some(worker_pause.clone());
        runtime.refresh(session_id).await.unwrap();
        worker_pause.reached.acquire().await.unwrap().forget();

        sender.send(WatcherMessage::BackendError).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let changed = {
                    let state = runtime
                        .inner
                        .state
                        .lock()
                        .expect("document runtime poisoned");
                    matches!(
                        state.generation.as_ref(),
                        Some(Generation::Active(session))
                            if session.watcher_degradation_id.is_some()
                                && session.watcher_degradation_id != Some(first_degradation_id)
                    )
                };
                if changed {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        worker_pause.release.add_permits(1);
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(events.recv().await, Ok(DocumentEvent::TreeChanged { .. })) {
                    return;
                }
            }
        })
        .await
        .unwrap();

        assert!(matches!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Degraded { .. }
        ));
    }

    #[tokio::test]
    async fn injected_watcher_failure_degrades_without_disabling_search_or_refresh() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime =
            DocumentRuntime::with_source_and_watcher_factory(Arc::new(source), watcher_factory);
        let session_id = Uuid::new_v4();
        let workspace = workspace(&temp);
        runtime.start_session(session_id, workspace).await.unwrap();
        wait_until_idle(&runtime, session_id).await;
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();

        dispatch_notify_result(
            &sender,
            Err(notify::Error::generic("same injected backend failure")),
        );
        dispatch_notify_result(
            &sender,
            Err(notify::Error::generic("same injected backend failure")),
        );
        let degraded = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let DocumentEvent::IndexStatusChanged { status, .. } =
                    events.recv().await.unwrap()
                {
                    return status;
                }
            }
        })
        .await
        .unwrap();

        assert!(matches!(degraded, IndexStatus::Degraded { .. }));
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!std::iter::from_fn(|| events.try_recv().ok())
            .any(|event| matches!(event, DocumentEvent::IndexStatusChanged { .. })));
        assert!(matches!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Degraded { .. }
        ));
        assert!(runtime
            .search(session_id, "guide", 20)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/guide.md"));
        sender.send(WatcherMessage::RepositoryChanged).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(events.recv().await, Ok(DocumentEvent::TreeChanged { .. })) {
                    return;
                }
            }
        })
        .await
        .unwrap();
        assert!(matches!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Degraded { .. }
        ));
        assert!(
            !std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(
                event,
                DocumentEvent::IndexStatusChanged {
                    status: IndexStatus::Ready,
                    ..
                }
            ))
        );

        runtime.refresh(session_id).await.unwrap();
        let recovered = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let DocumentEvent::IndexStatusChanged { status, .. } =
                    events.recv().await.unwrap()
                {
                    if status == IndexStatus::Ready {
                        return status;
                    }
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(recovered, IndexStatus::Ready);
        assert_eq!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Ready
        );
    }

    #[tokio::test]
    async fn injected_watcher_setup_error_degrades_without_disabling_refresh_and_search() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            |_repository_root: &std::path::Path,
             _roots: &[String],
             _sender: mpsc::UnboundedSender<WatcherMessage>| {
                Err(notify::Error::generic("injected watcher setup failure"))
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        let mut events = runtime.subscribe();

        let started = runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        assert!(matches!(started.index_status, IndexStatus::Degraded { .. }));
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.discovery_count() < 2
                || source.reads.lock().unwrap().is_empty()
                || runtime
                    .search(session_id, "guide", 20)
                    .await
                    .unwrap()
                    .items
                    .is_empty()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;

        let startup_statuses = std::iter::from_fn(|| events.try_recv().ok())
            .filter_map(|event| match event {
                DocumentEvent::IndexStatusChanged { status, .. } => Some(status),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(startup_statuses.len(), 2);
        assert_eq!(
            startup_statuses[0],
            IndexStatus::Preparing {
                indexed: 0,
                total: 1,
            }
        );
        assert!(matches!(startup_statuses[1], IndexStatus::Degraded { .. }));

        assert!(runtime
            .search(session_id, "guide", 20)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/guide.md"));
        let mut updated = summary("docs/guide.md");
        updated.modified_at_unix_ms = 2;
        source.replace_documents(vec![updated]);
        source.bodies.lock().unwrap().insert(
            "docs/guide.md".to_owned(),
            b"manual refresh remains searchable".to_vec(),
        );
        let discoveries_before_refresh = source.discovery_count();
        runtime.refresh(session_id).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.discovery_count() != discoveries_before_refresh + 1
                || runtime
                    .search(session_id, "manual refresh remains", 20)
                    .await
                    .unwrap()
                    .items
                    .is_empty()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;

        assert_eq!(
            runtime.snapshot(session_id).unwrap().catalog.documents[0].modified_at_unix_ms,
            2
        );
        assert!(matches!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Degraded { .. }
        ));
        assert_eq!(
            std::iter::from_fn(|| events.try_recv().ok())
                .filter(|event| matches!(event, DocumentEvent::IndexStatusChanged { .. }))
                .count(),
            0
        );
    }

    struct DropWatcher {
        _sender: mpsc::UnboundedSender<WatcherMessage>,
        drops: Arc<AtomicUsize>,
    }

    impl Drop for DropWatcher {
        fn drop(&mut self) {
            self.drops.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn dropping_the_last_runtime_handle_releases_watcher_task_and_cache_state() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = BlockingSessionBodySource {
            stale_workspace_id: workspace.workspace_id,
            active_reads: Arc::new(AtomicUsize::new(0)),
            max_active_reads: Arc::new(AtomicUsize::new(0)),
            stale_started: Arc::new(Semaphore::new(0)),
            stale_release: Arc::new(Semaphore::new(0)),
            current_started: Arc::new(Semaphore::new(0)),
        };
        let watcher_drops = Arc::new(AtomicUsize::new(0));
        let observed_drops = watcher_drops.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                Ok(Box::new(DropWatcher {
                    _sender: sender,
                    drops: observed_drops.clone(),
                }) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let weak_inner = Arc::downgrade(&runtime.inner);
        let session_id = Uuid::new_v4();
        runtime.start_session(session_id, workspace).await.unwrap();
        source.stale_started.acquire().await.unwrap().forget();
        runtime.stop_session(session_id).await.unwrap();

        drop(runtime);
        source.stale_release.add_permits(1);
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.active_reads.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            while weak_inner.upgrade().is_some() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(watcher_drops.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn watcher_coalesces_repository_changes_inside_one_150_ms_refresh_batch() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source =
            MutableDocumentSource::new(vec![summary("docs/first.md"), summary("docs/second.md")]);
        let watcher_sender = Arc::new(Mutex::new(None));
        let captured_sender = watcher_sender.clone();
        let watcher_factory: Arc<WatcherFactory> = Arc::new(
            move |_repository_root: &std::path::Path,
                  _roots: &[String],
                  sender: mpsc::UnboundedSender<WatcherMessage>| {
                *captured_sender.lock().unwrap() = Some(sender);
                Ok(Box::new(()) as Box<dyn WatcherGuard>)
            },
        );
        let runtime = DocumentRuntime::with_source_and_watcher_factory(
            Arc::new(source.clone()),
            watcher_factory,
        );
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.take_reads();
        let baseline_discoveries = source.discovery_count();
        let mut events = runtime.subscribe();
        let sender = watcher_sender.lock().unwrap().as_ref().unwrap().clone();

        let first_sent_at = Instant::now();
        sender.send(WatcherMessage::RepositoryChanged).unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(first_sent_at.elapsed() < super::WATCH_COALESCE_WINDOW);
        sender.send(WatcherMessage::RepositoryChanged).unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if matches!(events.recv().await, Ok(DocumentEvent::TreeChanged { .. })) {
                    return;
                }
            }
        })
        .await
        .unwrap();

        tokio::time::sleep(WATCH_COALESCE_WINDOW + Duration::from_millis(75)).await;
        assert_eq!(source.discovery_count(), baseline_discoveries + 1);
        assert!(source.take_reads().is_empty());
        let refresh_batches = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|event| matches!(event, DocumentEvent::TreeChanged { .. }))
            .count();
        assert_eq!(refresh_batches, 0);
    }

    #[tokio::test]
    async fn rename_with_stable_document_id_moves_last_opened_path() {
        let temp = TempDir::new().unwrap();
        let document_id = Uuid::new_v4();
        let mut old = summary("docs/old.md");
        old.document_id = Some(document_id);
        let source = MutableDocumentSource::new(vec![old]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        runtime
            .set_open_document(session_id, "docs/old.md")
            .unwrap();

        let mut renamed = summary("docs/new.md");
        renamed.document_id = Some(document_id);
        source.replace_documents(vec![renamed]);
        runtime.refresh(session_id).await.unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            while runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path
                .as_deref()
                != Some("docs/new.md")
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert_eq!(
            runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path
                .as_deref(),
            Some("docs/new.md")
        );
    }

    #[tokio::test]
    async fn duplicate_old_document_id_does_not_move_last_opened_path() {
        let temp = TempDir::new().unwrap();
        let document_id = Uuid::new_v4();
        let mut opened = summary("docs/opened.md");
        opened.document_id = Some(document_id);
        let mut duplicate = summary("docs/duplicate.md");
        duplicate.document_id = Some(document_id);
        let source = MutableDocumentSource::new(vec![opened, duplicate]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        runtime
            .set_open_document(session_id, "docs/opened.md")
            .unwrap();

        let mut renamed = summary("docs/new.md");
        renamed.document_id = Some(document_id);
        source.replace_documents(vec![renamed]);
        runtime.refresh(session_id).await.unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            while runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path
                .is_some()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert_eq!(runtime.snapshot(session_id).unwrap().last_opened_path, None);
    }

    #[derive(Clone)]
    struct CurrentDiscoveryFailureSource {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl DocumentSource for CurrentDiscoveryFailureSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.calls.fetch_add(1, Ordering::SeqCst) < 2 {
                Ok(catalog(vec![summary("docs/initial.md")]))
            } else {
                Err(AppError::new(
                    ErrorCode::DocumentIndexUnavailable,
                    "current discovery failed",
                ))
            }
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(format!("body for {path}").into_bytes())
        }
    }

    #[tokio::test]
    async fn a_current_discovery_failure_still_publishes_failed() {
        let temp = TempDir::new().unwrap();
        let source = CurrentDiscoveryFailureSource {
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source));
        let session_id = Uuid::new_v4();
        let workspace = workspace(&temp);
        runtime.start_session(session_id, workspace).await.unwrap();
        wait_until_idle(&runtime, session_id).await;

        let mut events = runtime.subscribe();
        runtime.refresh(session_id).await.unwrap();

        let error = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let DocumentEvent::Failed { error, .. } = events.recv().await.unwrap() {
                    return error;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(error.code, ErrorCode::DocumentIndexUnavailable);
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_current_open_document_reconciliation_failure_is_published_once() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = MutableDocumentSource::new(vec![summary("docs/previous.md")]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        runtime
            .set_open_document(session_id, "docs/previous.md")
            .unwrap();
        source.replace_documents(vec![summary("docs/current.md")]);
        rusqlite::Connection::open(&workspace.cache_path)
            .unwrap()
            .execute_batch("DROP TABLE meta")
            .unwrap();

        let mut events = runtime.subscribe();
        runtime.refresh(session_id).await.unwrap();
        let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            event,
            DocumentEvent::Failed {
                session_id: failed_session_id,
                error: AppError {
                    code: ErrorCode::DocumentIndexUnavailable,
                    ..
                },
            } if failed_session_id == session_id
        ));
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_session_uuid_can_be_reused_after_stop_or_replacement() {
        let temp = TempDir::new().unwrap();
        let runtime = DocumentRuntime::with_source(Arc::new(MutableDocumentSource::new(vec![])));
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();
        runtime.stop_session(first).await.unwrap();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();

        runtime
            .start_session(second, workspace(&temp))
            .await
            .unwrap();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();
        assert_eq!(runtime.snapshot(first).unwrap().session_id, first);
    }

    #[derive(Clone)]
    struct SameIdReuseRaceSource {
        discoveries: Arc<AtomicUsize>,
        stale_started: Arc<std::sync::atomic::AtomicBool>,
        stale_gate: Arc<(Mutex<bool>, Condvar)>,
    }

    #[async_trait]
    impl DocumentSource for SameIdReuseRaceSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            match self.discoveries.fetch_add(1, Ordering::SeqCst) {
                2 => {
                    self.stale_started.store(true, Ordering::SeqCst);
                    let (lock, wake) = &*self.stale_gate;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = wake.wait(released).unwrap();
                    }
                    Ok(catalog(vec![summary("docs/stale.md")]))
                }
                _ => Ok(catalog(vec![summary("docs/current.md")])),
            }
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(format!("body for {path}").into_bytes())
        }
    }

    #[tokio::test]
    async fn stale_work_for_x_cannot_alias_a_later_generation_of_x() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = SameIdReuseRaceSource {
            discoveries: Arc::new(AtomicUsize::new(0)),
            stale_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stale_gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let x = Uuid::new_v4();
        let replacement = Uuid::new_v4();

        runtime.start_session(x, workspace.clone()).await.unwrap();
        wait_until_idle(&runtime, x).await;
        runtime.refresh(x).await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !source.stale_started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        runtime
            .start_session(replacement, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, replacement).await;
        runtime.start_session(x, workspace).await.unwrap();
        wait_until_idle(&runtime, x).await;
        let mut events = runtime.subscribe();

        let (lock, wake) = &*source.stale_gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        tokio::time::sleep(Duration::from_millis(20)).await;

        let snapshot = runtime.snapshot(x).unwrap();
        assert_eq!(snapshot.catalog.documents[0].path, "docs/current.md");
        assert_eq!(snapshot.index_status, IndexStatus::Ready);
        assert!(events.try_recv().is_err());
    }

    #[derive(Clone)]
    struct DelayedOwnerCallbackSource {
        discoveries: Arc<AtomicUsize>,
        return_stale: Arc<std::sync::atomic::AtomicBool>,
    }

    #[async_trait]
    impl DocumentSource for DelayedOwnerCallbackSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            self.discoveries.fetch_add(1, Ordering::SeqCst);
            let path = if self.return_stale.load(Ordering::SeqCst) {
                "docs/stale.md"
            } else {
                "docs/current.md"
            };
            Ok(catalog(vec![summary(path)]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(format!("body for {path}").into_bytes())
        }
    }

    #[tokio::test]
    async fn delayed_callback_for_old_x_cannot_enter_a_later_generation_of_x() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = DelayedOwnerCallbackSource {
            discoveries: Arc::new(AtomicUsize::new(0)),
            return_stale: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let x = Uuid::new_v4();
        let replacement = Uuid::new_v4();

        runtime.start_session(x, workspace.clone()).await.unwrap();
        wait_until_idle(&runtime, x).await;
        let old_owner = runtime
            .inner
            .state
            .lock()
            .expect("document runtime poisoned")
            .generation
            .as_ref()
            .unwrap()
            .owner();
        runtime
            .start_session(replacement, workspace.clone())
            .await
            .unwrap();
        wait_until_idle(&runtime, replacement).await;
        runtime.start_session(x, workspace).await.unwrap();
        wait_until_idle(&runtime, x).await;

        let discoveries_before = source.discoveries.load(Ordering::SeqCst);
        let mut events = runtime.subscribe();
        source.return_stale.store(true, Ordering::SeqCst);
        assert_eq!(
            runtime.request_reconcile(old_owner).unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );

        assert_eq!(
            source.discoveries.load(Ordering::SeqCst),
            discoveries_before
        );
        let snapshot = runtime.snapshot(x).unwrap();
        assert_eq!(snapshot.catalog.documents[0].path, "docs/current.md");
        assert_eq!(snapshot.index_status, IndexStatus::Ready);
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn repeated_failed_starts_do_not_retain_session_ids() {
        let temp = TempDir::new().unwrap();
        let runtime = DocumentRuntime::with_cache_opener(
            Arc::new(MutableDocumentSource::new(vec![])),
            Arc::new(|_, _| {
                Err(CacheError::Io(std::io::Error::other(
                    "deliberate cache-open failure",
                )))
            }),
        );
        let ids = (0..64).map(|_| Uuid::new_v4()).collect::<Vec<_>>();

        for session_id in ids.iter().chain(ids.iter()) {
            assert_eq!(
                runtime
                    .start_session(*session_id, workspace(&temp))
                    .await
                    .unwrap_err()
                    .code,
                ErrorCode::DocumentIndexUnavailable
            );
        }
        assert!(runtime
            .inner
            .state
            .lock()
            .expect("document runtime poisoned")
            .generation
            .is_none());
    }

    #[tokio::test]
    async fn aborting_start_keeps_the_startup_gate_until_cache_open_finishes() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let stale_id = Uuid::new_v4();
        let replacement_id = Uuid::new_v4();
        let first_started = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first_finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first_gate = Arc::new((Mutex::new(false), Condvar::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let replacement_stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let completed_after_stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let runtime = DocumentRuntime::with_cache_opener(
            Arc::new(MutableDocumentSource::new(vec![])),
            Arc::new({
                let first_started = first_started.clone();
                let first_finished = first_finished.clone();
                let first_gate = first_gate.clone();
                let calls = calls.clone();
                let active = active.clone();
                let max_active = max_active.clone();
                let replacement_stopped = replacement_stopped.clone();
                let completed_after_stop = completed_after_stop.clone();
                move |path, workspace_id| {
                    let call = calls.fetch_add(1, Ordering::SeqCst);
                    let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(now_active, Ordering::SeqCst);
                    if call == 0 {
                        first_started.store(true, Ordering::SeqCst);
                        let (lock, wake) = &*first_gate;
                        let mut released = lock.lock().unwrap();
                        while !*released {
                            released = wake.wait(released).unwrap();
                        }
                    }
                    let result = DocumentCache::open(path, workspace_id);
                    if replacement_stopped.load(Ordering::SeqCst) {
                        completed_after_stop.store(true, Ordering::SeqCst);
                    }
                    active.fetch_sub(1, Ordering::SeqCst);
                    if call == 0 {
                        first_finished.store(true, Ordering::SeqCst);
                    }
                    result
                }
            }),
        );
        let mut stale_workspace = workspace.clone();
        stale_workspace.workspace_id = Uuid::new_v4();

        let stale_runtime = runtime.clone();
        let stale =
            tokio::spawn(
                async move { stale_runtime.start_session(stale_id, stale_workspace).await },
            );
        tokio::time::timeout(Duration::from_secs(2), async {
            while !first_started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        stale.abort();
        assert!(stale.await.unwrap_err().is_cancelled());

        let gate_held_after_abort = runtime.inner.startup_mutations.try_lock().is_err();
        let replacement_runtime = runtime.clone();
        let replacement_workspace = workspace.clone();
        let replacement = tokio::spawn(async move {
            replacement_runtime
                .start_session(replacement_id, replacement_workspace)
                .await
        });

        if gate_held_after_abort {
            let (lock, wake) = &*first_gate;
            *lock.lock().unwrap() = true;
            wake.notify_all();
            replacement.await.unwrap().unwrap();
            runtime.stop_session(replacement_id).await.unwrap();
            replacement_stopped.store(true, Ordering::SeqCst);
        } else {
            replacement.await.unwrap().unwrap();
            runtime.stop_session(replacement_id).await.unwrap();
            replacement_stopped.store(true, Ordering::SeqCst);
            let (lock, wake) = &*first_gate;
            *lock.lock().unwrap() = true;
            wake.notify_all();
        }

        tokio::time::timeout(Duration::from_secs(2), async {
            while !first_finished.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(gate_held_after_abort);
        assert_eq!(max_active.load(Ordering::SeqCst), 1);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert!(!completed_after_stop.load(Ordering::SeqCst));
    }

    #[derive(Clone)]
    struct SupersededStartupSource {
        discoveries: Arc<AtomicUsize>,
        stale_started: Arc<std::sync::atomic::AtomicBool>,
        stale_gate: Arc<(Mutex<bool>, Condvar)>,
    }

    #[async_trait]
    impl DocumentSource for SupersededStartupSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.discoveries.fetch_add(1, Ordering::SeqCst) == 0 {
                self.stale_started.store(true, Ordering::SeqCst);
                let (lock, wake) = &*self.stale_gate;
                let mut released = lock.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
                return Ok(catalog(vec![summary("docs/stale.md")]));
            }
            Ok(catalog(vec![summary("docs/current.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(format!("body for {path}").into_bytes())
        }
    }

    #[tokio::test]
    async fn superseded_startup_cannot_clear_the_current_sessions_cached_preference() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        std::fs::write(
            workspace.repository_root.join("docs/current.md"),
            "# Current",
        )
        .unwrap();
        let cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();
        cache
            .set_last_opened_path(Some("docs/previous.md"))
            .unwrap();
        drop(cache);

        let source = SupersededStartupSource {
            discoveries: Arc::new(AtomicUsize::new(0)),
            stale_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            stale_gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let stale_id = Uuid::new_v4();
        let current_id = Uuid::new_v4();

        let stale_runtime = runtime.clone();
        let stale_workspace = workspace.clone();
        let stale =
            tokio::spawn(
                async move { stale_runtime.start_session(stale_id, stale_workspace).await },
            );
        tokio::time::timeout(Duration::from_secs(2), async {
            while !source.stale_started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        runtime
            .start_session(current_id, workspace.clone())
            .await
            .unwrap();
        runtime
            .set_open_document(current_id, "docs/current.md")
            .unwrap();

        let (lock, wake) = &*source.stale_gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        assert_eq!(
            stale.await.unwrap().unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );

        assert_eq!(
            runtime
                .snapshot(current_id)
                .unwrap()
                .last_opened_path
                .as_deref(),
            Some("docs/current.md")
        );
        runtime.stop_session(current_id).await.unwrap();
        let cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();
        assert_eq!(
            cache.last_opened_path().unwrap().as_deref(),
            Some("docs/current.md")
        );
    }

    #[tokio::test]
    async fn superseded_startup_is_rejected_before_it_can_open_or_rebuild_the_cache() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        std::fs::write(
            workspace.repository_root.join("docs/current.md"),
            "# Current",
        )
        .unwrap();
        let cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();
        cache.set_last_opened_path(Some("docs/current.md")).unwrap();
        drop(cache);

        let stale_id = Uuid::new_v4();
        let current_id = Uuid::new_v4();
        let startup_pause = StartupReservationPause {
            session_id: stale_id,
            reached: Arc::new(Semaphore::new(0)),
            release: Arc::new(Semaphore::new(0)),
        };
        let opened_workspace_ids = Arc::new(Mutex::new(Vec::new()));
        let observed_ids = opened_workspace_ids.clone();
        let runtime = DocumentRuntime::with_source_and_startup_controls(
            Arc::new(MutableDocumentSource::new(vec![summary("docs/current.md")])),
            Arc::new(move |path: PathBuf, workspace_id| {
                observed_ids.lock().unwrap().push(workspace_id);
                DocumentCache::open(path, workspace_id)
            }),
            startup_pause.clone(),
        );
        let mut stale_workspace = workspace.clone();
        stale_workspace.workspace_id = Uuid::new_v4();

        let stale_runtime = runtime.clone();
        let stale =
            tokio::spawn(
                async move { stale_runtime.start_session(stale_id, stale_workspace).await },
            );
        startup_pause.reached.acquire().await.unwrap().forget();

        let snapshot = runtime
            .start_session(current_id, workspace.clone())
            .await
            .unwrap();
        assert_eq!(
            snapshot.last_opened_path.as_deref(),
            Some("docs/current.md")
        );
        startup_pause.release.add_permits(1);
        assert_eq!(
            stale.await.unwrap().unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );

        assert_eq!(
            *opened_workspace_ids.lock().unwrap(),
            vec![workspace.workspace_id]
        );
        runtime.stop_session(current_id).await.unwrap();
        let cache = DocumentCache::open(&workspace.cache_path, workspace.workspace_id).unwrap();
        assert_eq!(
            cache.last_opened_path().unwrap().as_deref(),
            Some("docs/current.md")
        );
    }

    async fn wait_until_idle(runtime: &DocumentRuntime, session_id: Uuid) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if runtime.snapshot(session_id).unwrap().index_status == IndexStatus::Ready {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    fn workspace(temp: &TempDir) -> DocumentWorkspace {
        let repository_root = temp.path().join("repository");
        std::fs::create_dir_all(repository_root.join("docs")).unwrap();
        DocumentWorkspace {
            workspace_id: Uuid::parse_str("9f9e8ac7-cf5a-4f83-b716-0b52e69fb9d6").unwrap(),
            repository_root,
            document_roots: vec!["docs".to_owned()],
            cache_path: temp.path().join("search.sqlite3"),
        }
    }

    fn summary(path: &str) -> DocumentSummary {
        DocumentSummary {
            path: path.to_owned(),
            file_name: PathBuf::from(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            title: "Session".to_owned(),
            document_id: None,
            frontmatter_status: FrontmatterStatus::Missing,
            modified_at_unix_ms: 1,
            size: 32,
        }
    }

    fn catalog(documents: Vec<DocumentSummary>) -> DocumentCatalog {
        DocumentCatalog {
            roots: vec![DocumentTreeEntry::Folder {
                name: "docs".to_owned(),
                path: "docs".to_owned(),
                children: documents
                    .iter()
                    .cloned()
                    .map(|summary| DocumentTreeEntry::Document { summary })
                    .collect(),
            }],
            documents,
        }
    }
}
