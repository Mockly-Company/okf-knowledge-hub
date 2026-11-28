use super::{DocumentRepository, DocumentsConfig, GithubRepositoryRef};

impl DocumentsConfig {
    /// Canonical list for new consumers. Never mutates or rewrites legacy settings.
    pub fn resolved_repositories(&self, source: &GithubRepositoryRef) -> Vec<DocumentRepository> {
        let mut repositories = Vec::new();
        if !self.roots.is_empty() {
            repositories.push(DocumentRepository {
                repository: self.repository.clone().unwrap_or_else(|| source.clone()),
                roots: self.roots.clone(),
                extra: Default::default(),
            });
        }
        repositories.extend(self.repositories.clone());
        repositories
    }
}

impl DocumentRepository {
    /// Pure scope check, not filesystem/symlink authorization. Exclusions win
    /// across overlapping roots, so adding a nested root cannot bypass them.
    pub fn includes_path(&self, path: &str) -> bool {
        let Some(path) = normalized_path(path).filter(|path| path != ".") else {
            return false;
        };
        let mut included = false;
        for root in &self.roots {
            let Some(base) = normalized_path(&root.path) else {
                return false;
            };
            included |= within(&path, &base);
            for exclude in &root.exclude {
                let Some(exclude) = normalized_path(exclude) else {
                    return false;
                };
                if exclude == base || !within(&exclude, &base) {
                    return false;
                }
                if within(&path, &exclude) {
                    return false;
                }
            }
        }
        included
    }
}

pub(crate) fn normalized_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if normalized.trim().is_empty()
        || normalized.contains('\0')
        || normalized.starts_with('/')
        || (normalized.as_bytes().get(1) == Some(&b':')
            && normalized.as_bytes()[0].is_ascii_alphabetic())
        || normalized.split('/').any(|part| part == "..")
    {
        return None;
    }
    let parts: Vec<_> = normalized
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    Some(if parts.is_empty() {
        ".".into()
    } else {
        parts.join("/")
    })
}

pub(crate) fn within(path: &str, parent: &str) -> bool {
    parent == "."
        || path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{model::WorkspaceDocument, validation::validate_workspace};
    use serde_json::json;

    fn source() -> GithubRepositoryRef {
        GithubRepositoryRef {
            id: "R_SOURCE".into(),
            full_name: "team/source".into(),
            extra: Default::default(),
        }
    }

    #[test]
    fn legacy_settings_keep_their_shape_and_default_to_the_source_repository() {
        let source_yaml = include_str!("fixtures/valid-workspace.yml");
        let document = WorkspaceDocument::parse(source_yaml).unwrap();
        let repositories = document.config.documents.resolved_repositories(&source());
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].repository.id, "R_SOURCE");
        assert!(repositories[0].includes_path("docs/product.md"));
        assert!(!repositories[0].includes_path("src/product.md"));
        let encoded = document.to_yaml().unwrap();
        let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(&encoded).unwrap();
        assert!(value["documents"].get("repositories").is_none());
        assert!(value["documents"]["roots"][0].get("exclude").is_none());
        assert_eq!(WorkspaceDocument::parse(&encoded).unwrap(), document);
    }

    #[test]
    fn round_trips_multiple_repositories_exclusions_and_unknown_metadata() {
        let document =
            WorkspaceDocument::parse(include_str!("fixtures/multi-document-workspace.yml"))
                .unwrap();
        assert!(validate_workspace(&document.config).is_empty());
        let repositories = document.config.documents.resolved_repositories(&source());
        assert_eq!(repositories.len(), 2);
        assert_eq!(repositories[0].repository.id, "R_SOURCE");
        assert_eq!(repositories[1].repository.id, "R_API");
        assert!(!repositories[0].includes_path("docs/archive/old.md"));
        assert!(!repositories[1].includes_path("specs/internal/auth.md"));
        assert!(repositories[1].includes_path("specs/public/auth.md"));
        let encoded = document.to_yaml().unwrap();
        assert_eq!(WorkspaceDocument::parse(&encoded).unwrap(), document);
        let value = serde_json::to_value(&document.config).unwrap();
        assert_eq!(value["custom_workspace"], json!({"keep":true}));
        assert_eq!(
            value["documents"]["repositories"][0]["custom_repo"],
            "preserved"
        );
        assert_eq!(value["documents"]["roots"][0]["custom_root"], "preserved");
    }

    #[test]
    fn list_only_configuration_does_not_add_an_implicit_source_repository() {
        let mut document =
            WorkspaceDocument::parse(include_str!("fixtures/multi-document-workspace.yml"))
                .unwrap();
        document.config.documents.roots.clear();
        assert!(validate_workspace(&document.config).is_empty());
        let repositories = document.config.documents.resolved_repositories(&source());
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].repository.id, "R_API");
    }

    #[test]
    fn exclusions_win_over_nested_roots_without_hiding_similarly_named_siblings() {
        let repository: DocumentRepository = serde_yaml_ng::from_str("repository: {id: R_DOCS, full_name: team/docs}\nroots:\n  - {path: docs, exclude: [docs/api]}\n  - {path: docs/api/public}\n").unwrap();
        for (path, included) in [
            ("docs/api/private.md", false),
            ("docs/api/public/allowed.md", false),
            ("docs/apiary/readme.md", true),
            ("docs/readme.md", true),
            ("docs2/readme.md", false),
            ("../docs/readme.md", false),
            ("/docs/readme.md", false),
            ("docs/../private.md", false),
        ] {
            assert_eq!(repository.includes_path(path), included, "{path}");
        }
    }

    #[test]
    fn whole_repository_scope_can_exclude_subtrees() {
        let repository: DocumentRepository = serde_yaml_ng::from_str("repository: {id: R_DOCS, full_name: team/docs}\nroots: [{path: '.', exclude: [private]}]\n").unwrap();
        assert!(repository.includes_path("README.md"));
        assert!(!repository.includes_path("private/nested/readme.md"));
        assert!(repository.includes_path("private-notes/readme.md"));
        assert!(!repository.includes_path("C:/private/readme.md"));
    }

    #[test]
    fn malformed_exclusion_and_repository_list_types_are_not_ignored_as_metadata() {
        for documents in [
            "roots: [{path: docs, exclude: secret}]",
            "roots: [{path: docs}]\nrepositories: wrong",
        ] {
            let yaml = format!("schema_version: 1\nworkspace: {{id: d5b90530-6041-47e3-a348-2bff3642d5fb, name: Team}}\ndocuments:\n{}\n",documents.lines().map(|line|format!("  {line}")).collect::<Vec<_>>().join("\n"));
            assert!(WorkspaceDocument::parse(&yaml).is_err());
        }
    }
}
