use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{GithubProjectItem, GithubProjectSummary};
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
    // 크래시로 남았을 수 있는 workspace.yml 임시 파일을 best-effort로 정리한다.
    // 진행 중인 다른 작업을 건드리지 않도록 1시간 초과분만 지운다.
    let okf_dir = repository_root.join(".okf");
    if let Ok(mut entries) = tokio::fs::read_dir(&okf_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("workspace.yml.tmp.") {
                continue;
            }
            let stale = entry
                .metadata()
                .await
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 3600);
            if stale {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
    let source = tokio::fs::read_to_string(okf_dir.join("workspace.yml"))
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

/// 트리 재귀의 최대 깊이. GitHub 서브이슈 체인이 비정상적으로 깊어지거나
/// 순환 참조가 `visiting` 검사를 우회해도 스택 오버플로를 막는다.
const MAX_TREE_DEPTH: usize = 10;

/// 서브이슈는 `SUB_ISSUES_FIRST`개까지만 가져오며 초과분은 잘린다.
/// GitHub subIssues 커넥션에 별도 페이지네이션을 하지 않으므로
/// 자식이 20개를 넘는 에픽은 초과분이 보드에서 빠진다.
/// 서브이슈 조회 상한(`SUB_ISSUES_FIRST`)을 초과한 잘림을 셀 때의 추가 탐사 깊이.
/// `build_tree`가 `MAX_TREE_DEPTH`에서 잘라도 카운터는 이 예산만큼 더 내려가
/// 잘린 서브트리 전체를 집계한다. 오염 체인 폭주 방지를 위한 상한이다.
const MAX_COUNT_EXTRA_DEPTH: usize = 100;

/// 깊이 제한으로 잘린 서브트리 전체 노드 수를 센다. 직속 자식만 세면
/// 손자 이하는 누락돼 `skipped`가 과소 집계되므로 재귀적으로 센다.
/// 잘린 노드는 렌더되지 않으므로 서로 다른 경로에서 공유되는 다이아몬드
/// 서브트리도 서로 다른 숨김으로 보지 않고 고유 URL 기준으로 한 번만 센다.
/// 깊이 상한을 둬 비정상 체인에서 스택 오버플로를 막는다.
fn count_descendants(
    item: &GithubProjectItem,
    index: &std::collections::HashMap<&str, &GithubProjectItem>,
    seen: &mut std::collections::HashSet<String>,
    depth: usize,
) -> u32 {
    if depth > MAX_TREE_DEPTH + MAX_COUNT_EXTRA_DEPTH {
        return 0;
    }
    let mut count = 0u32;
    for sub in &item.sub_issues {
        if !seen.insert(sub.url.clone()) {
            continue;
        }
        count += 1;
        if let Some(found) = index.get(sub.url.as_str()) {
            count += count_descendants(found, index, seen, depth + 1);
        }
    }
    count
}

fn build_tree(
    item: &GithubProjectItem,
    index: &std::collections::HashMap<&str, &GithubProjectItem>,
    visiting: &mut std::collections::HashSet<String>,
    depth: usize,
    skipped: &mut u32,
) -> Vec<BoardIssue> {
    let mut child_issues = if depth >= MAX_TREE_DEPTH {
        // 깊이 제한으로 잘라낸 서브트리 전체를 skipped에 반영한다.
        // 조상 경로를 시드로 넣어 순환을 끊고, 고유 URL 기준으로 한 번씩만 센다.
        let mut seen = visiting.clone();
        *skipped += count_descendants(item, index, &mut seen, depth);
        Vec::new()
    } else {
        let mut collected = Vec::new();
        for sub in &item.sub_issues {
            if !visiting.insert(sub.url.clone()) {
                continue;
            }
            match index.get(sub.url.as_str()) {
                Some(found) => {
                    collected.extend(build_tree(found, index, visiting, depth + 1, skipped));
                }
                // 목록에 없는 자식(프로젝트 밖·페이지 상한 누락)은 조용히 버리지 않고 센다.
                None => *skipped += 1,
            }
            visiting.remove(&sub.url);
        }
        collected
    };
    // 레이어를 판별할 수 없으면 미지정 레인에 모아 triage 대상으로 둔다.
    let layer = map_layer(item.area.as_deref(), &item.labels).unwrap_or(BoardLayer::Unassigned);
    match item.status.as_deref().and_then(map_status) {
        Some(status) => vec![BoardIssue {
            number: item.number,
            title: item.title.clone(),
            url: item.url.clone(),
            layer,
            status,
            children: std::mem::take(&mut child_issues),
            kind: item.kind.clone(),
        }],
        // 상태를 판별할 수 없는 부모는 버리되 유효한 자식은 루트로 승격해 살린다.
        None => {
            *skipped += 1;
            child_issues
        }
    }
}

fn record_rendered(issue: &BoardIssue, rendered: &mut std::collections::HashSet<String>) {
    // build_tree 결과(깊이 ≤ MAX_TREE_DEPTH)만 넣지만 반복문으로 상한 없이 안전하게 기록한다.
    // 루트가 이미 기록돼 있어도 자식은 항상 순회한다(호출자가 루트를 미리 표시해 두므로).
    let mut stack = vec![issue];
    while let Some(current) = stack.pop() {
        stack.extend(current.children.iter());
        rendered.insert(current.url.clone());
    }
}

/// 평탄한 수집 항목을 트리 보드로 묶는다. `skipped`에 매핑 실패·누락분을 가산한다.
/// 순환 참조(A↔B)로 루트 판별에서 제외된 노드는 폴백 루프로 승격해 살린다.
fn collect_issue_trees(items: &[GithubProjectItem], skipped: &mut u32) -> Vec<BoardIssue> {
    let mut issues = Vec::new();
    let mut child_urls = std::collections::HashSet::new();
    for item in items {
        for sub in &item.sub_issues {
            child_urls.insert(sub.url.clone());
        }
    }
    let index: std::collections::HashMap<&str, &GithubProjectItem> =
        items.iter().map(|item| (item.url.as_str(), item)).collect();
    let mut rendered = std::collections::HashSet::new();
    // 한 항목을 트리로 펼쳐 issues에 넣고 rendered에 기록한다.
    // 매핑 실패로 트리가 비어도 처리済み로 표시해 폴백 중복을 막는다.
    let mut render_item = |item: &GithubProjectItem,
                           rendered: &mut std::collections::HashSet<String>,
                           issues: &mut Vec<BoardIssue>| {
        rendered.insert(item.url.clone());
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(item.url.clone());
        let trees = build_tree(item, &index, &mut visiting, 0, skipped);
        for tree in &trees {
            record_rendered(tree, rendered);
        }
        issues.extend(trees);
    };
    for item in items {
        if child_urls.contains(&item.url) {
            continue;
        }
        render_item(item, &mut rendered, &mut issues);
    }
    // 순환 참조(A↔B)면 양쪽 모두 자식 집합에 있어 루트 판별에서 제외된다.
    // 미렌더 노드를 루트로 승격해 통째로 사라지지 않게 한다.
    // build_tree 내부 visiting 검사가 순환을 끊으므로 무한 재귀는 없다.
    for item in items {
        if rendered.contains(&item.url) {
            continue;
        }
        render_item(item, &mut rendered, &mut issues);
    }
    issues
}

fn map_status(status: &str) -> Option<BoardStatus> {
    match status.trim().to_ascii_lowercase().as_str() {
        "backlog" => Some(BoardStatus::Backlog),
        "ready" => Some(BoardStatus::Ready),
        "in progress" => Some(BoardStatus::InProgress),
        "in review" => Some(BoardStatus::InReview),
        "done" => Some(BoardStatus::Done),
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

fn fetched_now() -> Option<String> {
    match time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339) {
        Ok(formatted) => Some(formatted),
        Err(error) => {
            eprintln!("warning: failed to format fetched_at timestamp: {error:?}");
            None
        }
    }
}

async fn save_cached_board(
    cache_root: &std::path::Path,
    cache_key: &str,
    board: &ProjectBoard,
) -> CommandResult<()> {
    let path = project_board_cache_file(cache_root, cache_key);
    // 크래시로 남았을 수 있는 오래된 tmp(1시간 초과)만 best-effort로 정리한다.
    // 진행 중인 동시 sync의 tmp를 지우지 않도록 mtime을 확인한다.
    if let Ok(mut entries) = tokio::fs::read_dir(cache_root).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("board-") || !name.ends_with(".tmp") {
                continue;
            }
            let stale = entry
                .metadata()
                .await
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 3600);
            if stale {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }
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
    let mut skipped = dropped;
    let issues = collect_issue_trees(&items, &mut skipped);
    let board = ProjectBoard {
        issues,
        fetched_at: fetched_now(),
        skipped,
        truncated,
    };
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    // 캐시 저장은 best-effort다. 실패해도 갓 가져온 보드는 반환한다.
    if let Err(error) = save_cached_board(&cache_root, &project.id, &board).await {
        eprintln!("warning: failed to persist project board cache: {error:?}");
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::{build_tree, collect_issue_trees, map_layer, map_status};
    use crate::github::model::{GithubProjectItem, GithubSubIssue};
    use crate::project_board::{BoardLayer, BoardStatus};

    #[test]
    fn status_names_map_to_board_columns() {
        assert_eq!(map_status("Backlog"), Some(BoardStatus::Backlog));
        assert_eq!(map_status("In progress"), Some(BoardStatus::InProgress));
        assert_eq!(map_status("Done"), Some(BoardStatus::Done));
        assert_eq!(map_status("Todo"), None);
        assert_eq!(map_status("  In progress  "), Some(BoardStatus::InProgress));
        assert_eq!(map_status("IN PROGRESS"), Some(BoardStatus::InProgress));
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
        let items = [
            sample_item(1, "https://example.test/1", &["https://example.test/2"]),
            sample_item(2, "https://example.test/2", &["https://example.test/1"]),
        ];
        let index: std::collections::HashMap<&str, &GithubProjectItem> =
            items.iter().map(|item| (item.url.as_str(), item)).collect();
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(items[0].url.clone());
        let mut skipped = 0u32;
        let roots = build_tree(&items[0], &index, &mut visiting, 0, &mut skipped);
        assert_eq!(skipped, 0);
        assert_eq!(roots.len(), 1);
        let root = &roots[0];

        assert_eq!(root.children.len(), 1);
        assert_eq!(root.children[0].number, 2);
        assert!(root.children[0].children.is_empty());
        assert_eq!(root.children[0].layer, BoardLayer::Backend);
    }

    #[test]
    fn build_tree_stops_at_max_depth() {
        let items = [
            sample_item(1, "https://example.test/1", &["https://example.test/2"]),
            sample_item(2, "https://example.test/2", &[]),
        ];
        let index: std::collections::HashMap<&str, &GithubProjectItem> =
            items.iter().map(|item| (item.url.as_str(), item)).collect();
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(items[0].url.clone());
        let mut skipped = 0u32;
        let roots = build_tree(
            &items[0],
            &index,
            &mut visiting,
            super::MAX_TREE_DEPTH,
            &mut skipped,
        );
        assert_eq!(roots.len(), 1);
        let root = &roots[0];

        assert!(root.children.is_empty());
    }

    #[test]
    fn build_tree_promotes_children_of_unmappable_parent() {
        let mut orphan = sample_item(2, "https://example.test/2", &[]);
        orphan.status = Some("In progress".to_owned());
        let mut parent = sample_item(1, "https://example.test/1", &["https://example.test/2"]);
        parent.status = Some("알 수 없음".to_owned());
        let items = [parent, orphan];
        let index: std::collections::HashMap<&str, &GithubProjectItem> =
            items.iter().map(|item| (item.url.as_str(), item)).collect();
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(items[0].url.clone());
        let mut skipped = 0u32;
        let roots = build_tree(&items[0], &index, &mut visiting, 0, &mut skipped);
        assert_eq!(skipped, 1);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].number, 2);
    }

    #[test]
    fn sync_renders_cyclic_items_instead_of_dropping_them() {
        // A<->B 순환: 양쪽 모두 자식 집합에 포함돼 루트 판별에서 제외된다.
        // 프로덕션 collect_issue_trees를 직접 호출해 폴백 승격을 검증한다.
        let items = [
            sample_item(1, "https://example.test/1", &["https://example.test/2"]),
            sample_item(2, "https://example.test/2", &["https://example.test/1"]),
        ];
        let mut skipped = 0u32;
        let issues = collect_issue_trees(&items, &mut skipped);

        // 둘 중 하나가 루트로 승격되고 다른 쪽은 그 자식으로 한 번만 렌더된다.
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].children.len(), 1);
    }
}
