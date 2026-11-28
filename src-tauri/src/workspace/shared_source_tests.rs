use super::*;
use crate::github::automation_test_support::{fixture, fixture_http, Replies};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEXT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
fn source() -> WorkspaceSourceRef {
    WorkspaceSourceRef {
        repository_id: "R_SOURCE".into(),
        full_name: "team/source".into(),
    }
}
fn yaml(name: &str) -> String {
    format!("schema_version: 1\nworkspace:\n  id: d5b90530-6041-47e3-a348-2bff3642d5fb\n  name: {name}\ndocuments:\n  roots: [{{path: docs}}]\n")
}
fn repo() -> Value {
    json!({"node_id":"R_SOURCE","id":1,"full_name":"team/source","default_branch":"main","fork":false})
}
fn tree(paths: &[(&str, &str, usize)]) -> Value {
    json!({"truncated":false,"tree":paths.iter().map(|(path,sha,size)|json!({"path":path,"sha":sha,"type":"blob","mode":"100644","size":size})).collect::<Vec<_>>()})
}
fn blob(text: &str) -> Value {
    json!({"encoding":"base64","content":STANDARD.encode(text)})
}
fn replies(text: &str, sha: &str) -> Replies {
    vec![
        ("/repos/team/source", repo()),
        ("/repos/team/source/commits/main", json!({"sha":sha})),
        (
            "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tree(&[(SHARED_CONFIG_PATH, "CONFIG", text.len())]),
        ),
        ("/repos/team/source/git/blobs/CONFIG", blob(text)),
    ]
}
fn found(value: SharedWorkspaceLookup) -> Box<ResolvedSharedWorkspace> {
    match value {
        SharedWorkspaceLookup::Found { workspace } => workspace,
        other => panic!("expected found: {other:?}"),
    }
}

#[tokio::test]
async fn returns_every_document_repository_with_exclusions_and_access_status() {
    let text = yaml("Multi").replace("{path: docs}", "{path: docs, exclude: [docs/archive]}") + "  repositories:\n    - repository: {id: R_DOCS, full_name: team/docs}\n      roots: [{path: knowledge, exclude: [knowledge/private]}]\n";
    let mut r: Vec<_> = replies(&text, SHA)
        .into_iter()
        .map(|(p, v)| (p, 200, v))
        .collect();
    r.push(("/repos/team/docs", 403, json!({"message":"forbidden"})));
    let (github, requests) = fixture_http(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(
        value["documentRepositories"][0]["repository"]["full_name"],
        "team/source"
    );
    assert_eq!(
        value["documentRepositories"][0]["roots"][0]["exclude"],
        json!(["docs/archive"])
    );
    assert_eq!(
        value["documentRepositories"][1]["repository"]["full_name"],
        "team/docs"
    );
    assert_eq!(
        value["documentRepositories"][1]["roots"][0]["exclude"],
        json!(["knowledge/private"])
    );
    assert!(result
        .target_access
        .iter()
        .any(|a| a.target == "team/docs" && !a.available));
    assert!(requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, body)| body.is_none()));
}

#[tokio::test]
async fn document_exclusion_changes_invalidate_the_target_fingerprint() {
    let first = yaml("Multi");
    let second = first.replace("{path: docs}", "{path: docs, exclude: [docs/archive]}");
    let (a, _) = fixture(replies(&first, SHA));
    let (b, _) = fixture(replies(&second, SHA));
    let a = found(resolve_shared_workspace(&a, &source(), None).await.unwrap());
    let b = found(resolve_shared_workspace(&b, &source(), None).await.unwrap());
    assert_ne!(a.target_fingerprint, b.target_fingerprint);
}

#[tokio::test]
async fn rejects_an_additional_copy_of_the_inferred_document_source() {
    let text = yaml("Multi") + "  repositories:\n    - repository: {id: R_SOURCE, full_name: team/source}\n      roots: [{path: notes}]\n";
    let (github, _) = fixture(replies(&text, SHA));
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Invalid { .. }
    ));
}

