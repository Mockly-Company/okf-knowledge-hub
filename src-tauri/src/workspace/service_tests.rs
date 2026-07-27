use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::workspace::model::WorkspaceDocument;

use super::*;

fn workspace_with(source: &str) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
    std::fs::write(directory.path().join(".okf/workspace.yml"), source).unwrap();
    directory
}

fn valid_workspace(document_root: &str, repository_key: &str) -> String {
    format!(
            "schema_version: 1\nworkspace:\n  id: \"89bf04ef-df57-4a76-b10a-b33107d8a6c2\"\n  name: \"Mockly\"\ndocuments:\n  roots:\n    - path: \"{document_root}\"\nrepositories:\n  - key: \"{repository_key}\"\n    label: \"Mockly backend\"\n    github:\n      id: \"R_backend\"\n      full_name: \"Mockly/backend\"\n"
        )
}

fn files_below(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, directory: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        let mut entries = std::fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap())
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let file_type = entry.file_type().unwrap();
            if file_type.is_dir() {
                visit(root, &path, files);
            } else if file_type.is_file() {
                files.insert(
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }

    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

#[test]
fn workspace_inspection_variants_use_the_exact_public_wire_contract() {
    let workspace_id = Uuid::parse_str("89bf04ef-df57-4a76-b10a-b33107d8a6c2").unwrap();
    let cases = [
        (
            WorkspaceInspection::Ready {
                summary: WorkspaceSummary {
                    id: workspace_id,
                    name: "Mockly".into(),
                    schema_version: 1,
                    document_roots: vec!["docs".into()],
                    repository_count: 2,
                },
            },
            serde_json::json!({
                "status": "ready",
                "summary": {
                    "id": workspace_id,
                    "name": "Mockly",
                    "schemaVersion": 1,
                    "documentRoots": ["docs"],
                    "repositoryCount": 2
                }
            }),
        ),
        (
            WorkspaceInspection::InitializationRequired,
            serde_json::json!({ "status": "initialization_required" }),
        ),
        (
            WorkspaceInspection::Invalid {
                diagnostics: vec![WorkspaceDiagnostic {
                    code: WorkspaceDiagnosticCode::WorkspaceYamlInvalid,
                    path: ".okf/workspace.yml".into(),
                    message: "YAML을 읽을 수 없습니다.".into(),
                    value: None,
                }],
            },
            serde_json::json!({
                "status": "invalid",
                "diagnostics": [{
                    "code": "workspace_yaml_invalid",
                    "path": ".okf/workspace.yml",
                    "message": "YAML을 읽을 수 없습니다."
                }]
            }),
        ),
        (
            WorkspaceInspection::UnsupportedVersion { found_version: 2 },
            serde_json::json!({
                "status": "unsupported_version",
                "foundVersion": 2
            }),
        ),
    ];

    for (inspection, expected) in cases {
        assert_eq!(serde_json::to_value(inspection).unwrap(), expected);
    }
}

#[test]
fn missing_workspace_returns_initialization_required_without_writing_files() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("existing")).unwrap();

    let result = WorkspaceService::inspect(directory.path()).unwrap();

    assert_eq!(result, WorkspaceInspection::InitializationRequired);
    assert!(!directory.path().join(".okf").exists());
}

#[test]
fn malformed_but_parseable_workspace_reports_every_feasible_diagnostic_and_stays_unchanged() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: not-a-uuid\n  name: \"  \"\ndocuments:\n  roots: []\nrepositories: []\n",
        );
    let before = files_below(directory.path());

    let result = WorkspaceService::inspect(directory.path()).unwrap();

    let WorkspaceInspection::Invalid { diagnostics } = result else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();
    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdNotV4));
    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameEmpty));
    assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootsMissing));
    assert_eq!(files_below(directory.path()), before);
}

