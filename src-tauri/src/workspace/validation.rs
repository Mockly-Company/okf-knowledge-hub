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

    if config.documents.roots.is_empty() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentRootsMissing,
            "documents.roots",
            "documents.roots에는 하나 이상의 문서 루트가 필요합니다.",
        ));
    }

    for (index, root) in config.documents.roots.iter().enumerate() {
        let path = format!("documents.roots[{index}].path");
        if root.path.trim().is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootEmpty,
                path,
                "문서 루트 경로는 비어 있을 수 없습니다.",
            ));
        } else if is_outside_repository_path(&root.path) {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootOutsideRepository,
                path,
                "문서 루트는 저장소 내부의 상대 경로여야 합니다.",
            ));
        }
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

    if let Some(project) = config
        .github
        .as_ref()
        .and_then(|github| github.project.as_ref())
    {
        if project.id.trim().is_empty() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::GithubProjectIdMissing,
                "github.project.id",
                "GitHub Project Node ID가 필요합니다.",
            ));
        }
    }

    diagnostics
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

fn is_outside_repository_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized.starts_with('/')
        || has_windows_prefix(&normalized)
        || normalized.split('/').any(|component| component == "..")
}

fn has_windows_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
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
                extra: Default::default(),
            });
        config
            .documents
            .roots
            .push(crate::workspace::model::DocumentRoot {
                path: "C:\\documents".into(),
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