#[tokio::test]
async fn list_only_documents_keep_primary_compatibility_fields_and_adapter_parity() {
    let text = yaml("List only").replace("  roots: [{path: docs}]", "  repositories:\n    - repository: {id: R_SOURCE, full_name: team/source}\n      roots: [{path: docs, exclude: [docs/private]}]");
    let (app, _) = fixture(replies(&text, SHA));
    let (mcp, _) = fixture(replies(&text, SHA));
    let app = crate::commands::docs_repository::preview_shared_workspace_definition(
        &app,
        &source(),
        None,
    )
    .await
    .unwrap();
    let mcp = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
        .await
        .unwrap();
    assert_eq!(comparable(&app), comparable(&mcp));
    let result = found(app);
    assert_eq!(result.docs_repository.full_name, "team/source");
    assert_eq!(result.document_roots, ["docs"]);
    assert!(!result.docs_repository_inferred);
    assert_eq!(result.document_repositories.len(), 1);
    assert!(!result.document_repositories[0].includes_path("docs/private/draft.md"));
    assert!(result.document_repositories[0].includes_path("docs/public/spec.md"));
}

#[tokio::test]
async fn resolves_document_only_with_pinned_source_and_no_writes() {
    let (github, requests) = fixture(replies(&yaml("Team A"), SHA));
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(
        result.id.to_string(),
        "d5b90530-6041-47e3-a348-2bff3642d5fb"
    );
    assert_eq!(result.name, "Team A");
    assert_eq!(result.docs_repository.full_name, "team/source");
    assert!(result.docs_repository_inferred && result.registration_required);
    assert!(result.projects.is_empty() && result.code_repositories.is_empty());
    assert_eq!(result.provenance.commit, SHA);
    assert_eq!(result.provenance.freshness, "live");
    assert!(requests
        .lock()
        .unwrap()
        .iter()
        .all(|(_, body)| body.is_none()));
}

#[tokio::test]
async fn explicit_documents_roles_projects_and_partial_access_are_not_inferred() {
    let text=yaml("Team B").replace("roots:","repository: {id: R_DOCS, full_name: team/docs}\n  roots:")+"repositories:\n  - key: app\n    label: App\n    github: {id: R_APP, full_name: team/app}\n    roles: [frontend, backend]\ngithub:\n  projects:\n    - {id: P1, owner: team, number: 1, scope: organization}\n    - {id: P2, owner: team, number: 2, scope: organization}\n  active_project_id: P2\n";
    let mut r: Vec<_> = replies(&text, SHA)
        .into_iter()
        .map(|(p, v)| (p, 200, v))
        .collect();
    r.extend([
        (
            "/repos/team/docs",
            200,
            json!({"node_id":"R_DOCS","full_name":"team/docs","default_branch":"main"}),
        ),
        ("/repos/team/docs/commits/main", 200, json!({"sha":SHA})),
        ("/repos/team/app", 403, json!({"message":"forbidden"})),
        (
            "/graphql",
            200,
            json!({"data":{"organization":{"projectV2":{"id":"P1","title":"FE"}}}}),
        ),
        (
            "/graphql",
            200,
            json!({"data":{"organization":{"projectV2":{"id":"P2","title":"BE"}}}}),
        ),
    ]);
    let (github, _) = fixture_http(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert!(!result.docs_repository_inferred);
    assert_eq!(result.docs_repository.full_name, "team/docs");
    assert_eq!(result.code_repositories[0].roles.len(), 2);
    assert_eq!(result.projects.len(), 2);
    assert_eq!(result.default_project_id.as_deref(), Some("P2"));
    let failed = result
        .target_access
        .iter()
        .find(|a| a.target == "team/app")
        .unwrap();
    assert!(!failed.available);
    assert_eq!(
        failed.error.as_ref().unwrap().code,
        ErrorCode::GithubPermissionDenied
    );
    assert!(result
        .target_access
        .iter()
        .any(|a| a.target == "team/docs" && a.available));
}

#[tokio::test]
async fn missing_invalid_unavailable_and_empty_are_distinct() {
    let (github, _) = fixture(vec![
        ("/repos/team/source", repo()),
        ("/repos/team/source/commits/main", json!({"sha":SHA})),
        (
            "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tree(&[]),
        ),
    ]);
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Missing { .. }
    ));
    let (github, _) = fixture(replies("schema_version: 1\nworkspace: broken", SHA));
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Invalid { .. }
    ));
    for (status, code) in [
        (401, ErrorCode::ReauthenticationRequired),
        (403, ErrorCode::GithubPermissionDenied),
        (404, ErrorCode::GithubResourceNotFound),
        (503, ErrorCode::GithubUnavailable),
    ] {
        let (github, _) = fixture_http(vec![("/repos/team/source", status, json!({}))]);
        match resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap()
        {
            SharedWorkspaceLookup::Unavailable { error, .. } => assert_eq!(error.code, code),
            v => panic!("{v:?}"),
        }
    }
    let (github, _) = fixture_http(vec![
        ("/repos/team/source", 200, repo()),
        (
            "/repos/team/source/commits/main",
            409,
            json!({"message":"Git Repository is empty."}),
        ),
    ]);
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::EmptyRepository { .. }
    ));
}