#[test]
fn partial_workspace_reports_feasible_root_repository_and_project_diagnostics_together() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace: {}\ndocuments:\n  roots:\n    - path: ../outside\nrepositories:\n  - key: Backend!\n    label: Duplicate\n    github: {}\n  - key: Backend!\n    label: Duplicate\n    github: {}\ngithub:\n  project: {}\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdMissing));
    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameMissing));
    assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
    assert_eq!(
        codes
            .iter()
            .filter(|code| **code == WorkspaceDiagnosticCode::RepositoryKeyInvalid)
            .count(),
        2
    );
    assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryKey));
    assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryLabel));
    assert_eq!(
        codes
            .iter()
            .filter(|code| **code == WorkspaceDiagnosticCode::RepositoryGithubIdMissing)
            .count(),
        2
    );
    assert!(codes.contains(&WorkspaceDiagnosticCode::GithubProjectIdMissing));
}

#[test]
fn typed_structure_failure_remains_visible_with_semantic_and_missing_field_diagnostics() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: \"  \"\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: backend\n    github:\n      id: R_backend\n      full_name: Mockly/backend\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceStructureInvalid));
    assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameEmpty));
    assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryLabelMissing));
}

#[test]
fn partial_workspace_distinguishes_missing_and_wrong_type_required_fields() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 42\ndocuments:\n  roots:\n    - path: 42\n    - {}\nrepositories:\n  - key: 42\n    github:\n      id: 42\n  - key: backend\n    label: 42\n    github: wrong-type\ngithub:\n  project:\n    id: 42\n    number: \"3\"\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    for expected in [
        WorkspaceDiagnosticCode::WorkspaceStructureInvalid,
        WorkspaceDiagnosticCode::WorkspaceIdTypeInvalid,
        WorkspaceDiagnosticCode::WorkspaceNameMissing,
        WorkspaceDiagnosticCode::DocumentRootPathTypeInvalid,
        WorkspaceDiagnosticCode::DocumentRootPathMissing,
        WorkspaceDiagnosticCode::RepositoryKeyTypeInvalid,
        WorkspaceDiagnosticCode::RepositoryLabelMissing,
        WorkspaceDiagnosticCode::RepositoryGithubIdTypeInvalid,
        WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing,
        WorkspaceDiagnosticCode::RepositoryLabelTypeInvalid,
        WorkspaceDiagnosticCode::RepositoryGithubTypeInvalid,
        WorkspaceDiagnosticCode::GithubProjectIdTypeInvalid,
        WorkspaceDiagnosticCode::GithubProjectOwnerMissing,
        WorkspaceDiagnosticCode::GithubProjectNumberTypeInvalid,
    ] {
        assert!(
            codes.contains(&expected),
            "missing diagnostic: {expected:?}"
        );
    }
    assert!(!codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdNotV4));
    assert!(!codes.contains(&WorkspaceDiagnosticCode::DocumentRootEmpty));
    assert!(!codes.contains(&WorkspaceDiagnosticCode::RepositoryKeyEmpty));
}

#[test]
fn wrong_type_document_roots_is_not_reported_as_missing() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: Mockly\ndocuments:\n  roots: wrong-type\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootsTypeInvalid));
    assert!(!codes.contains(&WorkspaceDiagnosticCode::DocumentRootsMissing));
}

#[test]
fn missing_repository_github_reports_each_required_nested_field() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: Mockly\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: backend\n    label: Backend\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubMissing));
    assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubIdMissing));
    assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing));
}

#[test]
fn remaining_required_fields_report_precise_missing_and_type_diagnostics() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: 42\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - label: Backend\n    github:\n      id: R_backend\n      full_name: 42\ngithub:\n  project:\n    id: P_project\n    owner: 42\n",
        );

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };
    let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

    for expected in [
        WorkspaceDiagnosticCode::WorkspaceNameTypeInvalid,
        WorkspaceDiagnosticCode::RepositoryKeyMissing,
        WorkspaceDiagnosticCode::RepositoryGithubFullNameTypeInvalid,
        WorkspaceDiagnosticCode::GithubProjectOwnerTypeInvalid,
        WorkspaceDiagnosticCode::GithubProjectNumberMissing,
    ] {
        assert!(
            codes.contains(&expected),
            "missing diagnostic: {expected:?}"
        );
    }
}

