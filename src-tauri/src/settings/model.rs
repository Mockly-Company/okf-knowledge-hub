use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::workspace::service::WorkspaceSummary;

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