#[tokio::test]
async fn pinned_commit_rules_and_fingerprints_survive_main_changes() {
    let text = yaml("Team A");
    let r = vec![
        ("/repos/team/source", repo()),
        (
            "/repos/team/source/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            json!({"sha":SHA}),
        ),
        (
            "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tree(&[
                (SHARED_CONFIG_PATH, "CONFIG", text.len()),
                (".okf/AGENTS.md", "RULES", 4),
            ]),
        ),
        ("/repos/team/source/git/blobs/CONFIG", blob(&text)),
        ("/repos/team/source/git/blobs/RULES", blob("rule")),
    ];
    let (github, requests) = fixture(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), Some(SHA))
            .await
            .unwrap(),
    );
    assert_eq!(result.provenance.commit, SHA);
    assert!(result.rules.as_ref().unwrap().url.contains(SHA));
    assert_eq!(result.rules.as_ref().unwrap().text, "rule");
    assert!(!requests
        .lock()
        .unwrap()
        .iter()
        .any(|(url, _)| url.contains("commits/main")));
    let (github, _) = fixture(vec![
        ("/repos/team/source", repo()),
        ("/repos/team/source/commits/main", json!({"sha":NEXT})),
        (
            "/repos/team/source/git/trees/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            tree(&[(SHARED_CONFIG_PATH, "NEW", text.len())]),
        ),
        ("/repos/team/source/git/blobs/NEW", blob(&text)),
    ]);
    let latest = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(latest.provenance.commit, NEXT);
    assert_eq!(latest.target_fingerprint, result.target_fingerprint);
    assert_ne!(latest.config_fingerprint, result.config_fingerprint);
}

#[tokio::test]
async fn rejects_source_identity_mismatch_and_never_reads_outside_fixed_path() {
    let (github, requests) = fixture(vec![(
        "/repos/team/source",
        json!({"node_id":"OTHER","full_name":"team/source","default_branch":"main"}),
    )]);
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Unavailable { .. }
    ));
    assert_eq!(requests.lock().unwrap().len(), 1);
    let (github, requests) = fixture(vec![]);
    let bad = WorkspaceSourceRef {
        repository_id: "R".into(),
        full_name: "team/../secrets".into(),
    };
    assert!(resolve_shared_workspace(&github, &bad, None).await.is_err());
    assert!(requests.lock().unwrap().is_empty());
    assert!(resolve_shared_workspace(&github, &source(), Some("main"))
        .await
        .is_err());
}

#[tokio::test]
async fn refuses_truncated_trees_symlinks_and_oversized_blobs() {
    for t in [
        json!({"truncated":true,"tree":[]}),
        json!({"truncated":false,"tree":[{"path":SHARED_CONFIG_PATH,"sha":"C","type":"blob","mode":"120000","size":10}]}),
        tree(&[(SHARED_CONFIG_PATH, "C", SHARED_FILE_LIMIT as usize + 1)]),
    ] {
        let (github, requests) = fixture(vec![
            ("/repos/team/source", repo()),
            ("/repos/team/source/commits/main", json!({"sha":SHA})),
            (
                "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                t,
            ),
        ]);
        let result = resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap();
        assert!(!matches!(
            result,
            SharedWorkspaceLookup::Found { .. } | SharedWorkspaceLookup::Missing { .. }
        ));
        assert_eq!(requests.lock().unwrap().len(), 3);
    }
}

#[tokio::test]
async fn semantic_conflicts_are_rejected_before_target_access() {
    for text in [yaml("Team").replace("path: docs","path: ../outside"), yaml("Team")+"repositories:\n  - {key: a, label: A, github: {id: R1, full_name: team/app}}\n  - {key: b, label: B, github: {id: R2, full_name: team/app}}\n",yaml("Team")+"github:\n  projects:\n    - {id: P, owner: team, number: 1}\n    - {id: P, owner: team, number: 2}\n"] {
        let (github,requests)=fixture(replies(&text,SHA));
        assert!(matches!(resolve_shared_workspace(&github,&source(),None).await.unwrap(),SharedWorkspaceLookup::Invalid{..}));
        assert_eq!(requests.lock().unwrap().len(),4);
    }
}

