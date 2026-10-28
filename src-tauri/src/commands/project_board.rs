use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::GithubProjectSummary;
use crate::project_board::{
    load_cached_board, parse_project_url, project_board_cache_file, project_board_cache_tmp_file,
    BoardIssue, BoardLayer, BoardStatus, GithubProjectList, ProjectBoard, ProjectOwnerScope,
    ResolvedGithubProject,
};
use crate::settings::model::CurrentWorkspaceStatus;
use crate::state::AppServices;
use crate::workspace::model::{GithubProjectRef, GithubWorkspaceConfig, WorkspaceDocument};

pub const PROJECT_BOARD_CACHE_DIR_NAME: &str = "project-board";

/// workspace 문서까지만 읽는다. 연결 여부와 무관하다.
async fn load_workspace_root(
    services: &AppServices,
) -> CommandResult<(std::path::PathBuf, WorkspaceDocument)> {
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
    Ok((repository_root, document))
}

async fn load_linked_project(
    services: &AppServices,
) -> CommandResult<(std::path::PathBuf, GithubProjectRef, WorkspaceDocument)> {
    let (repository_root, document) = load_workspace_root(services).await?;
    match document
        .config
        .github
        .as_ref()
        .and_then(|github| github.project.clone())
    {
        Some(project) => Ok((repository_root, project, document)),
        None => Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "GitHub Project가 연결되지 않았습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
        .with_detail("path", ".okf/workspace.yml")),
    }
}

/// 연결용 로더. 프로젝트 연결 여부와 무관하게 workspace 문서까지만 읽는다.
/// 첫 연결 시에는 project가 없는 것이 정상이므로 여기서 요구하지 않는다.
async fn load_workspace_document(
    services: &AppServices,
) -> CommandResult<(std::path::PathBuf, WorkspaceDocument)> {
    load_workspace_root(services).await
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
    .with_detail("reason", "workspace_file_unreadable")
}

#[tauri::command]
pub async fn get_project_board(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<ProjectBoard> {
    let _access = state.acquire_authenticated_command().await?;
    // 읽기는 파일시스템을 변경하지 않는다. 디렉터리는 저장 시점에 만든다.
    let (_repository_root, project, _document) = load_linked_project(&state).await?;
    let project_key = project.id.clone();
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
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

/// 로그인한 계정이 볼 수 있는 GitHub Projects 목록을 가져온다.
#[tauri::command]
pub async fn list_github_projects(
    state: State<'_, AppServices>,
) -> CommandResult<GithubProjectList> {
    let _access = state.acquire_authenticated_command().await?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let (items, truncated) = github.list_projects().await?;
    Ok(GithubProjectList {
        projects: items
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
            .collect(),
        truncated,
    })
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
    let (repository_root, mut document) = load_workspace_document(&state).await?;
    // 프론트가 보낸 값을 그대로 저장하지 않고 GitHub에 재조회해 검증한다.
    // id·owner·number가 어긋나면 다른 프로젝트를 가리킬 수 있다.
    // 스코프가 어긋났을 수 있어 반대 스코프로 한 번 더 시도한다.
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let (verified, verified_scope) = match github
        .resolve_project(project.scope, &project.owner, project.number)
        .await
    {
        Ok(summary) => (summary, project.scope),
        Err(error) if is_project_not_found(&error) => {
            let fallback = match project.scope {
                ProjectOwnerScope::Organization => ProjectOwnerScope::User,
                ProjectOwnerScope::User => ProjectOwnerScope::Organization,
            };
            (
                github
                    .resolve_project(fallback, &project.owner, project.number)
                    .await?,
                fallback,
            )
        }
        Err(error) => return Err(error),
    };
    // owner/number는 조회 키이므로 서버가 그대로 돌려준다. 위조 판별은
    // 서버가 발급한 id 비교가 담당한다.
    if verified.id != project.id {
        return Err(invalid_project_url_error(
            "Project 정보가 일치하지 않습니다. 다시 불러와 연결해 주세요.".to_owned(),
        ));
    }
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
        scope: Some(verified_scope),
        extra: Default::default(),
    });
    document.config.github = Some(github);
    let content = document.to_yaml()?;
    // 크래시 시 반만 쓰인 workspace.yml이 남지 않도록 임시 파일에 쓰고 교체한다.
    let tmp_path = repository_root.join(".okf").join(format!(
        "workspace.yml.tmp.{}.{}",
        std::process::id(),
        workspace_tmp_seq()
    ));
    if let Err(error) = tokio::fs::write(&tmp_path, content).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "워크스페이스 파일을 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
        .with_detail("path", repository_root.display().to_string())
        .with_detail("reason", error.to_string()));
    }
    if let Err(error) = tokio::fs::rename(
        &tmp_path,
        repository_root.join(".okf").join("workspace.yml"),
    )
    .await
    {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "워크스페이스 파일을 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
        .with_detail("path", repository_root.display().to_string())
        .with_detail("reason", error.to_string()));
    }
    Ok(())
}

static WORKSPACE_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

fn workspace_tmp_seq() -> u64 {
    WORKSPACE_TMP_SEQ.fetch_add(1, Ordering::Relaxed)
}

fn resolve_project_scope(project: &GithubProjectRef) -> (ProjectOwnerScope, ProjectOwnerScope) {
    // 연결 시 확인된 스코프를 workspace.yml에 저장해 두므로
    // 저장된 스코프를 먼저 시도하고, 없을 때만 조직→사용자 순으로 재시도한다.
    let first = project.scope.unwrap_or(ProjectOwnerScope::Organization);
    let fallback = match first {
        ProjectOwnerScope::Organization => ProjectOwnerScope::User,
        ProjectOwnerScope::User => ProjectOwnerScope::Organization,
    };
    (first, fallback)
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
            ErrorCode::CacheUnavailable,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    tokio::fs::create_dir_all(cache_root)
        .await
        .map_err(|error| {
            AppError::new(
                ErrorCode::CacheUnavailable,
                "Project 보드를 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", cache_root.display().to_string())
            .with_detail("reason", error.to_string())
        })?;
    // 크래시 시 반만 쓰인 캐시가 남지 않도록 고유한 임시 파일에 쓰고 교체한다.
    // 실패한 tmp는 best-effort로 정리한다.
    let tmp_path = project_board_cache_tmp_file(cache_root, cache_key);
    if let Err(error) = tokio::fs::write(&tmp_path, content).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::new(
            ErrorCode::CacheUnavailable,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", tmp_path.display().to_string())
        .with_detail("reason", error.to_string()));
    }
    if let Err(error) = tokio::fs::rename(&tmp_path, &path).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(AppError::new(
            ErrorCode::CacheUnavailable,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", path.display().to_string())
        .with_detail("reason", error.to_string()));
    }
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
    let (_repository_root, project, _document) = load_linked_project(&state).await?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let (first_scope, fallback_scope) = resolve_project_scope(&project);
    let (items, truncated, dropped) = match github
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
    let mut skipped = dropped;
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
