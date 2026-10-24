use super::*;
#[test]
fn mappings_use_ids_and_never_infer_progress_from_names() {
    let project = Project {
        id: "P".into(),
        title: "Hub".into(),
        url: "https://github.com/orgs/acme/projects/1".into(),
        fields: vec![
            ProjectField {
                id: "status".into(),
                name: "상태".into(),
                kind: "SINGLE_SELECT".into(),
                options: vec![ProjectOption {
                    id: "work".into(),
                    name: "Whatever".into(),
                }],
            },
            ProjectField {
                id: "date".into(),
                name: "마감".into(),
                kind: "DATE".into(),
                options: vec![],
            },
        ],
    };
    let prefs = Preferences {
        project_id: "P".into(),
        status_field_id: "status".into(),
        in_progress_option_ids: vec!["work".into()],
        due_date_field_id: Some("date".into()),
    };
    assert!(validate_preferences(&project, &prefs).is_ok());
    assert!(validate_preferences(
        &project,
        &Preferences {
            in_progress_option_ids: vec!["In progress".into()],
            ..prefs.clone()
        }
    )
    .is_err());
    assert!(validate_preferences(
        &project,
        &Preferences {
            due_date_field_id: Some("status".into()),
            ..prefs
        }
    )
    .is_err());
}