#[tokio::test]
async fn shared_document_and_code_target_keeps_the_same_access_failure() {
    let text=yaml("Team").replace("roots:","repository: {id: R_APP, full_name: team/app}\n  roots:")+"repositories:\n  - {key: app, label: App, github: {id: R_APP, full_name: team/app}, roles: [frontend, backend]}\n";
    let mut r: Vec<_> = replies(&text, SHA)
        .into_iter()
        .map(|(p, v)| (p, 200, v))
        .collect();
    r.push(("/repos/team/app", 403, json!({})));
    let (github, _) = fixture_http(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(result.target_access.len(), 2);
    assert!(result.target_access.iter().all(|a| !a.available
        && a.error
            .as_ref()
            .is_some_and(|e| e.code == ErrorCode::GithubPermissionDenied)));
}

#[tokio::test]
async fn renamed_source_keeps_uuid_and_fork_is_a_warning_not_registration() {
    let text = yaml("New name");
    let mut renamed = repo();
    renamed["full_name"] = json!("new-team/source");
    renamed["fork"] = json!(true);
    let (github, _) = fixture(vec![
        ("/repos/team/source", renamed),
        (
            "/repos/new-team/source/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            json!({"sha":SHA}),
        ),
        (
            "/repos/new-team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tree(&[(SHARED_CONFIG_PATH, "CONFIG", text.len())]),
        ),
        ("/repos/new-team/source/git/blobs/CONFIG", blob(&text)),
    ]);
    let result = found(
        resolve_shared_workspace(&github, &source(), Some(SHA))
            .await
            .unwrap(),
    );
    assert_eq!(
        result.id.to_string(),
        "d5b90530-6041-47e3-a348-2bff3642d5fb"
    );
    assert_eq!(result.source_repository.full_name, "new-team/source");
    assert!(result.provenance.source_is_fork && result.registration_required);
    assert_eq!(result.warnings.len(), 1);
}

fn comparable(result: &SharedWorkspaceLookup) -> Value {
    let mut value = serde_json::to_value(result).unwrap();
    if let Some(provenance) = value
        .get_mut("workspace")
        .and_then(|w| w.get_mut("provenance"))
        .and_then(Value::as_object_mut)
    {
        provenance.remove("fetchedAtUnix");
    }
    if let Some(provenance) = value.get_mut("provenance").and_then(Value::as_object_mut) {
        provenance.remove("fetchedAtUnix");
    }
    value
}

#[tokio::test]
async fn app_and_mcp_read_adapters_return_the_same_pinned_definition_for_two_teams() {
    for (name, id) in [
        ("Team A", "d5b90530-6041-47e3-a348-2bff3642d5fb"),
        ("Team B", "a5b90530-6041-47e3-a348-2bff3642d5fb"),
    ] {
        let text = yaml(name).replace("d5b90530-6041-47e3-a348-2bff3642d5fb", id);
        let (app, _) = fixture(replies(&text, SHA));
        let (mcp, _) = fixture(replies(&text, SHA));
        let a = crate::commands::docs_repository::preview_shared_workspace_definition(
            &app,
            &source(),
            None,
        )
        .await
        .unwrap();
        let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
            .await
            .unwrap();
        let a = comparable(&a);
        let b = comparable(&b);
        assert_eq!(a, b);
        assert_eq!(a["workspace"]["id"], id);
        assert_eq!(a["workspace"]["name"], name);
        assert_eq!(a["workspace"]["provenance"]["commit"], SHA);
        assert_eq!(a["workspace"]["docsRepository"]["full_name"], "team/source");
    }
}

#[tokio::test]
async fn app_and_mcp_read_adapters_preserve_error_categories() {
    for status in [401, 403, 404, 503] {
        let (app, _) = fixture_http(vec![("/repos/team/source", status, json!({}))]);
        let (mcp, _) = fixture_http(vec![("/repos/team/source", status, json!({}))]);
        let a = crate::commands::docs_repository::preview_shared_workspace_definition(
            &app,
            &source(),
            None,
        )
        .await
        .unwrap();
        let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
            .await
            .unwrap();
        assert_eq!(comparable(&a), comparable(&b));
        assert!(matches!(a, SharedWorkspaceLookup::Unavailable { .. }));
    }
}

#[tokio::test]
async fn network_failure_is_not_a_missing_definition_in_either_adapter() {
    let app = crate::github::automation_test_support::network_failure_fixture();
    let mcp = crate::github::automation_test_support::network_failure_fixture();
    let a = crate::commands::docs_repository::preview_shared_workspace_definition(
        &app,
        &source(),
        None,
    )
    .await
    .unwrap();
    let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
        .await
        .unwrap();
    assert_eq!(comparable(&a), comparable(&b));
    match a {
        SharedWorkspaceLookup::Unavailable { error, .. } => {
            assert_eq!(error.code, ErrorCode::GithubNetworkError)
        }
        v => panic!("{v:?}"),
    }
}

#[tokio::test]
async fn app_and_mcp_match_for_explicit_docs_dual_roles_and_multiple_projects() {
    let text=yaml("Team B").replace("roots:","repository: {id: R_DOCS, full_name: team/docs}\n  roots:")+"repositories:\n  - {key: app, label: App, github: {id: R_APP, full_name: team/app}, roles: [frontend, backend]}\ngithub:\n  projects:\n    - {id: P1, owner: team, number: 1, scope: organization}\n    - {id: P2, owner: team, number: 2, scope: organization}\n  active_project_id: P2\n";
    let mut r = replies(&text, SHA);
    r.extend([
        (
            "/repos/team/docs",
            json!({"node_id":"R_DOCS","full_name":"team/docs","default_branch":"main"}),
        ),
        ("/repos/team/docs/commits/main", json!({"sha":SHA})),
        (
            "/repos/team/app",
            json!({"node_id":"R_APP","full_name":"team/app","default_branch":"main"}),
        ),
        ("/repos/team/app/commits/main", json!({"sha":SHA})),
        (
            "/graphql",
            json!({"data":{"organization":{"projectV2":{"id":"P1","title":"FE"}}}}),
        ),
        (
            "/graphql",
            json!({"data":{"organization":{"projectV2":{"id":"P2","title":"BE"}}}}),
        ),
    ]);
    let (app, _) = fixture(r.clone());
    let (mcp, _) = fixture(r);
    let a = crate::commands::docs_repository::preview_shared_workspace_definition(
        &app,
        &source(),
        None,
    )
    .await
    .unwrap();
    let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
        .await
        .unwrap();
    assert_eq!(comparable(&a), comparable(&b));
    let result = found(a);
    assert_eq!(result.docs_repository.full_name, "team/docs");
    assert_eq!(result.projects.len(), 2);
    assert_eq!(result.default_project_id.as_deref(), Some("P2"));
    assert_eq!(
        serde_json::to_value(&result.code_repositories[0].roles).unwrap(),
        json!(["frontend", "backend"])
    );
}

#[tokio::test]
async fn adapters_preserve_missing_invalid_empty_and_pinned_commit_semantics() {
    let cases = vec![
        vec![
            ("/repos/team/source", 200, repo()),
            ("/repos/team/source/commits/main", 200, json!({"sha":SHA})),
            (
                "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                200,
                tree(&[]),
            ),
        ],
        replies("schema_version: 1\nworkspace: broken", SHA)
            .into_iter()
            .map(|(p, v)| (p, 200, v))
            .collect(),
        vec![
            ("/repos/team/source", 200, repo()),
            (
                "/repos/team/source/commits/main",
                409,
                json!({"message":"Git Repository is empty."}),
            ),
        ],
    ];
    for (r, status) in cases
        .into_iter()
        .zip(["missing", "invalid", "empty_repository"])
    {
        let (app, _) = fixture_http(r.clone());
        let (mcp, _) = fixture_http(r);
        let a = crate::commands::docs_repository::preview_shared_workspace_definition(
            &app,
            &source(),
            None,
        )
        .await
        .unwrap();
        let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), None)
            .await
            .unwrap();
        assert_eq!(comparable(&a), comparable(&b));
        assert_eq!(comparable(&a)["status"], status);
    }
    let text = yaml("Pinned");
    let r = vec![
        ("/repos/team/source", repo()),
        (
            "/repos/team/source/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            json!({"sha":SHA}),
        ),
        (
            "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tree(&[(SHARED_CONFIG_PATH, "CONFIG", text.len())]),
        ),
        ("/repos/team/source/git/blobs/CONFIG", blob(&text)),
    ];
    let (app, _) = fixture(r.clone());
    let (mcp, _) = fixture(r);
    let a = crate::commands::docs_repository::preview_shared_workspace_definition(
        &app,
        &source(),
        Some(SHA),
    )
    .await
    .unwrap();
    let b = crate::automation::inspect_shared_workspace_definition(&mcp, &source(), Some(SHA))
        .await
        .unwrap();
    assert_eq!(comparable(&a), comparable(&b));
    assert_eq!(comparable(&a)["workspace"]["provenance"]["commit"], SHA);
}

