use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
use super::indexer::{catalog_from_summaries, spawn_body_reads};
use super::watcher::{
    affected_markdown_paths, DocumentWatcher, WatcherMessage, WATCH_COALESCE_WINDOW,
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
    cache_opener: Arc<CacheOpener>,
    state: Mutex<RuntimeState>,
    startup_mutations: AsyncMutex<()>,
    events: broadcast::Sender<DocumentEvent>,
    #[cfg(test)]
    startup_pause: Mutex<Option<StartupReservationPause>>,
}

struct RuntimeState {
    generation: Option<Generation>,
    seen_session_ids: HashSet<Uuid>,
    next_nonce: u64,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            generation: None,
            seen_session_ids: HashSet::new(),
            next_nonce: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SessionOwner {
    session_id: Uuid,
    nonce: u64,
}

enum Generation {
    Starting {
        owner: SessionOwner,
        cancellation: CancellationToken,
    },
    Active(ActiveSession),
}

struct ActiveSession {
    owner: SessionOwner,
    cancellation: CancellationToken,
    workspace: DocumentWorkspace,
    cache: DocumentCache,
    snapshot: DocumentSessionSnapshot,
    index_revision: u64,
    index_cancellation: CancellationToken,
    watcher_degraded: Option<String>,
    watcher: Option<DocumentWatcher>,
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
        let (events, _) = broadcast::channel(64);
        Self {
            inner: Arc::new(RuntimeInner {
                source,
                cache_opener,
                state: Mutex::new(RuntimeState::default()),
                startup_mutations: AsyncMutex::new(()),
                events,
                #[cfg(test)]
                startup_pause: Mutex::new(None),
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
        validate_session_id(session_id)?;
        let cancellation = CancellationToken::new();
        let owner = {
            let _mutation_guard = self.inner.startup_mutations.lock().await;
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            if !state.seen_session_ids.insert(session_id) {
                return Err(session_conflict());
            }
            let owner = SessionOwner {
                session_id,
                nonce: state.next_nonce,
            };
            state.next_nonce = state.next_nonce.wrapping_add(1).max(1);
            if let Some(previous) = state.generation.take() {
                previous.cancel();
            }
            state.generation = Some(Generation::Starting {
                owner,
                cancellation: cancellation.clone(),
            });
            owner
        };

        #[cfg(test)]
        self.pause_after_reservation(owner).await;

        let result = self
            .prepare_session(owner, workspace, cancellation.clone())
            .await;
        let (snapshot, catalog, warm_start, index_cancellation) = match result {
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

        let runtime = self.clone();
        tokio::spawn(async move {
            if warm_start {
                runtime.reconcile_filesystem(owner).await;
            } else {
                runtime
                    .index_catalog(owner, 0, catalog, index_cancellation, None)
                    .await;
            }
        });
        Ok(snapshot)
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
        generation.cancel();
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
        self.refresh_inner(session_id, None).await
    }

    pub(crate) async fn refresh_affected(
        &self,
        session_id: Uuid,
        affected_paths: Vec<String>,
    ) -> Result<(), AppError> {
        self.refresh_inner(session_id, Some(affected_paths)).await
    }

    async fn refresh_inner(
        &self,
        session_id: Uuid,
        affected_paths: Option<Vec<String>>,
    ) -> Result<(), AppError> {
        let (owner, revision, cancellation, workspace) = {
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_mut() else {
                return Err(session_conflict());
            };
            if session.owner.session_id != session_id {
                return Err(session_conflict());
            }
            session.index_cancellation.cancel();
            session.index_revision = session.index_revision.wrapping_add(1);
            session.index_cancellation = session.cancellation.child_token();
            (
                session.owner,
                session.index_revision,
                session.index_cancellation.clone(),
                session.workspace.clone(),
            )
        };
        let catalog = self.discover(workspace.clone()).await?;
        {
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_mut() else {
                return Err(session_conflict());
            };
            if session.owner != owner {
                return Err(session_conflict());
            }
            if session.index_revision != revision {
                return Ok(());
            }
            let migrated_open_path = reconcile_open_document(session, &catalog)?;
            session.snapshot.catalog = catalog.clone();
            session.snapshot.index_status = IndexStatus::Preparing {
                indexed: 0,
                total: catalog.documents.len(),
            };
            let _ = self.inner.events.send(DocumentEvent::TreeChanged {
                session_id,
                catalog: catalog.clone(),
            });
            let _ = self.inner.events.send(DocumentEvent::IndexStatusChanged {
                session_id,
                status: session.snapshot.index_status.clone(),
            });
            if let Some(path) = migrated_open_path {
                let _ = self
                    .inner
                    .events
                    .send(DocumentEvent::OpenDocumentChanged { session_id, path });
            }
        }
        let runtime = self.clone();
        tokio::spawn(async move {
            runtime
                .index_catalog(owner, revision, catalog, cancellation, affected_paths)
                .await;
        });
        Ok(())
    }

    async fn discover(&self, workspace: DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
        let source = self.inner.source.clone();
        tokio::task::spawn_blocking(move || source.discover(&workspace))
            .await
            .map_err(join_error)?
    }

    async fn reconcile_filesystem(&self, owner: SessionOwner) {
        if let Err(error) = self.refresh(owner.session_id).await {
            self.publish_if_owned(
                owner,
                DocumentEvent::Failed {
                    session_id: owner.session_id,
                    error,
                },
            );
        }
    }

    fn start_watcher(&self, owner: SessionOwner) {
        let Some(workspace) = self.workspace_if_owned(owner) else {
            return;
        };
        let (sender, receiver) = mpsc::unbounded_channel();
        match DocumentWatcher::start(
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
                let runtime = self.clone();
                tokio::spawn(async move {
                    runtime
                        .watch_changes(owner, workspace, receiver, cancellation)
                        .await;
                });
            }
            Err(_) => self.mark_watcher_degraded(owner),
        }
    }

    async fn watch_changes(
        &self,
        owner: SessionOwner,
        workspace: DocumentWorkspace,
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
            let mut paths = match message {
                WatcherMessage::Paths(paths) => paths,
                WatcherMessage::BackendError => {
                    self.mark_watcher_degraded(owner);
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
                    Ok(Some(WatcherMessage::Paths(more))) => paths.extend(more),
                    Ok(Some(WatcherMessage::BackendError)) => {
                        self.mark_watcher_degraded(owner);
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            let affected_paths = affected_markdown_paths(
                &workspace.repository_root,
                &workspace.document_roots,
                &paths,
            );
            if affected_paths.is_empty() {
                continue;
            }
            if let Err(error) = self
                .refresh_affected(owner.session_id, affected_paths)
                .await
            {
                self.publish_if_owned(
                    owner,
                    DocumentEvent::Failed {
                        session_id: owner.session_id,
                        error,
                    },
                );
            }
        }
    }

    fn mark_watcher_degraded(&self, owner: SessionOwner) {
        const MESSAGE: &str =
            "파일 변경 감시를 사용할 수 없습니다. 수동 새로 고침은 계속 사용할 수 있습니다.";
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return;
        };
        if session.owner != owner {
            return;
        }
        session.watcher_degraded = Some(MESSAGE.to_owned());
        let status = IndexStatus::Degraded {
            message: MESSAGE.to_owned(),
        };
        session.snapshot.index_status = status.clone();
        let _ = self.inner.events.send(DocumentEvent::IndexStatusChanged {
            session_id: owner.session_id,
            status,
        });
    }

    async fn prepare_session(
        &self,
        owner: SessionOwner,
        workspace: DocumentWorkspace,
        cancellation: CancellationToken,
    ) -> Result<
        (
            DocumentSessionSnapshot,
            DocumentCatalog,
            bool,
            CancellationToken,
        ),
        AppError,
    > {
        let cache_path = workspace.cache_path.clone();
        let workspace_id = workspace.workspace_id;
        let cache_opener = self.inner.cache_opener.clone();
        let cache = {
            let _mutation_guard = self.inner.startup_mutations.lock().await;
            {
                let state = self.inner.state.lock().expect("document runtime poisoned");
                if !matches!(state.generation.as_ref(), Some(Generation::Starting { owner: current, .. }) if *current == owner)
                {
                    return Err(session_conflict());
                }
            }
            tokio::task::spawn_blocking(move || cache_opener(cache_path, workspace_id))
                .await
                .map_err(join_error)?
                .map_err(cache_error)?
        };
        let cached = cache.cached_summaries().map_err(cache_error)?;
        let warm_start = !cached.is_empty();
        let catalog = if warm_start {
            catalog_from_summaries(&workspace.document_roots, cached)
        } else {
            self.discover(workspace.clone()).await?
        };
        let _mutation_guard = self.inner.startup_mutations.lock().await;
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        if !matches!(state.generation.as_ref(), Some(Generation::Starting { owner: current, .. }) if *current == owner)
        {
            return Err(session_conflict());
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
        let index_cancellation = cancellation.child_token();
        let active = ActiveSession {
            owner,
            cancellation,
            workspace,
            cache,
            snapshot: snapshot.clone(),
            index_revision: 0,
            index_cancellation: index_cancellation.clone(),
            watcher_degraded: None,
            watcher: None,
        };
        state.generation = Some(Generation::Active(active));
        Ok((snapshot, catalog, warm_start, index_cancellation))
    }

    async fn index_catalog(
        &self,
        owner: SessionOwner,
        revision: u64,
        catalog: DocumentCatalog,
        cancellation: CancellationToken,
        forced_paths: Option<Vec<String>>,
    ) {
        let to_index = {
            let mut state = self.inner.state.lock().expect("document runtime poisoned");
            let Some(Generation::Active(session)) = state.generation.as_mut() else {
                return;
            };
            if session.owner != owner || session.index_revision != revision {
                return;
            }
            match session.cache.reconcile_metadata(&catalog.documents) {
                Ok(delta) => match forced_paths {
                    Some(paths) => paths
                        .into_iter()
                        .filter(|path| {
                            catalog
                                .documents
                                .iter()
                                .any(|document| document.path == *path)
                        })
                        .collect(),
                    None => delta.to_index,
                },
                Err(error) => {
                    drop(state);
                    self.fail_if_owned(owner, revision, cache_error(error));
                    return;
                }
            }
        };

        let documents = to_index
            .iter()
            .filter_map(|path| {
                catalog
                    .documents
                    .iter()
                    .find(|document| document.path == *path)
                    .cloned()
            })
            .collect::<Vec<_>>();
        let workspace = match self.workspace_if_owned(owner) {
            Some(workspace) => workspace,
            None => return,
        };
        let mut reads = spawn_body_reads(
            self.inner.source.clone(),
            workspace,
            documents,
            cancellation.clone(),
        );
        let mut indexed = catalog.documents.len().saturating_sub(to_index.len());
        while let Some(read) = reads.recv().await {
            let body = match read.result {
                Ok(body) => body,
                Err(error) => {
                    self.fail_if_owned(owner, revision, error);
                    continue;
                }
            };
            if !self.commit_body_if_owned(owner, revision, &catalog, &read.summary.path, &body) {
                return;
            }
            indexed += 1;
            self.set_status_if_owned(
                owner,
                revision,
                IndexStatus::Preparing {
                    indexed,
                    total: catalog.documents.len(),
                },
            );
        }
        if !cancellation.is_cancelled() {
            self.set_status_if_owned(owner, revision, IndexStatus::Ready);
        }
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

    fn commit_body_if_owned(
        &self,
        owner: SessionOwner,
        revision: u64,
        catalog: &DocumentCatalog,
        path: &str,
        body: &[u8],
    ) -> bool {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return false;
        };
        if session.owner != owner || session.index_revision != revision {
            return false;
        }
        let Some(summary) = catalog
            .documents
            .iter()
            .find(|document| document.path == path)
        else {
            return true;
        };
        if let Err(error) = session.cache.upsert_content(summary, body) {
            drop(state);
            self.fail_if_owned(owner, revision, cache_error(error));
        }
        true
    }

    fn set_status_if_owned(&self, owner: SessionOwner, revision: u64, status: IndexStatus) {
        let mut state = self.inner.state.lock().expect("document runtime poisoned");
        let Some(Generation::Active(session)) = state.generation.as_mut() else {
            return;
        };
        if session.owner != owner || session.index_revision != revision {
            return;
        }
        let status = match (&status, &session.watcher_degraded) {
            (IndexStatus::Ready, Some(message)) => IndexStatus::Degraded {
                message: message.clone(),
            },
            _ => status,
        };
        session.snapshot.index_status = status.clone();
        let _ = self.inner.events.send(DocumentEvent::IndexStatusChanged {
            session_id: owner.session_id,
            status,
        });
    }

    fn fail_if_owned(&self, owner: SessionOwner, revision: u64, error: AppError) {
        let state = self.inner.state.lock().expect("document runtime poisoned");
        if matches!(state.generation.as_ref(), Some(Generation::Active(session)) if session.owner == owner && session.index_revision == revision)
        {
            let _ = self.inner.events.send(DocumentEvent::Failed {
                session_id: owner.session_id,
                error,
            });
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

    fn cancel(&self) {
        match self {
            Self::Starting { cancellation, .. } => cancellation.cancel(),
            Self::Active(session) => session.cancellation.cancel(),
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
        .and_then(|document| document.document_id);
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
    use std::time::Duration;
    use std::time::Instant;

    use async_trait::async_trait;
    use tempfile::TempDir;
    use tokio::sync::{Notify, Semaphore};
    use uuid::Uuid;

    use crate::documents::cache::DocumentCache;
    use crate::documents::contract::{
        DocumentCatalog, DocumentSummary, DocumentTreeEntry, FrontmatterStatus, IndexStatus,
    };
    use crate::error::{AppError, ErrorCode};

    use super::{DocumentRuntime, DocumentSource, DocumentWorkspace, StartupReservationPause};

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
        source.wait_for_read_count(2).await;
        wait_until_idle(&runtime, second).await;
        source.first_release.notify_waiters();
        tokio::task::yield_now().await;

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
    }

    #[derive(Clone)]
    struct MutableDocumentSource {
        documents: Arc<Mutex<Vec<DocumentSummary>>>,
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
    }

    #[async_trait]
    impl DocumentSource for MutableDocumentSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
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
        runtime.refresh(session_id).await.unwrap();
        wait_until_idle(&runtime, session_id).await;

        assert_eq!(source.take_reads(), ["docs/first.md"]);
    }

    #[tokio::test]
    async fn watcher_delta_forces_only_affected_paths_even_when_metadata_is_unchanged() {
        let temp = TempDir::new().unwrap();
        let first = summary("docs/first.md");
        let second = summary("docs/second.md");
        let source = MutableDocumentSource::new(vec![first, second]);
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.take_reads();

        runtime
            .refresh_affected(session_id, vec!["docs/first.md".to_owned()])
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;

        assert_eq!(source.take_reads(), ["docs/first.md"]);
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
        wait_until_idle(&runtime, session_id).await;

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
        let source = SlowDiscoverySource {
            slow: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let first = Uuid::new_v4();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, first).await;
        runtime.stop_session(first).await.unwrap();
        source.slow.store(true, Ordering::SeqCst);

        let started = Instant::now();
        let snapshot = runtime
            .start_session(Uuid::new_v4(), workspace(&temp))
            .await
            .unwrap();

        assert!(started.elapsed() < Duration::from_millis(100));
        assert_eq!(snapshot.catalog.documents[0].path, "docs/cached.md");
    }

    #[derive(Clone)]
    struct SlowDiscoverySource {
        slow: Arc<std::sync::atomic::AtomicBool>,
    }

    #[async_trait]
    impl DocumentSource for SlowDiscoverySource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            if self.slow.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(300));
            }
            Ok(catalog(vec![summary("docs/cached.md")]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            Ok(b"cached body".to_vec())
        }
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

    #[derive(Clone)]
    struct RefreshRaceSource {
        metadata_version: Arc<AtomicUsize>,
        reads: Arc<AtomicUsize>,
        stale_started: Arc<Notify>,
        stale_release: Arc<Notify>,
    }

    #[async_trait]
    impl DocumentSource for RefreshRaceSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            let mut document = summary("docs/race.md");
            document.modified_at_unix_ms = self.metadata_version.load(Ordering::SeqCst) as i64;
            Ok(catalog(vec![document]))
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            _path: &str,
        ) -> Result<Vec<u8>, AppError> {
            match self.reads.fetch_add(1, Ordering::SeqCst) {
                0 => Ok(b"initial body".to_vec()),
                1 => {
                    self.stale_started.notify_waiters();
                    self.stale_release.notified().await;
                    Ok(b"stale refresh body".to_vec())
                }
                _ => Ok(b"current refresh body".to_vec()),
            }
        }
    }

    #[tokio::test]
    async fn later_refresh_generation_rejects_an_older_body_commit() {
        let temp = TempDir::new().unwrap();
        let source = RefreshRaceSource {
            metadata_version: Arc::new(AtomicUsize::new(1)),
            reads: Arc::new(AtomicUsize::new(0)),
            stale_started: Arc::new(Notify::new()),
            stale_release: Arc::new(Notify::new()),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;

        source.metadata_version.store(2, Ordering::SeqCst);
        runtime.refresh(session_id).await.unwrap();
        source.stale_started.notified().await;
        source.metadata_version.store(3, Ordering::SeqCst);
        runtime.refresh(session_id).await.unwrap();
        wait_until_idle(&runtime, session_id).await;
        source.stale_release.notify_waiters();
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(runtime
            .search(session_id, "current refresh", 20)
            .await
            .unwrap()
            .items
            .iter()
            .any(|item| item.path == "docs/race.md"));
        assert!(runtime
            .search(session_id, "stale refresh", 20)
            .await
            .unwrap()
            .items
            .is_empty());
    }

    #[tokio::test]
    async fn watcher_failure_degrades_status_without_disabling_search_or_refresh() {
        let temp = TempDir::new().unwrap();
        let source = MutableDocumentSource::new(vec![summary("docs/guide.md")]);
        let runtime = DocumentRuntime::with_source(Arc::new(source));
        let session_id = Uuid::new_v4();
        let workspace = workspace(&temp);
        std::fs::remove_dir_all(workspace.repository_root.join("docs")).unwrap();
        runtime.start_session(session_id, workspace).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;

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
        runtime.refresh(session_id).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(matches!(
            runtime.snapshot(session_id).unwrap().index_status,
            IndexStatus::Degraded { .. }
        ));
    }

    #[tokio::test]
    async fn filesystem_watcher_coalesces_changes_and_refreshes_search_content() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let path = workspace.repository_root.join("docs/watched.md");
        std::fs::write(&path, "old watcher body").unwrap();
        let runtime = DocumentRuntime::new();
        let session_id = Uuid::new_v4();
        runtime.start_session(session_id, workspace).await.unwrap();
        wait_until_idle(&runtime, session_id).await;
        let mut events = runtime.subscribe();

        std::fs::write(&path, "watcher refreshed body").unwrap();

        let refreshed = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if runtime
                    .search(session_id, "watcher refreshed", 20)
                    .await
                    .unwrap()
                    .items
                    .iter()
                    .any(|item| item.path == "docs/watched.md")
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;
        if refreshed.is_err() {
            let mut observed = Vec::new();
            while let Ok(event) = events.try_recv() {
                observed.push(format!("{event:?}"));
            }
            panic!(
                "watcher refresh timed out; snapshot={:?}; events={observed:?}",
                runtime.snapshot(session_id).unwrap()
            );
        }
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

        assert_eq!(
            runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path
                .as_deref(),
            Some("docs/new.md")
        );
    }

    #[derive(Clone)]
    struct OutOfOrderDiscoverySource {
        calls: Arc<AtomicUsize>,
        first_refresh_started: Arc<std::sync::atomic::AtomicBool>,
        first_refresh_gate: Arc<(Mutex<bool>, Condvar)>,
    }

    #[async_trait]
    impl DocumentSource for OutOfOrderDiscoverySource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            match self.calls.fetch_add(1, Ordering::SeqCst) {
                0 => Ok(catalog(vec![summary("docs/initial.md")])),
                1 => {
                    self.first_refresh_started.store(true, Ordering::SeqCst);
                    let (lock, wake) = &*self.first_refresh_gate;
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
    async fn slower_older_discovery_cannot_overwrite_a_newer_refresh_generation() {
        let temp = TempDir::new().unwrap();
        let source = OutOfOrderDiscoverySource {
            calls: Arc::new(AtomicUsize::new(0)),
            first_refresh_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            first_refresh_gate: Arc::new((Mutex::new(false), Condvar::new())),
        };
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let session_id = Uuid::new_v4();
        runtime
            .start_session(session_id, workspace(&temp))
            .await
            .unwrap();
        wait_until_idle(&runtime, session_id).await;

        let older_runtime = runtime.clone();
        let older = tokio::spawn(async move { older_runtime.refresh(session_id).await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !source.first_refresh_started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        runtime.refresh(session_id).await.unwrap();
        wait_until_idle(&runtime, session_id).await;

        let (lock, wake) = &*source.first_refresh_gate;
        *lock.lock().unwrap() = true;
        wake.notify_all();
        older.await.unwrap().unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert_eq!(
            runtime.snapshot(session_id).unwrap().catalog.documents[0].path,
            "docs/current.md"
        );
    }

    #[tokio::test]
    async fn a_session_uuid_cannot_be_reused_after_stop_or_replacement() {
        let temp = TempDir::new().unwrap();
        let runtime = DocumentRuntime::with_source(Arc::new(MutableDocumentSource::new(vec![])));
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        runtime
            .start_session(first, workspace(&temp))
            .await
            .unwrap();
        runtime.stop_session(first).await.unwrap();
        assert_eq!(
            runtime
                .start_session(first, workspace(&temp))
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionConflict
        );

        runtime
            .start_session(second, workspace(&temp))
            .await
            .unwrap();
        assert_eq!(
            runtime
                .start_session(first, workspace(&temp))
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionConflict
        );
    }

    #[tokio::test]
    async fn stale_work_for_x_cannot_alias_a_later_reuse_attempt_for_x() {
        let temp = TempDir::new().unwrap();
        let workspace = workspace(&temp);
        let source = SequencedDocumentSource::new();
        let runtime = DocumentRuntime::with_source(Arc::new(source.clone()));
        let x = Uuid::new_v4();
        let replacement = Uuid::new_v4();

        runtime.start_session(x, workspace.clone()).await.unwrap();
        source.wait_for_first_read().await;
        runtime
            .start_session(replacement, workspace.clone())
            .await
            .unwrap();
        assert_eq!(
            runtime.start_session(x, workspace).await.unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );

        source.first_release.notify_waiters();
        wait_until_idle(&runtime, replacement).await;

        assert!(runtime
            .search(replacement, "stale generation", 20)
            .await
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            runtime.snapshot(x).unwrap_err().code,
            ErrorCode::DocumentSessionConflict
        );
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
