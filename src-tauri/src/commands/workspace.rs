use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{GithubRepositorySummary, Page};
use crate::repository::model::{
    CloneProgress, CloneRequest, InitializationResult, RepositoryIdentity, RepositorySnapshot,
};
use crate::repository::service::{
    CloneProgressSink, RepositoryCredentialPort, RepositoryRemotePort, RepositoryService,
};
use crate::settings::model::{CurrentWorkspace, KnowledgeRepository, PendingInitializationContext};
use crate::state::{AppServices, JobRegistrationError};
use crate::workspace::service::{
    InitializationPreview, RepositoryPopulation, WorkspaceInspection, WorkspaceService,
};

pub const REPOSITORY_CLONE_PROGRESS_EVENT: &str = "repository-clone-progress";
const INITIALIZATION_PREVIEW_TTL_SECONDS: i64 = 15 * 60;

trait RepositoryCloneEventEmitter: Send + Sync {
    fn emit(&self, event: RepositoryCloneEvent);
}

struct TauriRepositoryCloneEventEmitter {
    app: AppHandle,
}

impl RepositoryCloneEventEmitter for TauriRepositoryCloneEventEmitter {
    fn emit(&self, event: RepositoryCloneEvent) {
        let _ = self.app.emit(REPOSITORY_CLONE_PROGRESS_EVENT, event);
    }
}

struct CloneCommandProgressSink {
    request_id: Uuid,
    cancellation: tokio_util::sync::CancellationToken,
    emitter: Option<std::sync::Arc<dyn RepositoryCloneEventEmitter>>,
    jobs: Option<crate::state::JobRegistry>,
}

impl CloneCommandProgressSink {
    fn new(
        request_id: Uuid,
        cancellation: CancellationToken,
        emitter: Arc<dyn RepositoryCloneEventEmitter>,
        jobs: crate::state::JobRegistry,
    ) -> Self {
        Self {
            request_id,
            cancellation,
            emitter: Some(emitter),
            jobs: Some(jobs),
        }
    }

    #[cfg(test)]
    fn without_emitter(
        request_id: Uuid,
        cancellation: tokio_util::sync::CancellationToken,
    ) -> Self {
        Self {
            request_id,
            cancellation,
            emitter: None,
            jobs: None,
        }
    }

    #[cfg(test)]
    fn without_emitter_and_jobs(
        request_id: Uuid,
        cancellation: CancellationToken,
        jobs: crate::state::JobRegistry,
    ) -> Self {
        Self {
            request_id,
            cancellation,
            emitter: None,
            jobs: Some(jobs),
        }
    }
}

impl CloneProgressSink for CloneCommandProgressSink {
    fn emit(&self, progress: CloneProgress) -> bool {
        if self.cancellation.is_cancelled() {
            return false;
        }
        if let Some(emitter) = &self.emitter {
            emitter.emit(RepositoryCloneEvent::Progress {
                request_id: self.request_id,
                progress,
            });
        }
        !self.cancellation.is_cancelled()
    }

