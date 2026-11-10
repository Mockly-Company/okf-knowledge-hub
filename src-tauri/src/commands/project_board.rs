use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{GithubProjectItem, GithubProjectSummary};
use crate::project_board::{
    load_cached_board, parse_project_url, project_board_cache_file, project_board_cache_tmp_file,
    BoardIssue, BoardLayer, BoardStatus, GithubProjectList, ProjectBoard, ProjectOwnerScope,
    ResolvedGithubProject,
};
use crate::settings::model::{DocsRepository, LinkedProject};
use crate::state::AppServices;
use crate::workspace::model::GithubProjectRef;

pub const PROJECT_BOARD_CACHE_DIR_NAME: &str = "project-board";

/// 앱 설정의 활성 프로젝트. 보드 조회·동기화의 대상이다.
fn load_linked_project(services: &AppServices) -> CommandResult<GithubProjectRef> {
    let project = services
        .local_settings
        .load_active_project()?
        .ok_or_else(project_not_linked_error)?;
    Ok(GithubProjectRef {
        id: project.id,
        owner: project.owner,
        number: project.number,
        scope: Some(project.scope),
        extra: Default::default(),
    })
}

fn project_not_linked_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "GitHub Project가 연결되지 않았습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

/// 보드 캐시 키. 사람이 읽을 수 있도록 `{owner}-{number}` 기준이다.
/// 구버전 키(프로젝트 Node ID)는 마이그레이션 읽기용으로만 쓴다.
fn board_cache_key(project: &GithubProjectRef) -> String {
    format!("{}-{}", project.owner, project.number)
}

fn legacy_board_cache_key(project: &GithubProjectRef) -> String {
    project.id.clone()
}

async fn load_board_with_migration(
    cache_root: &std::path::Path,
    project: &GithubProjectRef,
) -> CommandResult<ProjectBoard> {
    let current = load_cached_board(cache_root, &board_cache_key(project)).await?;
    if !is_empty_board(&current) {
        return Ok(current);
    }
    // 구버전 단일 캐시(id 키)가 있으면 active/첫 프로젝트로 승격된 것처럼 읽는다.
    let legacy = load_cached_board(cache_root, &legacy_board_cache_key(project)).await?;
    Ok(legacy)
}

fn is_empty_board(board: &ProjectBoard) -> bool {
    board.issues.is_empty() && board.fetched_at.is_none()
}

