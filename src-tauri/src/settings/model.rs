use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::project_board::model::ProjectOwnerScope;
use crate::workspace::service::WorkspaceSummary;
use uuid::Uuid;

/// 앱 설정에 저장하는 연결된 GitHub Project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProject {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub scope: ProjectOwnerScope,
}

/// 프로젝트가 문서 저장소로 쓰는 GitHub 저장소.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsRepository {
    pub repository_id: String,
    pub full_name: String,
}

/// 앱에서 관리하는 통합 작업 단위(워크스페이스).
/// `Project + 문서 저장소` 모드와 `문서 저장소 단독` 모드를 모두 표현한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWorkspace {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub project: Option<LinkedProject>,
    #[serde(default)]
    pub docs_repository: Option<DocsRepository>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DisplayDensity {
    #[default]
    Default,
    Compact,
}

impl DisplayDensity {
    pub fn from_stored(value: Option<&str>) -> Self {
        match value {
            Some("compact") => Self::Compact,
            _ => Self::Default,
        }
    }

    pub fn as_stored(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Compact => "compact",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CurrentWorkspaceStatus {
    Connected,
    RecoveryRequired,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWorkspace {
    pub path: PathBuf,
    pub status: CurrentWorkspaceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<WorkspaceSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<KnowledgeRepository>,
    /// `.okf/workspace.yml`이 있는 OKF 저장소인지. 아니면 화면에 경고를 띄운다.
    pub okf: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRepository {
    pub id: String,
    pub full_name: String,
}

impl CurrentWorkspace {
    pub fn connected(path: PathBuf, summary: WorkspaceSummary) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::Connected,
            summary: Some(summary),
            repository: None,
            okf: true,
        }
    }

    pub fn connected_to_repository(
        path: PathBuf,
        summary: WorkspaceSummary,
        repository: KnowledgeRepository,
    ) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::Connected,
            summary: Some(summary),
            repository: Some(repository),
            okf: true,
        }
    }

    /// OKF 설정이 없는 저장소. 저장소 전체를 문서 폴더로 본다.
    pub fn connected_without_okf(path: PathBuf, repository: KnowledgeRepository) -> Self {
        let summary = WorkspaceSummary {
            id: Uuid::new_v5(&Uuid::NAMESPACE_URL, repository.id.as_bytes()),
            name: repository.full_name.clone(),
            schema_version: 0,
            document_roots: vec![".".to_owned()],
            repository_count: 1,
        };
        Self {
            path,
            status: CurrentWorkspaceStatus::Connected,
            summary: Some(summary),
            repository: Some(repository),
            okf: false,
        }
    }

    pub fn recovery_required(path: PathBuf) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::RecoveryRequired,
            summary: None,
            repository: None,
            okf: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingInitializationContext {
    pub preview_id: Uuid,
    pub root: PathBuf,
    pub repository_id: String,
    pub repository_full_name: String,
    pub author_id: u64,
    pub author_login: String,
    pub created_at_unix: i64,
    pub expires_at_unix: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_result: Option<crate::repository::model::InitializationResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_density_accepts_only_the_two_supported_wire_values() {
        assert_eq!(
            serde_json::from_str::<DisplayDensity>(r#""default""#).unwrap(),
            DisplayDensity::Default
        );
        assert_eq!(
            serde_json::from_str::<DisplayDensity>(r#""compact""#).unwrap(),
            DisplayDensity::Compact
        );
        assert!(serde_json::from_str::<DisplayDensity>(r#""comfortable""#).is_err());
    }
}