    fn begin_finalization(&self) -> bool {
        if self.cancellation.is_cancelled() {
            return false;
        }
        self.jobs
            .as_ref()
            .is_none_or(|jobs| jobs.begin_completion(self.request_id))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RepositoryCloneEvent {
    Progress {
        #[serde(rename = "requestId")]
        request_id: Uuid,
        progress: CloneProgress,
    },
    Completed {
        #[serde(rename = "requestId")]
        request_id: Uuid,
        #[serde(rename = "ownershipTargetPath")]
        ownership_target_path: PathBuf,
        repository: RepositorySnapshot,
    },
    Failed {
        #[serde(rename = "requestId")]
        request_id: Uuid,
        error: AppError,
    },
    Cancelled {
        #[serde(rename = "requestId")]
        request_id: Uuid,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryCommandRequest {
    pub repository_id: String,
    pub full_name: String,
    pub https_url: String,
    pub parent_directory: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneJob {
    pub request_id: Uuid,
    pub target_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInitializationRequest {
    pub repository_path: PathBuf,
    pub workspace_name: String,
    pub repository_id: String,
    pub repository_full_name: String,
}

pub(crate) async fn list_github_repositories_inner(
    services: &AppServices,
    cursor: Option<String>,
) -> CommandResult<Page<GithubRepositorySummary>> {
    services
        .github
        .clone()
        .ok_or_else(service_unavailable)?
        .list_repositories(cursor.as_deref())
        .await
}

#[tauri::command]
pub async fn list_github_repositories(
    state: State<'_, AppServices>,
    cursor: Option<String>,
) -> CommandResult<Page<GithubRepositorySummary>> {
    list_github_repositories_inner(&state, cursor).await
}

pub(crate) async fn inspect_existing_clone_inner(
    services: &AppServices,
    path: PathBuf,
    repository_id: String,
) -> CommandResult<RepositorySnapshot> {
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let git = services.repository_git.clone();
    run_blocking(move || {
        let service = RepositoryService::for_inspection(git, github);
        tauri::async_runtime::block_on(service.inspect_existing(&path, &repository_id))
    })
    .await
}

#[tauri::command]
pub async fn inspect_existing_clone(
    state: State<'_, AppServices>,
    path: PathBuf,
    repository_id: String,
) -> CommandResult<RepositorySnapshot> {
    inspect_existing_clone_inner(&state, path, repository_id).await
}

async fn clone_repository_inner(
    services: &AppServices,
    request_id: Uuid,
    request: CloneRepositoryCommandRequest,
    emitter: Arc<dyn RepositoryCloneEventEmitter>,
) -> CommandResult<CloneJob> {
    clone_repository_with_spawn_hook(services, request_id, request, emitter, || {}).await
}

async fn clone_repository_with_spawn_hook(
    services: &AppServices,
    request_id: Uuid,
    request: CloneRepositoryCommandRequest,
    emitter: Arc<dyn RepositoryCloneEventEmitter>,
    before_run: impl FnOnce() + Send + 'static,
) -> CommandResult<CloneJob> {
    let auth = services.auth.clone().ok_or_else(service_unavailable)?;
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let repository_name = repository_name_from_full_name(&request.full_name)?;
    let target_path = RepositoryService::clone_target(&request.parent_directory, repository_name)?;
    let cancellation = CancellationToken::new();
    services
        .clone_jobs
        .try_insert(request_id, cancellation.clone())
        .map_err(|error| clone_job_registration_error(error, request_id))?;

    let jobs = services.clone_jobs.clone();
    let git = services.repository_git.clone();
    let progress = Arc::new(CloneCommandProgressSink::new(
        request_id,
        cancellation.clone(),
        emitter.clone(),
        jobs.clone(),
    ));
    let ownership_target_path = target_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        before_run();
        let service = RepositoryService::for_clone(git, github, auth);
        let request = CloneRequest {
            repository_id: request.repository_id,
            full_name: request.full_name,
            https_url: request.https_url,
            parent_directory: request.parent_directory,
        };
        let result = tauri::async_runtime::block_on(async {
            tokio::select! {
                _ = cancellation.cancelled() => Err(clone_cancelled_error()),
                result = service.clone(request, progress) => result,
            }
        });
        let terminal = jobs.finish(request_id);
        emit_clone_terminal(
            emitter.as_ref(),
            request_id,
            ownership_target_path,
            terminal,
            result,
        );
    });

    Ok(CloneJob {
        request_id,
        target_path,
    })
}

fn emit_clone_terminal(
    emitter: &dyn RepositoryCloneEventEmitter,
    request_id: Uuid,
    ownership_target_path: PathBuf,
    terminal: crate::state::JobTerminal,
    result: CommandResult<RepositorySnapshot>,
) {
    match terminal {
        crate::state::JobTerminal::Cancelled => {
            emitter.emit(RepositoryCloneEvent::Cancelled { request_id });
        }
        crate::state::JobTerminal::Completed => match result {
            Ok(repository) => emitter.emit(RepositoryCloneEvent::Completed {
                request_id,
                ownership_target_path,
                repository,
            }),
            Err(error) => emitter.emit(RepositoryCloneEvent::Failed { request_id, error }),
        },
        crate::state::JobTerminal::AlreadyTerminal => {}
    }
}

#[tauri::command]
pub async fn clone_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
    request_id: Uuid,
    request: CloneRepositoryCommandRequest,
) -> CommandResult<CloneJob> {
    clone_repository_inner(
        &state,
        request_id,
        request,
        Arc::new(TauriRepositoryCloneEventEmitter { app }),
    )
    .await
}

pub(crate) async fn cancel_repository_clone_inner(
    services: &AppServices,
    request_id: Uuid,
) -> CommandResult<bool> {
    Ok(services.clone_jobs.cancel(request_id))
}

#[tauri::command]
pub async fn cancel_repository_clone(
    state: State<'_, AppServices>,
    request_id: Uuid,
) -> CommandResult<bool> {
    cancel_repository_clone_inner(&state, request_id).await
}

pub(crate) async fn inspect_workspace_inner(
    repository_path: PathBuf,
) -> CommandResult<WorkspaceInspection> {
    run_blocking(move || WorkspaceService::inspect(&repository_path)).await
}

#[tauri::command]
pub async fn inspect_workspace(repository_path: PathBuf) -> CommandResult<WorkspaceInspection> {
    inspect_workspace_inner(repository_path).await
}

pub(crate) async fn connect_workspace_inner(
    services: &AppServices,
    repository_path: PathBuf,
    repository_id: String,
    repository_full_name: String,
) -> CommandResult<CurrentWorkspace> {
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let verified_repository = github
        .repository_detail(&repository_id, &repository_full_name)
        .await?;
    inspect_existing_clone_inner(
        services,
        repository_path.clone(),
        verified_repository.id.clone(),
    )
    .await?;
    let settings = services.local_settings.clone();
    run_blocking(move || {
        settings.set_current_for_repository(
            &repository_path,
            KnowledgeRepository {
                id: verified_repository.id,
                full_name: verified_repository.full_name,
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn connect_workspace(
    state: State<'_, AppServices>,
    repository_path: PathBuf,
    repository_id: String,
    repository_full_name: String,
) -> CommandResult<CurrentWorkspace> {
    connect_workspace_inner(&state, repository_path, repository_id, repository_full_name).await
}

pub(crate) async fn preview_workspace_initialization_inner(
    services: &AppServices,
    request: WorkspaceInitializationRequest,
) -> CommandResult<InitializationPreview> {
    let auth = services.auth.clone().ok_or_else(service_unavailable)?;
    let auth_generation = auth
        .lifecycle_generation()
        .await
        .ok_or_else(stale_auth_preview_error)?;
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let repository = github
        .repository_detail(&request.repository_id, &request.repository_full_name)
        .await?;
    let user = github.current_user().await?;
    let git = services.repository_git.clone();
    let repository_path = request.repository_path.clone();
    let snapshot = run_blocking(move || git.inspect(&repository_path)).await?;
    let default_branch = repository
        .default_branch
        .clone()
        .unwrap_or_else(|| "main".into());
    let population = if repository.is_empty {
        RepositoryPopulation::Empty { default_branch }
    } else {
        RepositoryPopulation::ExistingContent { default_branch }
    };
    let preview_path = request.repository_path.clone();
    let workspace_name = request.workspace_name;
    let fingerprint = snapshot.fingerprint;
    let preview = run_blocking(move || {
        WorkspaceService::create_initialization_preview(
            &preview_path,
            &workspace_name,
            &fingerprint,
            population,
        )
    })
    .await?;
    let now = now_unix()?;
    let context = PendingInitializationContext {
        preview_id: preview.id,
        root: request.repository_path,
        repository_id: repository.id,
        repository_full_name: repository.full_name,
        author_id: user.id,
        author_login: user.login,
        created_at_unix: now,
        expires_at_unix: now.saturating_add(INITIALIZATION_PREVIEW_TTL_SECONDS),
        completed_result: None,
    };
    persist_initialization_preview(services, preview.clone(), context, auth, auth_generation)
        .await?;
    Ok(preview)
}

async fn persist_initialization_preview(
    services: &AppServices,
    preview: InitializationPreview,
    context: PendingInitializationContext,
    auth: Arc<crate::auth::service::AuthService>,
    captured_auth_generation: u64,
) -> CommandResult<()> {
    let _mutation = services.initialization_contexts.lock_mutation().await;
    if auth.lifecycle_generation().await != Some(captured_auth_generation) {
        return Err(stale_auth_preview_error());
    }
    services.initialization_previews.insert(preview.clone())?;
    let replacement = match services
        .initialization_contexts
        .begin_replace(context.clone())
    {
        Ok(replacement) => replacement,
        Err(error) => {
            services.initialization_previews.remove(preview.id);
            return Err(error);
        }
    };
    let settings = services.local_settings.clone();
    if let Err(error) = run_blocking(move || settings.set_pending_initialization(&context)).await {
        drop(replacement);
        services.initialization_previews.remove(preview.id);
        return Err(error);
    }
    if let Some(previous) = replacement.commit() {
        services.initialization_previews.remove(previous.preview_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_workspace_initialization(
    state: State<'_, AppServices>,
    request: WorkspaceInitializationRequest,
) -> CommandResult<InitializationPreview> {
    preview_workspace_initialization_inner(&state, request).await
}

pub(crate) async fn initialize_workspace_inner(
    services: &AppServices,
    preview_id: Uuid,
) -> CommandResult<crate::repository::model::InitializationResult> {
    let mut claim = claim_pending_initialization(services, preview_id).await?;
    let context = claim.context().clone();
    if let Some(result) = context.completed_result {
        clear_completed_initialization(services, claim).await?;
        return Ok(result);
    }
    #[cfg(test)]
    let test_boundaries = services.initialization_test_boundaries.clone();
    #[cfg(test)]
    let resolved_boundaries = match test_boundaries {
        Some(boundaries) => Some((
            boundaries.user,
            boundaries.repository,
            boundaries.remote,
            boundaries.credentials,
            boundaries.git,
        )),
        None => None,
    };
    #[cfg(test)]
    let resolved_boundaries = match resolved_boundaries {
        Some(boundaries) => boundaries,
        None => resolve_production_initialization_boundaries(services, &context).await?,
    };
    #[cfg(not(test))]
    let resolved_boundaries =
        resolve_production_initialization_boundaries(services, &context).await?;
    let (user, repository, remote, credentials, git) = resolved_boundaries;
    ensure_pending_initialization_account(services, &context, &user).await?;
    let expired = now_unix()? > context.expires_at_unix;
    if expired {
        services.initialization_previews.remove(preview_id);
    }
    let previews = services.initialization_previews.clone();
    let result = run_blocking(move || {
        let service = RepositoryService::new(
            git,
            remote,
            credentials,
            previews,
            context.root,
            repository,
            RepositoryIdentity {
                database_id: user.id,
                login: user.login,
            },
        );
        tauri::async_runtime::block_on(service.initialize(preview_id))
    })
    .await;
    let result = match result {
        Ok(result) => result,
        Err(error) => return handle_initialization_failure(services, claim, expired, error).await,
    };
    claim.record_completion(result.clone());
    let _mutation = services.initialization_contexts.lock_mutation().await;
    let settings = services.local_settings.clone();
    run_blocking(move || settings.clear_pending_initialization()).await?;
    drop(_mutation);
    claim.complete();
    Ok(result)
}

type InitializationBoundaries = (
    crate::auth::model::GithubUserSummary,
    crate::github::model::GithubRepositoryDetail,
    Arc<dyn RepositoryRemotePort>,
    Arc<dyn RepositoryCredentialPort>,
    Arc<dyn crate::repository::service::GitRepositoryPort>,
);

async fn resolve_production_initialization_boundaries(
    services: &AppServices,
    context: &PendingInitializationContext,
) -> CommandResult<InitializationBoundaries> {
    let auth = services.auth.clone().ok_or_else(service_unavailable)?;
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let user = github.current_user().await?;
    ensure_pending_initialization_account(services, context, &user).await?;
    let repository = github
        .repository_detail(&context.repository_id, &context.repository_full_name)
        .await?;
    let remote: Arc<dyn RepositoryRemotePort> = github;
    let credentials: Arc<dyn RepositoryCredentialPort> = auth;
    Ok((
        user,
        repository,
        remote,
        credentials,
        services.repository_git.clone(),
    ))
}

async fn handle_initialization_failure(
    services: &AppServices,
    claim: crate::state::InitializationContextClaim,
    expired: bool,
    error: AppError,
) -> CommandResult<InitializationResult> {
    if error.code == ErrorCode::WorkspaceChangedSincePreview {
        let root = claim.context().root.clone();
        let already_initialized = if expired {
            false
        } else {
            run_blocking(move || WorkspaceService::inspect(&root))
                .await
                .is_ok_and(|inspection| matches!(inspection, WorkspaceInspection::Ready { .. }))
        };
        if expired || already_initialized {
            drop(claim);
            clear_pending_initialization_inner(services).await?;
        }
    }
    Err(error)
}

async fn clear_completed_initialization(
    services: &AppServices,
    claim: crate::state::InitializationContextClaim,
) -> CommandResult<()> {
    let _mutation = services.initialization_contexts.lock_mutation().await;
    let settings = services.local_settings.clone();
    run_blocking(move || settings.clear_pending_initialization()).await?;
    services
        .initialization_previews
        .remove(claim.context().preview_id);
    drop(_mutation);
    claim.complete();
    Ok(())
}

async fn claim_pending_initialization(
    services: &AppServices,
    preview_id: Uuid,
) -> CommandResult<crate::state::InitializationContextClaim> {
    let _mutation = services.initialization_contexts.lock_mutation().await;
    if let Some(claim) = services
        .initialization_contexts
        .claim_if_present(preview_id)?
    {
        return Ok(claim);
    }
    let settings = services.local_settings.clone();
    let mut persisted = run_blocking(move || settings.load_pending_initialization())
        .await?
        .filter(|context| context.preview_id == preview_id)
        .ok_or_else(stale_preview_error)?;
    if persisted.completed_result.take().is_some() {
        let settings = services.local_settings.clone();
        let sanitized = persisted.clone();
        run_blocking(move || settings.set_pending_initialization(&sanitized)).await?;
    }
    services.initialization_contexts.insert(persisted)?;
    services.initialization_contexts.claim(preview_id)
}

async fn ensure_pending_initialization_account(
    services: &AppServices,
    context: &PendingInitializationContext,
    user: &crate::auth::model::GithubUserSummary,
) -> CommandResult<()> {
    if user.id == context.author_id {
        return Ok(());
    }
    clear_pending_initialization_inner(services).await?;
    Err(stale_account_preview_error())
}

pub(crate) async fn clear_pending_initialization_inner(
    services: &AppServices,
) -> CommandResult<()> {
    let _mutation = services.initialization_contexts.lock_mutation().await;
    clear_pending_initialization_locked(services).await
}

pub(crate) async fn clear_pending_initialization_locked(
    services: &AppServices,
) -> CommandResult<()> {
    let settings = services.local_settings.clone();
    run_blocking(move || settings.clear_pending_initialization()).await?;
    services.initialization_contexts.clear();
    services.initialization_previews.clear();
    Ok(())
}

pub(crate) async fn invalidate_pending_initialization_for_auth_transition_locked(
    services: &AppServices,
) -> CommandResult<()> {
    let clear = services.initialization_contexts.begin_clear()?;
    let settings = services.local_settings.clone();
    run_blocking(move || settings.invalidate_pending_initialization()).await?;
    clear.commit();
    services.initialization_previews.clear();
    Ok(())
}

pub(crate) async fn remove_pending_initialization_tombstone_locked(
    services: &AppServices,
) -> CommandResult<()> {
    let settings = services.local_settings.clone();
    run_blocking(move || settings.clear_pending_initialization()).await
}

#[tauri::command]
pub async fn initialize_workspace(
    state: State<'_, AppServices>,
    preview_id: Uuid,
) -> CommandResult<InitializationResult> {
    initialize_workspace_inner(&state, preview_id).await
}

pub(crate) async fn get_current_workspace_inner(
    services: &AppServices,
) -> CommandResult<Option<CurrentWorkspace>> {
    let settings = services.local_settings.clone();
    run_blocking(move || settings.load_current()).await
}

#[tauri::command]
pub async fn get_current_workspace(
    state: State<'_, AppServices>,
) -> CommandResult<Option<CurrentWorkspace>> {
    get_current_workspace_inner(&state).await
}

async fn run_blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| blocking_task_error())?
}

fn blocking_task_error() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "로컬 저장소 작업을 완료하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn clone_cancelled_error() -> AppError {
    AppError::new(ErrorCode::CloneFailed, "저장소 clone이 취소되었습니다.")
        .with_recovery(RecoveryAction::Retry)
}

fn clone_job_registration_error(error: JobRegistrationError, request_id: Uuid) -> AppError {
    let message = match error {
        JobRegistrationError::RequestIdNotV4 => "Clone 작업 ID는 UUID v4여야 합니다.",
        JobRegistrationError::AlreadyActive => "같은 clone 작업 ID가 이미 진행 중입니다.",
    };
    AppError::new(ErrorCode::CloneFailed, message)
        .with_recovery(RecoveryAction::Retry)
        .with_detail("requestId", request_id.to_string())
}

fn repository_name_from_full_name(full_name: &str) -> CommandResult<&str> {
    let mut parts = full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return Err(AppError::new(
            ErrorCode::CloneFailed,
            "선택한 GitHub 저장소 이름이 올바르지 않습니다.",
        ));
    }
    Ok(name)
}

fn stale_preview_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "초기화 미리보기가 없거나 더 이상 유효하지 않습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn stale_account_preview_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "초기화 미리보기를 만든 GitHub 계정이 현재 계정과 다릅니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn stale_auth_preview_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "GitHub 인증 상태가 변경되어 초기화 미리보기를 저장하지 않았습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn now_unix() -> CommandResult<i64> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| local_time_error())?
        .as_secs();
    i64::try_from(seconds).map_err(|_| local_time_error())
}

fn local_time_error() -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "초기화 미리보기 유효 시간을 확인할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn service_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "워크스페이스 저장소 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Barrier,
    };
    use std::sync::{Arc, Mutex};
    use std::thread;

    use async_trait::async_trait;
    use secrecy::SecretString;
    use uuid::Uuid;

    use super::*;
    use crate::auth::model::{
        AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
        TokenGrant,
    };
    use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
    use crate::auth::service::AuthService;
    use crate::error::ErrorCode;
    use crate::github::model::{DraftPullRequest, DraftPullRequestRequest, GithubRepositoryDetail};
    use crate::repository::model::CommitOutcome;
    use crate::repository::service::{GitRepositoryPort, RepositoryRemotePort};
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};

    #[derive(Clone, Default)]
    struct MemorySettings {
        values: Arc<Mutex<HashMap<String, String>>>,
        fail_next_write: Arc<AtomicBool>,
        fail_next_remove: Arc<AtomicBool>,
    }

    impl MemorySettings {
        fn fail_next_write(&self) {
            self.fail_next_write.store(true, Ordering::SeqCst);
        }

        fn fail_next_remove(&self) {
            self.fail_next_remove.store(true, Ordering::SeqCst);
        }
    }

    impl LocalSettingsStore for MemorySettings {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.values.lock().unwrap().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            if self.fail_next_write.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "fixture write failure",
                ));
            }
            self.values.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            if self.fail_next_remove.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "fixture remove failure",
                ));
            }
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }

    struct UnusedDeviceFlow;

    #[async_trait]
    impl DeviceFlowApi for UnusedDeviceFlow {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            unreachable!()
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            unreachable!()
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            unreachable!()
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            unreachable!()
        }
    }

    struct EmptyCredentials;

    #[async_trait]
    impl CredentialStore for EmptyCredentials {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(None)
        }

        async fn save(&self, _tokens: &StoredTokens) -> Result<(), AppError> {
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            Ok(())
        }
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn now_unix(&self) -> i64 {
            1_000
        }
    }

    struct NoDelay;

    #[async_trait]
    impl Delay for NoDelay {
        async fn wait(&self, _seconds: u64) {}
    }

    struct NoEvents;

    impl AuthEventSink for NoEvents {
        fn emit(&self, _event: AuthStatusEvent) -> bool {
            true
        }
    }

    #[derive(Clone)]
    struct AccountACredentials(Arc<Mutex<Option<StoredTokens>>>);

    impl AccountACredentials {
        fn new() -> Self {
            Self(Arc::new(Mutex::new(Some(StoredTokens::new(
                "account-a-access",
                "account-a-refresh",
                i64::MAX,
                i64::MAX,
            )))))
        }
    }

    #[async_trait]
    impl CredentialStore for AccountACredentials {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(self.0.lock().unwrap().clone())
        }

        async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
            *self.0.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct AccountBDeviceFlow;

    #[async_trait]
    impl DeviceFlowApi for AccountBDeviceFlow {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(DeviceCodeResponse::new(
                SecretString::new("account-b-device-code".into()),
                "B-LOGIN",
                "https://github.com/login/device",
                900,
                0,
            ))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            Ok(DeviceTokenPoll::Authorized(TokenGrant::new(
                "account-b-access",
                "account-b-refresh",
                3_600,
                7_200,
            )))
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            unreachable!()
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            Ok(GithubUserSummary {
                id: 84,
                login: "account-b".into(),
                avatar_url: "https://avatars.example/account-b".into(),
            })
        }
    }

    struct DurableAttemptBarrierGit {
        commit_entered: Arc<Barrier>,
        release_commit: Arc<Barrier>,
        remote_tokens: Arc<Mutex<Vec<String>>>,
        push_tokens: Arc<Mutex<Vec<String>>>,
    }

    impl GitRepositoryPort for DurableAttemptBarrierGit {
        fn inspect(&self, path: &std::path::Path) -> Result<RepositorySnapshot, AppError> {
            Ok(RepositorySnapshot {
                root: path.to_path_buf(),
                head_oid: Some("base-oid".into()),
                default_branch: Some("main".into()),
                is_dirty: false,
                has_content: true,
                remote_url: Some("https://github.com/Mockly-Company/mockly-knowledge.git".into()),
                fingerprint: "fixture".into(),
            })
        }

        fn clone_repository(
            &self,
            _clean_remote_url: &str,
            _target: &std::path::Path,
            _access_token: crate::auth::model::AccessToken,
            _progress: Arc<dyn CloneProgressSink>,
        ) -> Result<RepositorySnapshot, AppError> {
            unreachable!()
        }

        fn commit_initialization(
            &self,
            _root: &std::path::Path,
            _preview: &InitializationPreview,
            _identity: &RepositoryIdentity,
        ) -> Result<CommitOutcome, AppError> {
            self.commit_entered.wait();
            self.release_commit.wait();
            Ok(CommitOutcome {
                branch: "okf/init-workspace".into(),
                commit_oid: "initialization-oid".into(),
                original_branch: Some("main".into()),
            })
        }

        fn verify_initialization_commit(
            &self,
            _root: &std::path::Path,
            _preview: &InitializationPreview,
            _outcome: &CommitOutcome,
            _identity: &RepositoryIdentity,
        ) -> Result<(), AppError> {
            Ok(())
        }

        fn push_branch(
            &self,
            _root: &std::path::Path,
            _branch: &str,
            _approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<(), AppError> {
            self.push_tokens
                .lock()
                .unwrap()
                .push(access_token.expose_secret().to_owned());
            Ok(())
        }

        fn checkout_initialization(
            &self,
            _root: &std::path::Path,
            _preview: &InitializationPreview,
            _outcome: &CommitOutcome,
        ) -> Result<(), AppError> {
            unreachable!()
        }

        fn origin_url(&self, _root: &std::path::Path) -> Result<String, AppError> {
            Ok("https://github.com/Mockly-Company/mockly-knowledge.git".into())
        }

        fn attempt_directory(&self, root: &std::path::Path) -> Result<PathBuf, AppError> {
            Ok(root.join(".git/okhub"))
        }

        fn remote_branch_oid(
            &self,
            _root: &std::path::Path,
            _branch: &str,
            _approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<Option<String>, AppError> {
            self.remote_tokens
                .lock()
                .unwrap()
                .push(access_token.expose_secret().to_owned());
            Ok(None)
        }
    }

    struct AccountAInitializationRemote {
        auth: Arc<AuthService>,
        pr_tokens: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait]
    impl RepositoryRemotePort for AccountAInitializationRemote {
        async fn resolve_remote_repository(
            &self,
            _remote_url: &str,
            _expected_repository_id: &str,
        ) -> Result<GithubRepositoryDetail, AppError> {
            Ok(initialization_repository())
        }

        async fn create_draft_pull_request(
            &self,
            _request: &DraftPullRequestRequest,
        ) -> Result<DraftPullRequest, AppError> {
            let token = self.auth.valid_access_token().await?;
            self.pr_tokens
                .lock()
                .unwrap()
                .push(token.expose_secret().to_owned());
            Ok(DraftPullRequest {
                number: 1,
                html_url: "https://github.com/Mockly-Company/mockly-knowledge/pull/1".into(),
                is_draft: true,
            })
        }

        async fn find_open_pull_request(
            &self,
            _request: &DraftPullRequestRequest,
        ) -> Result<Option<DraftPullRequest>, AppError> {
            Ok(None)
        }
    }

    fn initialization_repository() -> GithubRepositoryDetail {
        GithubRepositoryDetail {
            id: "R_kgDOMockly".into(),
            owner: "Mockly-Company".into(),
            name: "mockly-knowledge".into(),
            full_name: "Mockly-Company/mockly-knowledge".into(),
            default_branch: Some("main".into()),
            is_empty: false,
            https_url: "https://github.com/Mockly-Company/mockly-knowledge.git".into(),
        }
    }

    fn services_with_auth(settings: LocalSettingsService) -> AppServices {
        AppServices::with_auth(
            settings,
            AuthService::new(
                "Iv1.public-client-id",
                UnusedDeviceFlow,
                EmptyCredentials,
                FixedClock,
                NoDelay,
                NoEvents,
            ),
        )
    }

    fn pending_context(author_id: u64) -> PendingInitializationContext {
        PendingInitializationContext {
            preview_id: Uuid::new_v4(),
            root: std::env::temp_dir().join("mockly-knowledge"),
            repository_id: "R_kgDOMockly".into(),
            repository_full_name: "Mockly-Company/mockly-knowledge".into(),
            author_id,
            author_login: "hyeeun".into(),
            created_at_unix: 1_000,
            expires_at_unix: 1_900,
            completed_result: None,
        }
    }

    #[derive(Clone, Default)]
    struct CloneEvents(Arc<Mutex<Vec<RepositoryCloneEvent>>>);

    impl RepositoryCloneEventEmitter for CloneEvents {
        fn emit(&self, event: RepositoryCloneEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    fn cloned_snapshot() -> RepositorySnapshot {
        RepositorySnapshot {
            root: std::env::temp_dir().join("mockly-knowledge"),
            head_oid: Some("abc123".into()),
            default_branch: Some("main".into()),
            is_dirty: false,
            has_content: true,
            remote_url: Some("https://github.com/Mockly-Company/mockly-knowledge.git".into()),
            fingerprint: "fixture".into(),
        }
    }

    #[tokio::test]
    async fn connecting_a_workspace_requires_authoritative_repository_verification() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Mockly\ndocuments:\n  roots:\n    - path: docs\nrepositories: []\n",
                Uuid::new_v4()
            ),
        )
        .unwrap();
        let services = AppServices::new(LocalSettingsService::new(MemorySettings::default()));

        let error = connect_workspace_inner(
            &services,
            directory.path().to_path_buf(),
            "R_kgDOMockly".into(),
            "Mockly-Company/mockly-knowledge".into(),
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        assert!(services.local_settings.load_current().unwrap().is_none());
    }

    fn initialization_result() -> InitializationResult {
        InitializationResult {
            root: std::env::temp_dir().join("mockly-knowledge"),
            branch: "okf/init-workspace".into(),
            commit_oid: "abc123".into(),
            commit_message: "chore: initialize OkHub workspace".into(),
            pushed: true,
            draft_pull_request_url: Some(
                "https://github.com/Mockly-Company/mockly-knowledge/pull/1".into(),
            ),
        }
    }

    fn initialization_preview(id: Uuid) -> InitializationPreview {
        InitializationPreview {
            id,
            workspace_id: Uuid::new_v4(),
            workspace_name: "Mockly".into(),
            repository_fingerprint: "fixture".into(),
            branch: "okf/init-workspace".into(),
            commit_message: "chore: initialize OkHub workspace".into(),
            strategy: crate::workspace::service::InitializationStrategy::DraftPullRequest {
                base_branch: "main".into(),
            },
            files: Vec::new(),
        }
    }

    struct ActualInitializationFixture {
        _directory: tempfile::TempDir,
        services: Arc<AppServices>,
        context: PendingInitializationContext,
        commit_entered: Arc<Barrier>,
        release_commit: Arc<Barrier>,
        remote_tokens: Arc<Mutex<Vec<String>>>,
        push_tokens: Arc<Mutex<Vec<String>>>,
        pr_tokens: Arc<Mutex<Vec<String>>>,
    }

    impl ActualInitializationFixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let mut context = pending_context(7);
            context.root = directory.path().to_path_buf();
            context.expires_at_unix = i64::MAX;
            let preview = initialization_preview(context.preview_id);
            let store = MemorySettings::default();
            let settings = LocalSettingsService::new(store);
            settings.set_pending_initialization(&context).unwrap();
            let auth = AuthService::new(
                "Iv1.public-client-id",
                AccountBDeviceFlow,
                AccountACredentials::new(),
                FixedClock,
                NoDelay,
                NoEvents,
            );
            let mut services = AppServices::with_auth(settings, auth);
            let auth = services.auth.clone().unwrap();
            let commit_entered = Arc::new(Barrier::new(2));
            let release_commit = Arc::new(Barrier::new(2));
            let remote_tokens = Arc::new(Mutex::new(Vec::new()));
            let push_tokens = Arc::new(Mutex::new(Vec::new()));
            let pr_tokens = Arc::new(Mutex::new(Vec::new()));
            let git = Arc::new(DurableAttemptBarrierGit {
                commit_entered: commit_entered.clone(),
                release_commit: release_commit.clone(),
                remote_tokens: remote_tokens.clone(),
                push_tokens: push_tokens.clone(),
            });
            let remote = Arc::new(AccountAInitializationRemote {
                auth: auth.clone(),
                pr_tokens: pr_tokens.clone(),
            });
            services.set_initialization_test_boundaries(
                git,
                remote,
                auth,
                GithubUserSummary {
                    id: 7,
                    login: "hyeeun".into(),
                    avatar_url: "https://avatars.example/hyeeun".into(),
                },
                initialization_repository(),
            );
            services
                .initialization_contexts
                .insert(context.clone())
                .unwrap();
            services.initialization_previews.insert(preview).unwrap();
            Self {
                _directory: directory,
                services: Arc::new(services),
                context,
                commit_entered,
                release_commit,
                remote_tokens,
                push_tokens,
                pr_tokens,
            }
        }

        fn prepared_attempt_path(&self) -> PathBuf {
            self.context
                .root
                .join(".git/okhub")
                .join(self.context.preview_id.to_string())
                .join("prepared.json")
        }
    }

    enum AuthTransition {
        Logout,
        AccountSwitch,
    }

    fn assert_actual_initialization_rejects_auth_transition(transition: AuthTransition) {
        let fixture = ActualInitializationFixture::new();
        let worker_services = fixture.services.clone();
        let preview_id = fixture.context.preview_id;
        let worker = thread::spawn(move || {
            tauri::async_runtime::block_on(initialize_workspace_inner(&worker_services, preview_id))
        });

        fixture.commit_entered.wait();
        assert!(fixture.prepared_attempt_path().is_file());
        let duplicate = tauri::async_runtime::block_on(initialize_workspace_inner(
            &fixture.services,
            preview_id,
        ))
        .unwrap_err();
        let generation_before = tauri::async_runtime::block_on(
            fixture
                .services
                .auth
                .as_ref()
                .unwrap()
                .lifecycle_generation(),
        )
        .unwrap();
        let unrelated_job = Uuid::new_v4();
        let unrelated_cancellation = CancellationToken::new();
        fixture
            .services
            .auth_jobs
            .try_insert(unrelated_job, unrelated_cancellation.clone())
            .unwrap();
        let transition_error = match transition {
            AuthTransition::Logout => tauri::async_runtime::block_on(
                crate::commands::auth::logout_github_inner(&fixture.services),
            )
            .unwrap_err(),
            AuthTransition::AccountSwitch => tauri::async_runtime::block_on(
                crate::commands::auth::begin_github_auth_inner(&fixture.services, Uuid::new_v4()),
            )
            .unwrap_err(),
        };

        assert_eq!(duplicate.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(
            transition_error.code,
            ErrorCode::WorkspaceChangedSincePreview
        );
        assert!(!unrelated_cancellation.is_cancelled());
        assert_eq!(
            tauri::async_runtime::block_on(
                fixture
                    .services
                    .auth
                    .as_ref()
                    .unwrap()
                    .lifecycle_generation()
            ),
            Some(generation_before)
        );

        fixture.release_commit.wait();
        let result = worker.join().unwrap().unwrap();
        assert!(result.pushed);
        assert_eq!(
            fixture.remote_tokens.lock().unwrap().as_slice(),
            ["account-a-access"]
        );
        assert_eq!(
            fixture.push_tokens.lock().unwrap().as_slice(),
            ["account-a-access"]
        );
        assert_eq!(
            fixture.pr_tokens.lock().unwrap().as_slice(),
            ["account-a-access"]
        );
        assert_eq!(
            fixture.services.auth_jobs.finish(unrelated_job),
            crate::state::JobTerminal::Completed
        );
    }

    #[test]
    fn actual_initialization_rejects_logout_after_durable_attempt_before_remote_mutations() {
        assert_actual_initialization_rejects_auth_transition(AuthTransition::Logout);
    }

    #[test]
    fn actual_initialization_rejects_account_switch_after_durable_attempt_before_remote_mutations()
    {
        assert_actual_initialization_rejects_auth_transition(AuthTransition::AccountSwitch);
    }

    #[tokio::test]
    async fn initialization_requires_a_registered_preview_id() {
        let state = AppServices::for_command_tests_without_auth();

        let error = initialize_workspace_inner(&state, Uuid::new_v4())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
    }

    #[tokio::test]
    async fn restart_rehydrates_the_original_expired_preview_id_for_durable_recovery() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let context = pending_context(42);
        settings.set_pending_initialization(&context).unwrap();

        let restarted = AppServices::new(LocalSettingsService::new(store));
        assert!(now_unix().unwrap() > context.expires_at_unix);
        let claim = claim_pending_initialization(&restarted, context.preview_id)
            .await
            .unwrap();

        assert_eq!(claim.context(), &context);
        drop(claim);
        assert!(restarted
            .initialization_previews
            .get(context.preview_id)
            .is_none());
    }

    #[tokio::test]
    async fn successful_initialization_cleanup_failure_retries_without_remote_work() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let mut context = pending_context(42);
        let expected = initialization_result();
        context.completed_result = Some(expected.clone());
        settings.set_pending_initialization(&context).unwrap();
        let services = services_with_auth(settings.clone());
        services
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        store.fail_next_remove();

        let first = initialize_workspace_inner(&services, context.preview_id)
            .await
            .unwrap_err();

        assert_eq!(first.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            settings.load_pending_initialization().unwrap(),
            Some(context.clone())
        );

        let recovered = initialize_workspace_inner(&services, context.preview_id)
            .await
            .unwrap();

        assert_eq!(recovered, expected);
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(services
            .initialization_contexts
            .claim(context.preview_id)
            .is_err());
    }

    #[tokio::test]
    async fn restarted_tampered_completed_result_is_not_trusted_as_success() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let mut context = pending_context(42);
        context.completed_result = Some(initialization_result());
        settings.set_pending_initialization(&context).unwrap();
        let restarted = AppServices::new(settings.clone());

        let error = initialize_workspace_inner(&restarted, context.preview_id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        let sanitized = settings.load_pending_initialization().unwrap().unwrap();
        assert_eq!(sanitized.preview_id, context.preview_id);
        assert_eq!(sanitized.completed_result, None);
    }

    #[tokio::test]
    async fn failed_preview_persistence_retains_the_previous_disk_and_memory_context() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let services = services_with_auth(settings.clone());
        let previous = pending_context(42);
        let previous_preview = initialization_preview(previous.preview_id);
        settings.set_pending_initialization(&previous).unwrap();
        services
            .initialization_contexts
            .insert(previous.clone())
            .unwrap();
        services
            .initialization_previews
            .insert(previous_preview.clone())
            .unwrap();
        let next = pending_context(42);
        let next_preview = initialization_preview(next.preview_id);
        store.fail_next_write();

        let auth = services.auth.clone().unwrap();
        let generation = auth.lifecycle_generation().await.unwrap();
        let error =
            persist_initialization_preview(&services, next_preview, next.clone(), auth, generation)
                .await
                .unwrap_err();

        assert_eq!(error.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            settings.load_pending_initialization().unwrap(),
            Some(previous.clone())
        );
        let previous_claim = services
            .initialization_contexts
            .claim(previous.preview_id)
            .unwrap();
        drop(previous_claim);
        assert!(services
            .initialization_previews
            .get(previous.preview_id)
            .is_some());
        assert!(services
            .initialization_previews
            .get(next.preview_id)
            .is_none());
        assert!(services
            .initialization_contexts
            .claim(next.preview_id)
            .is_err());
    }

    #[test]
    fn logout_between_identity_capture_and_persistence_rejects_stale_preview() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store);
        let services = Arc::new(services_with_auth(settings.clone()));
        let auth = services.auth.clone().unwrap();
        let captured_generation =
            tauri::async_runtime::block_on(auth.lifecycle_generation()).unwrap();
        let context = pending_context(42);
        let preview = initialization_preview(context.preview_id);
        let preview_id = preview.id;
        let captured = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_services = services.clone();
        let worker_auth = auth.clone();
        let worker_captured = captured.clone();
        let worker_release = release.clone();

        let worker = thread::spawn(move || {
            worker_captured.wait();
            worker_release.wait();
            tauri::async_runtime::block_on(persist_initialization_preview(
                &worker_services,
                preview,
                context,
                worker_auth,
                captured_generation,
            ))
        });

        captured.wait();
        tauri::async_runtime::block_on(crate::commands::auth::logout_github_inner(&services))
            .unwrap();
        release.wait();
        let error = worker.join().unwrap().unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(services.initialization_contexts.claim(preview_id).is_err());
        assert!(services.initialization_previews.get(preview_id).is_none());
    }

    #[tokio::test]
    async fn restarted_expired_unstarted_preview_is_cleared_after_one_stale_result() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let services = AppServices::new(settings.clone());
        let context = pending_context(42);
        settings.set_pending_initialization(&context).unwrap();
        let claim = claim_pending_initialization(&services, context.preview_id)
            .await
            .unwrap();

        let error = handle_initialization_failure(&services, claim, true, stale_preview_error())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        let next = claim_pending_initialization(&services, context.preview_id)
            .await
            .unwrap_err();
        assert_eq!(next.code, ErrorCode::WorkspaceChangedSincePreview);
    }

    #[tokio::test]
    async fn account_switch_invalidates_memory_and_persisted_preview_context() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let services = AppServices::new(settings.clone());
        let context = pending_context(42);
        settings.set_pending_initialization(&context).unwrap();
        services
            .initialization_contexts
            .insert(context.clone())
            .unwrap();

        let error = ensure_pending_initialization_account(
            &services,
            &context,
            &GithubUserSummary {
                id: 84,
                login: "other-developer".into(),
                avatar_url: "https://avatars.example/other".into(),
            },
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(services
            .initialization_contexts
            .claim(context.preview_id)
            .is_err());
    }

    #[test]
    fn concurrent_command_cannot_reach_push_or_pr_while_preview_is_claimed() {
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let context = pending_context(42);
        settings.set_pending_initialization(&context).unwrap();
        let services = Arc::new(AppServices::new(LocalSettingsService::new(store)));
        let at_push = Arc::new(Barrier::new(2));
        let before_pr = Arc::new(Barrier::new(2));
        let pushes = Arc::new(AtomicUsize::new(0));
        let pull_requests = Arc::new(AtomicUsize::new(0));
        let worker_services = services.clone();
        let worker_at_push = at_push.clone();
        let worker_before_pr = before_pr.clone();
        let worker_pushes = pushes.clone();
        let worker_pull_requests = pull_requests.clone();
        let preview_id = context.preview_id;

        let worker = thread::spawn(move || {
            let claim = tauri::async_runtime::block_on(claim_pending_initialization(
                &worker_services,
                preview_id,
            ))
            .unwrap();
            worker_at_push.wait();
            worker_pushes.fetch_add(1, Ordering::SeqCst);
            worker_before_pr.wait();
            worker_pull_requests.fetch_add(1, Ordering::SeqCst);
            claim.complete();
        });

        at_push.wait();
        let duplicate =
            tauri::async_runtime::block_on(claim_pending_initialization(&services, preview_id))
                .unwrap_err();
        assert_eq!(duplicate.code, ErrorCode::WorkspaceChangedSincePreview);
        before_pr.wait();
        worker.join().unwrap();

        assert_eq!(pushes.load(Ordering::SeqCst), 1);
        assert_eq!(pull_requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn clone_job_and_failure_event_preserve_the_caller_supplied_request_id() {
        let request_id = Uuid::parse_str("42e8ae6c-b0f7-4f66-9334-bdb990c825c4").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let services = services_with_auth(LocalSettingsService::new(MemorySettings::default()));
        let events = Arc::new(CloneEvents::default());
        let request = CloneRepositoryCommandRequest {
            repository_id: "R_kgDOMockly".into(),
            full_name: "Mockly-Company/mockly-knowledge".into(),
            https_url: "https://github.com/Mockly-Company/mockly-knowledge.git".into(),
            parent_directory: parent.path().to_path_buf(),
        };

        let job = clone_repository_inner(&services, request_id, request, events.clone())
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while events.0.lock().unwrap().is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert_eq!(job.request_id, request_id);
        assert_eq!(
            serde_json::to_value(job).unwrap()["requestId"],
            request_id.to_string()
        );
        assert!(matches!(
            events.0.lock().unwrap().as_slice(),
            [RepositoryCloneEvent::Failed {
                request_id: actual,
                ..
            }] if *actual == request_id
        ));
    }

    #[tokio::test]
    async fn duplicate_active_clone_id_is_rejected_before_a_second_worker_starts() {
        let request_id = Uuid::parse_str("d2063f80-887c-4bf5-8879-5f59a40f4959").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let services = services_with_auth(LocalSettingsService::new(MemorySettings::default()));
        services
            .clone_jobs
            .try_insert(request_id, CancellationToken::new())
            .unwrap();
        let events = Arc::new(CloneEvents::default());
        let worker_starts = Arc::new(AtomicUsize::new(0));
        let counted_starts = worker_starts.clone();
        let request = CloneRepositoryCommandRequest {
            repository_id: "R_kgDOMockly".into(),
            full_name: "Mockly-Company/mockly-knowledge".into(),
            https_url: "https://github.com/Mockly-Company/mockly-knowledge.git".into(),
            parent_directory: parent.path().to_path_buf(),
        };

        let error = clone_repository_with_spawn_hook(
            &services,
            request_id,
            request,
            events.clone(),
            move || {
                counted_starts.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
        assert_eq!(
            error.details.get("requestId"),
            Some(&request_id.to_string())
        );
        assert_eq!(worker_starts.load(Ordering::SeqCst), 0);
        assert!(events.0.lock().unwrap().is_empty());
        assert!(services.clone_jobs.contains(request_id));
    }

    #[test]
    fn clone_events_keep_the_exact_public_request_id_and_never_serialize_credentials() {
        let request_id = Uuid::parse_str("31c4ba61-b0db-47a8-9708-c012567c2dc4").unwrap();
        let events = [
            RepositoryCloneEvent::Progress {
                request_id,
                progress: crate::repository::model::CloneProgress {
                    stage: crate::repository::model::CloneProgressStage::ReceivingObjects,
                    completed: 2,
                    total: 10,
                },
            },
            RepositoryCloneEvent::Completed {
                request_id,
                ownership_target_path: PathBuf::from("/requested/mockly-knowledge"),
                repository: cloned_snapshot(),
            },
            RepositoryCloneEvent::Failed {
                request_id,
                error: AppError::new(ErrorCode::CloneFailed, "clone failed"),
            },
            RepositoryCloneEvent::Cancelled { request_id },
        ];

        for event in events {
            let json = serde_json::to_value(event).unwrap();
            assert_eq!(json["requestId"], request_id.to_string());
            assert!(json.get("request_id").is_none());
            assert!(!json.to_string().contains("token"));
            assert!(!json.to_string().contains("password"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn clone_completed_event_keeps_the_symlink_selected_target_separate_from_canonical_root() {
        let parent = tempfile::tempdir().unwrap();
        let real_parent = parent.path().join("real-workspace");
        std::fs::create_dir(&real_parent).unwrap();
        let symlink_parent = parent.path().join("workspace-link");
        std::os::unix::fs::symlink(&real_parent, &symlink_parent).unwrap();
        let ownership_target_path =
            RepositoryService::clone_target(&symlink_parent, "mockly-knowledge").unwrap();
        let canonical_root = real_parent.join("mockly-knowledge");
        let request_id = Uuid::new_v4();
        let repository = RepositorySnapshot {
            root: canonical_root.clone(),
            ..cloned_snapshot()
        };

        let json = serde_json::to_value(RepositoryCloneEvent::Completed {
            request_id,
            ownership_target_path: ownership_target_path.clone(),
            repository,
        })
        .unwrap();

        assert_eq!(
            json["ownershipTargetPath"].as_str(),
            ownership_target_path.to_str()
        );
        assert_eq!(json["repository"]["root"].as_str(), canonical_root.to_str());
        assert_ne!(json["ownershipTargetPath"], json["repository"]["root"]);
    }

    #[test]
    fn clone_progress_sink_emits_the_caller_supplied_request_id() {
        let request_id = Uuid::parse_str("f61f5dff-bfb8-45ae-a3f8-f07820712056").unwrap();
        let cancellation = CancellationToken::new();
        let jobs = crate::state::JobRegistry::default();
        jobs.try_insert(request_id, cancellation.clone()).unwrap();
        let events = Arc::new(CloneEvents::default());
        let sink =
            CloneCommandProgressSink::new(request_id, cancellation, events.clone(), jobs.clone());

        assert!(CloneProgressSink::emit(
            &sink,
            crate::repository::model::CloneProgress {
                stage: crate::repository::model::CloneProgressStage::ReceivingObjects,
                completed: 1,
                total: 10,
            },
        ));

        assert!(matches!(
            events.0.lock().unwrap().as_slice(),
            [RepositoryCloneEvent::Progress {
                request_id: actual,
                ..
            }] if *actual == request_id
        ));
        assert_eq!(
            jobs.finish(request_id),
            crate::state::JobTerminal::Completed
        );
    }

    #[test]
    fn cancelled_clone_progress_stops_the_blocking_git_operation() {
        let cancellation = tokio_util::sync::CancellationToken::new();
        cancellation.cancel();
        let sink = CloneCommandProgressSink::without_emitter(Uuid::new_v4(), cancellation);

        let should_continue = crate::repository::service::CloneProgressSink::emit(
            &sink,
            crate::repository::model::CloneProgress {
                stage: crate::repository::model::CloneProgressStage::ReceivingObjects,
                completed: 1,
                total: 10,
            },
        );

        assert!(!should_continue);
    }

    #[tokio::test]
    async fn cancelling_one_clone_request_does_not_cancel_another() {
        let state = AppServices::for_command_tests_without_auth();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let first_token = tokio_util::sync::CancellationToken::new();
        let second_token = tokio_util::sync::CancellationToken::new();
        state
            .clone_jobs
            .try_insert(first, first_token.clone())
            .unwrap();
        state
            .clone_jobs
            .try_insert(second, second_token.clone())
            .unwrap();

        assert!(cancel_repository_clone_inner(&state, first).await.unwrap());

        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(state.clone_jobs.contains(first));
        assert!(state.clone_jobs.contains(second));
        assert_eq!(
            state.clone_jobs.finish(first),
            crate::state::JobTerminal::Cancelled
        );
    }

    #[test]
    fn failed_clone_event_serializes_only_the_public_error_envelope() {
        let event = RepositoryCloneEvent::Failed {
            request_id: Uuid::new_v4(),
            error: crate::error::AppError::new(
                ErrorCode::CloneFailed,
                "저장소를 clone하지 못했습니다.",
            )
            .with_recovery(crate::error::RecoveryAction::Retry),
        };

        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("clone_failed"));
        assert!(json.contains("retry"));
        assert!(!json.contains("Debug"));
        assert!(!json.contains("ghu_"));
    }

    #[test]
    fn clone_request_rejects_non_owner_repository_full_names_before_starting_a_job() {
        assert_eq!(
            repository_name_from_full_name("Mockly/knowledge").unwrap(),
            "knowledge"
        );
        assert!(repository_name_from_full_name("knowledge").is_err());
        assert!(repository_name_from_full_name("Mockly/knowledge/extra").is_err());
        assert!(repository_name_from_full_name("/knowledge").is_err());
        assert!(repository_name_from_full_name("Mockly/").is_err());
    }

    #[test]
    fn clone_finalization_claim_makes_a_late_cancel_fail_and_completion_consistent() {
        let jobs = crate::state::JobRegistry::default();
        let request_id = Uuid::new_v4();
        let cancellation = CancellationToken::new();
        jobs.try_insert(request_id, cancellation.clone()).unwrap();
        let sink = CloneCommandProgressSink::without_emitter_and_jobs(
            request_id,
            cancellation,
            jobs.clone(),
        );

        assert!(crate::repository::service::CloneProgressSink::begin_finalization(&sink));
        assert!(!jobs.cancel(request_id));
        assert_eq!(
            jobs.finish(request_id),
            crate::state::JobTerminal::Completed
        );
    }

    #[test]
    fn clone_terminal_event_matches_the_atomic_cancel_or_finalization_winner() {
        let jobs = crate::state::JobRegistry::default();
        let events = CloneEvents::default();

        let cancelled_id = Uuid::new_v4();
        let cancelled_token = CancellationToken::new();
        jobs.try_insert(cancelled_id, cancelled_token.clone())
            .unwrap();
        let cancelled_sink = CloneCommandProgressSink::without_emitter_and_jobs(
            cancelled_id,
            cancelled_token,
            jobs.clone(),
        );
        let ready = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_ready = ready.clone();
        let worker_release = release.clone();
        let cancelled_worker = thread::spawn(move || {
            worker_ready.wait();
            worker_release.wait();
            CloneProgressSink::begin_finalization(&cancelled_sink)
        });
        ready.wait();
        assert!(jobs.cancel(cancelled_id));
        release.wait();
        assert!(!cancelled_worker.join().unwrap());
        let cancelled_terminal = jobs.finish(cancelled_id);
        emit_clone_terminal(
            &events,
            cancelled_id,
            PathBuf::from("/requested/cancelled"),
            cancelled_terminal,
            Ok(cloned_snapshot()),
        );

        let completed_id = Uuid::new_v4();
        let completed_token = CancellationToken::new();
        jobs.try_insert(completed_id, completed_token.clone())
            .unwrap();
        let completed_sink = CloneCommandProgressSink::without_emitter_and_jobs(
            completed_id,
            completed_token,
            jobs.clone(),
        );
        let claimed = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_claimed = claimed.clone();
        let worker_release = release.clone();
        let completed_worker = thread::spawn(move || {
            let finalized = CloneProgressSink::begin_finalization(&completed_sink);
            worker_claimed.wait();
            worker_release.wait();
            finalized
        });
        claimed.wait();
        assert!(!jobs.cancel(completed_id));
        release.wait();
        assert!(completed_worker.join().unwrap());
        let completed_terminal = jobs.finish(completed_id);
        emit_clone_terminal(
            &events,
            completed_id,
            PathBuf::from("/requested/completed"),
            completed_terminal,
            Ok(cloned_snapshot()),
        );

        let recorded = events.0.lock().unwrap();
        assert!(matches!(
            recorded[0],
            RepositoryCloneEvent::Cancelled { request_id } if request_id == cancelled_id
        ));
        assert!(matches!(
            recorded[1],
            RepositoryCloneEvent::Completed { request_id, .. } if request_id == completed_id
        ));
        assert_eq!(recorded.len(), 2);
    }
}