fn settings_unavailable_error() -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "로컬 설정을 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[tauri::command]
pub async fn get_project_board(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<ProjectBoard> {
    let _access = state.acquire_authenticated_command().await?;
    // 읽기는 파일시스템을 변경하지 않는다. 디렉터리는 저장 시점에 만든다.
    let project = load_linked_project(&state)?;
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    load_board_with_migration(&cache_root, &project).await
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
/// `owner`가 비어 있지 않으면 해당 owner(조직/사용자 로그인)와 일치하는 것만 돌려준다.
#[tauri::command]
pub async fn list_github_projects(
    state: State<'_, AppServices>,
    owner: Option<String>,
) -> CommandResult<GithubProjectList> {
    let _access = state.acquire_authenticated_command().await?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let (items, truncated) = github.list_projects().await?;
    let needle = owner
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    Ok(GithubProjectList {
        projects: items
            .into_iter()
            .filter(|item| match needle.as_deref() {
                Some(want) => item.owner.to_ascii_lowercase() == want,
                None => true,
            })
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

/// 연결된 Project 목록. `list_github_projects`의 `ResolvedGithubProject`와
/// 직렬화 키가 동일하다(`camelCase`: id/owner/number/title/scope).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedGithubProjectList {
    pub projects: Vec<ResolvedGithubProject>,
}

/// 앱 설정에 연결된 GitHub Projects 목록을 돌려준다. 워크스페이스가 없어도 된다.
#[tauri::command]
pub async fn list_linked_projects(
    state: State<'_, AppServices>,
) -> CommandResult<LinkedGithubProjectList> {
    let projects = list_linked_projects_inner(&state)?;
    Ok(LinkedGithubProjectList {
        projects: without_closed_projects(&state, projects).await,
    })
}

fn list_linked_projects_inner(services: &AppServices) -> CommandResult<Vec<ResolvedGithubProject>> {
    Ok(services
        .local_settings
        .load_linked_projects()?
        .into_iter()
        .map(|project| ResolvedGithubProject {
            id: project.id,
            owner: project.owner,
            number: project.number,
            title: project.title,
            scope: project.scope,
        })
        .collect())
}

/// GitHub에서 닫은 프로젝트는 선택 목록에서 숨긴다. 다시 열면 다시 보인다.
/// 로그인 전이거나 GitHub에 묻지 못하면 목록을 그대로 돌려준다.
async fn without_closed_projects(
    state: &AppServices,
    projects: Vec<ResolvedGithubProject>,
) -> Vec<ResolvedGithubProject> {
    let Some(github) = state.github.clone() else {
        return projects;
    };
    if projects.is_empty() {
        return projects;
    }
    let Ok(_access) = state.acquire_authenticated_command().await else {
        return projects;
    };
    let ids: Vec<String> = projects.iter().map(|project| project.id.clone()).collect();
    match github.closed_project_ids(&ids).await {
        Ok(closed) => projects
            .into_iter()
            .filter(|project| !closed.contains(&project.id))
            .collect(),
        Err(error) => {
            eprintln!("warning: closed project lookup failed: {}", error.message);
            projects
        }
    }
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

/// 확인된 프로젝트를 앱 설정에 연결한다.
#[tauri::command]
pub async fn link_github_project(
    state: State<'_, AppServices>,
    project: ResolvedGithubProject,
) -> CommandResult<()> {
    let _access = state.acquire_authenticated_command().await?;
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
    link_verified_project_inner(&state, project, verified_scope)
}

/// GitHub에서 확인한 스코프로 저장한다. 처음 연결한 프로젝트는 활성이 된다.
fn link_verified_project_inner(
    services: &AppServices,
    project: ResolvedGithubProject,
    verified_scope: ProjectOwnerScope,
) -> CommandResult<()> {
    services.local_settings.link_project(LinkedProject {
        id: project.id,
        owner: project.owner,
        number: project.number,
        title: project.title.trim().to_owned(),
        scope: verified_scope,
    })
}

/// 활성 프로젝트 전환 결과. 그 프로젝트의 문서 저장소가 없으면 `docs_repository`가 비어 있다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProjectResult {
    pub docs_repository: Option<DocsRepository>,
}

/// 연결된 GitHub Project를 활성 프로젝트로 전환한다.
#[tauri::command]
pub async fn set_active_github_project(
    app: AppHandle,
    state: State<'_, AppServices>,
    project_id: String,
) -> CommandResult<ActiveProjectResult> {
    let app_data = crate::commands::docs_repository::app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    let project_id = project_id.trim().to_owned();
    crate::commands::docs_repository::run_blocking(move || {
        set_active_project_inner(&settings, &app_data, &project_id)
    })
    .await
}

/// 활성 프로젝트를 바꾸고, Documents·AI 터미널이 읽는 현재 워크스페이스도 그 문서 저장소로 바꾼다.
pub(crate) fn set_active_project_inner(
    settings: &crate::settings::service::LocalSettingsService,
    app_data: &std::path::Path,
    project_id: &str,
) -> CommandResult<ActiveProjectResult> {
    settings.set_active_project(project_id)?;
    Ok(ActiveProjectResult {
        docs_repository: crate::commands::docs_repository::switch_current_to_project(
            settings, app_data, project_id,
        )?,
    })
}

/// 연결된 GitHub Project를 목록에서 제거한다. `project_id`가 비면 활성 프로젝트를 제거한다.
#[tauri::command]
pub async fn unlink_github_project(
    state: State<'_, AppServices>,
    project_id: Option<String>,
) -> CommandResult<()> {
    unlink_project_inner(&state, project_id)
}

fn unlink_project_inner(services: &AppServices, project_id: Option<String>) -> CommandResult<()> {
    let target = match project_id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => id.to_owned(),
        _ => load_linked_project(services)?.id,
    };
    if !services
        .local_settings
        .load_linked_projects()?
        .iter()
        .any(|project| project.id == target)
    {
        return Err(
            AppError::new(ErrorCode::WorkspaceInvalid, "연결되지 않은 Project입니다.")
                .with_recovery(RecoveryAction::Retry),
        );
    }
    services.local_settings.unlink_project(&target)
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

/// 깊이 제한으로 잘린 서브트리를 셀 때의 노드 예산.
/// 재귀 대신 명시적 스택으로 순회하므로 스택 오버플로 걱정은 없고,
/// 이 예산은 오염 캐시 폭주 시 HashSet 폭증을 막는 총량 상한이다.
const MAX_COUNT_NODES: usize = 100_000;

/// 깊이 제한으로 잘린 서브트리 전체 노드 수를 센다. 직속 자식만 세면
/// 손자 이하는 누락돼 `skipped`가 과소 집계되므로 전부 센다.
/// 잘린 노드는 렌더되지 않으므로 서로 다른 경로에서 공유되는 다이아몬드
/// 서브트리도 고유 URL 기준으로 한 번만 센다(집계 기준: 고유 숨김 URL 수).
/// 센 URL은 `seen`(호출자의 rendered 집합)에 그대로 남겨 폴백 루프가
/// 잘린 꼬리를 루트로 다시 승격해 깊이 제한을 우회하지 못하게 한다.
/// 명시적 스택 순회라 깊은 체인에서도 스택 오버플로가 없고,
/// 노드 예산을 초과하면 중단하고 capped=true를 돌려 호출자가
/// `truncated`를 세운다(예산 초과분은 셀 수 없으므로 0으로 두지 않는다).
fn count_descendants(
    item: &GithubProjectItem,
    index: &std::collections::HashMap<&str, &GithubProjectItem>,
    seen: &mut std::collections::HashSet<String>,
) -> (u32, bool) {
    let mut count = 0u32;
    let mut stack: Vec<&GithubProjectItem> = Vec::new();
    for sub in &item.sub_issues {
        if !seen.insert(sub.url.clone()) {
            continue;
        }
        count += 1;
        if count as usize >= MAX_COUNT_NODES {
            return (count, true);
        }
        if let Some(found) = index.get(sub.url.as_str()) {
            stack.push(found);
        }
    }
    while let Some(current) = stack.pop() {
        for sub in &current.sub_issues {
            if !seen.insert(sub.url.clone()) {
                continue;
            }
            count += 1;
            if count as usize >= MAX_COUNT_NODES {
                return (count, true);
            }
            if let Some(found) = index.get(sub.url.as_str()) {
                stack.push(found);
            }
        }
    }
    (count, false)
}

/// 트리 펼치기에 필요한 공유 상태를 묶는다.
/// `visiting`은 루트별 순회 경로라 별도 인자로 둔다.
struct TreeBuildCtx<'a> {
    index: &'a std::collections::HashMap<&'a str, &'a GithubProjectItem>,
    skipped: &'a mut u32,
    truncated: &'a mut bool,
    rendered: &'a mut std::collections::HashSet<String>,
    capped: &'a mut bool,
    /// 방문한 노드 총수. rendered 크기와 달리 재귀 중에도 증가하므로
    /// 단일 에픽의 폭 방향 기하급수 팽창을 렌더 중에 차단한다.
    /// 루트마다 리셋하지 않고 전체 동기화에서 공유한다.
    count: &'a mut usize,
}

fn build_tree(
    item: &GithubProjectItem,
    visiting: &mut std::collections::HashSet<String>,
    depth: usize,
    ctx: &mut TreeBuildCtx,
) -> (Vec<BoardIssue>, bool) {
    // 전체 노드 총량 예산. 다이아몬드 공유를 중복 렌더하므로 넓은 트리에서
    // 방문 카운터가 예산을 넘으면 더 펼치지 않고 잘라낸다.
    // (깊이 제한과 달리 폭 방향 팽창을 막는다. rendered 크기가 아니라
    // 카운터 기준이라 재귀 중에도 발동한다.)
    // 잘린 항목 자체도 숨겨지므로 skipped에 1건을 합치고,
    // 호출자가 부모에 children_truncated를 세울 수 있게 true를 돌려준다.
    // (전역 배너는 truncated로 표시한다. capped는 폴백 건너뛰기에 쓴다.)
    // 진입한 노드는 rendered에도 기록해 폴백 루프가 미완성 꼬리를
    // 루트로 다시 펼치지 못하게 한다.
    *ctx.count += 1;
    ctx.rendered.insert(item.url.clone());
    if *ctx.count > MAX_COUNT_NODES {
        // 총량 초과분도 가능 범위에서 count_descendants로 합산한다
        // (깊이 절단과 같은 고유 URL 단위). 잘린 항목 자체도 숨겨지므로 1건을 더한다.
        // 셀 수 없는 초과분은 truncated로 표시한다.
        let (sub_count, _) = count_descendants(item, ctx.index, ctx.rendered);
        *ctx.skipped += sub_count + 1;
        *ctx.truncated = true;
        *ctx.capped = true;
        return (Vec::new(), true);
    }
    let cut = depth >= MAX_TREE_DEPTH;
    let (mut child_issues, child_cut) = if cut {
        // 깊이 제한으로 잘라낸 서브트리 전체를 skipped에 반영한다.
        // 잘린 URL을 rendered에 직접 기록해 폴백 루프가 같은 꼬리를
        // 루트로 다시 펼쳐 제한을 우회하지 못하게 한다.
        // (clone이 아니라 실집합을 써야 폴백이 건너뛴다.)
        let (sub_count, sub_capped) = count_descendants(item, ctx.index, ctx.rendered);
        *ctx.skipped += sub_count;
        // 자식이 없는 리프는 잘릴 게 없으므로 배너를 세우지 않는다.
        // (childrenTruncated 가드와 동일한 기준.)
        if !item.sub_issues.is_empty() {
            *ctx.truncated = true;
        }
        if sub_capped {
            *ctx.capped = true;
        }
        // 깊이 절단은 잘린 노드 자체에 플래그가 있어 부모까지 올리지 않는다.
        (Vec::new(), false)
    } else {
        let mut collected = Vec::new();
        // 자식 서브트리에서 예산 절단이 일어나면 부모에도 플래그를 올려
        // 잘린 자식이 통째로 렌더되지 않는 위치를 표시한다.
        // (깊이 절단은 잘린 노드 자체에 플래그가 있어 부모까지 올리지 않는다.)
        let mut child_cut = false;
        for sub in &item.sub_issues {
            if !visiting.insert(sub.url.clone()) {
                // 순환으로 잘린 간선도 숨겨진 항목이므로 skipped에 합산한다.
                // 인덱스 누락(None 분기)과 동일하게 조용히 버리지 않는다.
                *ctx.skipped += 1;
                continue;
            }
            match ctx.index.get(sub.url.as_str()) {
                Some(found) => {
                    let (trees, cut_child) = build_tree(found, visiting, depth + 1, ctx);
                    child_cut = child_cut || cut_child;
                    collected.extend(trees);
                }
                // 목록에 없는 자식(프로젝트 밖·페이지 상한 누락)은 조용히 버리지 않고 센다.
                None => *ctx.skipped += 1,
            }
            visiting.remove(&sub.url);
        }
        (collected, child_cut)
    };
    // 레이어를 판별할 수 없으면 미지정 레인에 모아 triage 대상으로 둔다.
    let layer = map_layer(item.area.as_deref(), &item.labels).unwrap_or(BoardLayer::Unassigned);
    match item.status.as_deref().and_then(map_status) {
        Some(status) => (
            vec![BoardIssue {
                number: item.number,
                title: item.title.clone(),
                url: item.url.clone(),
                layer,
                status,
                children: std::mem::take(&mut child_issues),
                kind: item.kind.clone(),
                depends_on: item.depends_on,
                // 깊이 제한으로 잘린 노드는 프론트가 "하위 항목 생략됨"으로 표시한다.
                // 자식이 없으면 잘릴 게 없으므로 리프로 둔다.
                // 예산 절단으로 통째로 빠진 자식이 있으면 부모에도 표시한다.
                children_truncated: (cut && !item.sub_issues.is_empty()) || child_cut,
            }],
            child_cut,
        ),
        // 상태를 판별할 수 없는 부모는 버리되 유효한 자식은 루트로 승격해 살린다.
        None => {
            *ctx.skipped += 1;
            (child_issues, child_cut)
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
fn collect_issue_trees(
    items: &[GithubProjectItem],
    skipped: &mut u32,
    truncated: &mut bool,
) -> Vec<BoardIssue> {
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
    let mut capped_any = false;
    // 총량 카운터는 루프 밖에서 한 번 만들어 전체 동기화에서 공유한다.
    // 루트마다 리셋하면 루트 수만큼 예산이 곱해져 총량 제한이 무력화된다.
    let mut total_count: usize = 0;
    for item in items {
        // 루트 판별 + 완전 중복 URL 루트는 한 번만 펼친다.
        // 공유 자식은 각 부모 밑에 그대로 렌더한다(계층 정보 유지).
        // 레이어 뷰(flat)는 emitted로 중복 제거하지만 트리 뷰는 구조가 정보다.
        if child_urls.contains(&item.url) || rendered.contains(&item.url) {
            continue;
        }
        rendered.insert(item.url.clone());
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(item.url.clone());
        // ctx는 반복마다 만들어 빌림이 다음 반복으로 새지 않게 한다.
        // 카운터만 바깥 권역을 재빌림해 누적한다.
        let (trees, _) = {
            let mut ctx = TreeBuildCtx {
                index: &index,
                skipped: &mut *skipped,
                truncated: &mut *truncated,
                rendered: &mut rendered,
                capped: &mut capped_any,
                count: &mut total_count,
            };
            build_tree(item, &mut visiting, 0, &mut ctx)
        };
        for tree in &trees {
            record_rendered(tree, &mut rendered);
        }
        issues.extend(trees);
    }
    // 순환 참조(A↔B)면 양쪽 모두 자식 집합에 있어 루트 판별에서 제외된다.
    // 미렌더 노드를 루트로 승격해 통째로 사라지지 않게 한다.
    // build_tree 내부 visiting 검사가 순환을 끊으므로 무한 재귀는 없다.
    // 단, 노드 예산 초과(capped)로 꼬리가 미기록 상태면 폴백을 건너뛴다.
    // 미기록 꼬리를 루트로 승격하면 깊이·총량 제한을 우회해 렌더가 이어진다.
    // (truncated는 예산 초과 시점에 이미 세웠다.)
    // 건너뛴 미렌더 항목도 숨겨진 것이므로 skipped에 합산한다.
    // (어떤 에픽이 빠졌는지 개별 표시 대신 truncated 배너 + skipped 수로 알린다.)
    if capped_any {
        *skipped += items
            .iter()
            .filter(|item| !rendered.contains(&item.url))
            .count() as u32;
        return issues;
    }
    for item in items {
        if rendered.contains(&item.url) {
            continue;
        }
        rendered.insert(item.url.clone());
        let mut visiting = std::collections::HashSet::new();
        visiting.insert(item.url.clone());
        let (trees, _) = {
            let mut ctx = TreeBuildCtx {
                index: &index,
                skipped: &mut *skipped,
                truncated: &mut *truncated,
                rendered: &mut rendered,
                capped: &mut capped_any,
                count: &mut total_count,
            };
            build_tree(item, &mut visiting, 0, &mut ctx)
        };
        for tree in &trees {
            record_rendered(tree, &mut rendered);
        }
        issues.extend(trees);
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
    let project = load_linked_project(&state)?;
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
    let skipped = dropped;
    let board_truncated = truncated;
    // 트리 조립은 CPU 바운드 작업이라 별도 블로킹 스레드로 분리한다.
    // 대량·다이아몬드 보드에서 Tokio 워커를 장시간 점유하지 않게 한다.
    // (items 소유권을 넘겨 'static 조건을 만족한다.)
    let (issues, skipped, board_truncated) = tokio::task::spawn_blocking(move || {
        let mut skipped = skipped;
        let mut board_truncated = board_truncated;
        let issues = collect_issue_trees(&items, &mut skipped, &mut board_truncated);
        (issues, skipped, board_truncated)
    })
    .await
    .map_err(|error| {
        AppError::new(
            ErrorCode::CacheUnavailable,
            "Project 보드를 만들지 못했습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", format!("{error:?}"))
    })?;
    let board = ProjectBoard {
        issues,
        fetched_at: fetched_now(),
        skipped,
        truncated: board_truncated,
    };
    let cache_root = app
        .path()
        .app_data_dir()
        .map_err(|_| settings_unavailable_error())?
        .join(PROJECT_BOARD_CACHE_DIR_NAME);
    // 캐시 저장은 best-effort다. 실패해도 갓 가져온 보드는 반환한다.
    if let Err(error) = save_cached_board(&cache_root, &board_cache_key(&project), &board).await {
        eprintln!("warning: failed to persist project board cache: {error:?}");
    }
    Ok(board)
}

#[cfg(test)]
mod tests {
    use super::{
        build_tree, collect_issue_trees, count_descendants, map_layer, map_status, TreeBuildCtx,
    };
    use crate::github::model::{GithubProjectItem, GithubSubIssue};
    use crate::project_board::{BoardLayer, BoardStatus};

    mod app_settings {
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};

        use crate::error::AppError;
        use crate::project_board::{ProjectOwnerScope, ResolvedGithubProject};
        use crate::settings::service::{LocalSettingsService, LocalSettingsStore};
        use crate::state::AppServices;

        use super::super::{
            link_verified_project_inner, list_linked_projects_inner, load_linked_project,
            set_active_project_inner, unlink_project_inner,
        };

        #[derive(Clone, Default)]
        struct MemoryStore(Arc<Mutex<HashMap<String, String>>>);

        impl LocalSettingsStore for MemoryStore {
            fn read(&self, key: &str) -> Result<Option<String>, AppError> {
                Ok(self.0.lock().unwrap().get(key).cloned())
            }
            fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
                self.0
                    .lock()
                    .unwrap()
                    .insert(key.to_owned(), value.to_owned());
                Ok(())
            }
            fn remove(&self, key: &str) -> Result<(), AppError> {
                self.0.lock().unwrap().remove(key);
                Ok(())
            }
        }

        fn project(id: &str, number: u64) -> ResolvedGithubProject {
            ResolvedGithubProject {
                id: id.to_owned(),
                owner: "Mockly-Company".to_owned(),
                number,
                title: format!("보드 {number}"),
                scope: ProjectOwnerScope::Organization,
            }
        }

        #[test]
        fn linked_projects_do_not_require_a_workspace() {
            let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));

            link_verified_project_inner(&services, project("a", 1), ProjectOwnerScope::User)
                .unwrap();
            link_verified_project_inner(
                &services,
                project("b", 2),
                ProjectOwnerScope::Organization,
            )
            .unwrap();

            let listed = list_linked_projects_inner(&services).unwrap();
            assert_eq!(listed.len(), 2);
            assert_eq!(listed[0].scope, ProjectOwnerScope::User);
            assert_eq!(load_linked_project(&services).unwrap().id, "a");
        }

        #[test]
        fn switching_and_unlinking_use_app_settings() {
            let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));
            link_verified_project_inner(
                &services,
                project("a", 1),
                ProjectOwnerScope::Organization,
            )
            .unwrap();
            link_verified_project_inner(
                &services,
                project("b", 2),
                ProjectOwnerScope::Organization,
            )
            .unwrap();

            let app_data = tempfile::tempdir().unwrap();
            let switched =
                set_active_project_inner(&services.local_settings, app_data.path(), "b").unwrap();
            assert_eq!(switched.docs_repository, None);
            assert_eq!(load_linked_project(&services).unwrap().number, 2);

            unlink_project_inner(&services, None).unwrap();
            assert_eq!(load_linked_project(&services).unwrap().id, "a");
            assert!(
                set_active_project_inner(&services.local_settings, app_data.path(), "b").is_err()
            );
        }
    }

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
            depends_on: None,
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
        let mut case_truncated = false;
        let mut case_rendered = std::collections::HashSet::new();
        let mut case_capped = false;
        let mut case_count: usize = 0;
        let mut case_ctx = TreeBuildCtx {
            index: &index,
            skipped: &mut skipped,
            truncated: &mut case_truncated,
            rendered: &mut case_rendered,
            capped: &mut case_capped,
            count: &mut case_count,
        };
        let (roots, _) = build_tree(&items[0], &mut visiting, 0, &mut case_ctx);
        // 순환 간선(2 → 1)은 렌더되지 않으므로 skipped에 1건으로 합산된다.
        assert_eq!(skipped, 1);
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
        let mut case_truncated = false;
        let mut case_rendered = std::collections::HashSet::new();
        let mut case_capped = false;
        let mut case_count: usize = 0;
        let mut case_ctx = TreeBuildCtx {
            index: &index,
            skipped: &mut skipped,
            truncated: &mut case_truncated,
            rendered: &mut case_rendered,
            capped: &mut case_capped,
            count: &mut case_count,
        };
        let (roots, _) = build_tree(
            &items[0],
            &mut visiting,
            super::MAX_TREE_DEPTH,
            &mut case_ctx,
        );
        assert_eq!(roots.len(), 1);
        let root = &roots[0];

        assert!(root.children.is_empty());
        // 깊이 절단은 잘림이므로 전역 배너 조건이 선다.
        assert!(case_truncated);
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
        let mut case_truncated = false;
        let mut case_rendered = std::collections::HashSet::new();
        let mut case_capped = false;
        let mut case_count: usize = 0;
        let mut case_ctx = TreeBuildCtx {
            index: &index,
            skipped: &mut skipped,
            truncated: &mut case_truncated,
            rendered: &mut case_rendered,
            capped: &mut case_capped,
            count: &mut case_count,
        };
        let (roots, _) = build_tree(&items[0], &mut visiting, 0, &mut case_ctx);
        assert_eq!(skipped, 1);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].number, 2);
    }

    #[test]
    fn count_descendants_counts_unique_hidden_nodes_once() {
        // 집계 기준: 렌더 행 수가 아니라 고유 숨김 URL 수다.
        // 다이아몬드 공유 서브트리(R -> A,B -> D)는 D를 한 번만 센다.
        let items = [
            sample_item(
                1,
                "https://example.test/r",
                &["https://example.test/a", "https://example.test/b"],
            ),
            sample_item(2, "https://example.test/a", &["https://example.test/d"]),
            sample_item(3, "https://example.test/b", &["https://example.test/d"]),
            sample_item(4, "https://example.test/d", &[]),
        ];
        let index: std::collections::HashMap<&str, &GithubProjectItem> =
            items.iter().map(|item| (item.url.as_str(), item)).collect();
        let mut seen = std::collections::HashSet::new();
        // R, A, B, D 중 R 제외 3개가 아니라 A, B, D = 3개. D는 한 번만 센다.
        assert_eq!(count_descendants(&items[0], &index, &mut seen), (3, false));
    }

    #[test]
    fn count_descendants_counts_long_chains_without_recursion_limit() {
        // 300 체인도 명시적 스택으로 끝까지 센다. capped는 노드 예산 초과 때만 선다.
        let urls: Vec<String> = (0..300)
            .map(|i| format!("https://example.test/{i}"))
            .collect();
        let url_refs: Vec<&str> = urls.iter().map(String::as_str).collect();
        let items: Vec<GithubProjectItem> = (0..300)
            .map(|i| {
                let subs: &[&str] = if i + 1 < 300 {
                    &url_refs[i + 1..i + 2]
                } else {
                    &[]
                };
                sample_item(i as u64, &urls[i], subs)
            })
            .collect();
        let index: std::collections::HashMap<&str, &GithubProjectItem> =
            items.iter().map(|item| (item.url.as_str(), item)).collect();
        let mut seen = std::collections::HashSet::new();
        let (counted, capped) = count_descendants(&items[0], &index, &mut seen);
        assert_eq!(counted, 299);
        assert!(!capped);
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
        let mut case_truncated = false;
        let issues = collect_issue_trees(&items, &mut skipped, &mut case_truncated);

        // 둘 중 하나가 루트로 승격되고 다른 쪽은 그 자식으로 한 번만 렌더된다.
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].children.len(), 1);
    }
}