#[test]
fn partial_workspace_still_reports_feasible_document_reference_diagnostics() {
    let directory = workspace_with(
            "schema_version: 1\nworkspace: {}\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: frontend\n    label: Frontend\n    github:\n      id: R_frontend\n      full_name: Mockly/frontend\n",
        );
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(
        directory.path().join("docs/backend.md"),
        include_str!("fixtures/document-with-backend-ref.md"),
    )
    .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected invalid inspection");
    };

    assert!(diagnostics.iter().any(|item| {
        item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
            && item.value.as_deref() == Some("backend")
    }));
}

#[test]
fn newer_workspace_version_has_a_distinct_inspection_state() {
    let directory = workspace_with("schema_version: 2\nworkspace: {}\n");

    assert_eq!(
        WorkspaceService::inspect(directory.path()).unwrap(),
        WorkspaceInspection::UnsupportedVersion { found_version: 2 }
    );
}

#[test]
fn oversized_newer_workspace_version_preserves_the_actual_found_value() {
    let directory = workspace_with("schema_version: 4294967296\n");

    let WorkspaceInspection::UnsupportedVersion { found_version } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected unsupported version");
    };

    assert_eq!(found_version, 4_294_967_296);
}

#[test]
fn scans_references_only_in_configured_document_roots() {
    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::create_dir_all(directory.path().join("unconfigured")).unwrap();
    std::fs::write(
        directory.path().join("docs/backend.md"),
        include_str!("fixtures/document-with-backend-ref.md"),
    )
    .unwrap();
    std::fs::write(
        directory.path().join("unconfigured/ignored.yml"),
        "repository: \"also-unknown\"\n",
    )
    .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected unknown repository reference");
    };
    let references = diagnostics
        .iter()
        .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
        .collect::<Vec<_>>();

    assert_eq!(references.len(), 1);
    assert_eq!(references[0].value.as_deref(), Some("backend"));
    assert!(references[0].path.starts_with("docs/backend.md:"));
}

#[test]
fn markdown_reference_scan_uses_front_matter_and_ignores_body_examples() {
    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(
            directory.path().join("docs/guide.md"),
            "---\ncode_links: [{ \"repository\": backend, path: src/lib.rs }]\n---\n\nExample only:\n```yaml\ncode_links:\n  - repository: retired\n```\n",
        )
        .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected front-matter reference diagnostic");
    };
    let values = diagnostics
        .iter()
        .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
        .filter_map(|item| item.value.as_deref())
        .collect::<Vec<_>>();

    assert_eq!(values, vec!["backend"]);
}

#[test]
fn yaml_reference_scan_handles_flow_maps_and_ignores_unrelated_repository_fields() {
    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(
            directory.path().join("docs/links.yaml"),
            "metadata: { repository: retired }\ncode_links: [{ \"repository\": mobile, path: src/mobile.rs }]\n",
        )
        .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected flow-map reference diagnostic");
    };
    let values = diagnostics
        .iter()
        .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
        .filter_map(|item| item.value.as_deref())
        .collect::<Vec<_>>();

    assert_eq!(values, vec!["mobile"]);
}

