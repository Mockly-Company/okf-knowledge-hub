use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};
use crate::project_board::ProjectOwnerScope;

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub projects: Vec<GithubProjectRef>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "activeProjectId"
    )]
    pub active_project_id: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

impl GithubWorkspaceConfig {
    /// 모든 연결 프로젝트. 구버전 문서(`project` 단일 필드)도 포함한다.
    pub fn all_projects(&self) -> Vec<GithubProjectRef> {
        if self.projects.is_empty() {
            return self.project.clone().into_iter().collect();
        }
        let mut seen = std::collections::HashSet::new();
        let mut merged = Vec::new();
        for project in self.projects.iter().cloned() {
            seen.insert(project.id.clone());
            merged.push(project);
        }
        // 구버전 단일 필드가 목록에 없으면 하위호환용으로 합친다.
        if let Some(legacy) = self.project.clone() {
            if seen.insert(legacy.id.clone()) {
                merged.push(legacy);
            }
        }
        merged
    }

    /// 보드 조회·동기화 기준이 되는 활성 프로젝트.
    /// `active_project_id`가 목록에 없거나 비어 있으면 레거시 단일 프로젝트,
    /// 없으면 목록 첫 항목 순으로 폴백한다.
    pub fn active_project(&self) -> Option<GithubProjectRef> {
        let all = self.all_projects();
        if all.is_empty() {
            return None;
        }
        if let Some(active_id) = self.active_project_id.as_deref() {
            if let Some(found) = all.iter().find(|project| project.id == active_id).cloned() {
                return Some(found);
            }
        }
        if let Some(legacy) = self.project.clone() {
            return Some(legacy);
        }
        all.into_iter().next()
    }

    /// projects에 upsert하고 active로 지정한다. 레거시 `project`도 동기화한다.
    pub fn upsert_active(&mut self, project: GithubProjectRef) {
        if let Some(existing) = self.projects.iter_mut().find(|item| item.id == project.id) {
            *existing = project.clone();
        } else {
            self.projects.push(project.clone());
        }
        self.active_project_id = Some(project.id.clone());
        self.project = Some(project);
    }

    /// 지정 id를 제거한다. active였으면 첫 후보로 폴백하고 레거시도 동기화한다.
    pub fn remove_project(&mut self, project_id: &str) -> bool {
        let before = self.projects.len() + usize::from(self.project.is_some());
        self.projects.retain(|item| item.id != project_id);
        if self
            .project
            .as_ref()
            .is_some_and(|item| item.id == project_id)
        {
            self.project = None;
        }
        if self
            .active_project_id
            .as_deref()
            .is_some_and(|id| id == project_id)
        {
            self.active_project_id = None;
        }
        let removed = before != self.projects.len() + usize::from(self.project.is_some());
        // active가 비었으면 남은 첫 후보를 승격해 레거시 리더와 일치시킨다.
        if self.active_project_id.is_none() {
            if let Some(next) = self.projects.first().cloned() {
                self.active_project_id = Some(next.id.clone());
                self.project = Some(next);
            } else if self.project.is_some() {
                self.active_project_id = self.project.as_ref().map(|item| item.id.clone());
            }
        }
        removed
    }

    /// 지정 id를 active로 승격한다. 레거시 `project`도 동기화한다.
    pub fn set_active(&mut self, project_id: &str) -> bool {
        let found = self.all_projects();
        if let Some(next) = found.into_iter().find(|item| item.id == project_id) {
            self.active_project_id = Some(next.id.clone());
            self.project = Some(next);
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubProjectRef {
    pub id: String,
    pub owner: String,
    pub number: u64,
    /// 연결 시 확인된 조직/사용자 구분. 없으면 조직 우선으로 재시도한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<ProjectOwnerScope>,
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
