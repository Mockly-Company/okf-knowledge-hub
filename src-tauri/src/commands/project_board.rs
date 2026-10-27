use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::GithubProjectSummary;
use crate::project_board::{
    load_cached_board, parse_project_url, project_board_cache_file, BoardIssue, BoardLayer,
    BoardStatus, ProjectBoard, ProjectOwnerScope, ResolvedGithubProject,
};
use crate::settings::model::CurrentWorkspaceStatus;
use crate::state::AppServices;
use crate::workspace::model::{GithubProjectRef, GithubWorkspaceConfig, WorkspaceDocument};

pub const PROJECT_BOARD_CACHE_DIR_NAME: &str = "project-board";

async fn workspace_project_required(
    services: &AppServices,
) -> CommandResult<(std::path::PathBuf, String)> {
    let settings = services.local_settings.clone();
    let current = settings
        .load_current()
        .map_err(|_| settings_unavailable_error())?
        .ok_or_else(workspace_missing_error)?;
    if current.status != CurrentWorkspaceStatus::Connected {
        return Err(workspace_missing_error());
    }
    let repository_root = std::path::PathBuf::from(&current.path);
    let source = tokio::fs::read_to_string(repository_root.join(".okf").join("workspace.yml"))
        .await
        .map_err(|_| workspace_file_error(&current.path))?;
    let document =
        WorkspaceDocument::parse(&source).map_err(|_| workspace_file_error(&current.path))?;
    match document.config.github.and_then(|github| github.project) {
        Some(project) => Ok((repository_root, project.id)),
        None => Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "GitHub Project가 연결되지 않았습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
        .with_detail("path", ".okf/workspace.yml")),
    }
}

fn settings_unavailable_error() -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "로컬 설정을 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn workspace_missing_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceMissing,
        "연결된 워크스페이스가 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn workspace_file_error(path: &std::path::Path) -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "워크스페이스 파일을 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::OpenWorkspaceFile)
    .with_detail("path", path.display().to_string())
}

#[tauri::command]
pub async fn get_project_board(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<ProjectBoard> {
    let _access = state.acquire_authenticated_command().await?;
    let (_repository_root, project_key) = workspace_project_required(&state).await?;
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    tokio::fs::create_dir_all(&cache_root)
        .await
        .map_err(|error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "저장된 Project 보드를 읽을 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", cache_root.display().to_string())
            .with_detail("reason", error.to_string())
        })?;
    load_cached_board(&cache_root, &project_key).await
}

fn service_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "워크스페이스 저장소 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn invalid_project_url_error(reason: String) -> AppError {
    AppError::new(ErrorCode::WorkspaceInvalid, reason).with_recovery(RecoveryAction::Retry)
}

fn current_repository_root(services: &AppServices) -> CommandResult<std::path::PathBuf> {
    let settings = services.local_settings.clone();
    let current = settings
        .load_current()
        .map_err(|_| settings_unavailable_error())?
        .ok_or_else(workspace_missing_error)?;
    if current.status != CurrentWorkspaceStatus::Connected {
        return Err(workspace_missing_error());
    }
    Ok(std::path::PathBuf::from(&current.path))
}

async fn read_workspace_document(
    repository_root: &std::path::Path,
) -> CommandResult<WorkspaceDocument> {
    let source = tokio::fs::read_to_string(repository_root.join(".okf").join("workspace.yml"))
        .await
        .map_err(|_| workspace_file_error(repository_root))?;
    WorkspaceDocument::parse(&source).map_err(|_| workspace_file_error(repository_root))
}

/// 로그인한 계정이 볼 수 있는 GitHub Projects 목록을 가져온다.
#[tauri::command]
pub async fn list_github_projects(
    state: State<'_, AppServices>,
) -> CommandResult<Vec<ResolvedGithubProject>> {
    let _access = state.acquire_authenticated_command().await?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let items = github.list_projects().await?;
    Ok(items
        .into_iter()
        .map(|item| ResolvedGithubProject {
            id: item.id,
            owner: item.owner,
            number: item.number,
            title: item.title,
            scope: if item.organization {
                ProjectOwnerScope::Organization
            } else {
                ProjectOwnerScope::User
            },
        })
        .collect())
}

/// 붙여넣은 Project URL에서 owner/number를 읽고 GitHub에서 Node ID와 제목을 가져온다.
#[tauri::command]
pub async fn resolve_github_project(
    state: State<'_, AppServices>,
    url: String,
) -> CommandResult<ResolvedGithubProject> {
    let _access = state.acquire_authenticated_command().await?;
    let parsed = parse_project_url(&url).map_err(invalid_project_url_error)?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let summary: GithubProjectSummary = github
        .resolve_project(parsed.scope, &parsed.owner, parsed.number)
        .await?;
    Ok(ResolvedGithubProject {
        id: summary.id,
        owner: summary.owner,
        number: summary.number,
        title: summary.title,
        scope: parsed.scope,
    })
}

/// 확인된 프로젝트를 현재 워크스페이스의 `.okf/workspace.yml`에 연결한다.
#[tauri::command]
pub async fn link_github_project(
    state: State<'_, AppServices>,
    project: ResolvedGithubProject,
) -> CommandResult<()> {
    let _access = state.acquire_authenticated_command().await?;
    let repository_root = current_repository_root(&state)?;
    let mut document = read_workspace_document(&repository_root).await?;
    let mut github = document
        .config
        .github
        .take()
        .unwrap_or(GithubWorkspaceConfig {
            project: None,
            extra: Default::default(),
        });
    github.project = Some(GithubProjectRef {
        id: project.id,
        owner: project.owner,
        number: project.number,
        extra: Default::default(),
    });
    document.config.github = Some(github);
    let content = document.to_yaml()?;
    tokio::fs::write(repository_root.join(".okf").join("workspace.yml"), content)
        .await
        .map_err(|error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "워크스페이스 파일을 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::OpenWorkspaceFile)
            .with_detail("path", repository_root.display().to_string())
            .with_detail("reason", error.to_string())
        })?;
    Ok(())
}