#[test]
fn traversal_document_roots_are_rejected_without_scanning_outside_the_repository() {
    let parent = tempfile::tempdir().unwrap();
    let repository = parent.path().join("repository");
    std::fs::create_dir_all(repository.join(".okf")).unwrap();
    std::fs::write(
        repository.join(".okf/workspace.yml"),
        valid_workspace("../outside", "frontend"),
    )
    .unwrap();
    std::fs::create_dir_all(parent.path().join("outside")).unwrap();
    std::fs::write(
        parent.path().join("outside/secret.md"),
        "repository: \"outside-secret\"\n",
    )
    .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(&repository).unwrap()
    else {
        panic!("expected invalid document root");
    };

    assert!(diagnostics
        .iter()
        .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
    assert!(!diagnostics.iter().any(|item| {
        item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
            && item.value.as_deref() == Some("outside-secret")
    }));
}

#[cfg(unix)]
#[test]
fn symlink_escapes_are_not_scanned_for_repository_references() {
    use std::os::unix::fs::symlink;

    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    let outside = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(
        outside.path().join("secret.yml"),
        "repository: \"outside-secret\"\n",
    )
    .unwrap();
    symlink(outside.path(), directory.path().join("docs/linked-outside")).unwrap();

    let result = WorkspaceService::inspect(directory.path()).unwrap();

    assert!(matches!(result, WorkspaceInspection::Ready { .. }));
}

#[cfg(unix)]
#[test]
fn contained_symlink_document_root_is_scanned() {
    use std::os::unix::fs::symlink;

    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    std::fs::create_dir_all(directory.path().join("actual-docs")).unwrap();
    std::fs::write(
        directory.path().join("actual-docs/backend.yml"),
        "code_links: [{ repository: backend, path: src/backend.rs }]\n",
    )
    .unwrap();
    symlink(
        directory.path().join("actual-docs"),
        directory.path().join("docs"),
    )
    .unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected contained symlink root to be scanned");
    };

    assert!(diagnostics.iter().any(|item| {
        item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
            && item.value.as_deref() == Some("backend")
    }));
}

#[cfg(unix)]
#[test]
fn escaping_symlink_document_root_is_rejected_without_scanning_target() {
    use std::os::unix::fs::symlink;

    let directory = workspace_with(&valid_workspace("docs", "frontend"));
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(
        outside.path().join("backend.yml"),
        "code_links: [{ repository: outside-secret, path: secret }]\n",
    )
    .unwrap();
    symlink(outside.path(), directory.path().join("docs")).unwrap();

    let WorkspaceInspection::Invalid { diagnostics } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected escaping root diagnostic");
    };

    assert!(diagnostics
        .iter()
        .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
    assert!(!diagnostics.iter().any(|item| {
        item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
            && item.value.as_deref() == Some("outside-secret")
    }));
}

#[test]
fn valid_workspace_returns_a_summary_without_changing_files() {
    let directory = workspace_with(&valid_workspace("docs", "backend"));
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(
        directory.path().join("docs/backend.md"),
        include_str!("fixtures/document-with-backend-ref.md"),
    )
    .unwrap();
    let before = files_below(directory.path());

    let WorkspaceInspection::Ready { summary } =
        WorkspaceService::inspect(directory.path()).unwrap()
    else {
        panic!("expected ready workspace");
    };

    assert_eq!(summary.name, "Mockly");
    assert_eq!(summary.document_roots, vec!["docs"]);
    assert_eq!(summary.repository_count, 1);
    assert_eq!(files_below(directory.path()), before);
}

#[test]
fn preview_contains_only_missing_seed_files_and_does_not_write_them() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(directory.path().join("docs/existing.md"), "# Existing").unwrap();
    let before = files_below(directory.path());

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();

    assert_eq!(preview.repository_fingerprint, "head:abc123;status:clean");
    assert_eq!(preview.branch, "okf/init-workspace");
    assert_eq!(
        preview.strategy,
        InitializationStrategy::DraftPullRequest {
            base_branch: "main".into()
        }
    );
    assert!(preview
        .files
        .iter()
        .any(|file| file.path == ".okf/workspace.yml"));
    assert!(preview
        .files
        .iter()
        .any(|file| file.path == ".okf/templates/.gitkeep"));
    assert!(!preview
        .files
        .iter()
        .any(|file| file.path == "docs/.gitkeep"));
    assert!(preview.files.iter().all(|file| !file.overwrites_existing));
    assert_eq!(files_below(directory.path()), before);
    assert!(!directory.path().join(".okf").exists());
}

#[cfg(unix)]
#[test]
fn preview_rejects_a_missing_target_below_an_escaping_parent_symlink() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), directory.path().join(".okf")).unwrap();
    let before = files_below(outside.path());

    let error = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::WorkspaceInvalid);
    assert_eq!(files_below(outside.path()), before);
    assert!(!outside.path().join("workspace.yml").exists());
}

