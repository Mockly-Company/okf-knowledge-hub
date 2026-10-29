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
/// 은 루트별 순회 경로라 별도 인자로 둔다.
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
    if let Err(error) = save_cached_board(&cache_root, &project.id, &board).await {
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
