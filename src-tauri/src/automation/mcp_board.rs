use super::context_pack::{
    map_item_layer, map_item_status, parse_board_layer_arg, parse_board_status_arg,
};
use super::{mcp_sdk::error, AutomationRuntime};
use crate::error::AppError;
use crate::github::{model::GithubProjectSchema, GithubService};
use crate::project_board::model::BoardStatus;
use serde_json::{json, Value};

const ENRICHMENT_QUERY: &str = r#"
query($ids:[ID!]!) {
  nodes(ids:$ids) {
    ... on ProjectV2Item {
      id
      fieldValues(first:100) {
        nodes {
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id name } } }
          ... on ProjectV2ItemFieldIterationValue { title startDate duration iterationId field { ... on ProjectV2IterationField { id name } } }
        }
        pageInfo { hasNextPage }
      }
      content { ... on Issue { closedByPullRequestsReferences(first:100,includeClosedPrs:true) { nodes { number url merged mergedAt headRefOid repository { nameWithOwner } } pageInfo { hasNextPage } } } }
    }
  }
}
"#;

pub(super) fn is_due_field(name: &str) -> bool {
    ["due date", "due", "deadline", "마감일"]
        .iter()
        .any(|s| name.trim().eq_ignore_ascii_case(s))
}

pub(super) async fn schema(
    runtime: &AutomationRuntime,
    github: &GithubService,
) -> Result<GithubProjectSchema, AppError> {
    let project = runtime.require_project()?;
    github
        .inspect_project_schema(project.scope, &project.owner, project.number)
        .await
}

pub(super) async fn resolve_issue_repository(
    runtime: &AutomationRuntime,
    number: u64,
) -> Result<String, AppError> {
    let project = runtime.require_project()?;
    let github = runtime.build_github_service()?;
    let (items, truncated, dropped, _) = github
        .list_project_items_with_fallback(project.scope, &project.owner, project.number)
        .await?;
    if truncated || dropped > 0 {
        return Err(error(
            "번호만으로 대상을 확정할 수 없습니다. repository를 함께 지정하세요.",
        ));
    }
    let mut repositories: Vec<_> = items
        .iter()
        .filter(|item| item.number == number)
        .filter_map(|item| item.infer_repository_full_name())
        .map(|r| r.to_ascii_lowercase())
        .collect();
    repositories.sort();
    repositories.dedup();
    if repositories.len() != 1 {
        return Err(error(
            "Issue 번호가 없거나 여러 저장소에 있습니다. repository를 함께 지정하세요.",
        ));
    }
    super::mcp_sources::allowed_repo(runtime, Some(&repositories[0]), false)
}

pub(super) async fn target_item(
    github: &GithubService,
    repository: &str,
    number: u64,
    project_id: &str,
) -> Result<Value, AppError> {
    let p: Vec<_> = repository.split('/').collect();
    let mut after = Value::Null;
    let mut seen = std::collections::HashSet::new();
    let mut matches = Vec::new();
    loop {
        let data=github.graphql_value(r#"
query($owner:String!,$name:String!,$number:Int!,$after:String){
 repository(owner:$owner,name:$name){issue(number:$number){projectItems(first:100,after:$after){
  nodes{id project{id} fieldValues(first:100){nodes{
   ... on ProjectV2ItemFieldSingleSelectValue{name optionId field{... on ProjectV2SingleSelectField{id name}}}
   ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{id name}}}
   ... on ProjectV2ItemFieldIterationValue{title startDate duration iterationId field{... on ProjectV2IterationField{id name}}}
  } pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}
 }}}
}
"#,json!({"owner":p[0],"name":p[1],"number":number,"after":after})).await?;
        let connection = &data["repository"]["issue"]["projectItems"];
        let nodes = connection["nodes"]
            .as_array()
            .ok_or_else(|| error("Issue의 Project 연결을 조회할 수 없습니다."))?;
        matches.extend(
            nodes
                .iter()
                .filter(|node| node["project"]["id"] == project_id)
                .cloned(),
        );
        if connection["pageInfo"]["hasNextPage"] != true {
            break;
        }
        let cursor = connection["pageInfo"]["endCursor"]
            .as_str()
            .ok_or_else(|| error("Project 연결 페이지 정보 누락"))?;
        if !seen.insert(cursor.to_owned()) {
            return Err(error("Project 연결 페이지가 반복되었습니다."));
        }
        after = json!(cursor);
    }
    if matches.len() != 1 {
        return Err(error(
            "설정된 Project에서 Issue 연결을 유일하게 찾을 수 없습니다.",
        ));
    }
    let item = &matches[0];
    if item["fieldValues"]["pageInfo"]["hasNextPage"] == true {
        return Err(error("대상 Issue의 필드 조회가 잘렸습니다."));
    }
    let fields = item["fieldValues"]["nodes"]
        .as_array()
        .ok_or_else(|| error("Project 항목 필드 조회 실패"))?;
    let select = |names: &[&str]| {
        fields
            .iter()
            .find(|f| {
                f["field"]["name"].as_str().is_some_and(|name| {
                    names.iter().any(|wanted| name.eq_ignore_ascii_case(wanted))
                })
            })
            .map(|f| f["name"].clone())
            .unwrap_or(Value::Null)
    };
    let due: Vec<_> = fields
        .iter()
        .filter(|f| f["field"]["name"].as_str().is_some_and(is_due_field))
        .collect();
    Ok(
        json!({"itemId":item["id"],"repositoryFullName":repository,"number":number,"status":select(&["Status","상태"]),"area":select(&["Area","Layer","영역"]),"kind":select(&["Type","Kind","타입"]),"priority":select(&["Priority","우선순위","중요도"]),"dueDate":if due.len()==1{due[0]["date"].clone()}else{Value::Null},"scheduleFields":fields,"scheduleAvailable":true,"fieldsTruncated":false}),
    )
}