#[cfg(unix)]
#[test]
fn preview_allows_a_missing_target_below_a_contained_parent_symlink() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("metadata")).unwrap();
    symlink(
        directory.path().join("metadata"),
        directory.path().join(".okf"),
    )
    .unwrap();

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();

    assert!(preview
        .files
        .iter()
        .any(|file| file.path == ".okf/workspace.yml"));
    assert!(!directory.path().join("metadata/workspace.yml").exists());
}

#[cfg(unix)]
#[test]
fn execution_recheck_rejects_a_parent_symlink_added_after_preview_creation() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();
    symlink(outside.path(), directory.path().join(".okf")).unwrap();

    let error =
        WorkspaceService::validate_preview_paths(directory.path(), &preview.files).unwrap_err();

    assert_eq!(error.code, ErrorCode::WorkspaceInvalid);
    assert!(files_below(outside.path()).is_empty());
}

#[test]
fn preview_workspace_yaml_uses_one_generated_id_and_minimal_v1_defaults() {
    let directory = tempfile::tempdir().unwrap();

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "empty-repository",
        RepositoryPopulation::Empty {
            default_branch: "trunk".into(),
        },
    )
    .unwrap();
    let workspace_file = preview
        .files
        .iter()
        .find(|file| file.path == ".okf/workspace.yml")
        .unwrap();
    let parsed = WorkspaceDocument::parse(&workspace_file.content).unwrap();

    assert_eq!(preview.workspace_id, parsed.config.workspace.id);
    assert_eq!(parsed.config.workspace.name, "Mockly");
    assert_eq!(parsed.config.documents.roots[0].path, "docs");
    assert!(parsed.config.repositories.is_empty());
    assert!(parsed.config.github.is_none());
    assert_eq!(preview.branch, "trunk");
    assert_eq!(preview.strategy, InitializationStrategy::DirectPush);
    assert_eq!(preview.commit_message, "chore: initialize OkHub workspace");
}

#[test]
fn preview_skips_every_seed_path_that_already_has_content() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join(".okf/templates")).unwrap();
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(directory.path().join(".okf/workspace.yml"), "user-owned").unwrap();
    std::fs::write(
        directory.path().join(".okf/templates/template.md"),
        "template",
    )
    .unwrap();
    std::fs::write(directory.path().join("docs/readme.md"), "document").unwrap();
    let before = files_below(directory.path());

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "unchanged",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();

    assert!(preview.files.is_empty());
    assert_eq!(files_below(directory.path()), before);
}

#[test]
fn preview_adds_markers_when_seed_roots_contain_only_nested_empty_directories() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("docs/empty/nested")).unwrap();
    std::fs::create_dir_all(directory.path().join(".okf/templates/empty/nested")).unwrap();

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "unchanged",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();

    assert!(preview
        .files
        .iter()
        .any(|file| file.path == "docs/.gitkeep"));
    assert!(preview
        .files
        .iter()
        .any(|file| file.path == ".okf/templates/.gitkeep"));
}

#[test]
fn registry_returns_immutable_preview_snapshots_by_id_across_threads() {
    use std::sync::Arc;

    let directory = tempfile::tempdir().unwrap();
    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();
    let preview_id = preview.id;
    let registry = Arc::new(PreviewRegistry::default());
    registry.insert(preview.clone()).unwrap();

    let worker_registry = Arc::clone(&registry);
    let mut retrieved = std::thread::spawn(move || worker_registry.get(preview_id).unwrap())
        .join()
        .unwrap();
    retrieved.workspace_name = "mutated copy".into();

    assert_eq!(registry.get(preview_id).unwrap(), preview);
    assert!(registry.get(Uuid::new_v4()).is_none());
}

#[test]
fn registry_rejects_duplicate_ids_without_replacing_the_approved_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "approved-fingerprint",
        RepositoryPopulation::ExistingContent {
            default_branch: "main".into(),
        },
    )
    .unwrap();
    let mut replacement = preview.clone();
    replacement.repository_fingerprint = "attacker-controlled".into();
    replacement.files.clear();
    let registry = PreviewRegistry::default();
    registry.insert(preview.clone()).unwrap();

    let error = registry.insert(replacement).unwrap_err();

    assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
    assert_eq!(registry.get(preview.id).unwrap(), preview);
}
