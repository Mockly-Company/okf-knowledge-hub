use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::project_board::{
    is_empty_board, load_board_for_ref, sync_project_board_for_ref,
};
use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::github::model::{BoardAssignee, DocsPullRequestSummary, PullRequestChangedFile};
use crate::github::GithubService;
use crate::project_board::model::{BoardIssue, BoardLayer, BoardStatus, ProjectBoard};
use crate::settings::model::HubWorkspace;
use crate::state::AppServices;
use crate::workspace::model::GithubProjectRef;

const MAX_BOARD_DEPTH: usize = 32;
const SEVEN_DAYS_SECS: i64 = 7 * 86_400;
const MAX_PR_FILES_PER_REPO: usize = 12;
const SUMMARY_MAX_CHARS: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalDashboardResult {
    pub viewer_login: Option<String>,
    pub fetched_at: String,
    pub last_seen_at: Option<String>,
    pub assignee_options: Vec<BoardAssignee>,
    pub tasks: Vec<DashboardTaskItem>,
    pub unread_new_count: u32,
    pub ready_task_count: u32,
    pub notifications: Vec<DashboardNotificationItem>,
    pub unread_notification_count: u32,
    pub failures: Vec<DashboardWorkspaceFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardTaskItem {
    pub workspace_id: String,
    pub workspace_title: String,
    pub project_owner: String,
    pub project_number: u64,
    pub project_title: String,
    pub repository_full_name: Option<String>,
    pub issue_number: u64,
    pub title: String,
    pub url: String,
    pub status: BoardStatus,
    pub layer: BoardLayer,
    pub kind: Option<String>,
    pub depends_on: Option<u64>,
    pub predecessor_done: bool,
    pub ready_to_start: bool,
    pub is_new: bool,
    pub assignees: Vec<BoardAssignee>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardNotificationKind {
    OpenPr,
    MergedDoc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardNotificationItem {
    pub id: String,
    pub workspace_id: String,
    pub workspace_title: String,
    pub repository_full_name: String,
    pub kind: DashboardNotificationKind,
    pub pr_number: u64,
    pub title: String,
    pub summary: String,
    pub author_login: String,
    pub url: String,
    pub primary_doc_path: Option<String>,
    pub has_companion_html: bool,
    pub timestamp: String,
    pub is_new: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardFailureScope {
    Board,
    Docs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardWorkspaceFailure {
    pub workspace_id: String,
    pub workspace_title: String,
    pub scope: DashboardFailureScope,
    pub message: String,
}

pub(crate) struct DashboardFilter<'a> {
    pub viewer_login: Option<&'a str>,
    pub assignee_filter: Option<&'a str>,
    pub last_seen_at: Option<&'a str>,
    pub now_unix: i64,
}

fn service_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "GitHub 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn now_utc_pair() -> (i64, String) {
    let now = time::OffsetDateTime::now_utc();
    let iso = now
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();
    (now.unix_timestamp(), iso)
}

pub(crate) fn parse_rfc3339_unix(raw: Option<&str>) -> Option<i64> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    time::OffsetDateTime::parse(trimmed, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| dt.unix_timestamp())
}

pub(crate) fn is_timestamp_new(
    timestamp: Option<&str>,
    last_seen_at: Option<&str>,
    now_unix: i64,
) -> bool {
    let Some(ts) = parse_rfc3339_unix(timestamp) else {
        return false;
    };
    if let Some(seen) = parse_rfc3339_unix(last_seen_at) {
        ts > seen
    } else {
        ts >= now_unix - SEVEN_DAYS_SECS
    }
}

fn strip_summary_line(line: &str) -> String {
    let mut s = line.trim();
    for prefix in ["- ", "* ", "+ ", "• ", "> "] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest.trim_start();
            break;
        }
    }
    if let Some((num_prefix, rest)) = s.split_once(". ") {
        if !num_prefix.is_empty() && num_prefix.chars().all(|c| c.is_ascii_digit()) {
            s = rest.trim_start();
        }
    }
    let cleaned = s.replace('`', "").trim().to_owned();
    let mut chars = cleaned.chars();
    let prefix: String = chars.by_ref().take(SUMMARY_MAX_CHARS).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn extract_section_first_line(body: &str, heading_needle: &str) -> Option<String> {
    let mut in_section = false;
    for raw_line in body.lines() {
        let trimmed = raw_line.trim();
        if trimmed.starts_with('#') {
            if in_section {
                break;
            }
            let heading_text = trimmed.trim_start_matches('#').trim().trim_end_matches(':');
            if heading_text.eq_ignore_ascii_case(heading_needle) {
                in_section = true;
            }
            continue;
        }
        if !in_section {
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with("<!--") || trimmed == "---" {
            continue;
        }
        let cleaned = strip_summary_line(trimmed);
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    None
}

pub(crate) fn extract_change_summary(body: &str, fallback_title: &str) -> String {
    if let Some(found) = extract_section_first_line(body, "이번 변경 요약") {
        return found;
    }
    if let Some(found) = extract_section_first_line(body, "Summary") {
        return found;
    }
    for raw_line in body.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("<!--")
            || trimmed == "---"
        {
            continue;
        }
        let cleaned = strip_summary_line(trimmed);
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    strip_summary_line(fallback_title)
}

pub(crate) fn pick_primary_doc(files: &[PullRequestChangedFile]) -> (Option<String>, bool) {
    let is_regular_md = |path: &str| {
        let lower = path.to_ascii_lowercase();
        let file_name = lower.rsplit('/').next().unwrap_or(&lower);
        lower.ends_with(".md") && file_name != "agents.md" && file_name != "readme.md"
    };

    let active: Vec<&PullRequestChangedFile> =
        files.iter().filter(|f| f.status != "removed").collect();
    let pool: Vec<&PullRequestChangedFile> = if active.is_empty() {
        files.iter().collect()
    } else {
        active
    };

    let primary = pool
        .iter()
        .find(|f| {
            let norm = f.filename.replace('\\', "/").to_ascii_lowercase();
            norm.starts_with("docs/") && is_regular_md(&norm)
        })
        .or_else(|| pool.iter().find(|f| is_regular_md(&f.filename)))
        .or_else(|| {
            pool.iter()
                .find(|f| f.filename.to_ascii_lowercase().ends_with(".md"))
        })
        .map(|f| f.filename.replace('\\', "/"));

    let has_companion_html = match &primary {
        Some(md_path) => {
            let expected_html = md_path
                .strip_suffix(".md")
                .or_else(|| md_path.strip_suffix(".MD"))
                .map(|stem| format!("{stem}.html"));
            pool.iter().any(|f| {
                let norm = f.filename.replace('\\', "/");
                expected_html
                    .as_deref()
                    .is_some_and(|exp| norm.eq_ignore_ascii_case(exp))
                    || norm.to_ascii_lowercase().ends_with(".html")
            })
        }
        None => pool
            .iter()
            .any(|f| f.filename.to_ascii_lowercase().ends_with(".html")),
    };

    (primary, has_companion_html)
}

fn infer_repository_full_name_from_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url.trim()).ok()?;
    let mut segs = parsed.path_segments()?;
    let owner = segs.next()?.trim();
    let repo = segs.next()?.trim();
    let kind = segs.next()?.trim();
    if owner.is_empty() || repo.is_empty() || (kind != "issues" && kind != "pull") {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn index_issue_statuses(
    issues: &[BoardIssue],
    depth: usize,
    visited: &mut HashSet<String>,
    by_repo_and_num: &mut HashMap<(String, u64), BoardStatus>,
    by_unique_num: &mut HashMap<u64, Option<BoardStatus>>,
    discovered_assignees: &mut BTreeMap<String, BoardAssignee>,
) {
    if depth > MAX_BOARD_DEPTH {
        return;
    }
    for issue in issues {
        let key = issue.url.trim().to_owned();
        if !key.is_empty() && !visited.insert(key) {
            continue;
        }
        if let Some(repo) = infer_repository_full_name_from_url(&issue.url) {
            by_repo_and_num.insert((repo.to_ascii_lowercase(), issue.number), issue.status);
        }
        by_unique_num
            .entry(issue.number)
            .and_modify(|existing| {
                if *existing != Some(issue.status) {
                    *existing = None;
                }
            })
            .or_insert(Some(issue.status));
        for assignee in &issue.assignees {
            let lower = assignee.login.trim().to_ascii_lowercase();
            if !lower.is_empty() {
                discovered_assignees
                    .entry(lower)
                    .and_modify(|prev| {
                        if prev.avatar_url.is_none() && assignee.avatar_url.is_some() {
                            prev.avatar_url = assignee.avatar_url.clone();
                        }
                        if prev.name.is_none() && assignee.name.is_some() {
                            prev.name = assignee.name.clone();
                        }
                    })
                    .or_insert_with(|| assignee.clone());
            }
        }
        if !issue.children.is_empty() {
            index_issue_statuses(
                &issue.children,
                depth + 1,
                visited,
                by_repo_and_num,
                by_unique_num,
                discovered_assignees,
            );
        }
    }
}

fn matches_target_assignee(
    issue: &BoardIssue,
    viewer_login: Option<&str>,
    assignee_filter: Option<&str>,
) -> bool {
    let trimmed = assignee_filter.map(str::trim).filter(|s| !s.is_empty());
    if matches!(trimmed, Some("*") | Some("all")) {
        // `전체` 뷰에서는 순수 에픽 컨테이너(미배정 Epic)는 제외해 작업 목록 가독성을 지킨다.
        return issue.kind.as_deref() != Some("기능") || !issue.assignees.is_empty();
    }
    let Some(target_login) = trimmed.or(viewer_login) else {
        return false;
    };
    issue
        .assignees
        .iter()
        .any(|a| a.login.eq_ignore_ascii_case(target_login))
}

#[allow(clippy::too_many_arguments)]
fn walk_collect_tasks(
    workspace: &HubWorkspace,
    project_owner: &str,
    project_number: u64,
    project_title: &str,
    issues: &[BoardIssue],
    depth: usize,
    visited: &mut HashSet<String>,
    by_repo_and_num: &HashMap<(String, u64), BoardStatus>,
    by_unique_num: &HashMap<u64, Option<BoardStatus>>,
    filter: &DashboardFilter<'_>,
    tasks: &mut Vec<DashboardTaskItem>,
) {
    if depth > MAX_BOARD_DEPTH {
        return;
    }
    for issue in issues {
        let key = issue.url.trim().to_owned();
        if !key.is_empty() && !visited.insert(key) {
            continue;
        }
        if issue.status != BoardStatus::Done
            && matches_target_assignee(issue, filter.viewer_login, filter.assignee_filter)
        {
            let repo_from_url = infer_repository_full_name_from_url(&issue.url);
            let predecessor_done = match issue.depends_on {
                None => true,
                Some(dep) => {
                    let pred_status = repo_from_url
                        .as_deref()
                        .and_then(|repo| {
                            by_repo_and_num
                                .get(&(repo.to_ascii_lowercase(), dep))
                                .copied()
                        })
                        .or_else(|| by_unique_num.get(&dep).copied().flatten());
                    pred_status == Some(BoardStatus::Done)
                }
            };
            let ready_to_start = matches!(issue.status, BoardStatus::Backlog | BoardStatus::Ready)
                && predecessor_done;
            let timestamp = issue.updated_at.as_deref().or(issue.created_at.as_deref());
            let is_new = is_timestamp_new(timestamp, filter.last_seen_at, filter.now_unix);

            tasks.push(DashboardTaskItem {
                workspace_id: workspace.id.clone(),
                workspace_title: workspace.title.clone(),
                project_owner: project_owner.to_owned(),
                project_number,
                project_title: project_title.to_owned(),
                repository_full_name: repo_from_url.or_else(|| {
                    workspace
                        .docs_repository
                        .as_ref()
                        .map(|d| d.full_name.clone())
                }),
                issue_number: issue.number,
                title: issue.title.clone(),
                url: issue.url.clone(),
                status: issue.status,
                layer: issue.layer,
                kind: issue.kind.clone(),
                depends_on: issue.depends_on,
                predecessor_done,
                ready_to_start,
                is_new,
                assignees: issue.assignees.clone(),
                created_at: issue.created_at.clone(),
                updated_at: issue.updated_at.clone(),
            });
        }
        if !issue.children.is_empty() {
            walk_collect_tasks(
                workspace,
                project_owner,
                project_number,
                project_title,
                &issue.children,
                depth + 1,
                visited,
                by_repo_and_num,
                by_unique_num,
                filter,
                tasks,
            );
        }
    }
}

pub(crate) fn collect_workspace_tasks(
    workspace: &HubWorkspace,
    board: &ProjectBoard,
    filter: &DashboardFilter<'_>,
    discovered_assignees: &mut BTreeMap<String, BoardAssignee>,
    tasks: &mut Vec<DashboardTaskItem>,
) {
    let Some(project) = workspace.project.as_ref() else {
        return;
    };
    let mut index_visited = HashSet::new();
    let mut by_repo_and_num = HashMap::new();
    let mut by_unique_num = HashMap::new();
    index_issue_statuses(
        &board.issues,
        0,
        &mut index_visited,
        &mut by_repo_and_num,
        &mut by_unique_num,
        discovered_assignees,
    );

    let mut walk_visited = HashSet::new();
    walk_collect_tasks(
        workspace,
        &project.owner,
        project.number,
        &project.title,
        &board.issues,
        0,
        &mut walk_visited,
        &by_repo_and_num,
        &by_unique_num,
        filter,
        tasks,
    );
}

fn build_notifications_for_prs(
    workspace: &HubWorkspace,
    repo_full_name: &str,
    prs: Vec<(
        DashboardNotificationKind,
        DocsPullRequestSummary,
        Vec<PullRequestChangedFile>,
    )>,
    last_seen_at: Option<&str>,
    now_unix: i64,
) -> Vec<DashboardNotificationItem> {
    prs.into_iter()
        .map(|(kind, pr, files)| {
            let timestamp = match kind {
                DashboardNotificationKind::MergedDoc => pr
                    .merged_at
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or(&pr.updated_at)
                    .to_owned(),
                DashboardNotificationKind::OpenPr => pr.updated_at.clone(),
            };
            let is_new = is_timestamp_new(Some(&timestamp), last_seen_at, now_unix);
            let summary = extract_change_summary(&pr.body, &pr.title);
            let (primary_doc_path, has_companion_html) = pick_primary_doc(&files);
            let kind_tag = match kind {
                DashboardNotificationKind::OpenPr => "open",
                DashboardNotificationKind::MergedDoc => "merged",
            };
            DashboardNotificationItem {
                id: format!("{}:{kind_tag}:{}", workspace.id, pr.number),
                workspace_id: workspace.id.clone(),
                workspace_title: workspace.title.clone(),
                repository_full_name: repo_full_name.to_owned(),
                kind,
                pr_number: pr.number,
                title: pr.title,
                summary,
                author_login: pr.author_login,
                url: pr.html_url,
                primary_doc_path,
                has_companion_html,
                timestamp,
                is_new,
            }
        })
        .collect()
}

async fn fetch_workspace_docs_notifications(
    github: &Arc<GithubService>,
    workspace: &HubWorkspace,
    repo_full_name: &str,
    last_seen_at: Option<&str>,
    now_unix: i64,
) -> Result<Vec<DashboardNotificationItem>, DashboardWorkspaceFailure> {
    let cutoff = now_unix - SEVEN_DAYS_SECS;
    let open_prs = github
        .list_open_pull_requests(repo_full_name)
        .await
        .map_err(|error| DashboardWorkspaceFailure {
            workspace_id: workspace.id.clone(),
            workspace_title: workspace.title.clone(),
            scope: DashboardFailureScope::Docs,
            message: error.message,
        })?;
    let merged_prs = github
        .list_recent_merged_pull_requests(repo_full_name, cutoff)
        .await
        .map_err(|error| DashboardWorkspaceFailure {
            workspace_id: workspace.id.clone(),
            workspace_title: workspace.title.clone(),
            scope: DashboardFailureScope::Docs,
            message: error.message,
        })?;

    let mut seen_numbers = HashSet::new();
    let mut combined: Vec<(DashboardNotificationKind, DocsPullRequestSummary)> = Vec::new();
    for pr in open_prs {
        if seen_numbers.insert(pr.number) {
            combined.push((DashboardNotificationKind::OpenPr, pr));
        }
    }
    for pr in merged_prs {
        if seen_numbers.insert(pr.number) {
            combined.push((DashboardNotificationKind::MergedDoc, pr));
        }
    }

    let mut file_tasks = tokio::task::JoinSet::new();
    for (idx, (_, pr)) in combined.iter().take(MAX_PR_FILES_PER_REPO).enumerate() {
        let gh = Arc::clone(github);
        let repo = repo_full_name.to_owned();
        let pr_number = pr.number;
        file_tasks.spawn(async move {
            let files = gh
                .list_pull_request_files(&repo, pr_number)
                .await
                .unwrap_or_default();
            (idx, files)
        });
    }
    let mut files_by_idx: HashMap<usize, Vec<PullRequestChangedFile>> = HashMap::new();
    while let Some(joined) = file_tasks.join_next().await {
        if let Ok((idx, files)) = joined {
            files_by_idx.insert(idx, files);
        }
    }

    let enriched = combined
        .into_iter()
        .enumerate()
        .map(|(idx, (kind, pr))| (kind, pr, files_by_idx.remove(&idx).unwrap_or_default()))
        .collect();
    Ok(build_notifications_for_prs(
        workspace,
        repo_full_name,
        enriched,
        last_seen_at,
        now_unix,
    ))
}

#[tauri::command]
pub async fn get_personal_dashboard(
    app: AppHandle,
    state: State<'_, AppServices>,
    force_sync: Option<bool>,
    assignee_filter: Option<String>,
    retry_workspace_id: Option<String>,
) -> CommandResult<PersonalDashboardResult> {
    let _access = state.acquire_authenticated_command().await?;
    let github = state.github.clone().ok_or_else(service_unavailable)?;
    let viewer = github.current_user().await?;
    let viewer_login = viewer.login.trim().to_owned();
    let viewer_avatar = viewer.avatar_url.trim().to_owned();

    let workspaces = state.local_settings.load_hub_workspaces()?;
    let last_seen_at = state.local_settings.load_dashboard_last_seen_at()?;
    let (now_unix, fetched_at) = now_utc_pair();
    let force_all = force_sync.unwrap_or(false);
    let retry_target = retry_workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let mut discovered_assignees: BTreeMap<String, BoardAssignee> = BTreeMap::new();
    if !viewer_login.is_empty() {
        discovered_assignees.insert(
            viewer_login.to_ascii_lowercase(),
            BoardAssignee {
                login: viewer_login.clone(),
                avatar_url: if viewer_avatar.is_empty() {
                    None
                } else {
                    Some(viewer_avatar)
                },
                name: None,
            },
        );
    }

    let filter = DashboardFilter {
        viewer_login: (!viewer_login.is_empty()).then_some(viewer_login.as_str()),
        assignee_filter: assignee_filter.as_deref(),
        last_seen_at: last_seen_at.as_deref(),
        now_unix,
    };

    let mut tasks: Vec<DashboardTaskItem> = Vec::new();
    let mut notifications: Vec<DashboardNotificationItem> = Vec::new();
    let mut failures: Vec<DashboardWorkspaceFailure> = Vec::new();

    for workspace in &workspaces {
        if let Some(project) = workspace.project.as_ref() {
            let project_ref = GithubProjectRef {
                id: project.id.clone(),
                owner: project.owner.clone(),
                number: project.number,
                scope: Some(project.scope),
                extra: Default::default(),
            };
            let should_sync = force_all || retry_target == Some(workspace.id.as_str());
            let board_result = if should_sync {
                sync_project_board_for_ref(&app, &state, &project_ref).await
            } else {
                match load_board_for_ref(&app, &project_ref).await {
                    Ok(cached) if !is_empty_board(&cached) => Ok(cached),
                    _ => sync_project_board_for_ref(&app, &state, &project_ref).await,
                }
            };
            match board_result {
                Ok(board) => {
                    collect_workspace_tasks(
                        workspace,
                        &board,
                        &filter,
                        &mut discovered_assignees,
                        &mut tasks,
                    );
                }
                Err(error) => {
                    failures.push(DashboardWorkspaceFailure {
                        workspace_id: workspace.id.clone(),
                        workspace_title: workspace.title.clone(),
                        scope: DashboardFailureScope::Board,
                        message: error.message,
                    });
                }
            }
        }

        if let Some(docs_repo) = workspace.docs_repository.as_ref() {
            match fetch_workspace_docs_notifications(
                &github,
                workspace,
                &docs_repo.full_name,
                last_seen_at.as_deref(),
                now_unix,
            )
            .await
            {
                Ok(items) => notifications.extend(items),
                Err(failure) => failures.push(failure),
            }
        }
    }

    tasks.sort_by(|a, b| {
        b.is_new
            .cmp(&a.is_new)
            .then_with(|| b.ready_to_start.cmp(&a.ready_to_start))
            .then_with(|| {
                b.updated_at
                    .as_deref()
                    .unwrap_or("")
                    .cmp(a.updated_at.as_deref().unwrap_or(""))
            })
            .then_with(|| b.issue_number.cmp(&a.issue_number))
    });

    notifications.sort_by(|a, b| {
        b.timestamp
            .cmp(&a.timestamp)
            .then_with(|| b.pr_number.cmp(&a.pr_number))
    });

    let unread_new_count = tasks.iter().filter(|t| t.is_new).count() as u32;
    let ready_task_count = tasks.iter().filter(|t| t.ready_to_start).count() as u32;
    let unread_notification_count = notifications.iter().filter(|n| n.is_new).count() as u32;

    Ok(PersonalDashboardResult {
        viewer_login: (!viewer_login.is_empty()).then_some(viewer_login),
        fetched_at,
        last_seen_at,
        assignee_options: discovered_assignees.into_values().collect(),
        tasks,
        unread_new_count,
        ready_task_count,
        notifications,
        unread_notification_count,
        failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_board::model::ProjectOwnerScope;
    use crate::settings::model::{DocsRepository, LinkedProject};

    fn sample_workspace(id: &str, title: &str) -> HubWorkspace {
        HubWorkspace {
            id: id.into(),
            title: title.into(),
            project: Some(LinkedProject {
                id: format!("PVT_{id}"),
                owner: "Mockly-Company".into(),
                number: 1,
                title: title.into(),
                scope: ProjectOwnerScope::Organization,
            }),
            docs_repository: Some(DocsRepository {
                repository_id: format!("R_{id}"),
                full_name: format!("Mockly-Company/{id}-docs"),
            }),
        }
    }

    fn issue(
        number: u64,
        status: BoardStatus,
        assignees: Vec<&str>,
        depends_on: Option<u64>,
        updated_at: Option<&str>,
        children: Vec<BoardIssue>,
    ) -> BoardIssue {
        BoardIssue {
            number,
            title: format!("작업 #{number}"),
            url: format!("https://github.com/Mockly-Company/app/issues/{number}"),
            layer: BoardLayer::Frontend,
            status,
            children,
            kind: Some("작업".into()),
            depends_on,
            children_truncated: false,
            assignees: assignees
                .into_iter()
                .map(|login| BoardAssignee {
                    login: login.into(),
                    avatar_url: None,
                    name: None,
                })
                .collect(),
            created_at: None,
            updated_at: updated_at.map(str::to_owned),
        }
    }

    #[test]
    fn extract_change_summary_reads_first_bullet_and_falls_back_cleanly() {
        let with_section = "## 이번 변경 요약\n\n- `내 대시보드` 화면 명세(3.1~3.4)를 추가했습니다.\n- 두 번째 줄\n\n## 체크리스트\n- [x] 완료";
        assert_eq!(
            extract_change_summary(with_section, "제목"),
            "내 대시보드 화면 명세(3.1~3.4)를 추가했습니다."
        );

        let with_english = "## Summary\n- Add dashboard PRD";
        assert_eq!(
            extract_change_summary(with_english, "제목"),
            "Add dashboard PRD"
        );

        assert_eq!(
            extract_change_summary("", "fallback title"),
            "fallback title"
        );
    }

    #[test]
    fn pick_primary_doc_prefers_docs_markdown_and_detects_companion_html() {
        let files = vec![
            PullRequestChangedFile {
                filename: "AGENTS.md".into(),
                status: "modified".into(),
                previous_filename: None,
            },
            PullRequestChangedFile {
                filename: "docs/product/spec.md".into(),
                status: "modified".into(),
                previous_filename: None,
            },
            PullRequestChangedFile {
                filename: "docs/product/spec.html".into(),
                status: "modified".into(),
                previous_filename: None,
            },
        ];
        let (path, has_html) = pick_primary_doc(&files);
        assert_eq!(path.as_deref(), Some("docs/product/spec.md"));
        assert!(has_html);
    }

    #[test]
    fn collect_workspace_tasks_filters_assignees_computes_readiness_and_marks_new() {
        let ws = sample_workspace("okf", "OkHub");
        let board = ProjectBoard {
            issues: vec![BoardIssue {
                number: 68,
                title: "Epic".into(),
                url: "https://github.com/Mockly-Company/app/issues/68".into(),
                layer: BoardLayer::Planning,
                status: BoardStatus::InProgress,
                kind: Some("기능".into()),
                depends_on: None,
                children_truncated: false,
                assignees: Vec::new(),
                created_at: None,
                updated_at: Some("2026-11-14T08:00:00Z".into()),
                children: vec![
                    issue(
                        73,
                        BoardStatus::Done,
                        vec!["YoonDongGeun"],
                        None,
                        Some("2026-11-14T01:00:00Z"),
                        vec![],
                    ),
                    issue(
                        74,
                        BoardStatus::Ready,
                        vec!["yoondonggeun"],
                        Some(73),
                        Some("2026-11-14T06:00:00Z"),
                        vec![],
                    ),
                    issue(
                        77,
                        BoardStatus::Backlog,
                        vec!["YoonDongGeun"],
                        Some(74),
                        Some("2026-11-13T00:00:00Z"),
                        vec![],
                    ),
                    issue(
                        78,
                        BoardStatus::Ready,
                        vec!["teammate"],
                        None,
                        Some("2026-11-14T07:00:00Z"),
                        vec![],
                    ),
                ],
            }],
            fetched_at: Some("2026-11-14T08:00:00Z".into()),
            skipped: 0,
            truncated: false,
        };

        let now_unix = 1_763_107_200; // >= 2026-11-14
        let filter = DashboardFilter {
            viewer_login: Some("YoonDongGeun"),
            assignee_filter: None,
            last_seen_at: Some("2026-11-14T05:00:00Z"),
            now_unix,
        };
        let mut discovered = BTreeMap::new();
        let mut tasks = Vec::new();
        collect_workspace_tasks(&ws, &board, &filter, &mut discovered, &mut tasks);

        assert_eq!(tasks.len(), 2);
        let t74 = tasks.iter().find(|t| t.issue_number == 74).unwrap();
        assert!(t74.is_new);
        assert!(t74.predecessor_done);
        assert!(t74.ready_to_start);

        let t77 = tasks.iter().find(|t| t.issue_number == 77).unwrap();
        assert!(!t77.is_new);
        assert!(!t77.predecessor_done);
        assert!(!t77.ready_to_start);

        assert!(discovered.contains_key("yoondonggeun"));
        assert!(discovered.contains_key("teammate"));

        let filter_all = DashboardFilter {
            viewer_login: Some("YoonDongGeun"),
            assignee_filter: Some("*"),
            last_seen_at: Some("2026-11-14T05:00:00Z"),
            now_unix,
        };
        let mut all_tasks = Vec::new();
        let mut discovered_all = BTreeMap::new();
        collect_workspace_tasks(
            &ws,
            &board,
            &filter_all,
            &mut discovered_all,
            &mut all_tasks,
        );
        assert_eq!(all_tasks.len(), 3);
    }

    #[test]
    fn build_notifications_uses_merged_timestamp_for_merged_docs() {
        let ws = sample_workspace("okf", "OkHub");
        let prs = vec![
            (
                DashboardNotificationKind::OpenPr,
                DocsPullRequestSummary {
                    number: 17,
                    title: "docs: 리뷰 대기".into(),
                    body: "## 이번 변경 요약\n- 신규 모달 초안\n".into(),
                    html_url: "https://github.com/Mockly-Company/okf-docs/pull/17".into(),
                    author_login: "alice".into(),
                    head_ref: "draft/alice/modal".into(),
                    head_sha: "sha17".into(),
                    base_ref: "main".into(),
                    base_sha: "base".into(),
                    is_draft: false,
                    mergeable: Some(true),
                    updated_at: "2026-11-14T07:00:00Z".into(),
                    merged_at: None,
                },
                vec![],
            ),
            (
                DashboardNotificationKind::MergedDoc,
                DocsPullRequestSummary {
                    number: 16,
                    title: "docs: 대시보드 확정".into(),
                    body: "## 이번 변경 요약\n- `내 대시보드` 명세 반영\n".into(),
                    html_url: "https://github.com/Mockly-Company/okf-docs/pull/16".into(),
                    author_login: "alice".into(),
                    head_ref: "docs/dashboard".into(),
                    head_sha: "sha16".into(),
                    base_ref: "main".into(),
                    base_sha: "base".into(),
                    is_draft: false,
                    mergeable: None,
                    updated_at: "2026-11-14T03:00:00Z".into(),
                    merged_at: Some("2026-11-14T06:30:00Z".into()),
                },
                vec![
                    PullRequestChangedFile {
                        filename: "docs/product/spec.md".into(),
                        status: "modified".into(),
                        previous_filename: None,
                    },
                    PullRequestChangedFile {
                        filename: "docs/product/spec.html".into(),
                        status: "modified".into(),
                        previous_filename: None,
                    },
                ],
            ),
        ];

        let now_unix = 1_763_107_200;
        let items = build_notifications_for_prs(
            &ws,
            "Mockly-Company/okf-docs",
            prs,
            Some("2026-11-14T06:00:00Z"),
            now_unix,
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].kind, DashboardNotificationKind::OpenPr);
        assert!(items[0].is_new);
        assert_eq!(items[1].kind, DashboardNotificationKind::MergedDoc);
        assert_eq!(items[1].timestamp, "2026-11-14T06:30:00Z");
        assert!(items[1].is_new);
        assert_eq!(
            items[1].primary_doc_path.as_deref(),
            Some("docs/product/spec.md")
        );
        assert!(items[1].has_companion_html);
        assert_eq!(items[1].summary, "내 대시보드 명세 반영");
    }
}
