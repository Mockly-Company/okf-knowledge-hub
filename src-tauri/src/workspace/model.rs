use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConfigV1 {
    pub schema_version: u32,
    pub workspace: WorkspaceIdentity,
    pub documents: DocumentsConfig,
    #[serde(default)]
    pub repositories: Vec<LinkedRepository>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<GithubWorkspaceConfig>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceIdentity {
    pub id: Uuid,
    pub name: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentsConfig {
    pub roots: Vec<DocumentRoot>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentRoot {
    pub path: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkedRepository {
    pub key: String,
    pub label: String,
    pub github: GithubRepositoryRef,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubRepositoryRef {
    pub id: String,
    pub full_name: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubWorkspaceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<GithubProjectRef>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubProjectRef {
    pub id: String,
    pub owner: String,
    pub number: u64,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceDocument {
    pub config: WorkspaceConfigV1,
}

impl WorkspaceDocument {
    pub fn parse(source: &str) -> Result<Self, AppError> {
        let probe: Value = serde_yaml_ng::from_str(source)
            .map_err(|error| invalid_workspace_error(error.to_string()))?;
        let schema_version = probe
            .get("schema_version")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid_workspace_error("schema_version은 정수여야 합니다."))?;

        if schema_version > 1 {
            return Err(AppError::new(
                ErrorCode::WorkspaceVersionUnsupported,
                "이 OkHub 버전은 이 워크스페이스 스키마를 지원하지 않습니다.",
            )
            .with_detail("foundVersion", schema_version.to_string()));
        }

        if schema_version != 1 {
            return Err(invalid_workspace_error(format!(
                "지원하지 않는 워크스페이스 스키마 버전입니다: {}",
                schema_version
            )));
        }

        let config = serde_yaml_ng::from_str(source)
            .map_err(|error| invalid_workspace_error(error.to_string()))?;
        Ok(Self { config })
    }

    pub fn to_yaml(&self) -> Result<String, AppError> {
        serde_yaml_ng::to_string(&self.config)
            .map_err(|error| invalid_workspace_error(error.to_string()))
    }
}

fn invalid_workspace_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::WorkspaceInvalid, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn parses_v1_and_preserves_unknown_fields_on_every_rewritable_object() {
        let source = include_str!("fixtures/unknown-fields.yml");
        let document = WorkspaceDocument::parse(source).unwrap();

        assert_eq!(document.config.workspace.name, "Mockly");
        assert_eq!(document.config.repositories[0].key, "backend");
        assert!(document.config.extra.contains_key("extensions"));
        assert!(document
            .config
            .workspace
            .extra
            .contains_key("workspace_extension"));
        assert!(document
            .config
            .documents
            .extra
            .contains_key("documents_extension"));
        assert!(document.config.documents.roots[0]
            .extra
            .contains_key("root_extension"));
        assert!(document.config.repositories[0]
            .extra
            .contains_key("repository_extension"));
        assert!(document.config.repositories[0]
            .github
            .extra
            .contains_key("repository_github_extension"));
        assert!(document
            .config
            .github
            .as_ref()
            .unwrap()
            .extra
            .contains_key("github_extension"));
        assert!(document
            .config
            .github
            .as_ref()
            .unwrap()
            .project
            .as_ref()
            .unwrap()
            .extra
            .contains_key("project_extension"));

        let serialized = document.to_yaml().unwrap();
        let reparsed = WorkspaceDocument::parse(&serialized).unwrap();
        assert!(reparsed.config.extra.contains_key("extensions"));
        assert!(reparsed
            .config
            .workspace
            .extra
            .contains_key("workspace_extension"));
        assert!(reparsed
            .config
            .documents
            .extra
            .contains_key("documents_extension"));
        assert!(reparsed.config.documents.roots[0]
            .extra
            .contains_key("root_extension"));
        assert!(reparsed.config.repositories[0]
            .extra
            .contains_key("repository_extension"));
        assert!(reparsed.config.repositories[0]
            .github
            .extra
            .contains_key("repository_github_extension"));
        assert!(reparsed
            .config
            .github
            .as_ref()
            .unwrap()
            .extra
            .contains_key("github_extension"));
        assert!(reparsed
            .config
            .github
            .as_ref()
            .unwrap()
            .project
            .as_ref()
            .unwrap()
            .extra
            .contains_key("project_extension"));
    }

    #[test]
    fn reports_a_newer_schema_without_deserializing_it_as_v1() {
        let error = WorkspaceDocument::parse("schema_version: 2\n").unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceVersionUnsupported);
        assert_eq!(error.details["foundVersion"], "2");
    }

    #[test]
    fn reports_an_oversized_newer_schema_without_deserializing_it_as_v1() {
        let error = WorkspaceDocument::parse("schema_version: 4294967296\n").unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceVersionUnsupported);
        assert_eq!(error.details["foundVersion"], "4294967296");
    }
}
