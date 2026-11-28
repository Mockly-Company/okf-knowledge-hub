use std::collections::HashSet;

use uuid::{Variant, Version};

use crate::workspace::model::WorkspaceConfigV1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceDiagnosticCode {
    WorkspaceIdNotV4,
    WorkspaceNameEmpty,
    DocumentRootsMissing,
    DocumentRootEmpty,
    DocumentRootOutsideRepository,
    DocumentExclusionInvalid,
    DocumentRepositoryInvalid,
    DuplicateDocumentRepository,
    DuplicateRepositoryKey,
    DuplicateRepositoryLabel,
    RepositoryKeyEmpty,
    RepositoryKeyInvalid,
    RepositoryGithubIdMissing,
    GithubProjectIdMissing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceDiagnostic {
    pub code: WorkspaceDiagnosticCode,
    pub path: String,
    pub message: String,
}

pub fn validate_workspace(config: &WorkspaceConfigV1) -> Vec<WorkspaceDiagnostic> {
    let mut diagnostics = Vec::new();

    if config.workspace.id.get_version() != Some(Version::Random)
        || config.workspace.id.get_variant() != Variant::RFC4122
    {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceIdNotV4,
            "workspace.id",
            "workspace.id는 UUID v4여야 합니다.",
        ));
    }

    if config.workspace.name.trim().is_empty() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceNameEmpty,
            "workspace.name",
            "workspace.name은 비어 있을 수 없습니다.",
        ));
    }

    if config.documents.roots.is_empty() && config.documents.repositories.is_empty() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentRootsMissing,
            "documents.roots",
            "하나 이상의 문서 저장소와 루트가 필요합니다.",
        ));
    }
    if config.documents.repository.is_some() && config.documents.roots.is_empty() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentRootsMissing,
            "documents.roots",
            "문서 저장소의 루트가 필요합니다.",
        ));
    }
    validate_document_roots(&config.documents.roots, "documents.roots", &mut diagnostics);
    let mut document_ids = HashSet::new();
    let mut document_names = HashSet::new();
    if let Some(repository) = &config.documents.repository {
        document_ids.insert(repository.id.clone());
        document_names.insert(repository.full_name.to_ascii_lowercase());
    }
    for (index, repository) in config.documents.repositories.iter().enumerate() {
        let base = format!("documents.repositories[{index}]");
        let identity = &repository.repository;
        let name_parts: Vec<_> = identity.full_name.split('/').collect();
        if identity.id.trim().is_empty()
            || name_parts.len() != 2
            || name_parts.iter().any(|part| {
                part.is_empty()
                    || !part
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
            })
        {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRepositoryInvalid,
                format!("{base}.repository"),
                "저장소 ID와 owner/repository를 확인해 주세요.",
            ));
        }
        let duplicate_id = !document_ids.insert(identity.id.clone());
        let duplicate_name = !document_names.insert(identity.full_name.to_ascii_lowercase());
        if duplicate_id || duplicate_name {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DuplicateDocumentRepository,
                format!("{base}.repository"),
                "문서 저장소는 중복으로 연결할 수 없습니다.",
            ));
        }
        if repository.roots.is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootsMissing,
                format!("{base}.roots"),
                "하나 이상의 문서 루트가 필요합니다.",
            ));
        }
        validate_document_roots(
            &repository.roots,
            &format!("{base}.roots"),
            &mut diagnostics,
        );
    }

    let mut repository_keys = HashSet::new();
    let mut repository_labels = HashSet::new();
    for (index, repository) in config.repositories.iter().enumerate() {
        let base = format!("repositories[{index}]");
        if repository.key.trim().is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryKeyEmpty,
                format!("{base}.key"),
                "저장소 key는 비어 있을 수 없습니다.",
            ));
        } else if !is_valid_repository_key(&repository.key) {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryKeyInvalid,
                format!("{base}.key"),
                "저장소 key는 소문자로 시작하고 소문자, 숫자, _, -만 사용할 수 있습니다.",
            ));
        }

        if !repository_keys.insert(&repository.key) {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DuplicateRepositoryKey,
                format!("{base}.key"),
                "저장소 key는 워크스페이스 안에서 고유해야 합니다.",
            ));
        }

        if !repository_labels.insert(&repository.label) {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DuplicateRepositoryLabel,
                format!("{base}.label"),
                "저장소 label은 워크스페이스 안에서 고유해야 합니다.",
            ));
        }

        if repository.github.id.trim().is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryGithubIdMissing,
                format!("{base}.github.id"),
                "GitHub 저장소 Node ID가 필요합니다.",
            ));
        }
    }

    if let Some(github) = config.github.as_ref() {
        for (index, project) in github.all_projects().iter().enumerate() {
            if project.id.trim().is_empty() {
                let path = if github.projects.is_empty() {
                    "github.project.id".to_owned()
                } else {
                    format!("github.projects[{index}].id")
                };
                diagnostics.push(diagnostic(
                    WorkspaceDiagnosticCode::GithubProjectIdMissing,
                    path,
                    "GitHub Project Node ID가 필요합니다.",
                ));
            }
        }
        if let Some(active_id) = github.active_project_id.as_deref() {
            let known = github.all_projects();
            if !known.iter().any(|project| project.id == active_id) {
                diagnostics.push(diagnostic(
                    WorkspaceDiagnosticCode::GithubProjectIdMissing,
                    "github.active_project_id",
                    "활성 GitHub Project가 연결 목록에 없습니다.",
                ));
            }
        }
    }

    diagnostics
}

