use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::{Uuid, Variant, Version};

use crate::documents::contract::{
    DocumentAsset, DocumentCatalog, DocumentContent, DocumentEvent, HistoryCursor, HistoryPage,
    IndexStatus, SearchResult,
};
use crate::documents::history::{DocumentHistory, DEFAULT_HISTORY_PAGE_LIMIT};
use crate::documents::reader::DocumentReader;
use crate::documents::runtime::{DocumentRuntime, DocumentRuntimeGeneration, DocumentWorkspace};
use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::settings::service::ConnectedDocumentWorkspace;
use crate::state::{
    AppServices, DocumentCommandSessionContext, DocumentCommandSessionRegistry,
    DocumentCommandWorkspaceContext, DocumentSessionListener,
};

pub const DOCUMENT_EVENT: &str = "okhub://documents/event";

pub(crate) trait DocumentEventEmitter: Send + Sync {
    fn emit(&self, event: DocumentEventEnvelope);
}

struct TauriDocumentEventEmitter {
    app: AppHandle,
}

impl TauriDocumentEventEmitter {
    fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DocumentEventEmitter for TauriDocumentEventEmitter {
    fn emit(&self, event: DocumentEventEnvelope) {
        let _ = self.app.emit(DOCUMENT_EVENT, event);
    }
}

#[cfg(test)]
struct NoopDocumentEventEmitter;

#[cfg(test)]
impl DocumentEventEmitter for NoopDocumentEventEmitter {
    fn emit(&self, _event: DocumentEventEnvelope) {}
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentEventEnvelope {
    pub revision: u64,
    #[serde(flatten)]
    pub event: DocumentEvent,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSessionSnapshot {
    pub session_id: Uuid,
    pub revision: u64,
    pub workspace_id: Uuid,
    pub repository_full_name: String,
    pub branch: String,
    pub catalog: DocumentCatalog,
    pub index_status: IndexStatus,
    pub last_opened_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchResponse {
    pub session_id: Uuid,
    pub request_id: Uuid,
    pub items: Vec<SearchResult>,
}

#[cfg(test)]
pub(crate) async fn start_document_session_inner(
    services: &AppServices,
    request_id: Uuid,
) -> CommandResult<DocumentSessionSnapshot> {
    start_document_session_with_hook(
        services,
        request_id,
        Arc::new(NoopDocumentEventEmitter),
        || {},
    )
    .await
}

#[derive(Clone, Default)]
struct StartDocumentSessionTestBoundaries {
    #[cfg(test)]
    before_previous_listener_wait:
        Option<(Arc<tokio::sync::Semaphore>, Arc<tokio::sync::Semaphore>)>,
    #[cfg(test)]
    after_runtime_reservation: Option<(Arc<tokio::sync::Semaphore>, Arc<tokio::sync::Semaphore>)>,
}

#[cfg(test)]
async fn wait_for_start_boundary(
    boundary: &Option<(Arc<tokio::sync::Semaphore>, Arc<tokio::sync::Semaphore>)>,
) {
    if let Some((reached, release)) = boundary {
        reached.add_permits(1);
        release.acquire().await.unwrap().forget();
    }
}

struct DocumentStartCleanup {
    registry: DocumentCommandSessionRegistry,
    runtime: DocumentRuntime,
    context: Arc<DocumentCommandSessionContext>,
    previous_listener: Option<DocumentSessionListener>,
    previous_generation: Option<DocumentRuntimeGeneration>,
    listener: Option<DocumentSessionListener>,
    runtime_generation: Option<DocumentRuntimeGeneration>,
    armed: bool,
}

impl DocumentStartCleanup {
    fn new(services: &AppServices, context: Arc<DocumentCommandSessionContext>) -> Self {
        Self {
            registry: services.document_sessions.clone(),
            runtime: services.document_runtime.clone(),
            context,
            previous_listener: None,
            previous_generation: None,
            listener: None,
            runtime_generation: None,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for DocumentStartCleanup {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }

        let mut listeners = Vec::new();
        if let Some(active) = self.registry.remove_exact(&self.context) {
            let _ = self.runtime.stop_generation(active.runtime_generation);
            active.listener.cancel();
            listeners.push(active.listener);
        }
        for generation in [
            self.previous_generation.take(),
            self.runtime_generation.take(),
        ]
        .into_iter()
        .flatten()
        {
            let _ = self.runtime.stop_generation(generation);
        }
        for listener in [self.previous_listener.take(), self.listener.take()]
            .into_iter()
            .flatten()
        {
            listener.cancel();
            listeners.push(listener);
        }

        if !listeners.is_empty() {
            let _cleanup = tokio::spawn(async move {
                for listener in listeners {
                    listener.wait().await;
                }
            });
        }
    }
}

async fn start_document_session_with_hook<F>(
    services: &AppServices,
    request_id: Uuid,
    emitter: Arc<dyn DocumentEventEmitter>,
    before_result: F,
) -> CommandResult<DocumentSessionSnapshot>
where
    F: FnOnce(),
{
    start_document_session_impl(
        services,
        request_id,
        emitter,
        move || async move { before_result() },
        StartDocumentSessionTestBoundaries::default(),
    )
    .await
}

#[cfg(test)]
async fn start_document_session_with_boundaries<F>(
    services: &AppServices,
    request_id: Uuid,
    emitter: Arc<dyn DocumentEventEmitter>,
    before_result: F,
    boundaries: StartDocumentSessionTestBoundaries,
) -> CommandResult<DocumentSessionSnapshot>
where
    F: FnOnce(),
{
    start_document_session_impl(
        services,
        request_id,
        emitter,
        move || async move { before_result() },
        boundaries,
    )
    .await
}

#[cfg(test)]
async fn start_document_session_with_async_hook<F, Fut>(
    services: &AppServices,
    request_id: Uuid,
    emitter: Arc<dyn DocumentEventEmitter>,
    before_result: F,
) -> CommandResult<DocumentSessionSnapshot>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    start_document_session_impl(
        services,
        request_id,
        emitter,
        before_result,
        StartDocumentSessionTestBoundaries::default(),
    )
    .await
}

async fn start_document_session_impl<F, Fut>(
    services: &AppServices,
    request_id: Uuid,
    emitter: Arc<dyn DocumentEventEmitter>,
    before_result: F,
    _boundaries: StartDocumentSessionTestBoundaries,
) -> CommandResult<DocumentSessionSnapshot>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    validate_client_id(request_id, "문서 세션")?;
    let context = services
        .document_sessions
        .reserve_pending(request_id)
        .map_err(|_| document_session_conflict())?;
    let mut cleanup = DocumentStartCleanup::new(services, context.clone());

    let (workspace, branch) = load_document_workspace(services).await?;
    let cache_directory = services
        .document_cache_root
        .join(workspace.workspace_id.to_string());
    let cache_path = cache_directory.join("search.sqlite3");
    run_blocking(move || {
        std::fs::create_dir_all(cache_directory).map_err(|_| document_index_unavailable())
    })
    .await?;

    context
        .initialize(DocumentCommandWorkspaceContext {
            workspace_id: workspace.workspace_id,
            repository_root: workspace.repository_root.clone(),
            document_roots: workspace.document_roots.clone(),
            repository_full_name: workspace.repository_full_name.clone(),
            branch,
        })
        .map_err(|_| document_session_conflict())?;

    {
        let _mutation = services.document_sessions.lock_mutation().await;
        if !services.document_sessions.is_pending(&context) {
            return Err(document_session_stale());
        }
        if let Some(previous) = services
            .document_sessions
            .take_active_for_pending(&context)
            .map_err(|_| document_session_stale())?
        {
            previous.listener.cancel();
            cleanup.previous_generation = Some(previous.runtime_generation);
            cleanup.previous_listener = Some(previous.listener);
            #[cfg(test)]
            wait_for_start_boundary(&_boundaries.before_previous_listener_wait).await;
            if let Some(listener) = cleanup.previous_listener.take() {
                listener.wait().await;
            }
            if let Some(generation) = cleanup.previous_generation.take() {
                let _ = services.document_runtime.stop_generation(generation);
            }
        }
    }

    let runtime_workspace = DocumentWorkspace {
        workspace_id: workspace.workspace_id,
        repository_root: workspace.repository_root,
        document_roots: workspace.document_roots,
        cache_path,
    };
    let mut receiver = services.document_runtime.subscribe();
    let runtime_start = services
        .document_runtime
        .reserve_session(request_id)
        .await
        .map_err(sanitize_document_error)?;
    #[cfg(test)]
    wait_for_start_boundary(&_boundaries.after_runtime_reservation).await;
    let runtime_snapshot = services
        .document_runtime
        .finish_reserved_session(&runtime_start, runtime_workspace)
        .await
        .map_err(sanitize_document_error)?;
    let runtime_generation = runtime_start.complete();
    cleanup.runtime_generation = Some(runtime_generation);

    flush_document_events(
        &mut receiver,
        &context,
        emitter.as_ref(),
        &services.document_runtime,
        runtime_generation,
    );
    let listener_cancellation = CancellationToken::new();
    let listener_task = tokio::spawn(forward_document_events(
        receiver,
        context.clone(),
        emitter,
        listener_cancellation.clone(),
        services.document_runtime.clone(),
        runtime_generation,
    ));
    cleanup.listener = Some(DocumentSessionListener::new(
        listener_cancellation,
        listener_task,
    ));

    {
        let _mutation = services.document_sessions.lock_mutation().await;
        let listener = cleanup
            .listener
            .take()
            .expect("document listener prepared before activation");
        let runtime_generation = cleanup
            .runtime_generation
            .take()
            .expect("runtime generation prepared before activation");
        if let Err((listener, runtime_generation)) = services.document_sessions.activate_pending(
            context.clone(),
            listener,
            runtime_generation,
        ) {
            cleanup.listener = Some(listener);
            cleanup.runtime_generation = Some(runtime_generation);
            return Err(document_session_stale());
        }
    }

    before_result().await;
    let result = public_snapshot(runtime_snapshot, &context);
    cleanup.disarm();
    Ok(result)
}

#[tauri::command]
pub async fn start_document_session(
    state: State<'_, AppServices>,
    app: AppHandle,
    request_id: Uuid,
) -> CommandResult<DocumentSessionSnapshot> {
    let _access = state.acquire_authenticated_command().await?;
    start_document_session_with_hook(
        &state,
        request_id,
        Arc::new(TauriDocumentEventEmitter::new(app)),
        || {},
    )
    .await
}

pub(crate) async fn stop_document_session_inner(
    services: &AppServices,
    session_id: Uuid,
) -> CommandResult<()> {
    validate_client_id(session_id, "문서 세션")?;
    let _mutation = services.document_sessions.lock_mutation().await;
    let context = active_context(services, session_id)?;
    let active = services
        .document_sessions
        .take_if(&context)
        .ok_or_else(document_session_stale)?;
    active.listener.cancel();
    let result = services
        .document_runtime
        .stop_generation(active.runtime_generation)
        .map_err(map_active_session_error);
    active.listener.wait().await;
    result
}

#[tauri::command]
pub async fn stop_document_session(
    state: State<'_, AppServices>,
    session_id: Uuid,
) -> CommandResult<()> {
    stop_document_session_inner(&state, session_id).await
}

pub(crate) async fn refresh_document_session_inner(
    services: &AppServices,
    session_id: Uuid,
) -> CommandResult<()> {
    validate_client_id(session_id, "문서 세션")?;
    let _mutation = services.document_sessions.lock_mutation().await;
    let context = active_context(services, session_id)?;
    services
        .document_runtime
        .refresh(session_id)
        .await
        .map_err(map_active_session_error)?;
    ensure_active_context(services, &context)
}

#[tauri::command]
pub async fn refresh_document_session(
    state: State<'_, AppServices>,
    session_id: Uuid,
) -> CommandResult<()> {
    let _access = state.acquire_authenticated_command().await?;
    refresh_document_session_inner(&state, session_id).await
}

pub(crate) async fn search_documents_inner(
    services: &AppServices,
    session_id: Uuid,
    request_id: Uuid,
    query: String,
    limit: usize,
) -> CommandResult<DocumentSearchResponse> {
    search_documents_with_completion_hook(services, session_id, request_id, query, limit, || {})
        .await
}

async fn search_documents_with_completion_hook<F>(
    services: &AppServices,
    session_id: Uuid,
    request_id: Uuid,
    query: String,
    limit: usize,
    before_publication: F,
) -> CommandResult<DocumentSearchResponse>
where
    F: FnOnce(),
{
    validate_client_id(session_id, "문서 세션")?;
    validate_client_id(request_id, "문서 검색 요청")?;
    let context = active_context(services, session_id)?;
    let response = services
        .document_runtime
        .search(session_id, &query, limit)
        .await;
    before_publication();
    let _mutation = services.document_sessions.lock_mutation().await;
    ensure_active_context(services, &context)?;
    let response = response.map_err(map_active_session_error)?;
    Ok(DocumentSearchResponse {
        session_id,
        request_id,
        items: response.items,
    })
}

#[tauri::command]
pub async fn search_documents(
    state: State<'_, AppServices>,
    session_id: Uuid,
    request_id: Uuid,
    query: String,
    limit: usize,
) -> CommandResult<DocumentSearchResponse> {
    let _access = state.acquire_authenticated_command().await?;
    search_documents_inner(&state, session_id, request_id, query, limit).await
}

pub(crate) async fn read_document_inner(
    services: &AppServices,
    session_id: Uuid,
    request_id: String,
    path: String,
) -> CommandResult<DocumentContent> {
    read_document_with_completion_hook(services, session_id, request_id, path, || {}).await
}

async fn read_document_with_completion_hook<F>(
    services: &AppServices,
    session_id: Uuid,
    request_id: String,
    path: String,
    before_publication: F,
) -> CommandResult<DocumentContent>
where
    F: FnOnce(),
{
    validate_client_id(session_id, "문서 세션")?;
    let (context, read_owner) = {
        let _mutation = services.document_sessions.lock_mutation().await;
        let context = active_context(services, session_id)?;
        let read_owner = context.register_document_read(request_id);
        (context, read_owner)
    };
    let repository_root = context.workspace().repository_root.clone();
    let document_roots = context.workspace().document_roots.clone();
    let read_path = path.clone();
    let content = run_blocking(move || {
        let reader = DocumentReader::new(&repository_root, &document_roots)?;
        let mut content = reader.read_document(&read_path)?;
        let history = DocumentHistory::open(&repository_root)?;
        content.last_commit =
            history.latest_change(&content.summary.path, content.summary.document_id)?;
        Ok(content)
    })
    .await;

    before_publication();
    let _mutation = services.document_sessions.lock_mutation().await;
    ensure_active_context(services, &context)?;
    let content = content.map_err(sanitize_document_error)?;
    if context.document_read_is_latest(&read_owner) {
        let snapshot = services
            .document_runtime
            .snapshot(session_id)
            .map_err(map_active_session_error)?;
        if snapshot.last_opened_path.as_deref() != Some(path.as_str()) {
            services
                .document_runtime
                .set_open_document(session_id, &path)
                .map_err(map_active_session_error)?;
        }
    }
    Ok(content)
}

#[tauri::command]
pub async fn read_document(
    state: State<'_, AppServices>,
    session_id: Uuid,
    request_id: String,
    path: String,
) -> CommandResult<DocumentContent> {
    let _access = state.acquire_authenticated_command().await?;
    read_document_inner(&state, session_id, request_id, path).await
}

pub(crate) async fn read_document_asset_inner(
    services: &AppServices,
    session_id: Uuid,
    document_path: String,
    asset_path: String,
) -> CommandResult<DocumentAsset> {
    read_document_asset_with_completion_hook(services, session_id, document_path, asset_path, || {})
        .await
}

async fn read_document_asset_with_completion_hook<F>(
    services: &AppServices,
    session_id: Uuid,
    document_path: String,
    asset_path: String,
    before_publication: F,
) -> CommandResult<DocumentAsset>
where
    F: FnOnce(),
{
    validate_client_id(session_id, "문서 세션")?;
    let context = active_context(services, session_id)?;
    let repository_root = context.workspace().repository_root.clone();
    let document_roots = context.workspace().document_roots.clone();
    let preparation = require_current_document(services, session_id, &document_path)
        .and_then(|_| resolve_asset_path(&document_path, &asset_path));
    let asset = match preparation {
        Ok(resolved_asset_path) => {
            run_blocking(move || {
                DocumentReader::new(&repository_root, &document_roots)?
                    .read_asset(&resolved_asset_path)
            })
            .await
        }
        Err(error) => Err(error),
    };
    before_publication();
    let _mutation = services.document_sessions.lock_mutation().await;
    ensure_active_context(services, &context)?;
    asset.map_err(sanitize_document_error)
}

#[tauri::command]
pub async fn read_document_asset(
    state: State<'_, AppServices>,
    session_id: Uuid,
    document_path: String,
    asset_path: String,
) -> CommandResult<DocumentAsset> {
    let _access = state.acquire_authenticated_command().await?;
    read_document_asset_inner(&state, session_id, document_path, asset_path).await
}

pub(crate) async fn list_document_history_inner(
    services: &AppServices,
    session_id: Uuid,
    path: String,
    cursor: Option<HistoryCursor>,
) -> CommandResult<HistoryPage> {
    list_document_history_with_completion_hook(services, session_id, path, cursor, || {}).await
}

async fn list_document_history_with_completion_hook<F>(
    services: &AppServices,
    session_id: Uuid,
    path: String,
    cursor: Option<HistoryCursor>,
    before_publication: F,
) -> CommandResult<HistoryPage>
where
    F: FnOnce(),
{
    validate_client_id(session_id, "문서 세션")?;
    let context = active_context(services, session_id)?;
    let repository_root = context.workspace().repository_root.clone();
    let document_id = require_current_document(services, session_id, &path);
    let page = match document_id {
        Ok(document_id) => {
            run_blocking(move || {
                DocumentHistory::open(&repository_root)?.history_page(
                    &path,
                    document_id,
                    cursor,
                    DEFAULT_HISTORY_PAGE_LIMIT,
                )
            })
            .await
        }
        Err(error) => Err(error),
    };
    before_publication();
    let _mutation = services.document_sessions.lock_mutation().await;
    ensure_active_context(services, &context)?;
    let page = page.map_err(sanitize_document_error)?;
    context.issue_versions(
        page.items
            .iter()
            .map(|item| (item.commit_oid.as_str(), item.path_at_commit.as_str())),
    );
    Ok(page)
}

#[tauri::command]
pub async fn list_document_history(
    state: State<'_, AppServices>,
    session_id: Uuid,
    path: String,
    cursor: Option<HistoryCursor>,
) -> CommandResult<HistoryPage> {
    let _access = state.acquire_authenticated_command().await?;
    list_document_history_inner(&state, session_id, path, cursor).await
}

pub(crate) async fn read_document_version_inner(
    services: &AppServices,
    session_id: Uuid,
    request_id: String,
    commit_oid: String,
    path_at_commit: String,
) -> CommandResult<DocumentContent> {
    read_document_version_with_completion_hook(
        services,
        session_id,
        request_id,
        commit_oid,
        path_at_commit,
        || {},
    )
    .await
}

async fn read_document_version_with_completion_hook<F>(
    services: &AppServices,
    session_id: Uuid,
    request_id: String,
    commit_oid: String,
    path_at_commit: String,
    before_publication: F,
) -> CommandResult<DocumentContent>
where
    F: FnOnce(),
{
    validate_client_id(session_id, "문서 세션")?;
    let context = {
        let _mutation = services.document_sessions.lock_mutation().await;
        let context = active_context(services, session_id)?;
        context.register_document_read(request_id);
        context
    };
    let repository_root = context.workspace().repository_root.clone();
    let authorized = context.version_was_issued(&commit_oid, &path_at_commit);
    let content = if authorized {
        run_blocking(move || {
            DocumentHistory::open(&repository_root)?.read_version(&commit_oid, &path_at_commit)
        })
        .await
    } else {
        Err(document_history_not_issued())
    };
    before_publication();
    let _mutation = services.document_sessions.lock_mutation().await;
    ensure_active_context(services, &context)?;
    content.map_err(sanitize_document_error)
}

#[tauri::command]
pub async fn read_document_version(
    state: State<'_, AppServices>,
    session_id: Uuid,
    request_id: String,
    commit_oid: String,
    path_at_commit: String,
) -> CommandResult<DocumentContent> {
    let _access = state.acquire_authenticated_command().await?;
    read_document_version_inner(&state, session_id, request_id, commit_oid, path_at_commit).await
}

async fn load_document_workspace(
    services: &AppServices,
) -> CommandResult<(ConnectedDocumentWorkspace, String)> {
    let settings = services.local_settings.clone();
    let repository_git = services.repository_git.clone();
    run_blocking(move || {
        let workspace = settings.load_connected_document_workspace()?;
        let repository = repository_git
            .inspect(&workspace.repository_root)
            .map_err(|_| document_workspace_unavailable())?;
        let branch = repository
            .default_branch
            .filter(|branch| !branch.trim().is_empty())
            .ok_or_else(document_workspace_unavailable)?;
        Ok((workspace, branch))
    })
    .await
    .map_err(sanitize_document_error)
}

fn active_context(
    services: &AppServices,
    session_id: Uuid,
) -> CommandResult<Arc<DocumentCommandSessionContext>> {
    services
        .document_sessions
        .active_context(session_id)
        .ok_or_else(document_session_stale)
}

fn ensure_active_context(
    services: &AppServices,
    context: &Arc<DocumentCommandSessionContext>,
) -> CommandResult<()> {
    if services.document_sessions.is_active(context) {
        Ok(())
    } else {
        Err(document_session_stale())
    }
}

fn require_current_document(
    services: &AppServices,
    session_id: Uuid,
    path: &str,
) -> CommandResult<Option<Uuid>> {
    services
        .document_runtime
        .snapshot(session_id)
        .map_err(map_active_session_error)?
        .catalog
        .documents
        .into_iter()
        .find(|document| document.path == path)
        .map(|document| document.document_id)
        .ok_or_else(|| document_path_invalid(path))
}

fn resolve_asset_path(document_path: &str, asset_path: &str) -> CommandResult<String> {
    if asset_path.contains('\\') {
        return Err(document_path_invalid(asset_path));
    }
    let document = normalized_repository_path(Path::new(document_path))?;
    let asset = Path::new(asset_path);
    if asset.is_absolute() || asset.as_os_str().is_empty() {
        return Err(document_path_invalid(asset_path));
    }
    let mut resolved = document.parent().map(Path::to_path_buf).unwrap_or_default();
    for component in asset.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => resolved.push(part),
            Component::ParentDir => {
                if !resolved.pop() {
                    return Err(document_path_invalid(asset_path));
                }
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(document_path_invalid(asset_path));
            }
        }
    }
    if resolved.as_os_str().is_empty() {
        return Err(document_path_invalid(asset_path));
    }
    resolved
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| document_path_invalid(asset_path))
}