use std::collections::VecDeque;
use std::sync::Mutex;
struct Script(Mutex<VecDeque<(&'static str, Value, Value)>>);
#[async_trait]
impl Source for Script {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, AppError> {
        if query.contains("HomeRepositoryAccess")
            && self.0.lock().unwrap().front().map(|s| s.0) != Some("HomeRepositoryAccess")
        {
            return Ok(
                json!({"repository":{"nameWithOwner":format!("{}/{}",variables["owner"].as_str().unwrap(),variables["name"].as_str().unwrap()),"issues":{"totalCount":0},"pullRequests":{"totalCount":0}}}),
            );
        }
        let (expected, vars, response) = self
            .0
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected extra network request");
        assert!(query.contains(expected), "{expected}: {query}");
        for (key, value) in vars.as_object().unwrap() {
            assert_eq!(&variables[key], value, "query variable {key}")
        }
        if response == json!("network-error") {
            Err(unavailable())
        } else {
            Ok(response)
        }
    }
}
fn script(steps: Vec<(&'static str, Value, Value)>) -> Script {
    Script(Mutex::new(steps.into()))
}
fn connection(values: Vec<Value>, next: Option<&str>) -> Value {
    json!({"nodes":values,"pageInfo":{"hasNextPage":next.is_some(),"endCursor":next}})
}
fn issue(id: &str) -> Value {
    json!({"__typename":"Issue","issueState":"OPEN","assignees":{"nodes":[{"login":"alice"}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"id":id,"title":id,"number":1,"url":"https://github.com/acme/docs/issues/1","updatedAt":"2026-10-24T00:00:00Z","repository":{"nameWithOwner":"acme/docs"}})
}
fn search_page(values: Vec<Value>, count: usize, next: Option<&str>) -> Value {
    let mut c = connection(values, next);
    c["issueCount"] = json!(count);
    json!({"search":c})
}
#[tokio::test]
async fn personal_lists_fetch_every_page_and_scope_queries_to_workspace_repositories() {
    let source = script(vec![
        (
            "HomeSearch",
            json!({"query":"is:pr is:open review-requested:alice repo:acme/docs"}),
            search_page(vec![], 0, None),
        ),
        (
            "HomeSearch",
            json!({"after":null}),
            search_page(vec![issue("one")], 2, Some("next")),
        ),
        (
            "HomeSearch",
            json!({"after":"next"}),
            search_page(vec![issue("two")], 2, None),
        ),
    ]);
    let result = load(
        &source,
        "scope".into(),
        "alice",
        &["acme/docs".into()],
        None,
        None,
        0,
    )
    .await;
    assert!(!result.tasks_error);
    assert_eq!(result.issues.len(), 2);
    assert_eq!(result.issues[0]["dueDate"], Value::Null);
    assert!(source.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn capped_or_partial_search_is_an_error_never_confirmed_empty() {
    let source = script(vec![(
        "HomeSearch",
        json!({}),
        search_page(vec![], 1001, None),
    )]);
    let result = load(
        &source,
        "scope".into(),
        "alice",
        &["acme/docs".into()],
        None,
        None,
        0,
    )
    .await;
    assert!(result.tasks_error);
    assert!(result.reviews.is_empty());
    assert!(result.issues.is_empty());
    let source = script(vec![(
        "HomeSearch",
        json!({}),
        search_page(vec![issue("one")], 2, None),
    )]);
    assert!(
        load(
            &source,
            "scope".into(),
            "alice",
            &["acme/docs".into()],
            None,
            None,
            0
        )
        .await
        .tasks_error
    );
}
#[tokio::test]
async fn current_review_request_uses_latest_matching_event_across_pages_not_pr_updated_time() {
    let source = script(vec![
        (
            "HomeReviewers",
            json!({"after":null}),
            json!({"node":{"reviewRequests":connection(vec![json!({"requestedReviewer":{"id":"alice-id","login":"alice"}})],None)}}),
        ),
        (
            "HomeRequestTimes",
            json!({"after":null}),
            json!({"node":{"timelineItems":connection(vec![json!({"createdAt":"2026-10-20T00:00:00Z","requestedReviewer":{"id":"alice-id"},"actor":{"login":"old-requester"}})],Some("events-2"))}}),
        ),
        (
            "HomeRequestTimes",
            json!({"after":"events-2"}),
            json!({"node":{"timelineItems":connection(vec![json!({"createdAt":"2026-10-23T00:00:00Z","requestedReviewer":{"id":"alice-id"},"actor":{"login":"current-requester"}})],None)}}),
        ),
    ]);
    let requests = review_request_rows(review_requests(&source, "pr-id").await.unwrap());
    assert_eq!(
        requests,
        vec![(
            "alice".into(),
            Some("2026-10-23T00:00:00Z".into()),
            Some("current-requester".into())
        )]
    );
}
#[tokio::test]
async fn a_repeating_cursor_and_null_visible_item_are_not_silently_accepted() {
    let source = script(vec![
        (
            "HomeSearch",
            json!({}),
            search_page(vec![issue("one")], 2, Some("same")),
        ),
        (
            "HomeSearch",
            json!({}),
            search_page(vec![issue("two")], 2, Some("same")),
        ),
    ]);
    assert!(search(&source, "q".into()).await.is_err());
    let source = script(vec![(
        "HomeSearch",
        json!({}),
        search_page(vec![Value::Null], 1, None),
    )]);
    assert!(search(&source, "q".into()).await.is_err());
}
#[tokio::test]
async fn missing_request_time_stays_missing_and_empty_requests_do_not_read_timeline() {
    let source = script(vec![
        (
            "HomeReviewers",
            json!({}),
            json!({"node":{"reviewRequests":connection(vec![json!({"requestedReviewer":{"id":"u","login":"alice"}})],None)}}),
        ),
        (
            "HomeRequestTimes",
            json!({}),
            json!({"node":{"timelineItems":connection(vec![],None)}}),
        ),
    ]);
    assert_eq!(
        review_request_rows(review_requests(&source, "pr").await.unwrap()),
        vec![("alice".into(), None, None)]
    );
    let source = script(vec![(
        "HomeReviewers",
        json!({}),
        json!({"node":{"reviewRequests":connection(vec![],None)}}),
    )]);
    assert!(review_requests(&source, "pr").await.unwrap().is_empty());
}

#[test]
fn opening_home_resources_cannot_escape_github_issue_and_pull_pages() {
    assert!(valid_resource_url("https://github.com/acme/docs/pull/12"));
    assert!(valid_resource_url(
        "https://github.com/acme/docs/issues/12#issuecomment-1"
    ));
    for url in [
        "https://github.com/login?return_to=https://evil.test",
        "https://github.com/acme/docs/settings",
        "https://github.com/acme/docs/pull/1?token=secret",
        "https://github.com.evil.test/acme/docs/issues/1",
    ] {
        assert!(!valid_resource_url(url));
    }
}
#[tokio::test]
async fn mapped_project_fields_drive_dates_and_analysis_without_status_name_guessing() {
    let fields = vec![
        json!({"id":"S","name":"Work","dataType":"SINGLE_SELECT","options":[{"id":"W","name":"Custom status"}]}),
        json!({"id":"D","name":"Deadline","dataType":"DATE"}),
    ];
    let p = json!({"node":{"__typename":"ProjectV2","id":"P","title":"Hub","url":"https://github.com/orgs/acme/projects/1","fields":connection(fields,None)}});
    let mut content = issue("one");
    content["issueState"] = json!("OPEN");
    let item = json!({"id":"item-1","isArchived":false,"content":content,"status":{"optionId":"W","name":"Custom status"},"due":{"date":"2026-10-25"}});
    let source = script(vec![
        ("HomeProject", json!({"id":"P"}), p),
        (
            "HomeItems",
            json!({"status":"Work","due":"Deadline"}),
            json!({"node":{"items":connection(vec![item],None)}}),
        ),
        ("HomeSearch", json!({}), search_page(vec![], 0, None)),
        (
            "HomeSearch",
            json!({}),
            search_page(vec![issue("one")], 1, None),
        ),
    ]);
    let prefs = Preferences {
        project_id: "P".into(),
        status_field_id: "S".into(),
        in_progress_option_ids: vec!["W".into()],
        due_date_field_id: Some("D".into()),
    };
    let result = load(
        &source,
        "scope".into(),
        "alice",
        &["acme/docs".into()],
        Some("P"),
        Some(prefs),
        0,
    )
    .await;
    assert!(!result.tasks_error);
    assert!(!result.analysis_error);
    assert_eq!(result.issues[0]["dueDate"], "2026-10-25");
    assert_eq!(result.issues[0]["projectStatus"], "Custom status");
    assert_eq!(
        result.analysis.unwrap()["inProgressIssues"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn a_stale_search_hit_is_not_a_current_personal_review_request() {
    let source = script(vec![
        (
            "HomeSearch",
            json!({}),
            search_page(vec![pull_request("old-search-pr")], 1, None),
        ),
        (
            "HomeReviewers",
            json!({}),
            json!({"node":{"reviewRequests":connection(vec![],None)}}),
        ),
        ("HomeSearch", json!({}), search_page(vec![], 0, None)),
    ]);
    let result = load(
        &source,
        "scope".into(),
        "alice",
        &["acme/docs".into()],
        None,
        None,
        0,
    )
    .await;
    assert!(!result.tasks_error);
    assert!(
        result.reviews.is_empty(),
        "search index must not override current review requests"
    );
}

#[tokio::test]
async fn unavailable_historical_reviewers_do_not_hide_current_requests() {
    let source = script(vec![
        (
            "HomeReviewers",
            json!({}),
            json!({"node":{"reviewRequests":connection(vec![json!({"requestedReviewer":{"id":"current","login":"alice"}})],None)}}),
        ),
        (
            "HomeRequestTimes",
            json!({}),
            json!({"node":{"timelineItems":connection(vec![json!({"createdAt":"2026-10-19T00:00:00Z","requestedReviewer":null,"actor":{"login":"old"}}),json!({"createdAt":"2026-10-23T00:00:00Z","requestedReviewer":{"id":"current"},"actor":{"login":"bob"}})],None)}}),
        ),
    ]);
    assert_eq!(
        review_request_rows(review_requests(&source, "pr").await.unwrap()),
        vec![(
            "alice".into(),
            Some("2026-10-23T00:00:00Z".into()),
            Some("bob".into())
        )]
    );
}
#[test]
fn both_review_queries_cover_enterprise_team_ids() {
    for query in [queries::REQUESTS, queries::EVENTS] {
        assert!(query.contains("... on EnterpriseTeam{id}"));
    }
}

fn review_request_rows(
    requests: Vec<CurrentReviewRequest>,
) -> Vec<(String, Option<String>, Option<String>)> {
    requests
        .into_iter()
        .map(|r| (r.login.unwrap_or(r.id), r.requested_at, r.requester))
        .collect()
}

#[tokio::test]
async fn personal_team_requests_require_live_membership_not_a_stale_search_match() {
    for member in [true, false] {
        let mut pr = pull_request("pr");
        pr["__typename"] = json!("PullRequest");
        let source = script(vec![
            ("HomeSearch", json!({}), search_page(vec![pr], 1, None)),
            (
                "HomeReviewers",
                json!({}),
                json!({"node":{"reviewRequests":connection(vec![json!({"requestedReviewer":{"__typename":"EnterpriseTeam","id":"ET"}})],None)}}),
            ),
            (
                "HomeRequestTimes",
                json!({}),
                json!({"node":{"timelineItems":connection(vec![json!({"createdAt":"2026-10-23T00:00:00Z","requestedReviewer":{"id":"ET"},"actor":{"login":"bob"}})],None)}}),
            ),
            (
                "HomeTeamMembership",
                json!({"id":"ET","login":"alice"}),
                json!({"node":{"__typename":"EnterpriseTeam","isViewerMember":member}}),
            ),
            ("HomeSearch", json!({}), search_page(vec![], 0, None)),
        ]);
        let result = load(
            &source,
            "scope".into(),
            "alice",
            &["acme/docs".into()],
            None,
            None,
            0,
        )
        .await;
        assert!(!result.tasks_error);
        assert_eq!(result.reviews.len(), usize::from(member));
    }
}
#[tokio::test]
async fn organization_team_membership_pages_are_exact_not_fuzzy_name_matches() {
    let source = script(vec![
        (
            "HomeTeamMembership",
            json!({"after":null}),
            json!({"node":{"__typename":"Team","members":connection(vec![json!({"login":"alice-other"})],Some("next"))}}),
        ),
        (
            "HomeTeamMembership",
            json!({"after":"next"}),
            json!({"node":{"__typename":"Team","members":connection(vec![json!({"login":"Alice"})],None)}}),
        ),
    ]);
    assert!(viewer_is_team_member(&source, "T", "alice").await.unwrap());
}

#[tokio::test]
async fn closed_or_reassigned_issue_search_hits_are_not_current_assignments() {
    for closed in [true, false] {
        let mut item = issue("stale-issue");
        item["issueState"] = json!(if closed { "CLOSED" } else { "OPEN" });
        item["assignees"] = connection(vec![json!({"login":"bob"})], None);
        let source = script(vec![
            ("HomeSearch", json!({}), search_page(vec![], 0, None)),
            ("HomeSearch", json!({}), search_page(vec![item], 1, None)),
        ]);
        let result = load(
            &source,
            "scope".into(),
            "alice",
            &["acme/docs".into()],
            None,
            None,
            0,
        )
        .await;
        assert!(!result.tasks_error);
        assert!(result.issues.is_empty());
    }
}

fn pull_request(id: &str) -> Value {
    let mut value = issue(id);
    value["__typename"] = json!("PullRequest");
    value["pullRequestState"] = json!("OPEN");
    value
}

#[tokio::test]
async fn an_unreadable_scoped_repository_is_not_reported_as_no_personal_work() {
    let source = script(vec![(
        "HomeRepositoryAccess",
        json!({"owner":"acme","name":"docs"}),
        json!({"repository":null}),
    )]);
    let result = load(
        &source,
        "scope".into(),
        "alice",
        &["acme/docs".into()],
        None,
        None,
        0,
    )
    .await;
    assert!(result.tasks_error);
    assert!(source.0.lock().unwrap().is_empty());
}
