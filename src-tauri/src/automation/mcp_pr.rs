//! PR search and independent, confirmed PR management.
use super::mcp_sdk::error;
use super::AutomationRuntime;
use crate::error::AppError;
use serde_json::json;
use serde_json::Value;

const PR_SEARCH: &str = r#"
query($query:String!,$first:Int!,$after:String) {
  search(type:ISSUE,query:$query,first:$first,after:$after) {
    issueCount pageInfo {hasNextPage endCursor}
    nodes { ... on PullRequest {
      id number title state isDraft updatedAt url headRefOid
      repository {nameWithOwner} author {login} reviewDecision
      reviewRequests(first:100) {nodes {requestedReviewer {
        ... on User {login} ... on Team {slug organization {login}}
      }} pageInfo {hasNextPage}}
      commits(last:1) {nodes {commit {statusCheckRollup {state}}}}
    }}
  }
}
"#;

fn qualifier_value(value: &str) -> Result<&str, AppError> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c))
    {
        return Err(error("작성자·리뷰 요청 대상 형식이 잘못되었습니다."));
    }
    Ok(value)
}

fn search_query(repository: &str, args: &Value) -> Result<String, AppError> {
    let mut parts = vec![
        format!("repo:{repository}"),
        "is:pr".into(),
        "sort:updated-desc".into(),
    ];
    match args["state"].as_str().unwrap_or("open") {
        "open" => parts.push("is:open".into()),
        "closed" => parts.extend(["is:closed".into(), "is:unmerged".into()]),
        "merged" => parts.push("is:merged".into()),
        "all" => {}
        _ => return Err(error("PR state 값 오류")),
    }
    if let Some(author) = args["author"].as_str() {
        parts.push(format!("author:{}", qualifier_value(author)?));
    }
    if let Some(who) = args["reviewRequestedFor"].as_str() {
        parts.push(format!(
            "{}:{}",
            if who.contains('/') {
                "team-review-requested"
            } else {
                "review-requested"
            },
            qualifier_value(who)?
        ));
    }
    if let Some(review) = args["reviewDecision"].as_str() {
        let qualifier = match review {
            "approved" => "approved",
            "changes_requested" => "changes_requested",
            "review_required" => "required",
            _ => return Err(error("PR 리뷰 결과 필터 값 오류")),
        };
        parts.push(format!("review:{qualifier}"));
    }
    if let Some(draft) = args["draft"].as_bool() {
        parts.push(format!("draft:{draft}"));
    }
    if let Some(query) = args["query"].as_str().filter(|q| !q.trim().is_empty()) {
        if query.len() > 500 || query.contains(['\n', '\r', '\0']) {
            return Err(error(
                "PR 검색어가 너무 길거나 허용되지 않은 문자를 포함합니다.",
            ));
        }
        parts.push(format!(
            "\"{}\"",
            query.replace('\\', "\\\\").replace('"', "\\\"")
        ));
    }
    Ok(parts.join(" "))
}

fn summary(node: &Value, repository: &str) -> Result<Value, AppError> {
    if !node["repository"]["nameWithOwner"]
        .as_str()
        .is_some_and(|repo| repo.eq_ignore_ascii_case(repository))
    {
        return Err(error("허용된 저장소 밖의 PR 검색 결과입니다."));
    }
    let state = match node["state"].as_str() {
        Some("OPEN") => "open",
        Some("CLOSED") => "closed",
        Some("MERGED") => "merged",
        _ => return Err(error("PR 상태를 확인할 수 없습니다.")),
    };
    if node["number"].as_u64().is_none()
        || node["title"].as_str().is_none()
        || node["isDraft"].as_bool().is_none()
        || node["headRefOid"].as_str().is_none()
    {
        return Err(error("PR 요약 응답이 불완전합니다."));
    }
    let review = match node["reviewDecision"].as_str() {
        Some("APPROVED") => "approved",
        Some("CHANGES_REQUESTED") => "changes_requested",
        Some("REVIEW_REQUIRED") => "review_required",
        _ => "unknown",
    };
    let reviewers: Vec<_> = node["reviewRequests"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|n| {
            let r = &n["requestedReviewer"];
            if let Some(login) = r["login"].as_str() {
                json!({"kind":"user","login":login})
            } else {
                json!({"kind":"team","organization":r["organization"]["login"],"slug":r["slug"]})
            }
        })
        .collect();
    let checks = node["commits"]["nodes"]
        .as_array()
        .and_then(|n| n.last())
        .and_then(|n| n["commit"]["statusCheckRollup"]["state"].as_str())
        .unwrap_or("unknown");
    Ok(
        json!({"repository":repository,"number":node["number"],"title":node["title"],"state":state,"draft":node["isDraft"],"author":node["author"]["login"],"requestedReviewers":reviewers,"reviewersTruncated":node["reviewRequests"]["pageInfo"]["hasNextPage"],"reviewDecision":review,"checksSummary":checks,"updatedAt":node["updatedAt"],"url":node["url"],"headSha":node["headRefOid"]}),
    )
}