#[tokio::test]
async fn local_settings_and_clone_cannot_override_an_explicit_read_source() {
    let temp = tempfile::tempdir().unwrap();
    let settings = temp.path().join("settings.json");
    let clone = temp.path().join("clone/.okf");
    std::fs::create_dir_all(&clone).unwrap();
    std::fs::write(
        &settings,
        r#"{"hub-workspaces":"[{\"id\":\"wrong\",\"title\":\"Wrong team\"}]"}"#,
    )
    .unwrap();
    std::fs::write(clone.join("workspace.yml"), yaml("Wrong local clone")).unwrap();
    let before = std::fs::read(&settings).unwrap();
    // An unrelated local runtime exists, but the read boundary accepts only an
    // explicit GitHub source. Neither its path nor personal settings are inputs.
    let _runtime =
        crate::automation::AutomationRuntime::load(&crate::automation::AutomationOverrides {
            app_data_dir: Some(temp.path().to_path_buf()),
            workspace_dir: Some(temp.path().join("clone")),
            ..Default::default()
        })
        .unwrap();
    let (github, _) = fixture(replies(&yaml("Remote team"), SHA));
    let result = found(
        crate::automation::inspect_shared_workspace_definition(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(result.name, "Remote team");
    assert_eq!(result.docs_repository.full_name, "team/source");
    assert_eq!(std::fs::read(settings).unwrap(), before);
    assert_eq!(
        std::fs::read_to_string(clone.join("workspace.yml")).unwrap(),
        yaml("Wrong local clone")
    );
}

#[tokio::test]
async fn incomplete_tree_or_symlinked_config_directory_never_means_missing() {
    for t in [
        json!({"tree":[]}),
        json!({"truncated":false,"tree":[{"path":".okf","type":"blob","mode":"120000","sha":"LINK","size":10}]}),
    ] {
        let (github, _) = fixture(vec![
            ("/repos/team/source", repo()),
            ("/repos/team/source/commits/main", json!({"sha":SHA})),
            (
                "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                t,
            ),
        ]);
        assert!(matches!(
            resolve_shared_workspace(&github, &source(), None)
                .await
                .unwrap(),
            SharedWorkspaceLookup::Unavailable { .. } | SharedWorkspaceLookup::Invalid { .. }
        ));
    }
}

#[tokio::test]
async fn review_explicit_sha_must_be_a_commit_not_a_tree() {
    let (github, requests) = fixture_http(vec![
        ("/repos/team/source", 200, repo()),
        (
            "/repos/team/source/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            404,
            json!({}),
        ),
    ]);
    match resolve_shared_workspace(&github, &source(), Some(SHA))
        .await
        .unwrap()
    {
        SharedWorkspaceLookup::Unavailable { error, .. } => {
            assert_eq!(error.code, ErrorCode::CommitNotFound)
        }
        v => panic!("{v:?}"),
    }
    assert_eq!(requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn review_metadata_access_is_not_content_access() {
    let text = yaml("Team").replace(
        "roots:",
        "repository: {id: R_DOCS, full_name: team/docs}\n  roots:",
    );
    let mut r: Vec<_> = replies(&text, SHA)
        .into_iter()
        .map(|(p, v)| (p, 200, v))
        .collect();
    r.extend([
        (
            "/repos/team/docs",
            200,
            json!({"node_id":"R_DOCS","full_name":"team/docs","default_branch":"main"}),
        ),
        ("/repos/team/docs/commits/main", 403, json!({})),
    ]);
    let (github, _) = fixture_http(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert!(!result.target_access[0].available);
    assert_eq!(
        result.target_access[0].error.as_ref().unwrap().code,
        ErrorCode::GithubPermissionDenied
    );
}

#[tokio::test]
async fn review_scope_less_personal_project_falls_back_only_on_not_found() {
    let text = yaml("Team") + "github:\n  project: {id: PERSONAL, owner: alice, number: 3}\n";
    let mut r = replies(&text, SHA);
    r.extend([
        ("/graphql", json!({"data":{"organization":null}})),
        (
            "/graphql",
            json!({"data":{"user":{"projectV2":{"id":"PERSONAL","title":"Mine"}}}}),
        ),
    ]);
    let (github, requests) = fixture(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert!(
        result
            .target_access
            .iter()
            .find(|a| a.target == "project:PERSONAL")
            .unwrap()
            .available
    );
    let requests = requests.lock().unwrap();
    assert!(requests.last().unwrap().1.as_ref().unwrap()["query"]
        .as_str()
        .unwrap()
        .contains("user(login"));
}

#[tokio::test]
async fn review_unknown_root_extensions_do_not_panic_or_change_connection_hash() {
    let original = yaml("Team");
    let extension = original.replace("path: docs", "path: docs, ext: {? [a, b]: c}");
    let (github, _) = fixture(replies(&original, SHA));
    let a = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    let (github, _) = fixture(replies(&extension, SHA));
    let b = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(a.target_fingerprint, b.target_fingerprint);
    assert_ne!(a.config_fingerprint, b.config_fingerprint);
}

#[tokio::test]
async fn review_duplicate_project_entries_are_invalid_but_legacy_mirror_is_valid() {
    let text=yaml("Team")+"github:\n  projects:\n    - {id: P, owner: team, number: 1, scope: organization}\n    - {id: P, owner: team, number: 1, scope: organization}\n";
    let (github, _) = fixture(replies(&text, SHA));
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Invalid { .. }
    ));
    let text=yaml("Team")+"github:\n  project: {id: P, owner: team, number: 1}\n  projects:\n    - {id: P, owner: team, number: 1, scope: organization}\n";
    let mut r = replies(&text, SHA);
    r.push((
        "/graphql",
        json!({"data":{"organization":{"projectV2":{"id":"P","title":"Board"}}}}),
    ));
    let (github, _) = fixture(r);
    let result = found(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
    );
    assert_eq!(result.projects.len(), 1);
    assert_eq!(result.default_project_id.as_deref(), Some("P"));
}

#[tokio::test]
async fn review_invalid_files_and_bad_provider_metadata_are_not_empty_or_transient() {
    let text = yaml("Team");
    for t in [
        json!({"truncated":false,"tree":[{"path":SHARED_CONFIG_PATH,"sha":"C","type":"blob","mode":"120000","size":10}]}),
        tree(&[(SHARED_CONFIG_PATH, "C", SHARED_FILE_LIMIT as usize + 1)]),
    ] {
        let (github, _) = fixture(vec![
            ("/repos/team/source", repo()),
            ("/repos/team/source/commits/main", json!({"sha":SHA})),
            (
                "/repos/team/source/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                t,
            ),
        ]);
        assert!(matches!(
            resolve_shared_workspace(&github, &source(), None)
                .await
                .unwrap(),
            SharedWorkspaceLookup::Invalid { .. }
        ));
    }
    let mut detail = repo();
    detail["default_branch"] = json!(42);
    let (github, _) = fixture(vec![("/repos/team/source", detail)]);
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Unavailable { .. }
    ));
    let (github, _) = fixture_http(vec![
        ("/repos/team/source", 200, repo()),
        (
            "/repos/team/source/commits/main",
            409,
            json!({"message":"conflict"}),
        ),
    ]);
    assert!(matches!(
        resolve_shared_workspace(&github, &source(), None)
            .await
            .unwrap(),
        SharedWorkspaceLookup::Unavailable { .. }
    ));
    let _ = text;
}

#[tokio::test]
async fn review_wrapped_base64_at_exact_limit_is_readable() {
    let prefix = yaml("Team");
    let text = prefix.clone() + "#" + &"x".repeat(SHARED_FILE_LIMIT as usize - prefix.len() - 1);
    let mut r = replies(&text, SHA);
    let encoded = STANDARD.encode(&text);
    let wrapped = encoded
        .as_bytes()
        .chunks(60)
        .map(|b| std::str::from_utf8(b).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    r.last_mut().unwrap().1 = json!({"encoding":"base64","content":wrapped});
    let (github, _) = fixture(r);
    assert_eq!(
        found(
            resolve_shared_workspace(&github, &source(), None)
                .await
                .unwrap()
        )
        .name,
        "Team"
    );
}
