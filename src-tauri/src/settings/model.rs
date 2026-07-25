use std::path::PathBuf;

use serde::Serialize;

use crate::workspace::service::WorkspaceSummary;

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
}

impl CurrentWorkspace {
    pub fn connected(path: PathBuf, summary: WorkspaceSummary) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::Connected,
            summary: Some(summary),
        }
    }

    pub fn recovery_required(path: PathBuf) -> Self {
        Self {
            path,
            status: CurrentWorkspaceStatus::RecoveryRequired,
            summary: None,
        }
    }
}
