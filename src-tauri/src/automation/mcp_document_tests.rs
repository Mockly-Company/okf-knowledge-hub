use super::{mcp_paging, mcp_sources, AutomationOverrides, AutomationRuntime};
use crate::github::automation_test_support::fixture;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;

const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn runtime(
    dir: &std::path::Path,
    scenario: &str,
) -> (
    AutomationRuntime,
    crate::github::automation_test_support::Requests,
) {
    std::fs::create_dir_all(dir.join(".okf")).unwrap();
    std::fs::write(dir.join(".okf/workspace.yml"),"schema_version: 1\nworkspace: {id: d5b90530-6041-47e3-a348-2bff3642d5fb, name: Team}\ndocuments:\n  roots: [{path: docs, exclude: [docs/private]}]\n  repositories:\n    - repository: {id: R_OTHER, full_name: acme/other}\n      roots: [{path: docs, exclude: [docs/private]}]\n").unwrap();
    let mut replies = Vec::new();
    for run in 0..if scenario.starts_with("page") { 2 } else { 1 } {
        for (repo, sha, body) in [
            ("acme/docs", A, "# First"),
            ("acme/other", B, "# Second needle"),
        ] {
            if scenario == "read" && repo != "acme/other" {
                continue;
            }
            let base = format!("/repos/{repo}");
            if scenario != "read" {
                replies.push((format!("{base}"),json!({"default_branch":"main","node_id":if repo=="acme/other"{"R_OTHER"}else{"R_DOCS"}})));
                let current = if scenario == "page_move" && run == 1 {
                    "cccccccccccccccccccccccccccccccccccccccc"
                } else {
                    sha
                };
                replies.push((format!("{base}/commits/main"), json!({"sha":current})));
                if current != sha {
                    replies.push((
                        format!("{base}/compare/{sha}...{current}"),
                        json!({"status":"ahead"}),
                    ));
                }
            }
            if scenario == "read" {
                replies.push((base.clone(), json!({"node_id":"R_OTHER"})));
            }
            replies.push((format!("{base}/git/trees/{sha}"),json!({"truncated":false,"tree":[{"type":"blob","mode":"100644","path":"docs/same.md","size":40},{"type":"blob","mode":"100644","path":"docs/private/secret.md","size":40}]})));
            replies.push((
                format!("{base}/contents/docs/same.md"),
                json!({"encoding":"base64","content":STANDARD.encode(body)}),
            ));
            if scenario != "read" && !(scenario == "search" && repo == "acme/docs") {
                replies.push((
                    format!("{base}/commits"),
                    json!([{"sha":sha,"commit":{"committer":{"date":"2026-11-27T00:00:00Z"}}}]),
                ));
            }
        }
    }
    let (github, requests) = fixture(
        replies
            .into_iter()
            .map(|(url, value)| (&*Box::leak(url.into_boxed_str()), value))
            .collect(),
    );
    let mut runtime = AutomationRuntime::load(&AutomationOverrides {
        app_data_dir: Some(dir.join("settings")),
        workspace_dir: Some(dir.to_path_buf()),
        docs_repo: Some("acme/docs".into()),
        ..Default::default()
    })
    .unwrap();
    runtime.test_github = Some(github);
    (runtime, requests)
}

#[tokio::test]
async fn published_list_and_search_cover_both_repositories_without_reading_excluded_content() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, requests) = runtime(dir.path(), "list");
    let list = mcp_sources::list_docs(&runtime, &json!({"mode":"documents","sort":"path"}))
        .await
        .unwrap();
    assert_eq!(list["total"], 2);
    assert_eq!(list["items"][0]["repository"], "acme/docs");
    assert_eq!(list["items"][1]["repository"], "acme/other");
    assert_eq!(list["repositoryCommits"]["acme/docs"], A);
    assert_eq!(list["repositoryCommits"]["acme/other"], B);
    let (search_runtime, search_requests) = self::runtime(dir.path(), "search");
    let search = mcp_sources::list_docs(
        &search_runtime,
        &json!({"mode":"documents","query":"needle"}),
    )
    .await
    .unwrap();
    assert_eq!(search["total"], 1);
    assert_eq!(search["items"][0]["repository"], "acme/other");
    assert!(requests
        .lock()
        .unwrap()
        .iter()
        .all(|(url, _)| !url.contains("private")));
    assert!(search_requests
        .lock()
        .unwrap()
        .iter()
        .all(|(url, _)| !url.contains("private")));
}