fn normalized_repository_path(path: &Path) -> CommandResult<PathBuf> {
    if path.is_absolute() || path.as_os_str().is_empty() {
        return Err(document_path_invalid(path.to_string_lossy().as_ref()));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(document_path_invalid(path.to_string_lossy().as_ref()));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        Err(document_path_invalid(path.to_string_lossy().as_ref()))
    } else {
        Ok(normalized)
    }
}

fn public_snapshot(
    runtime: crate::documents::contract::DocumentSessionSnapshot,
    context: &DocumentCommandSessionContext,
) -> DocumentSessionSnapshot {
    let workspace = context.workspace();
    DocumentSessionSnapshot {
        session_id: runtime.session_id,
        revision: 0,
        workspace_id: workspace.workspace_id,
        repository_full_name: workspace.repository_full_name.clone(),
        branch: workspace.branch.clone(),
        catalog: runtime.catalog,
        index_status: runtime.index_status,
        last_opened_path: runtime.last_opened_path,
    }
}

fn flush_document_events(
    receiver: &mut broadcast::Receiver<DocumentEvent>,
    context: &Arc<DocumentCommandSessionContext>,
    emitter: &dyn DocumentEventEmitter,
    runtime: &DocumentRuntime,
    generation: DocumentRuntimeGeneration,
) {
    loop {
        match receiver.try_recv() {
            Ok(event) => emit_if_owned(context, emitter, event),
            Err(broadcast::error::TryRecvError::Lagged(_)) => {
                if !recover_lagged_document_events_sync(
                    receiver, context, emitter, runtime, generation,
                ) {
                    return;
                }
            }
            Err(broadcast::error::TryRecvError::Empty | broadcast::error::TryRecvError::Closed) => {
                return
            }
        }
    }
}

