use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{GithubProjectItem, GithubProjectSummary};
use crate::project_board::{
    load_cached_board, parse_project_url, BoardIssue, BoardLayer, BoardStatus, ProjectBoard,
    ProjectOwnerScope, ResolvedGithubProject,
};
use crate::settings::model::CurrentWorkspaceStatus;
use crate::state::AppServices;
use crate::workspace::model::{GithubProjectRef, GithubWorkspaceConfig, WorkspaceDocument};

pub const PROJECT_BOARD_CACHE_DIR_NAME: &str = "project-board";

fn workspace_project_required(services: &AppServices) -> CommandResult<std::path::PathBuf> {
    let settings = services.local_settings.clone();
    let current = settings
        .load_current()
        .map_err(|_| settings_unavailable_error())?
        .ok_or_else(workspace_missing_error)?;
    if current.status != CurrentWorkspaceStatus::Connected {
        return Err(workspace_missing_error());
    }
    let repository_root = std::path::PathBuf::from(&current.path);
    let source = std::fs::read_to_string(repository_root.join(".okf").join("workspace.yml"))
        .map_err(|_| workspace_file_error(&current.path))?;
    let document =
        WorkspaceDocument::parse(&source).map_err(|_| workspace_file_error(&current.path))?;
    match document.config.github.and_then(|github| github.project) {
        Some(_) => Ok(repository_root),
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
    workspace_project_required(&state)?;
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    std::fs::create_dir_all(&cache_root).map_err(|error| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            "저장된 Project 보드를 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", cache_root.display().to_string())
        .with_detail("reason", error.to_string())
    })?;
    load_cached_board(&cache_root)
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

fn read_workspace_document(repository_root: &std::path::Path) -> CommandResult<WorkspaceDocument> {
    let source = std::fs::read_to_string(repository_root.join(".okf").join("workspace.yml"))
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
    let mut document = read_workspace_document(&repository_root)?;
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
    std::fs::write(repository_root.join(".okf").join("workspace.yml"), content).map_err(
        |error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "워크스페이스 파일을 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::OpenWorkspaceFile)
            .with_detail("path", repository_root.display().to_string())
            .with_detail("reason", error.to_string())
        },
    )?;
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

fn build_tree(
    item: &GithubProjectItem,
    all: &[GithubProjectItem],
    visiting: &mut std::collections::HashSet<String>,
) -> BoardIssue {
    let children = item
        .sub_issues
        .iter()
        .filter_map(|sub| {
            if !visiting.insert(sub.url.clone()) {
                return None;
            }
            let child = all
                .iter()
                .find(|candidate| candidate.url == sub.url)
                .map(|found| build_tree(found, all, visiting));
            visiting.remove(&sub.url);
            child
        })
        .collect();
    BoardIssue {
        number: item.number,
        title: item.title.clone(),
        url: item.url.clone(),
        layer: map_layer(item.area.as_deref(), &item.labels),
        status: map_status(item.status.as_deref()),
        children,
        kind: item.kind.clone(),
    }
}

fn map_status(status: Option<&str>) -> BoardStatus {
    match status {
        Some("Backlog") => BoardStatus::Backlog,
        Some("Ready") => BoardStatus::Ready,
        Some("In progress") => BoardStatus::InProgress,
        Some("In review") => BoardStatus::InReview,
        Some("Done") => BoardStatus::Done,
        // 알 수 없는 상태는 triage 대상이므로 Backlog에 둔다.
        _ => BoardStatus::Backlog,
    }
}

fn map_layer(area: Option<&str>, labels: &[String]) -> BoardLayer {
    // 팀의 Project `영역` 필드가 기준이고, 없으면 `layer:*` 라벨을 본다.
    // 둘 다 없으면 미지정 레인에 모아 언제든 직접 할당할 수 있게 한다.
    if let Some(layer) = area.and_then(map_area) {
        return layer;
    }
    labels
        .iter()
        .find_map(|label| BoardLayer::from_label(label))
        .unwrap_or(BoardLayer::Unassigned)
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

fn save_cached_board(cache_root: &std::path::Path, board: &ProjectBoard) -> CommandResult<()> {
    let path = cache_root.join("board.json");
    let content = serde_json::to_string(board).map_err(|error| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            "Project 보드를 저장할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    std::fs::create_dir_all(cache_root)
        .and_then(|()| std::fs::write(&path, content))
        .map_err(|error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "Project 보드를 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", path.display().to_string())
            .with_detail("reason", error.to_string())
        })
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
    let document = read_workspace_document(&repository_root)?;
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
    let items = match github
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
    let mut child_urls = std::collections::HashSet::new();
    for item in &items {
        for sub in &item.sub_issues {
            child_urls.insert(sub.url.clone());
        }
    }
    for item in &items {
        if child_urls.contains(&item.url) {
            continue;
        }
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(item.url.clone());
        issues.push(build_tree(item, &items, &mut visiting));
    }
    let board = ProjectBoard {
        issues,
        fetched_at: Some(fetched_now()?),
    };
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    save_cached_board(&cache_root, &board)?;
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::{build_tree, map_layer, map_status};
    use crate::github::model::{GithubProjectItem, GithubSubIssue};
    use crate::project_board::{BoardLayer, BoardStatus};

    #[test]
    fn status_names_map_to_board_columns() {
        assert_eq!(map_status(Some("Backlog")), BoardStatus::Backlog);
        assert_eq!(map_status(Some("In progress")), BoardStatus::InProgress);
        assert_eq!(map_status(Some("Done")), BoardStatus::Done);
        assert_eq!(map_status(Some("Todo")), BoardStatus::Backlog);
        assert_eq!(map_status(None), BoardStatus::Backlog);
    }

    #[test]
    fn first_layer_source_wins() {
        assert_eq!(
            map_layer(Some("백엔드"), &["layer:design".to_owned()]),
            BoardLayer::Backend
        );
        assert_eq!(
            map_layer(None, &["layer:design".to_owned()]),
            BoardLayer::Design
        );
        assert_eq!(map_layer(Some("프론트"), &[]), BoardLayer::Frontend);
        assert_eq!(map_layer(Some("미정"), &[]), BoardLayer::Unassigned);
        assert_eq!(map_layer(None, &[]), BoardLayer::Unassigned);
    }

    fn sample_item(number: u64, url: &str, sub_urls: &[&str]) -> GithubProjectItem {
        GithubProjectItem {
            number,
            title: format!("issue-{number}"),
            url: url.to_owned(),
            labels: Vec::new(),
            status: Some("In progress".to_owned()),
            area: Some("백엔드".to_owned()),
            kind: None,
            sub_issues: sub_urls
                .iter()
                .enumerate()
                .map(|(index, sub)| GithubSubIssue {
                    number: 100 + index as u64,
                    title: format!("sub-{index}"),
                    url: (*sub).to_owned(),
                })
                .collect(),
        }
    }

    #[test]
    fn build_tree_nests_children_and_skips_cycles() {
        let items = vec![
            sample_item(1, "https://example.test/1", &["https://example.test/2"]),
            sample_item(2, "https://example.test/2", &["https://example.test/1"]),
        ];
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(items[0].url.clone());
        let root = build_tree(&items[0], &items, &mut visiting);

        assert_eq!(root.children.len(), 1);
        assert_eq!(root.children[0].number, 2);
        assert!(root.children[0].children.is_empty());
        assert_eq!(root.children[0].layer, BoardLayer::Backend);
    }
}
