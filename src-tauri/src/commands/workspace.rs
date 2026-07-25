use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{GithubRepositorySummary, Page};
use crate::repository::model::{
    CloneProgress, CloneRequest, InitializationResult, RepositoryIdentity, RepositorySnapshot,
};
use crate::repository::service::{CloneProgressSink, RepositoryService};
use crate::settings::model::CurrentWorkspace;
use crate::state::{AppServices, InitializationContext};
use crate::workspace::service::{
    InitializationPreview, RepositoryPopulation, WorkspaceInspection, WorkspaceService,
};

pub const REPOSITORY_CLONE_PROGRESS_EVENT: &str = "repository-clone-progress";

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
}

impl CloneCommandProgressSink {
    fn new(
        request_id: Uuid,
        cancellation: CancellationToken,
        emitter: Arc<dyn RepositoryCloneEventEmitter>,
    ) -> Self {
        Self {
            request_id,
            cancellation,
            emitter: Some(emitter),
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
    request: CloneRepositoryCommandRequest,
    emitter: Arc<dyn RepositoryCloneEventEmitter>,
) -> CommandResult<CloneJob> {
    let auth = services.auth.clone().ok_or_else(service_unavailable)?;
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let repository_name = repository_name_from_full_name(&request.full_name)?;
    let target_path = RepositoryService::clone_target(&request.parent_directory, repository_name)?;
    let request_id = Uuid::new_v4();
    let cancellation = CancellationToken::new();
    services
        .clone_jobs
        .insert(request_id, cancellation.clone())
        .await;

    let jobs = services.clone_jobs.clone();
    let git = services.repository_git.clone();
    let progress = Arc::new(CloneCommandProgressSink::new(
        request_id,
        cancellation.clone(),
        emitter.clone(),
    ));
    tauri::async_runtime::spawn_blocking(move || {
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
        let was_cancelled = cancellation.is_cancelled();
        tauri::async_runtime::block_on(jobs.remove(request_id));
        if was_cancelled {
            emitter.emit(RepositoryCloneEvent::Cancelled { request_id });
        } else {
            match result {
                Ok(repository) => emitter.emit(RepositoryCloneEvent::Completed {
                    request_id,
                    repository,
                }),
                Err(error) => emitter.emit(RepositoryCloneEvent::Failed { request_id, error }),
            }
        }
    });

    Ok(CloneJob {
        request_id,
        target_path,
    })
}

#[tauri::command]
pub async fn clone_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
    request: CloneRepositoryCommandRequest,
) -> CommandResult<CloneJob> {
    clone_repository_inner(
        &state,
        request,
        Arc::new(TauriRepositoryCloneEventEmitter { app }),
    )
    .await
}

pub(crate) async fn cancel_repository_clone_inner(
    services: &AppServices,
    request_id: Uuid,
) -> CommandResult<bool> {
    Ok(services.clone_jobs.cancel(request_id).await)
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
) -> CommandResult<CurrentWorkspace> {
    let settings = services.local_settings.clone();
    run_blocking(move || settings.set_current(&repository_path)).await
}

#[tauri::command]
pub async fn connect_workspace(
    state: State<'_, AppServices>,
    repository_path: PathBuf,
) -> CommandResult<CurrentWorkspace> {
    connect_workspace_inner(&state, repository_path).await
}

pub(crate) async fn preview_workspace_initialization_inner(
    services: &AppServices,
    request: WorkspaceInitializationRequest,
) -> CommandResult<InitializationPreview> {
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
    services.initialization_previews.insert(preview.clone())?;
    services
        .initialization_contexts
        .insert(
            preview.id,
            InitializationContext {
                root: request.repository_path,
                repository,
                identity: RepositoryIdentity {
                    database_id: user.id,
                    login: user.login,
                },
            },
        )
        .await;
    Ok(preview)
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
    let context = services
        .initialization_contexts
        .get(preview_id)
        .await
        .ok_or_else(stale_preview_error)?;
    let auth = services.auth.clone().ok_or_else(service_unavailable)?;
    let github = services.github.clone().ok_or_else(service_unavailable)?;
    let git = services.repository_git.clone();
    let previews = services.initialization_previews.clone();
    let result = run_blocking(move || {
        let service = RepositoryService::new(
            git,
            github,
            auth,
            previews,
            context.root,
            context.repository,
            context.identity,
        );
        tauri::async_runtime::block_on(service.initialize(preview_id))
    })
    .await?;
    services.initialization_contexts.remove(preview_id).await;
    Ok(result)
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

fn service_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "워크스페이스 저장소 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;
    use crate::error::ErrorCode;

    #[tokio::test]
    async fn initialization_requires_a_registered_preview_id() {
        let state = AppServices::for_command_tests_without_auth();

        let error = initialize_workspace_inner(&state, Uuid::new_v4())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
    }

    #[test]
    fn clone_events_keep_request_ids_and_never_serialize_credentials() {
        let request_id = Uuid::new_v4();
        let event = RepositoryCloneEvent::Progress {
            request_id,
            progress: crate::repository::model::CloneProgress {
                stage: crate::repository::model::CloneProgressStage::ReceivingObjects,
                completed: 2,
                total: 10,
            },
        };

        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains(&request_id.to_string()));
        assert!(json.contains("receiving_objects"));
        assert!(!json.contains("token"));
        assert!(!json.contains("password"));
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
        state.clone_jobs.insert(first, first_token.clone()).await;
        state.clone_jobs.insert(second, second_token.clone()).await;

        assert!(cancel_repository_clone_inner(&state, first).await.unwrap());

        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(!state.clone_jobs.contains(first).await);
        assert!(state.clone_jobs.contains(second).await);
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
}