pub(super) async fn date_field(
    github: &GithubService,
    project_id: &str,
) -> Result<Option<String>, AppError> {
    let data = github.graphql_value("query($id:ID!){node(id:$id){... on ProjectV2{fields(first:100){nodes{... on ProjectV2Field{id name dataType}} pageInfo{hasNextPage}}}}}",json!({"id":project_id})).await?;
    let fields = &data["node"]["fields"];
    if fields["pageInfo"]["hasNextPage"] == true {
        return Err(error(
            "Project 필드가 잘려 마감일 필드를 확정할 수 없습니다.",
        ));
    }
    let matches: Vec<_> = fields["nodes"]
        .as_array()
        .ok_or_else(|| error("Project 필드 조회 실패"))?
        .iter()
        .filter(|f| f["dataType"] == "DATE" && f["name"].as_str().is_some_and(is_due_field))
        .collect();
    if matches.len() > 1 {
        return Err(error(
            "마감일 필드가 여러 개여서 변경 대상을 확정할 수 없습니다.",
        ));
    }
    Ok(matches
        .first()
        .and_then(|f| f["id"].as_str())
        .map(str::to_owned))
}

pub(super) async fn list(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    if args["readyOnly"] == true
        && args["status"]
            .as_str()
            .is_some_and(|status| parse_board_status_arg(status) != Some(BoardStatus::Ready))
    {
        return Err(error(
            "readyOnly=true와 Ready 이외의 status를 함께 지정할 수 없습니다.",
        ));
    }
    let project = runtime.require_project()?;
    let github = runtime.build_github_service()?;
    if args["readyOnly"] == true
        && schema(runtime, &github)
            .await?
            .find_status_option(BoardStatus::Ready)
            .is_none()
    {
        return Err(error("연결 Project에 Ready 상태 옵션이 없습니다."));
    }
    let (items, truncated, dropped, scope) = github
        .list_project_items_with_fallback(project.scope, &project.owner, project.number)
        .await?;
    let layer = args["layer"]
        .as_str()
        .map(|s| parse_board_layer_arg(s).ok_or_else(|| error("영역 값 오류")))
        .transpose()?;
    let status = args["status"]
        .as_str()
        .map(|s| parse_board_status_arg(s).ok_or_else(|| error("상태 값 오류")))
        .transpose()?;
    let mut details = std::collections::HashMap::new();
    let mut warnings = Vec::new();
    let ids: Vec<_> = items.iter().filter_map(|i| i.item_id.as_ref()).collect();
    for chunk in ids.chunks(100) {
        let data = github
            .graphql_value(ENRICHMENT_QUERY, json!({"ids":chunk}))
            .await;
        match data {
            Ok(data) => {
                for node in data["nodes"].as_array().into_iter().flatten() {
                    if let Some(id) = node["id"].as_str() {
                        details.insert(id.to_owned(), node.clone());
                    }
                }
            }
            Err(e) => warnings.push(json!({"source":"schedule_and_linked_prs","error":e.message})),
        }
    }
    let mut rows = Vec::new();
    for item in &items {
        if layer.is_some_and(|l| map_item_layer(item.area.as_deref(), &item.labels) != l)
            || status.is_some_and(|s| map_item_status(item.status.as_deref()) != Some(s))
        {
            continue;
        }
        if args["assignee"].as_str().is_some_and(|who| {
            !item
                .assignees
                .iter()
                .any(|a| a.login.eq_ignore_ascii_case(who.trim_start_matches('@')))
        }) {
            continue;
        }
        let ready = ready_filter_matches(item, &items);
        if args["readyOnly"] == true && !ready {
            continue;
        }
        let detail = item.item_id.as_ref().and_then(|id| details.get(id));
        let fields: Vec<Value> = detail
            .and_then(|v| v["fieldValues"]["nodes"].as_array())
            .map(|v| {
                v.iter()
                    .filter(|f| f.get("date").is_some() || f.get("iterationId").is_some())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let due_values: Vec<_> = fields
            .iter()
            .filter(|f| f["field"]["name"].as_str().is_some_and(is_due_field))
            .collect();
        let due = if due_values.len() == 1 {
            due_values[0]["date"].clone()
        } else {
            Value::Null
        };
        if let Some(before) = args["dueBefore"].as_str() {
            validate_date(before)?;
            if due.as_str().is_none_or(|d| d > before) {
                continue;
            }
        }
        let mut row = serde_json::to_value(item).map_err(|e| error(e.to_string()))?;
        row["dueDate"] = due;
        row["scheduleFields"] = json!(fields);
        if args["includeDependencies"] == true {
            row["dependencyCheck"] = dependency_check(item, &items, truncated || dropped > 0);
        }
        row["scheduleAvailable"] = json!(detail.is_some());
        row["fieldsTruncated"] =
            json!(detail.is_some_and(|d| d["fieldValues"]["pageInfo"]["hasNextPage"] == true));
        row["linkedPullRequests"] = detail
            .map(|d| d["content"]["closedByPullRequestsReferences"].clone())
            .unwrap_or(Value::Null);
        rows.push(row);
    }
    Ok(
        json!({"items":rows,"truncated":truncated,"droppedItems":dropped,"resolvedScope":scope,"warnings":warnings,"source":"github_live"}),
    )
}

fn ready_filter_matches(
    item: &crate::github::model::GithubProjectItem,
    _items: &[crate::github::model::GithubProjectItem],
) -> bool {
    map_item_status(item.status.as_deref()) == Some(BoardStatus::Ready)
}

fn dependency_check(
    item: &crate::github::model::GithubProjectItem,
    items: &[crate::github::model::GithubProjectItem],
    incomplete: bool,
) -> Value {
    let own_repo = item.infer_repository_full_name().unwrap_or_default();
    let body = item.body.as_deref().unwrap_or_default();
    let references = body
        .lines()
        .filter(|line| line.trim().starts_with("이전 단계:"))
        .count();
    if references > 1 {
        return json!({"status":"unknown","reason":"multiple_predecessor_references","references":[],"complete":false});
    }
    let dependency = match dependency_ref(body, &own_repo) {
        Ok(dep) => dep,
        Err(_) => {
            return json!({"status":"unknown","reason":"invalid_predecessor_reference","references":[],"complete":false})
        }
    };
    let source = if dependency.is_some() {
        "issue_body_reference"
    } else {
        "depends_on_field"
    };
    let dependency = dependency.or_else(|| item.depends_on.map(|number| (own_repo, number)));
    if let Some((repo, dep)) = dependency {
        let predecessors: Vec<_> = items
            .iter()
            .filter(|p| {
                p.number == dep
                    && p.infer_repository_full_name()
                        .is_some_and(|r| r.eq_ignore_ascii_case(&repo))
            })
            .collect();
        let status = if predecessors.len() != 1 {
            "unknown"
        } else {
            match map_item_status(predecessors[0].status.as_deref()) {
                Some(BoardStatus::Done) if !incomplete => "satisfied",
                Some(BoardStatus::Done) | None => "unknown",
                _ => "blocked",
            }
        };
        json!({"status":status,"references":[{"repository":repo,"number":dep,"projectStatus":predecessors.first().and_then(|p|p.status.as_deref()),"source":source}],"complete":status!="unknown","reason":if status=="unknown"{Some("missing_ambiguous_or_incomplete_lookup")}else{None}})
    } else {
        json!({"status":"not_configured","references":[],"complete":true,"note":"등록된 참조 없음은 실제 선행 작업 없음의 보증이 아닙니다."})
    }
}

fn dependency_ref(body: &str, own_repo: &str) -> Result<Option<(String, u64)>, AppError> {
    for line in body.lines() {
        if let Some(reference) = line.trim().strip_prefix("이전 단계:") {
            let reference = reference.trim();
            let (repo, number) = reference
                .rsplit_once('#')
                .ok_or_else(|| error("선행 Issue 참조 형식 오류"))?;
            let number = number
                .trim()
                .parse::<u64>()
                .map_err(|_| error("선행 Issue 번호 오류"))?;
            let repo = if repo.trim().is_empty() {
                own_repo
            } else {
                repo.trim()
            };
            if number == 0 || repo.split('/').count() != 2 {
                return Err(error("선행 Issue 식별이 모호합니다."));
            }
            return Ok(Some((repo.to_ascii_lowercase(), number)));
        }
    }
    Ok(None)
}

pub(super) fn validate_date(date: &str) -> Result<(), AppError> {
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]")
        .map_err(|e| error(e.to_string()))?;
    time::Date::parse(date, &format)
        .map(|_| ())
        .map_err(|_| error("날짜는 유효한 YYYY-MM-DD여야 합니다."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::model::GithubProjectItem;
    fn item(
        repo: &str,
        number: u64,
        status: &str,
        body: &str,
        depends_on: Option<u64>,
    ) -> GithubProjectItem {
        GithubProjectItem {
            item_id: None,
            content_id: None,
            number,
            title: "Task".into(),
            url: format!("https://github.com/{repo}/issues/{number}"),
            body: Some(body.into()),
            repository_full_name: Some(repo.into()),
            labels: vec![],
            status: Some(status.into()),
            area: None,
            kind: None,
            priority: None,
            depends_on,
            sub_issues: vec![],
            assignees: vec![],
            created_at: None,
            updated_at: None,
            linked_doc_paths: vec![],
        }
    }
    #[test]
    fn actual_enrichment_query_parses_and_includes_closed_prs() {
        graphql_parser::parse_query::<String>(ENRICHMENT_QUERY).unwrap();
        assert!(ENRICHMENT_QUERY.contains("includeClosedPrs:true"));
    }
    #[test]
    fn predecessor_is_resolved_by_repository_not_only_number() {
        let child = item("acme/web", 8, "Backlog", "이전 단계: acme/api#7", Some(7));
        let wrong = item("acme/web", 7, "Done", "", None);
        let actual = item("acme/api", 7, "In progress", "", None);
        assert_eq!(
            dependency_check(&child, &[wrong, actual], false)["status"],
            "blocked"
        );
        assert_eq!(
            dependency_check(
                &child,
                &[
                    item("acme/web", 7, "Backlog", "", None),
                    item("acme/api", 7, "Done", "", None)
                ],
                false
            )["status"],
            "satisfied"
        );
    }

    #[test]
    fn ready_filter_is_project_status_not_backlog_or_dependency_completion() {
        let ready = item("acme/web", 8, "Ready", "이전 단계: acme/api#7", None);
        let blocked = item("acme/api", 7, "In progress", "", None);
        assert!(ready_filter_matches(&ready, &[blocked]));
        let backlog = item("acme/web", 9, "Backlog", "이전 단계: acme/api#7", None);
        assert!(!ready_filter_matches(
            &backlog,
            &[item("acme/api", 7, "Done", "", None)]
        ));
    }

    #[test]
    fn dependency_absence_uncertainty_and_blocked_are_distinct() {
        assert_eq!(
            dependency_check(&item("acme/web", 8, "Ready", "", None), &[], false)["status"],
            "not_configured"
        );
        let task = item("acme/web", 8, "Ready", "이전 단계: acme/api#7", None);
        assert_eq!(dependency_check(&task, &[], false)["status"], "unknown");
        assert_eq!(
            dependency_check(&task, &[item("acme/api", 7, "Done", "", None)], true)["status"],
            "unknown"
        );
        assert_eq!(
            dependency_check(
                &task,
                &[item("acme/api", 7, "In progress", "", None)],
                false
            )["status"],
            "blocked"
        );
        assert_eq!(
            dependency_check(&task, &[item("acme/api", 7, "Done", "", None)], false)["status"],
            "satisfied"
        );
    }
}
