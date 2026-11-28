//! Read-only shared definition contracts. A successful lookup is not registration
//! or permission to mutate any of the declared targets.
use serde::{Deserialize, Serialize};

use super::model::{DocumentRepository, GithubProjectRef, GithubRepositoryRef, LinkedRepository};
use crate::error::AppError;

pub const SHARED_CONFIG_PATH: &str = ".okf/workspace.yml";
pub const SHARED_FILE_LIMIT: u64 = 200 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSourceRef {
    pub repository_id: String,
    pub full_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProvenance {
    pub source: WorkspaceSourceRef,
    pub branch: String,
    pub commit: String,
    pub path: String,
    pub fetched_at_unix: u64,
    pub freshness: &'static str,
    pub source_is_fork: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedDiagnostic {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTargetAccess {
    pub target: String,
    pub available: bool,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRules {
    pub path: String,
    pub text: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSharedWorkspace {
    pub id: uuid::Uuid,
    pub name: String,
    pub source_repository: WorkspaceSourceRef,
    pub docs_repository: GithubRepositoryRef,
    pub docs_repository_inferred: bool,
    pub document_roots: Vec<String>,
    /// Complete scopes for new consumers; singular fields above mirror the first scope.
    pub document_repositories: Vec<DocumentRepository>,
    pub code_repositories: Vec<LinkedRepository>,
    pub projects: Vec<GithubProjectRef>,
    pub default_project_id: Option<String>,
    pub provenance: WorkspaceProvenance,
    pub config_fingerprint: String,
    pub target_fingerprint: String,
    pub rules: Option<SharedRules>,
    pub target_access: Vec<WorkspaceTargetAccess>,
    pub warnings: Vec<String>,
    pub registration_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SharedWorkspaceLookup {
    Found {
        workspace: Box<ResolvedSharedWorkspace>,
    },
    Missing {
        provenance: WorkspaceProvenance,
    },
    Invalid {
        provenance: WorkspaceProvenance,
        diagnostics: Vec<SharedDiagnostic>,
    },
    Unavailable {
        provenance: Option<WorkspaceProvenance>,
        error: AppError,
    },
    EmptyRepository {
        source: WorkspaceSourceRef,
    },
}