fn validate_document_roots(
    roots: &[crate::workspace::model::DocumentRoot],
    base: &str,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) {
    use crate::workspace::model::document_scopes::{normalized_path, within};
    for (index, root) in roots.iter().enumerate() {
        let path = format!("{base}[{index}].path");
        let normalized = normalized_path(&root.path);
        if root.path.trim().is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootEmpty,
                path,
                "문서 루트 경로는 비어 있을 수 없습니다.",
            ));
        } else if normalized.is_none() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootOutsideRepository,
                path,
                "문서 루트는 저장소 내부의 상대 경로여야 합니다.",
            ));
        }
        for (excluded_index, exclude) in root.exclude.iter().enumerate() {
            let valid = normalized
                .as_ref()
                .zip(normalized_path(exclude).as_ref())
                .is_some_and(|(root, excluded)| excluded != root && within(excluded, root));
            if !valid {
                diagnostics.push(diagnostic(
                    WorkspaceDiagnosticCode::DocumentExclusionInvalid,
                    format!("{base}[{index}].exclude[{excluded_index}]"),
                    "제외 폴더는 문서 루트 아래의 저장소 상대 경로여야 합니다.",
                ));
            }
        }
    }
}

fn diagnostic(
    code: WorkspaceDiagnosticCode,
    path: impl Into<String>,
    message: impl Into<String>,
) -> WorkspaceDiagnostic {
    WorkspaceDiagnostic {
        code,
        path: path.into(),
        message: message.into(),
    }
}