pub(super) async fn list(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    let offset = args["offset"].as_u64().unwrap_or(0) as usize;
    let limit = args["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
    if offset >= 1000 {
        return Err(error(
            "GitHub PR 검색은 앞의 1000개까지만 조회할 수 있습니다. 필터를 좁히세요.",
        ));
    }
    let context = runtime.active_context_summary();
    let mut repositories = if args["repositories"] == "all" {
        if args.get("repository").is_some() {
            return Err(error(
                "repository와 repositories=all을 동시에 지정할 수 없습니다.",
            ));
        }
        context
            .docs_repository_full_name
            .into_iter()
            .chain(context.code_repositories.into_iter().map(|r| r.full_name))
            .collect::<Vec<_>>()
    } else {
        vec![super::mcp_sources::allowed_repo(
            runtime,
            args["repository"]
                .as_str()
                .or(context.docs_repository_full_name.as_deref()),
            false,
        )?]
    };
    repositories.sort_by_key(|repository| repository.to_ascii_lowercase());
    repositories.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    if repositories.is_empty() {
        return Err(error("조회할 PR 저장소가 없습니다."));
    }
    let github = runtime.build_github_service()?;
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut total = 0u64;
    let mut successful = 0usize;
    for repository in repositories {
        let repository = super::mcp_sources::allowed_repo(runtime, Some(&repository), false)?;
        let parts: Vec<_> = repository.split('/').collect();
        let detail = match github
            .automation_get(&["repos", parts[0], parts[1]], &[])
            .await
        {
            Ok(value) => value,
            Err(e) => {
                warnings.push(json!({"repository":repository,"error":e.message}));
                continue;
            }
        };
        let canonical = detail["full_name"]
            .as_str()
            .ok_or_else(|| error("저장소 신원 응답이 불완전합니다."))?;
        let query = search_query(canonical, args)?;
        let mut after = Value::Null;
        let mut loaded = 0;
        let mut seen = std::collections::HashSet::new();
        loop {
            let data = match github
                .graphql_value(PR_SEARCH, json!({"query":query,"first":100,"after":after}))
                .await
            {
                Ok(value) => value,
                Err(e) => {
                    warnings.push(json!({"repository":canonical,"error":e.message}));
                    break;
                }
            };
            let page = &data["search"];
            if after.is_null() {
                let count = page["issueCount"]
                    .as_u64()
                    .ok_or_else(|| error("PR 검색 개수 응답 누락"))?;
                total += count;
                successful += 1;
                if count > 1000 {
                    warnings.push(
                        json!({"repository":canonical,"reason":"github_search_1000_result_cap"}),
                    );
                }
            }
            let nodes = page["nodes"]
                .as_array()
                .ok_or_else(|| error("PR 검색 목록 응답 누락"))?;
            if nodes.is_empty() && page["pageInfo"]["hasNextPage"] == true {
                return Err(error(
                    "빈 PR 검색 페이지가 후속 페이지를 주장해 안전하게 중단했습니다.",
                ));
            }
            for node in nodes {
                let row = summary(node, canonical)?;
                if row["reviewDecision"] == "unknown"
                    || row["checksSummary"] == "unknown"
                    || row["reviewersTruncated"] == true
                {
                    warnings.push(json!({"repository":canonical,"number":row["number"],"reason":"review_or_checks_incomplete"}));
                }
                rows.push(row);
                loaded += 1;
            }
            if page["pageInfo"]["hasNextPage"] != true
                || loaded >= offset + limit + 1
                || loaded >= 1000
            {
                break;
            }
            let cursor = page["pageInfo"]["endCursor"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| error("PR 다음 페이지 정보가 없습니다."))?;
            if !seen.insert(cursor.to_owned()) {
                return Err(error("PR 페이지 커서가 반복되었습니다."));
            }
            after = json!(cursor);
        }
    }
    if successful == 0 {
        return Err(error(format!(
            "모든 PR 저장소 조회가 실패했습니다: {}",
            json!(warnings)
        )));
    }
    if total > 1000 {
        warnings.push(json!({"reason":"combined_search_result_cap","accessibleLimit":1000,"hint":"저장소·상태·작성자 등 필터를 좁혀 다시 조회하세요."}));
    }
    rows.sort_by(|a, b| {
        b["updatedAt"]
            .as_str()
            .cmp(&a["updatedAt"].as_str())
            .then(a["repository"].as_str().cmp(&b["repository"].as_str()))
            .then(a["number"].as_u64().cmp(&b["number"].as_u64()))
    });
    let items = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let next = if offset + items.len() < (total.min(1000) as usize) && !items.is_empty() {
        Some(offset + items.len())
    } else {
        None
    };
    Ok(
        json!({"items":items,"total":total,"nextOffset":next,"warnings":warnings,"paginationStability":"live","sort":"updated_desc","source":"github_live"}),
    )
}

pub(super) fn validate_manage_args(args: &Value) -> Result<(), AppError> {
    let object = args
        .as_object()
        .ok_or_else(|| error("PR 변경 입력은 object여야 합니다."))?;
    let action = args["action"]
        .as_str()
        .ok_or_else(|| error("PR action이 필요합니다."))?;
    let fields: &[&str] = match action {
        "create" => &["head", "base", "title", "body", "draft"],
        "update" => &["title", "body", "base"],
        "request_review" => &["reviewers", "teamReviewers"],
        "review" => &["event", "body"],
        "merge" => &["mergeMethod"],
        "close" | "reopen" | "mark_ready" | "convert_to_draft" => &[],
        _ => return Err(error("지원하지 않는 PR action입니다.")),
    };
    if object.keys().any(|key| {
        !["action", "requestId", "repository", "number"].contains(&key.as_str())
            && !fields.contains(&key.as_str())
    }) {
        return Err(error("이 PR action에서 허용하지 않는 입력입니다."));
    }
    if args["requestId"]
        .as_str()
        .is_none_or(|id| id.trim().is_empty() || id.len() > 128)
    {
        return Err(error("유효한 requestId가 필요합니다."));
    }
    if action == "create" {
        for field in ["head", "title"] {
            if args[field].as_str().is_none_or(|s| s.trim().is_empty()) {
                return Err(error(format!("{field}가 필요합니다.")));
            }
        }
        if args.get("number").is_some() {
            return Err(error("PR 생성에는 number를 지정하지 않습니다."));
        }
    } else if args["number"].as_u64().is_none_or(|n| n == 0) {
        return Err(error("대상 PR 번호가 필요합니다."));
    }
    if action == "update"
        && !["title", "body", "base"]
            .iter()
            .any(|key| args.get(key).is_some())
    {
        return Err(error("변경할 PR 필드가 없습니다."));
    }
    for field in ["head", "base", "title"] {
        if args.get(field).is_some() && args[field].as_str().is_none_or(|s| s.trim().is_empty()) {
            return Err(error(format!("{field}는 빈 값일 수 없습니다.")));
        }
    }
    if action == "merge"
        && !matches!(
            args["mergeMethod"].as_str(),
            Some("merge" | "squash" | "rebase")
        )
    {
        return Err(error(
            "mergeMethod로 merge/squash/rebase 중 하나를 명시하세요.",
        ));
    }
    if action == "review" {
        match args["event"].as_str() {
            Some("approve") => {}
            Some("comment" | "request_changes") => {
                if args["body"].as_str().is_none_or(|s| s.trim().is_empty()) {
                    return Err(error("의견·수정 요청에는 본문이 필요합니다."));
                }
            }
            _ => return Err(error("PR review event 값 오류")),
        }
    }
    if action == "request_review" {
        let mut count = 0;
        for field in ["reviewers", "teamReviewers"] {
            if let Some(value) = args.get(field) {
                let list = value
                    .as_array()
                    .ok_or_else(|| error("리뷰 대상은 문자열 목록이어야 합니다."))?;
                for entry in list {
                    let value = entry.as_str().ok_or_else(|| error("리뷰 대상 형식 오류"))?;
                    qualifier_value(value)?;
                    if value.contains('/') {
                        return Err(error("팀은 조직 이름 없이 slug만 지정하세요."));
                    }
                    count += 1;
                }
            }
        }
        if count == 0 {
            return Err(error("리뷰 요청 대상이 필요합니다."));
        }
    }
    Ok(())
}

pub(super) async fn prepare(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    validate_manage_args(args)?;
    let context = runtime.active_context_summary();
    let repository = super::mcp_sources::allowed_repo(
        runtime,
        args["repository"]
            .as_str()
            .or(context.docs_repository_full_name.as_deref()),
        false,
    )?;
    let p: Vec<_> = repository.split('/').collect();
    let github = runtime.build_github_service()?;
    let repo = github.automation_get(&["repos", p[0], p[1]], &[]).await?;
    if repo["permissions"]["push"] != true {
        return Err(error("대상 저장소에 PR 변경 권한이 없습니다."));
    }
    let repository_id = repo["node_id"]
        .as_str()
        .ok_or_else(|| error("저장소 신원을 확인할 수 없습니다."))?;
    let mut changes = args.clone();
    changes["repository"] = json!(repository);
    let action = args["action"].as_str().unwrap();
    let before = if action == "create" {
        let head = args["head"].as_str().unwrap();
        let base = args["base"]
            .as_str()
            .or(repo["default_branch"].as_str())
            .ok_or_else(|| error("대상 기본 브랜치를 확인할 수 없습니다."))?;
        changes["base"] = json!(base);
        let head_commit = github
            .automation_get(&["repos", p[0], p[1], "commits", head], &[])
            .await?;
        let base_commit = github
            .automation_get(&["repos", p[0], p[1], "commits", base], &[])
            .await?;
        super::mcp_sources::require_sha(head_commit["sha"].as_str().unwrap_or(""))?;
        super::mcp_sources::require_sha(base_commit["sha"].as_str().unwrap_or(""))?;
        json!({"headSha":head_commit["sha"],"baseSha":base_commit["sha"]})
    } else {
        let number = args["number"].as_u64().unwrap().to_string();
        let pr = github
            .automation_get(&["repos", p[0], p[1], "pulls", &number], &[])
            .await?;
        let head = pr["head"]["sha"]
            .as_str()
            .ok_or_else(|| error("PR head 커밋을 확인할 수 없습니다."))?;
        super::mcp_sources::require_sha(head)?;
        let state = pr["state"]
            .as_str()
            .ok_or_else(|| error("PR 상태를 확인할 수 없습니다."))?;
        let draft = pr["draft"]
            .as_bool()
            .ok_or_else(|| error("PR draft 상태를 확인할 수 없습니다."))?;
        let merged = pr["merged"]
            .as_bool()
            .ok_or_else(|| error("PR 병합 여부를 확인할 수 없습니다."))?;
        if matches!(
            action,
            "review" | "request_review" | "mark_ready" | "convert_to_draft"
        ) && state != "open"
        {
            return Err(error("열린 PR에서만 실행할 수 있습니다."));
        }
        if matches!(action, "close" | "reopen") && merged {
            return Err(error("병합된 PR을 닫거나 다시 열 수 없습니다."));
        }
        if action == "mark_ready" && !draft {
            return Err(error("이미 검토 준비 상태입니다."));
        }
        if action == "convert_to_draft" && draft {
            return Err(error("이미 초안 상태입니다."));
        }
        if action == "merge" && !merged {
            if state != "open" || draft {
                return Err(error("열린 검토 준비 PR만 병합할 수 있습니다."));
            }
            if pr["mergeable"] != true {
                return Err(error("PR 병합 가능 여부가 불명확하거나 충돌이 있습니다."));
            }
            let field = match args["mergeMethod"].as_str().unwrap() {
                "merge" => "allow_merge_commit",
                "squash" => "allow_squash_merge",
                _ => "allow_rebase_merge",
            };
            if repo[field] != true {
                return Err(error("저장소에서 선택한 병합 방식을 허용하지 않습니다."));
            }
        }
        if action == "review" && args["event"] != "comment" {
            let viewer = github.current_user().await?;
            if pr["user"]["login"]
                .as_str()
                .is_some_and(|author| author.eq_ignore_ascii_case(&viewer.login))
            {
                return Err(error(
                    "자신의 PR에 승인·수정 요청 리뷰를 제출할 수 없습니다.",
                ));
            }
        }
        if action == "request_review" {
            for reviewer in args["reviewers"].as_array().into_iter().flatten() {
                let who = reviewer.as_str().unwrap();
                if pr["user"]["login"]
                    .as_str()
                    .is_some_and(|a| a.eq_ignore_ascii_case(who))
                {
                    return Err(error("PR 작성자에게 리뷰를 요청할 수 없습니다."));
                }
                let permission = github
                    .automation_get(
                        &["repos", p[0], p[1], "collaborators", who, "permission"],
                        &[],
                    )
                    .await?;
                if !permission["permission"]
                    .as_str()
                    .is_some_and(|p| p != "none")
                {
                    return Err(error("저장소에 접근할 수 없는 리뷰 대상입니다."));
                }
            }
            for team in args["teamReviewers"].as_array().into_iter().flatten() {
                github
                    .automation_get(
                        &[
                            "orgs",
                            p[0],
                            "teams",
                            team.as_str().unwrap(),
                            "repos",
                            p[0],
                            p[1],
                        ],
                        &[],
                    )
                    .await?;
            }
        }
        let new_base = if action == "update" {
            if let Some(base) = args["base"].as_str() {
                Some(
                    github
                        .automation_get(&["repos", p[0], p[1], "commits", base], &[])
                        .await?["sha"]
                        .clone(),
                )
            } else {
                None
            }
        } else {
            None
        };
        json!({"nodeId":pr["node_id"],"headSha":head,"baseSha":pr["base"]["sha"],"baseRef":pr["base"]["ref"],"newBaseSha":new_base,"title":pr["title"],"body":pr["body"],"state":state,"draft":draft,"merged":merged,"mergeable":pr["mergeable"],"updatedAt":pr["updated_at"],"authorLogin":pr["user"]["login"],"requestedReviewers":pr["requested_reviewers"],"requestedTeams":pr["requested_teams"]})
    };
    Ok(
        json!({"tool":"okhub_pr_manage","changes":changes,"repositoryNodeId":repository_id,"before":before,"mergeMethod":args["mergeMethod"]}),
    )
}

pub(super) async fn execute(
    runtime: &AutomationRuntime,
    preview: &Value,
) -> Result<Value, AppError> {
    use crate::github::model::AutomationPrMutation as Mutation;
    let args = &preview["changes"];
    let repository = args["repository"].as_str().unwrap();
    let action = args["action"].as_str().unwrap();
    if action == "create" {
        return serde_json::to_value(
            runtime
                .create_pull_request(
                    Some(repository),
                    args["head"].as_str().unwrap(),
                    args["base"].as_str(),
                    args["title"].as_str().unwrap(),
                    args["body"].as_str().unwrap_or(""),
                    args["draft"].as_bool().unwrap_or(false),
                )
                .await?,
        )
        .map_err(|e| error(e.to_string()));
    }
    let number = args["number"].as_u64().unwrap();
    let github = runtime.build_github_service()?;
    let (operation, payload) = match action {
        "update" => {
            let mut payload = json!({});
            for field in ["title", "body", "base"] {
                if let Some(v) = args.get(field) {
                    payload[field] = v.clone();
                }
            }
            (Mutation::Update, payload)
        }
        "close" | "reopen" => (
            Mutation::Update,
            json!({"state":if action=="close"{"closed"}else{"open"}}),
        ),
        "request_review" => (
            Mutation::RequestReview,
            json!({"reviewers":args.get("reviewers").cloned().unwrap_or_else(||json!([])),"team_reviewers":args.get("teamReviewers").cloned().unwrap_or_else(||json!([]))}),
        ),
        "review" => (
            Mutation::Review,
            json!({"event":match args["event"].as_str().unwrap(){"approve"=>"APPROVE","request_changes"=>"REQUEST_CHANGES",_=>"COMMENT"},"body":args["body"].as_str().unwrap_or(""),"commit_id":preview["before"]["headSha"]}),
        ),
        "merge" => {
            if preview["before"]["merged"] == true {
                return Ok(
                    json!({"merged":true,"alreadyMerged":true,"repository":repository,"number":number}),
                );
            }
            (
                Mutation::Merge,
                json!({"merge_method":args["mergeMethod"],"sha":preview["before"]["headSha"]}),
            )
        }
        "mark_ready" | "convert_to_draft" => {
            let id = preview["before"]["nodeId"]
                .as_str()
                .ok_or_else(|| error("PR node ID 누락"))?;
            let query = if action == "mark_ready" {
                "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id isDraft}}}"
            } else {
                "mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{id isDraft}}}"
            };
            return github.graphql_value(query, json!({"id":id})).await;
        }
        _ => return Err(error("지원하지 않는 PR action입니다.")),
    };
    let result = github
        .automation_pr_mutation(repository, number, operation, payload)
        .await?;
    if action == "merge" && result["merged"] != true {
        return Err(error("GitHub에서 병합 완료를 확인하지 못했습니다."));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::automation_test_support::fixture;
    use serde_json::json;

    fn repository() -> Value {
        json!({"node_id":"R","full_name":"acme/docs","default_branch":"main","permissions":{"push":true},"allow_merge_commit":true,"allow_squash_merge":true,"allow_rebase_merge":true})
    }
    fn pull_request() -> Value {
        json!({"node_id":"PR1","number":42,"title":"Login","body":"Ready","state":"open","draft":false,"merged":false,"mergeable":true,"updated_at":"2026-11-22T00:00:00Z","user":{"login":"alice"},"head":{"sha":"a".repeat(40)},"base":{"sha":"b".repeat(40),"ref":"main"},"requested_reviewers":[],"requested_teams":[]})
    }
    fn runtime(dir: &std::path::Path, github: crate::github::GithubService) -> AutomationRuntime {
        let mut r = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        r.test_github = Some(github);
        r
    }

    #[tokio::test]
    async fn independent_review_is_bound_to_the_displayed_commit_and_never_merges() {
        let dir = tempfile::tempdir().unwrap();
        let (github, requests) = fixture(vec![
            ("/repos/acme/docs", repository()),
            ("/repos/acme/docs/pulls/42", pull_request()),
            (
                "/user",
                json!({"id":2,"login":"bob","avatar_url":"https://example.test/avatar"}),
            ),
            (
                "/repos/acme/docs/pulls/42/reviews",
                json!({"id":5,"state":"APPROVED"}),
            ),
        ]);
        let runtime = runtime(dir.path(), github);
        let preview = prepare(
            &runtime,
            &json!({"action":"review","requestId":"r1","number":42,"event":"approve"}),
        )
        .await
        .unwrap();
        let result = execute(&runtime, &preview).await.unwrap();
        assert_eq!(result["state"], "APPROVED");
        let requests = requests.lock().unwrap();
        let (_, payload) = requests.last().unwrap();
        assert_eq!(payload.as_ref().unwrap()["event"], "APPROVE");
        assert_eq!(payload.as_ref().unwrap()["commit_id"], "a".repeat(40));
        assert!(requests.iter().all(|(url, _)| !url.ends_with("/merge")));
    }

    #[tokio::test]
    async fn merge_uses_the_explicit_method_and_expected_head_sha() {
        for method in ["merge", "squash", "rebase"] {
            let dir = tempfile::tempdir().unwrap();
            let (github, requests) = fixture(vec![
                ("/repos/acme/docs", repository()),
                ("/repos/acme/docs/pulls/42", pull_request()),
                (
                    "/repos/acme/docs/pulls/42/merge",
                    json!({"merged":true,"sha":"c".repeat(40)}),
                ),
            ]);
            let runtime = runtime(dir.path(), github);
            let preview = prepare(
                &runtime,
                &json!({"action":"merge","requestId":"m1","number":42,"mergeMethod":method}),
            )
            .await
            .unwrap();
            let result = execute(&runtime, &preview).await.unwrap();
            assert_eq!(result["merged"], true);
            let recorded = requests.lock().unwrap();
            let payload = recorded.last().unwrap().1.as_ref().unwrap();
            assert_eq!(payload["merge_method"], method);
            assert_eq!(payload["sha"], "a".repeat(40));
        }
    }

    #[tokio::test]
    async fn update_review_request_close_reopen_and_draft_actions_stay_separate() {
        for action in [
            "update",
            "request_review",
            "close",
            "reopen",
            "mark_ready",
            "convert_to_draft",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let mut pr = pull_request();
            if action == "reopen" {
                pr["state"] = json!("closed");
            }
            if action == "mark_ready" {
                pr["draft"] = json!(true);
            }
            let mut args = json!({"action":action,"requestId":"one-action","number":42});
            if action == "update" {
                args["title"] = json!("New title");
            }
            if action == "request_review" {
                args["reviewers"] = json!(["bob"]);
            }
            let mut replies = vec![
                ("/repos/acme/docs", repository()),
                ("/repos/acme/docs/pulls/42", pr),
            ];
            if action == "request_review" {
                replies.push((
                    "/repos/acme/docs/collaborators/bob/permission",
                    json!({"permission":"read"}),
                ));
            }
            let endpoint = match action {
                "request_review" => "/repos/acme/docs/pulls/42/requested_reviewers",
                "mark_ready" | "convert_to_draft" => "/graphql",
                _ => "/repos/acme/docs/pulls/42",
            };
            replies.push((endpoint,if action=="mark_ready"{json!({"data":{"markPullRequestReadyForReview":{"pullRequest":{"id":"PR1","isDraft":false}}}})}else if action=="convert_to_draft"{json!({"data":{"convertPullRequestToDraft":{"pullRequest":{"id":"PR1","isDraft":true}}}})}else{json!({"number":42,"state":"open"})}));
            let (github, requests) = fixture(replies);
            let runtime = runtime(dir.path(), github);
            let preview = prepare(&runtime, &args).await.unwrap();
            execute(&runtime, &preview).await.unwrap();
            let requests = requests.lock().unwrap();
            let payload = requests.last().unwrap().1.as_ref().unwrap();
            match action {
                "update" => assert_eq!(payload, &json!({"title":"New title"})),
                "request_review" => assert_eq!(payload["reviewers"], json!(["bob"])),
                "close" => assert_eq!(payload["state"], "closed"),
                "reopen" => assert_eq!(payload["state"], "open"),
                _ => {
                    graphql_parser::parse_query::<String>(payload["query"].as_str().unwrap())
                        .unwrap();
                    assert_eq!(payload["variables"]["id"], "PR1");
                }
            }
            assert!(
                !requests.iter().any(|(url, _)| url.ends_with("/merge")),
                "{action} unexpectedly merged"
            );
        }
    }

    #[tokio::test]
    async fn disallowed_merge_method_draft_unknown_mergeability_and_self_approval_block() {
        for case in ["disallowed", "draft", "unknown", "self-review"] {
            let dir = tempfile::tempdir().unwrap();
            let mut repo = repository();
            let mut pr = pull_request();
            if case == "disallowed" {
                repo["allow_squash_merge"] = json!(false);
            }
            if case == "draft" {
                pr["draft"] = json!(true);
            }
            if case == "unknown" {
                pr["mergeable"] = Value::Null;
            }
            let mut replies = vec![
                ("/repos/acme/docs", repo),
                ("/repos/acme/docs/pulls/42", pr),
            ];
            let args = if case == "self-review" {
                replies.push((
                    "/user",
                    json!({"id":1,"login":"alice","avatar_url":"https://example.test/a"}),
                ));
                json!({"action":"review","requestId":"bad","number":42,"event":"approve"})
            } else {
                json!({"action":"merge","requestId":"bad","number":42,"mergeMethod":"squash"})
            };
            let (github, requests) = fixture(replies);
            assert!(
                prepare(&runtime(dir.path(), github), &args).await.is_err(),
                "{case}"
            );
            assert!(requests
                .lock()
                .unwrap()
                .iter()
                .all(|(url, _)| !url.ends_with("/merge") && !url.ends_with("/reviews")));
        }
    }

    #[test]
    fn merge_requires_an_explicit_method_and_review_is_not_a_merge() {
        assert!(
            validate_manage_args(&json!({"action":"merge","requestId":"m1","number":42})).is_err()
        );
        for method in ["merge", "squash", "rebase"] {
            assert!(validate_manage_args(
                &json!({"action":"merge","requestId":"m1","number":42,"mergeMethod":method})
            )
            .is_ok());
        }
        assert!(validate_manage_args(&json!({"action":"review","requestId":"r1","number":42,"event":"approve","mergeMethod":"squash"})).is_err());
        assert!(validate_manage_args(&json!({"action":"review","requestId":"r1","number":42,"event":"request_changes","body":""})).is_err());
        assert!(validate_manage_args(
            &json!({"action":"update","requestId":"u1","number":42,"state":"closed"})
        )
        .is_err());
    }

    #[tokio::test]
    async fn combined_pr_search_cap_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let mut replies = Vec::new();
        for repo in ["acme/api", "acme/docs"] {
            let path = if repo == "acme/api" {
                "/repos/acme/api"
            } else {
                "/repos/acme/docs"
            };
            replies.push((path, json!({"full_name":repo})));
            let node = json!({"number":1,"title":"PR","state":"OPEN","isDraft":false,"headRefOid":"a".repeat(40),"repository":{"nameWithOwner":repo},"reviewDecision":"APPROVED","reviewRequests":{"nodes":[],"pageInfo":{"hasNextPage":false}},"commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"SUCCESS"}}}]}});
            replies.push(("/graphql",json!({"data":{"search":{"issueCount":700,"nodes":[node.clone(),node],"pageInfo":{"hasNextPage":true,"endCursor":"next"}}}})));
        }
        let (github, _) = fixture(replies);
        let mut runtime = runtime(dir.path(), github);
        runtime.ai_context.code_repositories.push(
            crate::settings::ai_runner::LinkedCodeRepoRuleInfo {
                key: "backend".into(),
                label: "Backend".into(),
                full_name: "acme/api".into(),
                local_path: None,
            },
        );
        let result = list(&runtime, &json!({"repositories":"all","limit":1}))
            .await
            .unwrap();
        assert_eq!(result["total"], 1400);
        assert!(result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["reason"] == "combined_search_result_cap"));
        graphql_parser::parse_query::<String>(PR_SEARCH).unwrap();
    }

    #[tokio::test]
    async fn pr_search_filters_and_reports_unknown_review_and_check_state() {
        let dir = tempfile::tempdir().unwrap();
        let (github, requests) = fixture(vec![
            (
                "/repos/acme/docs",
                json!({"node_id":"R","full_name":"acme/docs"}),
            ),
            (
                "/graphql",
                json!({"data":{"search":{"issueCount":1,"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"PR1","number":42,"title":"Login","state":"OPEN","isDraft":false,"updatedAt":"2026-11-22T00:00:00Z","url":"https://github.com/acme/docs/pull/42","headRefOid":"a".repeat(40),"repository":{"nameWithOwner":"acme/docs"},"author":{"login":"alice"},"reviewDecision":null,"reviewRequests":{"nodes":[],"pageInfo":{"hasNextPage":false}},"commits":{"nodes":[]}}]}}}),
            ),
        ]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        let result = list(&runtime, &json!({"reviewRequestedFor":"bob","draft":false}))
            .await
            .unwrap();
        assert_eq!(result["items"][0]["state"], "open");
        assert_eq!(result["items"][0]["reviewDecision"], "unknown");
        assert_eq!(result["items"][0]["checksSummary"], "unknown");
        let recorded = requests.lock().unwrap();
        let query = recorded[1].1.as_ref().unwrap()["variables"]["query"]
            .as_str()
            .unwrap();
        assert!(query.contains("repo:acme/docs"));
        assert!(query.contains("is:open"));
        assert!(query.contains("review-requested:bob"));
        assert!(query.contains("draft:false"));
    }

    #[tokio::test]
    async fn pr_search_cannot_return_a_repository_outside_the_selected_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let (github, _) = fixture(vec![
            (
                "/repos/acme/docs",
                json!({"node_id":"R","full_name":"acme/docs"}),
            ),
            (
                "/graphql",
                json!({"data":{"search":{"issueCount":1,"pageInfo":{"hasNextPage":false},"nodes":[{"id":"OTHER","number":1,"repository":{"nameWithOwner":"evil/secret"}}]}}}),
            ),
        ]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        assert!(list(&runtime, &json!({})).await.is_err());
    }
}