fn resolve_project_scope(_project: &GithubProjectRef) -> (ProjectOwnerScope, ProjectOwnerScope) {
    // workspace.yml에는 조직/사용자 구분을 저장하지 않으므로
    // 조직을 먼저 시도하고, 없을 때만 사용자로 다시 시도한다.
    (ProjectOwnerScope::Organization, ProjectOwnerScope::User)
}

fn is_project_not_found(error: &AppError) -> bool {
    error.code == ErrorCode::GithubPermissionDenied
        && error
            .details
            .get("reason")
            .is_some_and(|reason| reason == "project_not_found")
}

fn map_status(status: &str) -> Option<BoardStatus> {
    match status {
        "Backlog" => Some(BoardStatus::Backlog),
        "Ready" => Some(BoardStatus::Ready),
        "In progress" => Some(BoardStatus::InProgress),
        "In review" => Some(BoardStatus::InReview),
        "Done" => Some(BoardStatus::Done),
        _ => None,
    }
}

fn map_layer(area: Option<&str>, labels: &[String]) -> Option<BoardLayer> {
    // 팀의 Project `영역` 필드가 기준이고, 없으면 `layer:*` 라벨을 본다.
    if let Some(layer) = area.and_then(map_area) {
        return Some(layer);
    }
    labels
        .iter()
        .find_map(|label| BoardLayer::from_label(label))
}

fn map_area(area: &str) -> Option<BoardLayer> {
    match area.trim() {
        "기획" => Some(BoardLayer::Planning),
        "디자인" => Some(BoardLayer::Design),
        "프론트엔드" | "프론트" => Some(BoardLayer::Frontend),
        "백엔드" => Some(BoardLayer::Backend),
        _ => None,
    }
}

fn fetched_now() -> CommandResult<String> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| {
            AppError::new(
                ErrorCode::GithubUnavailable,
                "Project 보드를 가져오지 못했습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
        })
}

async fn save_cached_board(
    cache_root: &std::path::Path,
    cache_key: &str,
    board: &ProjectBoard,
) -> CommandResult<()> {
    let path = project_board_cache_file(cache_root, cache_key);
    let content = serde_json::to_string(board).map_err(|error| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    tokio::fs::create_dir_all(cache_root)
        .await
        .map_err(|error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "Project 보드를 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", path.display().to_string())
            .with_detail("reason", error.to_string())
        })?;
    tokio::fs::write(&path, content).await.map_err(|error| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", path.display().to_string())
        .with_detail("reason", error.to_string())
    })?;
    Ok(())
}

/// 연결된 GitHub Project에서 Issue/PR을 가져와 보드 캐시를 갱신한다.
/// 레이어(`layer:*` 라벨)나 상태(Status 필드)를 판별할 수 없는 항목은 세어만 둔다.
#[tauri::command]
pub async fn sync_project_board(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<ProjectBoard> {
    let _access = state.acquire_authenticated_command().await?;
    let repository_root = current_repository_root(&state)?;
    let document = read_workspace_document(&repository_root).await?;
    let project = document
        .config
        .github
        .and_then(|github| github.project)
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "GitHub Project가 연결되지 않았습니다.",
            )
            .with_recovery(RecoveryAction::OpenWorkspaceFile)
            .with_detail("path", ".okf/workspace.yml")
        })?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let (first_scope, fallback_scope) = resolve_project_scope(&project);
    let (items, truncated) = match github
        .list_project_items(first_scope, &project.owner, project.number)
        .await
    {
        Ok(items) => items,
        Err(error) if is_project_not_found(&error) => {
            github
                .list_project_items(fallback_scope, &project.owner, project.number)
                .await?
        }
        Err(error) => return Err(error),
    };
    let mut issues = Vec::new();
    let mut skipped = 0u32;
    for item in items {
        match (
            map_layer(item.area.as_deref(), &item.labels),
            item.status.as_deref().and_then(map_status),
        ) {
            (Some(layer), Some(status)) => issues.push(BoardIssue {
                number: item.number,
                title: item.title,
                url: item.url,
                layer,
                status,
            }),
            _ => skipped += 1,
        }
    }
    let board = ProjectBoard {
        issues,
        fetched_at: Some(fetched_now()?),
        skipped,
        truncated,
    };
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    save_cached_board(&cache_root, &project.id, &board).await?;
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::{map_layer, map_status};
    use crate::project_board::{BoardLayer, BoardStatus};

    #[test]
    fn status_names_map_to_board_columns() {
        assert_eq!(map_status("Backlog"), Some(BoardStatus::Backlog));
        assert_eq!(map_status("In progress"), Some(BoardStatus::InProgress));
        assert_eq!(map_status("Done"), Some(BoardStatus::Done));
        assert_eq!(map_status("Todo"), None);
    }

    #[test]
    fn first_layer_source_wins() {
        assert_eq!(
            map_layer(Some("백엔드"), &["layer:design".to_owned()]),
            Some(BoardLayer::Backend)
        );
        assert_eq!(
            map_layer(None, &["layer:design".to_owned()]),
            Some(BoardLayer::Design)
        );
        assert_eq!(map_layer(Some("프론트"), &[]), Some(BoardLayer::Frontend));
        assert_eq!(map_layer(Some("미정"), &[]), None);
        assert_eq!(map_layer(None, &[]), None);
    }
}
