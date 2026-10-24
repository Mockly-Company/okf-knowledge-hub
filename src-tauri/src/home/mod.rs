//! Read-only Home projection. Auth and GitHub writes stay in their existing services.
use crate::error::{AppError, ErrorCode};
use crate::github::GithubService;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
mod queries;
#[cfg(test)]
mod tests;

pub(crate) fn unavailable() -> AppError {
    AppError::new(ErrorCode::GithubUnavailable, "홈 데이터를 모두 확인하지 못했습니다. 연결과 GitHub 접근 권한을 확인한 뒤 다시 시도해 주세요.")
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub project_id: String,
    pub status_field_id: String,
    pub in_progress_option_ids: Vec<String>,
    pub due_date_field_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectOption {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectField {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub options: Vec<ProjectOption>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub url: String,
    pub fields: Vec<ProjectField>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Configuration {
    pub project: Option<Project>,
    pub preferences: Option<Preferences>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub scope_key: String,
    pub as_of_unix_ms: u64,
    pub reviews: Vec<Value>,
    pub issues: Vec<Value>,
    pub tasks_error: bool,
    pub analysis: Option<Value>,
    pub analysis_error: bool,
    pub configuration: Configuration,
}
#[async_trait]
pub(crate) trait Source: Send + Sync {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, AppError>;
}
#[async_trait]
impl Source for GithubService {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, AppError> {
        self.read_graphql(query, variables).await
    }
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(unavailable)
}
fn nodes(value: &Value) -> Result<&Vec<Value>, AppError> {
    value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(unavailable)
}
fn next_page(value: &Value, cursor: &Option<String>) -> Result<Option<String>, AppError> {
    let page = &value["pageInfo"];
    match page["hasNextPage"].as_bool() {
        Some(false) => Ok(None),
        Some(true) => {
            let next = string(page, "endCursor")?.to_string();
            if cursor.as_ref() == Some(&next) {
                return Err(unavailable());
            }
            Ok(Some(next))
        }
        None => Err(unavailable()),
    }
}
fn reference(value: &Value) -> Result<Value, AppError> {
    let url = string(value, "url")?;
    if !safe_github_url(url) {
        return Err(unavailable());
    }
    Ok(
        json!({"id":string(value,"id")?,"title":string(value,"title")?,"number":value["number"].as_u64().ok_or_else(unavailable)?,"repository":string(&value["repository"],"nameWithOwner")?,"url":url}),
    )
}
pub(crate) fn safe_github_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("github.com")
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
    })
}
pub(crate) fn valid_resource_url(value: &str) -> bool {
    if !safe_github_url(value) {
        return false;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    if url.query().is_some() {
        return false;
    }
    let parts: Vec<_> = url.path().split('/').filter(|p| !p.is_empty()).collect();
    parts.len() == 4
        && valid_name(parts[0])
        && valid_name(parts[1])
        && matches!(parts[2], "issues" | "pull")
        && parts[3].parse::<u64>().is_ok_and(|n| n > 0)
}
fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
pub(crate) fn valid_repository(s: &str) -> bool {
    let p: Vec<_> = s.split('/').collect();
    p.len() == 2 && p.iter().all(|s| valid_name(s))
}
pub(crate) fn validate_preferences(project: &Project, prefs: &Preferences) -> Result<(), AppError> {
    if prefs.project_id != project.id || prefs.in_progress_option_ids.is_empty() {
        return Err(unavailable());
    }
    let field = project
        .fields
        .iter()
        .find(|f| f.id == prefs.status_field_id && f.kind == "SINGLE_SELECT")
        .ok_or_else(unavailable)?;
    if prefs
        .in_progress_option_ids
        .iter()
        .any(|id| !field.options.iter().any(|o| &o.id == id))
    {
        return Err(unavailable());
    }
    if let Some(id) = &prefs.due_date_field_id {
        if !project
            .fields
            .iter()
            .any(|f| &f.id == id && f.kind == "DATE")
        {
            return Err(unavailable());
        }
    }
    Ok(())
}
pub(crate) async fn project(source: &dyn Source, id: &str) -> Result<Project, AppError> {
    let mut after = None;
    let mut fields = Vec::new();
    for _ in 0..100 {
        let data = source
            .query(queries::PROJECT, json!({"id":id,"after":after}))
            .await?;
        let p = &data["node"];
        if string(p, "__typename")? != "ProjectV2" {
            return Err(unavailable());
        }
        let connection = &p["fields"];
        for f in nodes(connection)? {
            let kind = f["dataType"].as_str().unwrap_or("");
            if !matches!(kind, "SINGLE_SELECT" | "DATE") {
                continue;
            }
            let options = if kind == "SINGLE_SELECT" {
                f["options"]
                    .as_array()
                    .ok_or_else(unavailable)?
                    .iter()
                    .map(|o| {
                        Ok(ProjectOption {
                            id: string(o, "id")?.into(),
                            name: string(o, "name")?.into(),
                        })
                    })
                    .collect::<Result<Vec<_>, AppError>>()?
            } else {
                vec![]
            };
            fields.push(ProjectField {
                id: string(f, "id")?.into(),
                name: string(f, "name")?.into(),
                kind: kind.into(),
                options,
            });
        }
        let url = string(p, "url")?;
        if !safe_github_url(url) {
            return Err(unavailable());
        }
        let result = (
            string(p, "id")?.to_string(),
            string(p, "title")?.to_string(),
            url.to_string(),
        );
        after = next_page(connection, &after)?;
        if after.is_none() {
            let (id, title, url) = result;
            return Ok(Project {
                id,
                title,
                url,
                fields,
            });
        }
    }
    Err(unavailable())
}
async fn search(source: &dyn Source, query: String) -> Result<Vec<Value>, AppError> {
    let mut after = None;
    let mut result = Vec::new();
    let mut expected = None;
    for _ in 0..10 {
        let data = source
            .query(queries::SEARCH, json!({"query":query,"after":after}))
            .await?;
        let c = &data["search"];
        let count = c["issueCount"].as_u64().ok_or_else(unavailable)?;
        if count > 1000 || expected.is_some_and(|n| n != count) {
            return Err(unavailable());
        }
        expected = Some(count);
        for n in nodes(c)? {
            reference(n)?;
            if result.iter().any(|old: &Value| old["id"] == n["id"]) {
                return Err(unavailable());
            }
            result.push(n.clone());
        }
        after = next_page(c, &after)?;
        if after.is_none() {
            if result.len() as u64 != count {
                return Err(unavailable());
            }
            return Ok(result);
        }
    }
    Err(unavailable())
}
#[derive(Debug)]
struct CurrentReviewRequest {
    id: String,
    login: Option<String>,
    team: bool,
    requested_at: Option<String>,
    requester: Option<String>,
}
async fn viewer_is_team_member(
    source: &dyn Source,
    id: &str,
    login: &str,
) -> Result<bool, AppError> {
    let mut after = None;
    for _ in 0..100 {
        let data = source
            .query(
                queries::TEAM_MEMBER,
                json!({"id":id,"login":login,"after":after}),
            )
            .await?;
        let node = &data["node"];
        if node["__typename"] == "EnterpriseTeam" {
            return node["isViewerMember"].as_bool().ok_or_else(unavailable);
        }
        if node["__typename"] != "Team" {
            return Err(unavailable());
        }
        let c = &node["members"];
        if nodes(c)?.iter().any(|member| {
            member["login"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(login))
        }) {
            return Ok(true);
        }
        after = next_page(c, &after)?;
        if after.is_none() {
            return Ok(false);
        }
    }
    Err(unavailable())
}

async fn viewer_is_assigned(
    source: &dyn Source,
    issue: &Value,
    login: &str,
) -> Result<bool, AppError> {
    let mut c = issue["assignees"].clone();
    let mut after = None;
    for _ in 0..100 {
        if nodes(&c)?.iter().any(|user| {
            user["login"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(login))
        }) {
            return Ok(true);
        }
        after = next_page(&c, &after)?;
        if after.is_none() {
            return Ok(false);
        }
        let data = source
            .query(
                queries::ASSIGNEES,
                json!({"id":string(issue,"id")?,"after":after}),
            )
            .await?;
        if data["node"]["issueState"] != "OPEN" {
            return Ok(false);
        }
        c = data["node"]["assignees"].clone();
    }
    Err(unavailable())
}

/// Both connections are fully paginated: a current request has no createdAt field.
async fn review_requests(
    source: &dyn Source,
    id: &str,
) -> Result<Vec<CurrentReviewRequest>, AppError> {
    let mut after = None;
    let mut reviewers = Vec::new();
    for _ in 0..100 {
        let data = source
            .query(queries::REQUESTS, json!({"id":id,"after":after}))
            .await?;
        let c = &data["node"]["reviewRequests"];
        for n in nodes(c)? {
            let r = &n["requestedReviewer"];
            let key = string(r, "id")?;
            reviewers.push((
                key.to_owned(),
                r["login"].as_str().map(str::to_owned),
                matches!(r["__typename"].as_str(), Some("Team" | "EnterpriseTeam")),
            ));
        }
        after = next_page(c, &after)?;
        if after.is_none() {
            break;
        }
        if reviewers.len() >= 10000 {
            return Err(unavailable());
        }
    }
    if after.is_some() {
        return Err(unavailable());
    }
    if reviewers.is_empty() {
        return Ok(vec![]);
    }
    let mut events = std::collections::HashMap::new();
    let mut after = None;
    for _ in 0..100 {
        let data = source
            .query(queries::EVENTS, json!({"id":id,"after":after}))
            .await?;
        let c = &data["node"]["timelineItems"];
        for e in nodes(c)? {
            let Some(key) = e["requestedReviewer"]["id"].as_str() else {
                continue;
            };
            if !reviewers.iter().any(|(id, _, _)| id == key) {
                continue;
            }
            events.insert(
                key.to_owned(),
                (
                    string(e, "createdAt")?.to_owned(),
                    e["actor"]["login"].as_str().map(str::to_owned),
                ),
            );
        }
        after = next_page(c, &after)?;
        if after.is_none() {
            return Ok(reviewers
                .into_iter()
                .map(|(key, login, team)| {
                    let event = events.get(&key);
                    CurrentReviewRequest {
                        id: key,
                        login,
                        team,
                        requested_at: event.map(|e| e.0.clone()),
                        requester: event.and_then(|e| e.1.clone()),
                    }
                })
                .collect());
        }
    }
    Err(unavailable())
}
async fn project_items(
    source: &dyn Source,
    p: &Project,
    prefs: &Preferences,
) -> Result<Vec<Value>, AppError> {
    let status = p
        .fields
        .iter()
        .find(|f| f.id == prefs.status_field_id)
        .ok_or_else(unavailable)?;
    let due = prefs
        .due_date_field_id
        .as_ref()
        .and_then(|id| p.fields.iter().find(|f| &f.id == id));
    if p.fields.iter().filter(|f| f.name == status.name).count() != 1
        || due.is_some_and(|d| p.fields.iter().filter(|f| f.name == d.name).count() != 1)
    {
        return Err(unavailable());
    }
    let mut after = None;
    let mut result = Vec::new();
    for _ in 0..100 {
        let data=source.query(queries::ITEMS,json!({"id":p.id,"status":status.name,"due":due.map(|f|f.name.as_str()).unwrap_or(""),"includeDue":due.is_some(),"after":after})).await?;
        let c = &data["node"]["items"];
        for item in nodes(c)? {
            if item["isArchived"].as_bool().is_none() {
                return Err(unavailable());
            }
            if item["content"].is_null() {
                return Err(unavailable());
            }
            if item["content"]["__typename"] == "DraftIssue" {
                continue;
            }
            reference(&item["content"])?;
            if !result.iter().any(|old: &Value| old["id"] == item["id"]) {
                result.push(item.clone())
            } else {
                return Err(unavailable());
            }
        }
        after = next_page(c, &after)?;
        if after.is_none() {
            return Ok(result);
        }
    }
    Err(unavailable())
}
fn analysis_base(p: &Project) -> Value {
    json!({"projectName":p.title,"complete":true,"pendingReviews":[],"inProgressIssues":[],"completed":[]})
}
pub(crate) async fn load(
    source: &dyn Source,
    scope_key: String,
    login: &str,
    repositories: &[String],
    project_id: Option<&str>,
    prefs: Option<Preferences>,
    as_of_unix_ms: u64,
) -> Snapshot {
    let mut snapshot = Snapshot {
        scope_key,
        as_of_unix_ms,
        reviews: vec![],
        issues: vec![],
        tasks_error: false,
        analysis: None,
        analysis_error: false,
        configuration: Configuration {
            project: None,
            preferences: prefs.clone(),
        },
    };
    let p = if let Some(id) = project_id {
        match project(source, id).await {
            Ok(p) => Some(p),
            Err(_) => {
                snapshot.analysis_error = true;
                None
            }
        }
    } else {
        None
    };
    snapshot.configuration.project = p.clone();
    let mut items = None;
    if let (Some(p), Some(prefs)) = (&p, &prefs) {
        if validate_preferences(p, prefs).is_ok() {
            match project_items(source, p, prefs).await {
                Ok(value) => items = Some(value),
                Err(_) => snapshot.analysis_error = true,
            }
        } else {
            snapshot.analysis_error = true
        }
    }
    let scope = repositories
        .iter()
        .map(|r| format!("repo:{r}"))
        .collect::<Vec<_>>()
        .join(" ");
    let personal = async {
        if !valid_name(login)
            || repositories.is_empty()
            || repositories.len() > 50
            || repositories.iter().any(|r| !valid_repository(r))
        {
            return Err(unavailable());
        }
        // Search can omit inaccessible repositories instead of returning an error.
        // Verify the required resource connections before treating search zero as empty.
        for repository in repositories {
            let (owner, name) = repository.split_once('/').ok_or_else(unavailable)?;
            let access = source
                .query(
                    queries::REPOSITORY_ACCESS,
                    json!({"owner":owner,"name":name}),
                )
                .await?;
            let value = &access["repository"];
            if !string(value, "nameWithOwner")?.eq_ignore_ascii_case(repository)
                || value["issues"]["totalCount"].as_u64().is_none()
                || value["pullRequests"]["totalCount"].as_u64().is_none()
            {
                return Err(unavailable());
            }
        }
        let prs = search(
            source,
            format!("is:pr is:open review-requested:{login} {scope}"),
        )
        .await?;
        let mut reviews = Vec::new();
        for pr in prs {
            match pr["pullRequestState"].as_str() {
                Some("OPEN") => {}
                Some("CLOSED" | "MERGED") => continue,
                _ => return Err(unavailable()),
            }
            let mut r = reference(&pr)?;
            let requests = review_requests(source, string(&pr, "id")?).await?;
            let mut matching = Vec::new();
            for request in &requests {
                if request
                    .login
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(login))
                    || (request.team && viewer_is_team_member(source, &request.id, login).await?)
                {
                    matching.push(request);
                }
            }
            if matching.is_empty() {
                continue;
            }
            let event = matching
                .iter()
                .max_by(|a, b| a.requested_at.cmp(&b.requested_at));
            let complete = matching.iter().all(|r| r.requested_at.is_some());
            r["updatedAt"] = pr["updatedAt"].clone();
            r["requestedAt"] = if complete {
                event
                    .and_then(|e| e.requested_at.as_ref())
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            r["requester"] = json!(if complete {
                event
                    .and_then(|e| e.requester.as_deref())
                    .unwrap_or("알 수 없음")
            } else {
                "알 수 없음"
            });
            reviews.push(r);
        }
        let raw = search(source, format!("is:issue is:open assignee:{login} {scope}")).await?;
        let mut issues = Vec::new();
        for issue in raw {
            match issue["issueState"].as_str() {
                Some("OPEN") => {}
                Some("CLOSED") => continue,
                _ => return Err(unavailable()),
            }
            if !viewer_is_assigned(source, &issue, login).await? {
                continue;
            }
            let mut r = reference(&issue)?;
            r["updatedAt"] = issue["updatedAt"].clone();
            let item = items.as_ref().and_then(|items| {
                items
                    .iter()
                    .find(|item| item["content"]["id"] == issue["id"])
            });
            r["projectStatus"] = item
                .map(|i| i["status"]["name"].clone())
                .unwrap_or(Value::Null);
            r["dueDate"] = item
                .map(|i| i["due"]["date"].clone())
                .unwrap_or(Value::Null);
            issues.push(r);
        }
        Ok::<_, AppError>((reviews, issues))
    }
    .await;
    match personal {
        Ok((reviews, issues)) => {
            snapshot.reviews = reviews;
            snapshot.issues = issues
        }
        Err(_) => snapshot.tasks_error = true,
    }
    // If a configured Project could not be read, issue status/deadline is not a confirmed absence.
    if project_id.is_some() && prefs.is_some() && items.is_none() {
        snapshot.tasks_error = true;
        snapshot.reviews.clear();
        snapshot.issues.clear();
    }
    if let (Some(p), Some(prefs), Some(items)) = (&p, &prefs, items) {
        let mut analysis = analysis_base(p);
        let mut pending = Vec::new();
        let mut progress = Vec::new();
        let mut completed = Vec::new();
        for item in items {
            let content = &item["content"];
            let mut r = match reference(content) {
                Ok(r) => r,
                Err(_) => {
                    snapshot.analysis_error = true;
                    break;
                }
            };
            if content["__typename"] == "PullRequest" {
                if content["pullRequestState"] == "OPEN" {
                    match review_requests(source, content["id"].as_str().unwrap_or("")).await {
                        Ok(requests) => {
                            // One PR is one summary item; its last remaining review request supplies its age.
                            if !requests.is_empty() {
                                if requests.iter().any(|r| r.requested_at.is_none()) {
                                    analysis["complete"] = json!(false)
                                }
                                let latest = requests
                                    .iter()
                                    .filter_map(|r| r.requested_at.as_ref())
                                    .max();
                                r["requestedAt"] = latest.map(|v| json!(v)).unwrap_or(Value::Null);
                                pending.push(r.clone());
                            }
                        }
                        Err(_) => {
                            snapshot.analysis_error = true;
                            break;
                        }
                    }
                }
                if content["pullRequestState"] == "MERGED" {
                    r["kind"] = json!("pr");
                    r["completedAt"] = content["mergedAt"].clone();
                    completed.push(r);
                }
            } else if content["__typename"] == "Issue" {
                if content["issueState"] == "OPEN"
                    && prefs
                        .in_progress_option_ids
                        .iter()
                        .any(|id| item["status"]["optionId"].as_str() == Some(id.as_str()))
                    && !item["isArchived"].as_bool().unwrap_or(false)
                {
                    r["updatedAt"] = content["updatedAt"].clone();
                    progress.push(r.clone());
                }
                if content["issueState"] == "CLOSED" {
                    r["kind"] = json!("issue");
                    r["completedAt"] = content["closedAt"].clone();
                    completed.push(r);
                }
            }
        }
        analysis["pendingReviews"] = json!(pending);
        analysis["inProgressIssues"] = json!(progress);
        analysis["completed"] = json!(completed);
        if !snapshot.analysis_error {
            snapshot.analysis = Some(analysis)
        }
    }
    snapshot
}