async fn forward_document_events(
    receiver: broadcast::Receiver<DocumentEvent>,
    context: Arc<DocumentCommandSessionContext>,
    emitter: Arc<dyn DocumentEventEmitter>,
    cancellation: CancellationToken,
    runtime: DocumentRuntime,
    generation: DocumentRuntimeGeneration,
) {
    let (queue, mut queued_events) = mpsc::unbounded_channel();
    let ingress_cancellation = cancellation.clone();
    let ingress = tokio::spawn(receive_document_events(
        receiver,
        context,
        queue,
        ingress_cancellation,
        runtime,
        generation,
    ));

    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            event = queued_events.recv() => match event {
                Some(event) => emitter.emit(event),
                None => break,
            }
        }
    }

    cancellation.cancel();
    let _ = ingress.await;
}

async fn receive_document_events(
    mut receiver: broadcast::Receiver<DocumentEvent>,
    context: Arc<DocumentCommandSessionContext>,
    queue: mpsc::UnboundedSender<DocumentEventEnvelope>,
    cancellation: CancellationToken,
    runtime: DocumentRuntime,
    generation: DocumentRuntimeGeneration,
) {
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            event = receiver.recv() => match event {
                Ok(event) => {
                    if let Some(event) = published_event(&context, event) {
                        if queue.send(event).is_err() {
                            return;
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if !recover_lagged_document_events(
                        &mut receiver,
                        &context,
                        &queue,
                        &cancellation,
                        &runtime,
                        generation,
                        || {},
                    )
                    .await
                    {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

fn recover_lagged_document_events_sync(
    receiver: &mut broadcast::Receiver<DocumentEvent>,
    context: &Arc<DocumentCommandSessionContext>,
    emitter: &dyn DocumentEventEmitter,
    runtime: &DocumentRuntime,
    generation: DocumentRuntimeGeneration,
) -> bool {
    if !discard_retained_document_events(receiver) {
        return false;
    }
    let mut barrier_id = match runtime.publish_resync_barrier(generation) {
        Ok(barrier_id) => barrier_id,
        Err(_) => return false,
    };
    loop {
        match receiver.try_recv() {
            Ok(event)
                if matches!(
                    &event,
                    DocumentEvent::Resynced {
                        barrier_id: event_barrier,
                        ..
                    } if *event_barrier == barrier_id
                ) =>
            {
                emit_if_owned(
                    context,
                    emitter,
                    DocumentEvent::Failed {
                        session_id: context.session_id,
                        error: document_event_lagged(),
                    },
                );
                emit_if_owned(context, emitter, event);
                return true;
            }
            Ok(_) => {}
            Err(broadcast::error::TryRecvError::Lagged(_)) => {
                if !discard_retained_document_events(receiver) {
                    return false;
                }
                barrier_id = match runtime.publish_resync_barrier(generation) {
                    Ok(barrier_id) => barrier_id,
                    Err(_) => return false,
                };
            }
            Err(broadcast::error::TryRecvError::Empty | broadcast::error::TryRecvError::Closed) => {
                return false;
            }
        }
    }
}

async fn recover_lagged_document_events<F>(
    receiver: &mut broadcast::Receiver<DocumentEvent>,
    context: &Arc<DocumentCommandSessionContext>,
    queue: &mpsc::UnboundedSender<DocumentEventEnvelope>,
    cancellation: &CancellationToken,
    runtime: &DocumentRuntime,
    generation: DocumentRuntimeGeneration,
    after_barrier_published: F,
) -> bool
where
    F: FnOnce(),
{
    if !discard_retained_document_events(receiver) {
        return false;
    }
    let mut barrier_id = match runtime.publish_resync_barrier(generation) {
        Ok(barrier_id) => barrier_id,
        Err(_) => return false,
    };
    after_barrier_published();
    loop {
        let event = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return false,
            event = receiver.recv() => event,
        };
        match event {
            Ok(event)
                if matches!(
                    &event,
                    DocumentEvent::Resynced {
                        barrier_id: event_barrier,
                        ..
                    } if *event_barrier == barrier_id
                ) =>
            {
                let Some(failed) = published_event(
                    context,
                    DocumentEvent::Failed {
                        session_id: context.session_id,
                        error: document_event_lagged(),
                    },
                ) else {
                    return false;
                };
                let Some(resynced) = published_event(context, event) else {
                    return false;
                };
                return queue.send(failed).is_ok() && queue.send(resynced).is_ok();
            }
            Ok(_) => {}
            Err(broadcast::error::RecvError::Lagged(_)) => {
                if !discard_retained_document_events(receiver) {
                    return false;
                }
                barrier_id = match runtime.publish_resync_barrier(generation) {
                    Ok(barrier_id) => barrier_id,
                    Err(_) => return false,
                };
            }
            Err(broadcast::error::RecvError::Closed) => return false,
        }
    }
}

fn discard_retained_document_events(receiver: &mut broadcast::Receiver<DocumentEvent>) -> bool {
    loop {
        match receiver.try_recv() {
            Ok(_) | Err(broadcast::error::TryRecvError::Lagged(_)) => {}
            Err(broadcast::error::TryRecvError::Empty) => return true,
            Err(broadcast::error::TryRecvError::Closed) => return false,
        }
    }
}

fn emit_if_owned(
    context: &Arc<DocumentCommandSessionContext>,
    emitter: &dyn DocumentEventEmitter,
    event: DocumentEvent,
) {
    if let Some(event) = published_event(context, event) {
        emitter.emit(event);
    }
}

fn published_event(
    context: &Arc<DocumentCommandSessionContext>,
    event: DocumentEvent,
) -> Option<DocumentEventEnvelope> {
    (document_event_session_id(&event) == context.session_id).then(|| DocumentEventEnvelope {
        revision: context.next_revision(),
        event: sanitize_document_event(event),
    })
}

fn document_event_session_id(event: &DocumentEvent) -> Uuid {
    match event {
        DocumentEvent::TreeChanged { session_id, .. }
        | DocumentEvent::IndexStatusChanged { session_id, .. }
        | DocumentEvent::OpenDocumentChanged { session_id, .. }
        | DocumentEvent::Failed { session_id, .. }
        | DocumentEvent::Resynced { session_id, .. } => *session_id,
    }
}

fn sanitize_document_event(event: DocumentEvent) -> DocumentEvent {
    match event {
        DocumentEvent::Failed { session_id, error } => DocumentEvent::Failed {
            session_id,
            error: sanitize_document_error(error),
        },
        event => event,
    }
}

fn validate_client_id(id: Uuid, label: &str) -> CommandResult<()> {
    if id.get_version() == Some(Version::Random) && id.get_variant() == Variant::RFC4122 {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::DocumentSessionConflict,
            format!("{label} ID는 UUID v4여야 합니다."),
        )
        .with_recovery(RecoveryAction::Retry))
    }
}

fn map_active_session_error(error: AppError) -> AppError {
    if error.code == ErrorCode::DocumentSessionConflict {
        document_session_stale()
    } else {
        sanitize_document_error(error)
    }
}

fn sanitize_document_error(mut error: AppError) -> AppError {
    error.details.clear();
    error
}

fn document_session_conflict() -> AppError {
    AppError::new(
        ErrorCode::DocumentSessionConflict,
        "같은 문서 세션이 이미 활성 상태입니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn document_session_stale() -> AppError {
    AppError::new(
        ErrorCode::DocumentSessionStale,
        "문서 세션이 더 이상 활성 상태가 아닙니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn document_workspace_unavailable() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "현재 워크스페이스의 Git 상태를 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::OpenWorkspaceFile)
}

fn document_index_unavailable() -> AppError {
    AppError::new(
        ErrorCode::DocumentIndexUnavailable,
        "문서 검색 색인을 준비할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn document_event_lagged() -> AppError {
    AppError::new(
        ErrorCode::DocumentIndexUnavailable,
        "문서 변경 이벤트를 모두 전달하지 못해 현재 상태를 다시 동기화했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn document_history_not_issued() -> AppError {
    AppError::new(
        ErrorCode::DocumentHistoryInvalid,
        "이 문서 버전은 현재 세션의 기록에서 선택되지 않았습니다.",
    )
}

fn document_path_invalid(_path: &str) -> AppError {
    AppError::new(
        ErrorCode::DocumentPathInvalid,
        "문서 또는 자산 경로가 현재 워크스페이스에 속하지 않습니다.",
    )
}

async fn run_blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| document_index_unavailable())?
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Barrier, Mutex};
    use std::time::Duration;

    use git2::{IndexAddOption, Repository, RepositoryInitOptions, Signature};
    use tempfile::TempDir;
    use tokio::sync::{mpsc, Semaphore};
    use tokio_util::sync::CancellationToken;
    use uuid::Uuid;

    use crate::documents::contract::{DocumentAsset, DocumentEvent, IndexStatus};
    use crate::documents::runtime::DocumentRuntime;
    use crate::error::ErrorCode;
    use crate::settings::model::KnowledgeRepository;
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};
    use crate::state::AppServices;

    use super::{
        list_document_history_inner, list_document_history_with_completion_hook, published_event,
        read_document_asset_inner, read_document_asset_with_completion_hook, read_document_inner,
        read_document_version_inner, read_document_version_with_completion_hook,
        read_document_with_completion_hook, recover_lagged_document_events,
        refresh_document_session_inner, search_documents_inner,
        search_documents_with_completion_hook, start_document_session_inner,
        start_document_session_with_async_hook, start_document_session_with_boundaries,
        start_document_session_with_hook, stop_document_session_inner, DocumentEventEmitter,
        DocumentEventEnvelope, StartDocumentSessionTestBoundaries,
    };

    const REPOSITORY_FULL_NAME: &str = "Mockly-Company/mockly-knowledge";

    #[derive(Clone, Default)]
    struct MemorySettings(Arc<Mutex<HashMap<String, String>>>);

    impl LocalSettingsStore for MemorySettings {
        fn read(&self, key: &str) -> Result<Option<String>, crate::error::AppError> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> Result<(), crate::error::AppError> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), crate::error::AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct RecordedEvents(Arc<Mutex<Vec<DocumentEventEnvelope>>>);

    impl RecordedEvents {
        fn clear(&self) {
            self.0.lock().unwrap().clear();
        }

        fn snapshot(&self) -> Vec<DocumentEventEnvelope> {
            self.0.lock().unwrap().clone()
        }
    }

    impl DocumentEventEmitter for RecordedEvents {
        fn emit(&self, event: DocumentEventEnvelope) {
            self.0.lock().unwrap().push(event);
        }
    }

    struct DocumentServicesFixture {
        _repository: TempDir,
        _cache: TempDir,
        services: Arc<AppServices>,
        workspace_id: Uuid,
    }

    impl DocumentServicesFixture {
        fn new() -> Self {
            let repository = tempfile::tempdir().unwrap();
            let cache = tempfile::tempdir().unwrap();
            let workspace_id = Uuid::new_v4();
            write_workspace(repository.path(), workspace_id);
            initialize_repository(repository.path());

            let settings = LocalSettingsService::new(MemorySettings::default());
            settings
                .set_current_for_repository(
                    repository.path(),
                    KnowledgeRepository {
                        id: "R_kgDOExample".into(),
                        full_name: REPOSITORY_FULL_NAME.into(),
                    },
                )
                .unwrap();
            let services = AppServices::new(settings)
                .with_documents(DocumentRuntime::new(), cache.path().to_path_buf());

            Self {
                _repository: repository,
                _cache: cache,
                services: Arc::new(services),
                workspace_id,
            }
        }
    }

    fn write_workspace(root: &Path, workspace_id: Uuid) {
        write_workspace_with_document_root(root, workspace_id, "docs");
    }

    fn write_workspace_with_document_root(root: &Path, workspace_id: Uuid, document_root: &str) {
        fs::create_dir_all(root.join(".okf")).unwrap();
        fs::create_dir_all(root.join("docs/images")).unwrap();
        fs::write(
            root.join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {workspace_id}\n  name: Mockly\ndocuments:\n  roots:\n    - path: {document_root}\nrepositories: []\n"
            ),
        )
        .unwrap();
        fs::write(
            root.join("docs/guide.md"),
            format!(
                "---\nokf_hub_id: {}\ntitle: API Guide\n---\n\n# API Guide\n\nSearchable API text.\n",
                Uuid::new_v4()
            ),
        )
        .unwrap();
        fs::write(root.join("docs/other.md"), "# Other Document\n").unwrap();
        fs::write(root.join("docs/images/map.png"), b"not-a-decoded-png").unwrap();
    }

    fn initialize_repository(root: &Path) {
        let mut options = RepositoryInitOptions::new();
        options.initial_head("main");
        let repository = Repository::init_opts(root, &options).unwrap();
        let mut index = repository.index().unwrap();
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("OkHub Test", "test@example.com").unwrap();
        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "docs: add guide",
                &tree,
                &[],
            )
            .unwrap();
    }

    fn commit_all(root: &Path, message: &str) -> String {
        let repository = Repository::open(root).unwrap();
        let mut index = repository.index().unwrap();
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .unwrap();
        index.update_all(["*"].iter(), None).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("OkHub Test", "test@example.com").unwrap();
        let parent = repository.head().unwrap().peel_to_commit().unwrap();
        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &[&parent],
            )
            .unwrap()
            .to_string()
    }

    async fn wait_at(barrier: Arc<Barrier>) {
        tokio::task::spawn_blocking(move || {
            barrier.wait();
        })
        .await
        .unwrap();
    }

    fn read_request_id() -> String {
        Uuid::new_v4().to_string()
    }

    #[tokio::test]
    async fn start_session_uses_the_saved_workspace_and_echoes_client_id() {
        let fixture = DocumentServicesFixture::new();
        let request_id = Uuid::new_v4();

        let snapshot = start_document_session_inner(&fixture.services, request_id)
            .await
            .unwrap();

        assert_eq!(snapshot.session_id, request_id);
        assert_eq!(snapshot.workspace_id, fixture.workspace_id);
        assert_eq!(snapshot.repository_full_name, REPOSITORY_FULL_NAME);
        assert_eq!(snapshot.branch, "main");
        let value = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(value["sessionId"], request_id.to_string());
        assert_eq!(value["workspaceId"], fixture.workspace_id.to_string());
        assert_eq!(value["repositoryFullName"], REPOSITORY_FULL_NAME);
        assert_eq!(value["branch"], "main");
        assert!(value.get("repositoryRoot").is_none());
        assert!(value.get("cachePath").is_none());
        let serialized = value.to_string();
        assert!(!serialized.contains(fixture._repository.path().to_str().unwrap()));
        assert!(!serialized.contains(fixture._cache.path().to_str().unwrap()));
        assert!(!serialized.contains("token"));

        stop_document_session_inner(&fixture.services, request_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn search_rejects_an_inactive_session() {
        let fixture = DocumentServicesFixture::new();

        let error = search_documents_inner(
            &fixture.services,
            Uuid::new_v4(),
            Uuid::new_v4(),
            "api".into(),
            20,
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::DocumentSessionStale);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["code"],
            "document_session_stale"
        );
    }

    #[tokio::test]
    async fn search_echoes_the_valid_client_request_id() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let request_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let response =
            search_documents_inner(&fixture.services, session_id, request_id, "api".into(), 20)
                .await
                .unwrap();

        assert_eq!(response.session_id, session_id);
        assert_eq!(response.request_id, request_id);
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["sessionId"], session_id.to_string());
        assert_eq!(value["requestId"], request_id.to_string());
        let invalid =
            search_documents_inner(&fixture.services, session_id, Uuid::nil(), "api".into(), 20)
                .await
                .unwrap_err();
        assert_eq!(invalid.code, ErrorCode::DocumentSessionConflict);
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn an_invalid_start_id_cannot_replace_the_active_session() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let error = start_document_session_inner(&fixture.services, Uuid::nil())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::DocumentSessionConflict);
        assert_eq!(
            fixture
                .services
                .document_runtime
                .snapshot(session_id)
                .unwrap()
                .session_id,
            session_id
        );
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn start_requires_the_saved_workspace_to_include_repository_identity() {
        let repository = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        write_workspace(repository.path(), Uuid::new_v4());
        initialize_repository(repository.path());
        let settings = LocalSettingsService::new(MemorySettings::default());
        settings.set_current(repository.path()).unwrap();
        let services = AppServices::new(settings)
            .with_documents(DocumentRuntime::new(), cache.path().to_path_buf());
        let session_id = Uuid::new_v4();

        let error = start_document_session_inner(&services, session_id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceInvalid);
        assert_eq!(
            services
                .document_runtime
                .snapshot(session_id)
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionConflict
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn start_publishes_the_client_owned_status_before_returning() {
        let fixture = DocumentServicesFixture::new();
        let request_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        let reached = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let services = fixture.services.clone();
        let command_events = events.clone();
        let command_reached = reached.clone();
        let command_release = release.clone();

        let command = tokio::spawn(async move {
            start_document_session_with_hook(&services, request_id, command_events, move || {
                command_reached.wait();
                command_release.wait();
            })
            .await
        });
        wait_at(reached).await;

        assert!(!command.is_finished());
        assert!(events.snapshot().iter().any(|event| matches!(
            &event.event,
            DocumentEvent::IndexStatusChanged { session_id, status: IndexStatus::Preparing { .. } }
                if *session_id == request_id
        )));

        wait_at(release).await;
        let snapshot = command.await.unwrap().unwrap();
        assert_eq!(snapshot.session_id, request_id);
        stop_document_session_inner(&fixture.services, request_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn reconcile_before_start_result_has_a_newer_revision_than_the_start_snapshot() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        let services = fixture.services.clone();
        let hook_events = events.clone();
        let waiting_events = hook_events.clone();

        let snapshot = start_document_session_with_async_hook(
            &fixture.services,
            session_id,
            events,
            move || async move {
                services.document_runtime.refresh(session_id).await.unwrap();
                tokio::time::timeout(Duration::from_secs(1), async {
                    loop {
                        if waiting_events.snapshot().iter().any(|event| {
                            matches!(
                                event.event,
                                DocumentEvent::IndexStatusChanged {
                                    session_id: id,
                                    status: IndexStatus::Ready,
                                } if id == session_id
                            )
                        }) {
                            break;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
            },
        )
        .await
        .unwrap();

        let ready_revision = hook_events
            .snapshot()
            .iter()
            .filter_map(|event| {
                matches!(
                    event.event,
                    DocumentEvent::IndexStatusChanged {
                        session_id: id,
                        status: IndexStatus::Ready,
                    } if id == session_id
                )
                .then_some(event.revision)
            })
            .max()
            .unwrap();
        assert!(ready_revision > snapshot.revision);

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stopped_generation_cannot_publish_or_mutate_a_reused_session_id() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        let reached = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let command_reached = reached.clone();
        let command_release = release.clone();
        let services = fixture.services.clone();

        let read = tokio::spawn(async move {
            read_document_with_completion_hook(
                &services,
                session_id,
                read_request_id(),
                "docs/guide.md".into(),
                move || {
                    command_reached.wait();
                    command_release.wait();
                },
            )
            .await
        });
        wait_at(reached).await;
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        events.clear();

        wait_at(release).await;
        let error = read.await.unwrap().unwrap_err();

        assert_eq!(error.code, ErrorCode::DocumentSessionStale);
        assert_eq!(
            fixture
                .services
                .document_runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path,
            None
        );
        assert!(!events
            .snapshot()
            .iter()
            .any(|event| matches!(event.event, DocumentEvent::OpenDocumentChanged { .. })));
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn stopping_a_session_releases_its_emitter_and_rejects_every_adapter_command() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        assert_eq!(Arc::strong_count(&events), 2);

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        assert_eq!(Arc::strong_count(&events), 1);
        let refresh = refresh_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap_err();
        let search = search_documents_inner(
            &fixture.services,
            session_id,
            Uuid::new_v4(),
            "api".into(),
            20,
        )
        .await
        .unwrap_err();
        let read = read_document_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap_err();
        let asset = read_document_asset_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            "images/map.png".into(),
        )
        .await
        .unwrap_err();
        let history = list_document_history_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            None,
        )
        .await
        .unwrap_err();
        let version = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "0000000000000000000000000000000000000000".into(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap_err();

        for error in [refresh, search, read, asset, history, version] {
            assert_eq!(error.code, ErrorCode::DocumentSessionStale);
        }
    }

    #[tokio::test]
    async fn replacing_a_session_drops_the_previous_emitter() {
        let fixture = DocumentServicesFixture::new();
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let first_events = Arc::new(RecordedEvents::default());
        let second_events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, first_id, first_events.clone(), || {})
            .await
            .unwrap();
        assert_eq!(Arc::strong_count(&first_events), 2);

        start_document_session_with_hook(
            &fixture.services,
            second_id,
            second_events.clone(),
            || {},
        )
        .await
        .unwrap();

        assert_eq!(Arc::strong_count(&first_events), 1);
        assert_eq!(Arc::strong_count(&second_events), 2);
        assert!(second_events
            .snapshot()
            .iter()
            .all(|event| super::document_event_session_id(&event.event) == second_id));
        stop_document_session_inner(&fixture.services, second_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn aborting_start_while_waiting_for_the_old_listener_cleans_exact_pending_ownership() {
        let fixture = DocumentServicesFixture::new();
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let first_events = Arc::new(RecordedEvents::default());
        let second_events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, first_id, first_events.clone(), || {})
            .await
            .unwrap();
        let reached = Arc::new(Semaphore::new(0));
        let release = Arc::new(Semaphore::new(0));
        let services = fixture.services.clone();
        let command_events = second_events.clone();
        let command_reached = reached.clone();
        let command_release = release.clone();

        let command = tokio::spawn(async move {
            start_document_session_with_boundaries(
                &services,
                second_id,
                command_events,
                || {},
                StartDocumentSessionTestBoundaries {
                    before_previous_listener_wait: Some((command_reached, command_release)),
                    after_runtime_reservation: None,
                },
            )
            .await
        });
        reached.acquire().await.unwrap().forget();

        command.abort();
        assert!(command.await.unwrap_err().is_cancelled());
        release.add_permits(1);

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if Arc::strong_count(&first_events) == 1
                    && Arc::strong_count(&second_events) == 1
                    && fixture
                        .services
                        .document_runtime
                        .snapshot(first_id)
                        .is_err()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        start_document_session_inner(&fixture.services, second_id)
            .await
            .unwrap();
        stop_document_session_inner(&fixture.services, second_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn aborting_start_after_runtime_reservation_stops_only_that_generation_and_emitter() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        let reached = Arc::new(Semaphore::new(0));
        let release = Arc::new(Semaphore::new(0));
        let services = fixture.services.clone();
        let command_events = events.clone();
        let command_reached = reached.clone();
        let command_release = release.clone();

        let command = tokio::spawn(async move {
            start_document_session_with_boundaries(
                &services,
                session_id,
                command_events,
                || {},
                StartDocumentSessionTestBoundaries {
                    before_previous_listener_wait: None,
                    after_runtime_reservation: Some((command_reached, command_release)),
                },
            )
            .await
        });
        reached.acquire().await.unwrap().forget();

        command.abort();
        assert!(command.await.unwrap_err().is_cancelled());
        release.add_permits(1);

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if Arc::strong_count(&events) == 1
                    && fixture
                        .services
                        .document_runtime
                        .snapshot(session_id)
                        .is_err()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn lag_recovery_discards_through_the_barrier_before_forwarding_a_concurrent_event() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        let context = fixture
            .services
            .document_sessions
            .active_context(session_id)
            .unwrap();
        let generation = fixture
            .services
            .document_sessions
            .active_generation(&context)
            .unwrap();
        let runtime = &fixture.services.document_runtime;
        let mut receiver = runtime.subscribe();
        for _ in 0..65 {
            runtime.publish_resync_barrier(generation).unwrap();
        }
        assert!(matches!(
            receiver.recv().await,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_))
        ));
        let (queue, mut queued) = mpsc::unbounded_channel();
        let cancellation = CancellationToken::new();

        assert!(
            recover_lagged_document_events(
                &mut receiver,
                &context,
                &queue,
                &cancellation,
                runtime,
                generation,
                || runtime
                    .set_open_document(session_id, "docs/guide.md")
                    .unwrap(),
            )
            .await
        );

        let failed = queued.recv().await.unwrap();
        let resynced = queued.recv().await.unwrap();
        let post_barrier = published_event(&context, receiver.recv().await.unwrap()).unwrap();
        assert!(matches!(failed.event, DocumentEvent::Failed { .. }));
        assert!(matches!(resynced.event, DocumentEvent::Resynced { .. }));
        assert!(matches!(
            post_barrier.event,
            DocumentEvent::OpenDocumentChanged { ref path, .. } if path == "docs/guide.md"
        ));
        assert!(failed.revision < resynced.revision);
        assert!(resynced.revision < post_barrier.revision);

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn same_uuid_replacement_wins_over_every_retained_operation_error() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        fixture
            .services
            .document_runtime
            .stop_session(session_id)
            .await
            .unwrap();

        let reached = Arc::new(Barrier::new(6));
        let release = Arc::new(Barrier::new(6));
        let search = {
            let services = fixture.services.clone();
            let reached = reached.clone();
            let release = release.clone();
            tokio::spawn(async move {
                search_documents_with_completion_hook(
                    &services,
                    session_id,
                    Uuid::new_v4(),
                    "api".into(),
                    20,
                    move || {
                        reached.wait();
                        release.wait();
                    },
                )
                .await
            })
        };
        let read = {
            let services = fixture.services.clone();
            let reached = reached.clone();
            let release = release.clone();
            tokio::spawn(async move {
                read_document_with_completion_hook(
                    &services,
                    session_id,
                    read_request_id(),
                    "docs/missing.md".into(),
                    move || {
                        reached.wait();
                        release.wait();
                    },
                )
                .await
            })
        };
        let asset = {
            let services = fixture.services.clone();
            let reached = reached.clone();
            let release = release.clone();
            tokio::spawn(async move {
                read_document_asset_with_completion_hook(
                    &services,
                    session_id,
                    "docs/missing.md".into(),
                    "missing.png".into(),
                    move || {
                        reached.wait();
                        release.wait();
                    },
                )
                .await
            })
        };
        let history = {
            let services = fixture.services.clone();
            let reached = reached.clone();
            let release = release.clone();
            tokio::spawn(async move {
                list_document_history_with_completion_hook(
                    &services,
                    session_id,
                    "docs/missing.md".into(),
                    None,
                    move || {
                        reached.wait();
                        release.wait();
                    },
                )
                .await
            })
        };
        let version = {
            let services = fixture.services.clone();
            let reached = reached.clone();
            let release = release.clone();
            tokio::spawn(async move {
                read_document_version_with_completion_hook(
                    &services,
                    session_id,
                    read_request_id(),
                    "0000000000000000000000000000000000000000".into(),
                    "docs/missing.md".into(),
                    move || {
                        reached.wait();
                        release.wait();
                    },
                )
                .await
            })
        };

        wait_at(reached).await;
        assert_eq!(
            stop_document_session_inner(&fixture.services, session_id)
                .await
                .unwrap_err()
                .code,
            ErrorCode::DocumentSessionStale
        );
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        wait_at(release).await;

        for error in [
            search.await.unwrap().unwrap_err(),
            read.await.unwrap().unwrap_err(),
            asset.await.unwrap().unwrap_err(),
            history.await.unwrap().unwrap_err(),
            version.await.unwrap().unwrap_err(),
        ] {
            assert_eq!(error.code, ErrorCode::DocumentSessionStale);
        }
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn reads_use_only_the_active_workspace_boundaries() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let content = read_document_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap();
        assert_eq!(content.summary.title, "API Guide");
        assert_eq!(
            content.last_commit.as_ref().unwrap().message,
            "docs: add guide"
        );

        let asset = read_document_asset_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            "images/map.png".into(),
        )
        .await
        .unwrap();
        assert!(
            matches!(asset, DocumentAsset::Raster { mime_type, .. } if mime_type == "image/png")
        );

        let history = list_document_history_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(history.items.len(), 1);
        let version = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            history.items[0].commit_oid.clone(),
            history.items[0].path_at_commit.clone(),
        )
        .await
        .unwrap();
        assert_eq!(version.summary.title, "API Guide");

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn version_reads_require_an_exact_pair_issued_by_the_exact_session_context() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        let history = list_document_history_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            None,
        )
        .await
        .unwrap();
        let issued = history.items.first().unwrap();

        let guessed = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            issued.commit_oid.clone(),
            "docs/other.md".into(),
        )
        .await
        .unwrap_err();
        assert_eq!(guessed.code, ErrorCode::DocumentHistoryInvalid);

        let issued_commit = issued.commit_oid.clone();
        let issued_path = issued.path_at_commit.clone();
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        let replacement = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            issued_commit,
            issued_path,
        )
        .await
        .unwrap_err();
        assert_eq!(replacement.code, ErrorCode::DocumentHistoryInvalid);

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn repository_dot_root_uses_the_reader_and_history_portable_path_semantics() {
        let repository = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let workspace_id = Uuid::new_v4();
        write_workspace_with_document_root(repository.path(), workspace_id, ".");
        initialize_repository(repository.path());
        let settings = LocalSettingsService::new(MemorySettings::default());
        settings
            .set_current_for_repository(
                repository.path(),
                KnowledgeRepository {
                    id: "R_kgDOExample".into(),
                    full_name: REPOSITORY_FULL_NAME.into(),
                },
            )
            .unwrap();
        let services = AppServices::new(settings)
            .with_documents(DocumentRuntime::new(), cache.path().to_path_buf());
        let session_id = Uuid::new_v4();
        start_document_session_inner(&services, session_id)
            .await
            .unwrap();

        let history =
            list_document_history_inner(&services, session_id, "docs/guide.md".into(), None)
                .await
                .unwrap();
        let version = read_document_version_inner(
            &services,
            session_id,
            read_request_id(),
            history.items[0].commit_oid.clone(),
            history.items[0].path_at_commit.clone(),
        )
        .await
        .unwrap();
        assert_eq!(version.summary.path, "docs/guide.md");

        stop_document_session_inner(&services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn an_issued_rename_version_may_precede_the_current_document_root() {
        let fixture = DocumentServicesFixture::new();
        let document_id = Uuid::new_v4();
        fs::create_dir_all(fixture._repository.path().join("legacy")).unwrap();
        fs::write(
            fixture._repository.path().join("legacy/renamed.md"),
            format!("---\nokf_hub_id: {document_id}\ntitle: Renamed\n---\n\n# Renamed\n"),
        )
        .unwrap();
        commit_all(fixture._repository.path(), "docs: add legacy document");
        fs::rename(
            fixture._repository.path().join("legacy/renamed.md"),
            fixture._repository.path().join("docs/renamed.md"),
        )
        .unwrap();
        commit_all(
            fixture._repository.path(),
            "docs: move document into current root",
        );
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let history = list_document_history_inner(
            &fixture.services,
            session_id,
            "docs/renamed.md".into(),
            None,
        )
        .await
        .unwrap();
        let legacy = history
            .items
            .iter()
            .find(|item| item.path_at_commit == "legacy/renamed.md")
            .unwrap();
        let version = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            legacy.commit_oid.clone(),
            legacy.path_at_commit.clone(),
        )
        .await
        .unwrap();
        assert_eq!(version.summary.path, "legacy/renamed.md");

        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn repeated_reads_persist_selection_without_re_emitting_it() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        events.clear();

        read_document_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap();
        read_document_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap();

        assert_eq!(
            events
                .snapshot()
                .iter()
                .filter(|event| matches!(event.event, DocumentEvent::OpenDocumentChanged { .. }))
                .count(),
            1
        );
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn older_read_completing_last_cannot_reclaim_live_or_restored_selection() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        events.clear();

        let older_reached = Arc::new(Barrier::new(2));
        let older_release = Arc::new(Barrier::new(2));
        let older_request_id = Uuid::new_v4().to_string();
        let newer_request_id = Uuid::new_v4().to_string();
        let services = fixture.services.clone();
        let command_reached = older_reached.clone();
        let command_release = older_release.clone();
        let older = tokio::spawn(async move {
            read_document_with_completion_hook(
                &services,
                session_id,
                older_request_id,
                "docs/guide.md".into(),
                move || {
                    command_reached.wait();
                    command_release.wait();
                },
            )
            .await
        });
        wait_at(older_reached).await;

        read_document_inner(
            &fixture.services,
            session_id,
            newer_request_id,
            "docs/other.md".into(),
        )
        .await
        .unwrap();
        wait_at(older_release).await;
        older.await.unwrap().unwrap();

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if events.snapshot().iter().any(|event| {
                    matches!(
                        &event.event,
                        DocumentEvent::OpenDocumentChanged { path, .. }
                            if path == "docs/other.md"
                    )
                }) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        let live_path = fixture
            .services
            .document_runtime
            .snapshot(session_id)
            .unwrap()
            .last_opened_path;
        let open_events = events
            .snapshot()
            .into_iter()
            .filter_map(|event| match event.event {
                DocumentEvent::OpenDocumentChanged { path, .. } => Some(path),
                _ => None,
            })
            .collect::<Vec<_>>();
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let restart_id = Uuid::new_v4();
        let restored = start_document_session_inner(&fixture.services, restart_id)
            .await
            .unwrap();
        stop_document_session_inner(&fixture.services, restart_id)
            .await
            .unwrap();

        assert_eq!(live_path.as_deref(), Some("docs/other.md"));
        assert_eq!(restored.last_opened_path.as_deref(), Some("docs/other.md"));
        assert_eq!(open_events, ["docs/other.md"]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn duplicate_read_request_ids_cannot_let_the_older_invocation_win() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let request_id = Uuid::new_v4().to_string();
        let older_request_id = request_id.clone();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
        let older_reached = Arc::new(Barrier::new(2));
        let older_release = Arc::new(Barrier::new(2));
        let services = fixture.services.clone();
        let command_reached = older_reached.clone();
        let command_release = older_release.clone();

        let older = tokio::spawn(async move {
            read_document_with_completion_hook(
                &services,
                session_id,
                older_request_id,
                "docs/guide.md".into(),
                move || {
                    command_reached.wait();
                    command_release.wait();
                },
            )
            .await
        });
        wait_at(older_reached).await;
        read_document_inner(
            &fixture.services,
            session_id,
            request_id,
            "docs/other.md".into(),
        )
        .await
        .unwrap();
        wait_at(older_release).await;
        older.await.unwrap().unwrap();

        assert_eq!(
            fixture
                .services
                .document_runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path
                .as_deref(),
            Some("docs/other.md")
        );
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn newer_historical_read_prevents_an_older_current_read_from_persisting() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        let events = Arc::new(RecordedEvents::default());
        start_document_session_with_hook(&fixture.services, session_id, events.clone(), || {})
            .await
            .unwrap();
        let history = list_document_history_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            None,
        )
        .await
        .unwrap();
        let version = history.items.first().unwrap().clone();
        events.clear();
        let older_reached = Arc::new(Barrier::new(2));
        let older_release = Arc::new(Barrier::new(2));
        let services = fixture.services.clone();
        let command_reached = older_reached.clone();
        let command_release = older_release.clone();

        let older = tokio::spawn(async move {
            read_document_with_completion_hook(
                &services,
                session_id,
                read_request_id(),
                "docs/guide.md".into(),
                move || {
                    command_reached.wait();
                    command_release.wait();
                },
            )
            .await
        });
        wait_at(older_reached).await;
        read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            version.commit_oid,
            version.path_at_commit,
        )
        .await
        .unwrap();
        wait_at(older_release).await;
        older.await.unwrap().unwrap();

        assert_eq!(
            fixture
                .services
                .document_runtime
                .snapshot(session_id)
                .unwrap()
                .last_opened_path,
            None
        );
        assert!(!events
            .snapshot()
            .iter()
            .any(|event| matches!(event.event, DocumentEvent::OpenDocumentChanged { .. })));
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_new_session_restores_only_the_valid_cached_document_path() {
        let fixture = DocumentServicesFixture::new();
        let first_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, first_id)
            .await
            .unwrap();
        read_document_inner(
            &fixture.services,
            first_id,
            read_request_id(),
            "docs/guide.md".into(),
        )
        .await
        .unwrap();
        stop_document_session_inner(&fixture.services, first_id)
            .await
            .unwrap();

        let second_id = Uuid::new_v4();
        let restored = start_document_session_inner(&fixture.services, second_id)
            .await
            .unwrap();

        assert_eq!(restored.last_opened_path.as_deref(), Some("docs/guide.md"));
        stop_document_session_inner(&fixture.services, second_id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn asset_paths_cannot_escape_and_unissued_versions_are_rejected() {
        let fixture = DocumentServicesFixture::new();
        let session_id = Uuid::new_v4();
        start_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();

        let asset = read_document_asset_inner(
            &fixture.services,
            session_id,
            "docs/guide.md".into(),
            "../../.okf/workspace.yml".into(),
        )
        .await
        .unwrap_err();
        let version = read_document_version_inner(
            &fixture.services,
            session_id,
            read_request_id(),
            "0000000000000000000000000000000000000000".into(),
            ".okf/workspace.yml".into(),
        )
        .await
        .unwrap_err();

        assert_eq!(asset.code, ErrorCode::DocumentPathInvalid);
        assert_eq!(version.code, ErrorCode::DocumentHistoryInvalid);
        stop_document_session_inner(&fixture.services, session_id)
            .await
            .unwrap();
    }
}