#[tokio::test]
async fn direct_read_is_repository_qualified_and_excluded_paths_are_blocked_before_network_access()
{
    let dir = tempfile::tempdir().unwrap();
    let (runtime, requests) = runtime(dir.path(), "read");
    for repo in ["acme/docs", "acme/other"] {
        assert!(mcp_sources::read_doc(
            &runtime,
            &json!({"repository":repo,"path":"docs/private/secret.md","commit":A})
        )
        .await
        .is_err());
    }
    assert!(requests.lock().unwrap().is_empty());
    assert!(
        mcp_sources::read_doc(&runtime, &json!({"path":"docs/same.md","commit":A}))
            .await
            .is_err()
    );
    assert!(mcp_sources::read_doc(
        &runtime,
        &json!({"repository":"unconfigured/repo","path":"docs/same.md","commit":A})
    )
    .await
    .is_err());
    let doc = mcp_sources::read_doc(
        &runtime,
        &json!({"repository":"acme/other","path":"docs/same.md","commit":B}),
    )
    .await
    .unwrap();
    assert_eq!(doc["markdown"], "# Second needle");
    assert_eq!(doc["repository"], "acme/other");
}

#[tokio::test]
async fn continuation_preserves_every_repository_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, requests) = runtime(dir.path(), "page_move");
    let args = json!({"mode":"documents","sort":"path","limit":1});
    let mut first = mcp_sources::list_docs(&runtime, &args).await.unwrap();
    mcp_paging::decorate("okhub_doc_list", &args, &mut first).unwrap();
    let next = &first["continuation"]["arguments"];
    assert_eq!(
        next["repositoryCommits"],
        json!({"acme/docs":A,"acme/other":B})
    );
    mcp_paging::validate("okhub_doc_list", next).unwrap();
    let second = mcp_sources::list_docs(&runtime, next).await.unwrap();
    assert_eq!(second["items"][0]["repository"], "acme/other");
    assert_eq!(second["items"][0]["commit"], B);
    assert_eq!(
        second["currentDefaultCommits"]["acme/other"],
        "cccccccccccccccccccccccccccccccccccccccc"
    );
    assert!(requests
        .lock()
        .unwrap()
        .iter()
        .filter(|(url, _)| url.contains("/contents/"))
        .all(|(url, _)| !url.contains("ref=cccc")));
}