fn is_valid_repository_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    matches!(bytes.first(), Some(b'a'..=b'z'))
        && bytes[1..]
            .iter()
            .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;
    use crate::workspace::model::{WorkspaceConfigV1, WorkspaceDocument};

    fn valid_workspace() -> WorkspaceConfigV1 {
        WorkspaceDocument::parse(include_str!("fixtures/valid-workspace.yml"))
            .unwrap()
            .config
    }

    #[test]
    fn rejects_unsafe_paths_in_additional_document_repositories() {
        let mut value: serde_yaml_ng::Value =
            serde_yaml_ng::from_str(include_str!("fixtures/valid-workspace.yml")).unwrap();
        value["documents"]["repositories"] = serde_yaml_ng::from_str(
            "- repository: {id: R_OTHER, full_name: team/other}\n  roots: [{path: ../private}]\n",
        )
        .unwrap();
        let config: WorkspaceConfigV1 = serde_yaml_ng::from_value(value).unwrap();
        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.path == "documents.repositories[0].roots[0].path"));
    }

    #[test]
    fn rejects_exclusions_outside_the_selected_document_root() {
        for excluded in [
            "../secrets",
            "/private",
            "C:/private",
            "docs/../private",
            "other",
            "docs",
            "",
        ] {
            let mut value: serde_yaml_ng::Value =
                serde_yaml_ng::from_str(include_str!("fixtures/valid-workspace.yml")).unwrap();
            value["documents"]["roots"][0]["exclude"] =
                serde_yaml_ng::to_value(vec![excluded]).unwrap();
            let config: WorkspaceConfigV1 = serde_yaml_ng::from_value(value).unwrap();
            assert!(
                validate_workspace(&config)
                    .iter()
                    .any(|item| item.path == "documents.roots[0].exclude[0]"),
                "accepted {excluded:?}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_document_repository_identities() {
        let mut value: serde_yaml_ng::Value =
            serde_yaml_ng::from_str(include_str!("fixtures/valid-workspace.yml")).unwrap();
        value["documents"]["repositories"] = serde_yaml_ng::from_str("- repository: {id: R_OTHER, full_name: team/other}\n  roots: [{path: docs}]\n- repository: {id: R_OTHER, full_name: TEAM/OTHER}\n  roots: [{path: notes}]\n").unwrap();
        let config: WorkspaceConfigV1 = serde_yaml_ng::from_value(value).unwrap();
        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.path == "documents.repositories[1].repository"));
    }

    #[test]
    fn rejects_paths_outside_the_repository_and_duplicate_repository_identity() {
        let mut config = valid_workspace();
        config.documents.roots[0].path = "../outside".into();
        config.repositories.push(config.repositories[0].clone());

        let codes = validate_workspace(&config)
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
        assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryKey));
        assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryLabel));
    }

    #[test]
    fn rejects_an_empty_workspace_name() {
        let mut config = valid_workspace();
        config.workspace.name = "   ".into();

        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::WorkspaceNameEmpty));
    }

    #[test]
    fn rejects_a_non_v4_workspace_id() {
        let mut config = valid_workspace();
        config.workspace.id = Uuid::parse_str("6ba7b810-9dad-11d1-80b4-00c04fd430c8").unwrap();

        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::WorkspaceIdNotV4));
    }

    #[test]
    fn rejects_a_v4_nibble_uuid_with_a_non_rfc_variant() {
        let mut config = valid_workspace();
        config.workspace.id = Uuid::parse_str("89bf04ef-df57-4a76-f10a-b33107d8a6c2").unwrap();

        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::WorkspaceIdNotV4));
    }

    #[test]
    fn rejects_zero_document_roots() {
        let mut config = valid_workspace();
        config.documents.roots.clear();

        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootsMissing));
    }

    #[test]
    fn rejects_empty_and_absolute_document_root_paths_on_unix_and_windows() {
        let mut config = valid_workspace();
        config.documents.roots[0].path = "".into();
        config
            .documents
            .roots
            .push(crate::workspace::model::DocumentRoot {
                path: "/documents".into(),
                exclude: Vec::new(),
                extra: Default::default(),
            });
        config
            .documents
            .roots
            .push(crate::workspace::model::DocumentRoot {
                path: "C:\\documents".into(),
                exclude: Vec::new(),
                extra: Default::default(),
            });

        let codes = validate_workspace(&config)
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootEmpty));
        assert_eq!(
            codes
                .iter()
                .filter(|code| **code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository)
                .count(),
            2
        );
    }

    #[test]
    fn rejects_backslash_parent_components_in_document_roots() {
        let mut config = valid_workspace();
        config.documents.roots[0].path = "docs\\..\\outside".into();

        assert!(validate_workspace(&config)
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
    }

    #[test]
    fn rejects_empty_and_invalid_repository_keys() {
        let mut config = valid_workspace();
        config.repositories[0].key = "".into();
        config
            .repositories
            .push(crate::workspace::model::LinkedRepository {
                key: "Backend!".into(),
                ..config.repositories[0].clone()
            });

        let codes = validate_workspace(&config)
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryKeyEmpty));
        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryKeyInvalid));
    }

    #[test]
    fn rejects_missing_github_node_ids() {
        let mut config = valid_workspace();
        config.repositories[0].github.id = " ".into();
        config.github.as_mut().unwrap().project.as_mut().unwrap().id = "".into();

        let codes = validate_workspace(&config)
            .into_iter()
            .map(|item| item.code)
            .collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubIdMissing));
        assert!(codes.contains(&WorkspaceDiagnosticCode::GithubProjectIdMissing));
    }
}
