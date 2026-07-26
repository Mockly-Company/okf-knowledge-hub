use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::workspace::service::WorkspaceSummary;
use uuid::Uuid;

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
        }
    }

    pub fn recovery_required(path: PathBuf) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::RecoveryRequired,
            summary: None,
            repository: None,
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