#[tokio::test]
async fn local_draft_list_search_and_read_apply_scopes_to_both_repositories() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, _) = runtime(dir.path(), "list");
    std::fs::create_dir_all(dir.path().join("docs/private")).unwrap();
    std::fs::write(dir.path().join("docs/first.md"), "# First visible").unwrap();
    std::fs::write(dir.path().join("docs/private/secret.md"), [0xff]).unwrap();
    let secondary = dir.path().join("settings/repos/acme/other");
    std::fs::create_dir_all(secondary.join("docs/private")).unwrap();
    let git = git2::Repository::init(&secondary).unwrap();
    git.remote("origin", "https://github.com/acme/other.git")
        .unwrap();
    std::fs::write(secondary.join("docs/second.md"), "# Second visible").unwrap();
    std::fs::write(
        secondary.join("docs/private/secret.md"),
        "# Classified secret",
    )
    .unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("private/secret.md", secondary.join("docs/alias.md")).unwrap();
    let list = mcp_sources::list_docs(&runtime, &json!({"published":false}))
        .await
        .unwrap();
    assert_eq!(list["total"], 2);
    let search = mcp_sources::list_docs(&runtime, &json!({"published":false,"query":"Classified"}))
        .await
        .unwrap();
    assert_eq!(search["total"], 0);
    for repo in ["acme/docs", "acme/other"] {
        assert!(mcp_sources::read_doc(
            &runtime,
            &json!({"repository":repo,"path":"docs/private/secret.md"})
        )
        .await
        .is_err());
    }
    let body = mcp_sources::read_doc(
        &runtime,
        &json!({"repository":"acme/other","path":"docs/second.md"}),
    )
    .await
    .unwrap();
    assert_eq!(body["markdown"], "# Second visible");
    #[cfg(unix)]
    assert!(mcp_sources::read_doc(
        &runtime,
        &json!({"repository":"acme/other","path":"docs/alias.md"})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn secondary_local_documents_use_registered_checkout_before_managed_clone() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, requests) = runtime(dir.path(), "list");
    std::fs::create_dir_all(dir.path().join("docs")).unwrap();
    let secondary = dir.path().join("custom-checkout");
    let git = git2::Repository::init(&secondary).unwrap();
    git.remote("origin", "git@github.com:ACME/other.git")
        .unwrap();
    std::fs::create_dir_all(secondary.join("docs")).unwrap();
    std::fs::write(secondary.join("docs/custom.md"), "# Custom checkout needle").unwrap();
    crate::settings::service::LocalSettingsService::new(super::JsonFileSettingsStore::new(
        dir.path().join("settings/settings.json"),
    ))
    .set_code_repository_local_path("acme/other", &secondary)
    .unwrap();

    let list = mcp_sources::list_docs(&runtime, &json!({"published":false,"query":"needle"}))
        .await
        .unwrap();
    assert_eq!(list["total"], 1);
    assert_eq!(list["items"][0]["repository"], "acme/other");
    assert_eq!(list["items"][0]["path"], "docs/custom.md");
    let read = mcp_sources::read_doc(
        &runtime,
        &json!({"repository":"acme/other","path":"docs/custom.md"}),
    )
    .await
    .unwrap();
    assert_eq!(read["markdown"], "# Custom checkout needle");
    assert!(requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn secondary_local_documents_reject_invalid_registered_checkout_without_fallback() {
    for invalid in ["wrong-origin", "subdirectory", "missing"] {
        let dir = tempfile::tempdir().unwrap();
        let (runtime, requests) = runtime(dir.path(), "list");
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        let managed = dir.path().join("settings/repos/acme/other");
        let git = git2::Repository::init(&managed).unwrap();
        git.remote("origin", "https://github.com/acme/other.git")
            .unwrap();
        std::fs::create_dir_all(managed.join("docs")).unwrap();
        std::fs::write(managed.join("docs/fallback.md"), "# Must not read").unwrap();
        let custom = dir.path().join("custom-checkout");
        let git = git2::Repository::init(&custom).unwrap();
        git.remote(
            "origin",
            if invalid == "wrong-origin" {
                "https://github.com/acme/unrelated.git"
            } else {
                "https://github.com/acme/other.git"
            },
        )
        .unwrap();
        let registered = if invalid == "subdirectory" {
            custom.join("nested")
        } else if invalid == "missing" {
            custom.join("missing")
        } else {
            custom
        };
        if invalid == "subdirectory" {
            std::fs::create_dir_all(&registered).unwrap();
        }
        use crate::settings::service::LocalSettingsStore;
        super::JsonFileSettingsStore::new(dir.path().join("settings/settings.json"))
            .write(
                "code-repository-paths",
                &json!({"acme/other":registered}).to_string(),
            )
            .unwrap();
        assert!(
            mcp_sources::list_docs(&runtime, &json!({"published":false}))
                .await
                .is_err(),
            "{invalid}"
        );
        assert!(
            mcp_sources::read_doc(
                &runtime,
                &json!({"repository":"acme/other","path":"docs/fallback.md"}),
            )
            .await
            .is_err(),
            "{invalid}"
        );
        assert!(requests.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn continuation_rejects_changed_exclusion_policy_before_any_remote_request() {
    let dir = tempfile::tempdir().unwrap();
    let (runtime, requests) = runtime(dir.path(), "list");
    let args = json!({"mode":"documents","limit":1});
    let mut first = mcp_sources::list_docs(&runtime, &args).await.unwrap();
    mcp_paging::decorate("okhub_doc_list", &args, &mut first).unwrap();
    let before = requests.lock().unwrap().len();
    let config = dir.path().join(".okf/workspace.yml");
    let text = std::fs::read_to_string(&config).unwrap().replace(
        "exclude: [docs/private]",
        "exclude: [docs/private, docs/restricted]",
    );
    std::fs::write(config, text).unwrap();
    assert!(
        mcp_sources::list_docs(&runtime, &first["continuation"]["arguments"])
            .await
            .is_err()
    );
    assert_eq!(requests.lock().unwrap().len(), before);
}
