use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceInspection {
    Ready {
        summary: WorkspaceSummary,
    },
    InitializationRequired,
    Invalid {
        diagnostics: Vec<WorkspaceDiagnostic>,
    },
    UnsupportedVersion {
        found_version: u64,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: Uuid,
    pub name: String,
    pub schema_version: u32,
    pub document_roots: Vec<String>,
    pub repository_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceDiagnosticCode {
    WorkspaceYamlInvalid,
    WorkspaceStructureInvalid,
    SchemaVersionInvalid,
    WorkspaceTypeInvalid,
    WorkspaceIdMissing,
    WorkspaceIdTypeInvalid,
    WorkspaceIdNotV4,
    WorkspaceNameMissing,
    WorkspaceNameTypeInvalid,
    WorkspaceNameEmpty,
    DocumentsTypeInvalid,
    DocumentRootsMissing,
    DocumentRootsTypeInvalid,
    DocumentRootTypeInvalid,
    DocumentRootPathMissing,
    DocumentRootPathTypeInvalid,
    DocumentRootEmpty,
    DocumentRootOutsideRepository,
    RepositoriesTypeInvalid,
    RepositoryTypeInvalid,
    DuplicateRepositoryKey,
    DuplicateRepositoryLabel,
    RepositoryKeyMissing,
    RepositoryKeyTypeInvalid,
    RepositoryKeyEmpty,
    RepositoryKeyInvalid,
    RepositoryLabelMissing,
    RepositoryLabelTypeInvalid,
    RepositoryGithubMissing,
    RepositoryGithubTypeInvalid,
    RepositoryGithubIdMissing,
    RepositoryGithubIdTypeInvalid,
    RepositoryGithubFullNameMissing,
    RepositoryGithubFullNameTypeInvalid,
    GithubTypeInvalid,
    GithubProjectTypeInvalid,
    GithubProjectIdMissing,
    GithubProjectIdTypeInvalid,
    GithubProjectOwnerMissing,
    GithubProjectOwnerTypeInvalid,
    GithubProjectNumberMissing,
    GithubProjectNumberTypeInvalid,
    UnknownRepositoryKey,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiagnostic {
    pub code: WorkspaceDiagnosticCode,
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializationPreview {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub repository_fingerprint: String,
    pub branch: String,
    pub commit_message: String,
    pub strategy: InitializationStrategy,
    pub files: Vec<PreviewFile>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RepositoryPopulation {
    Empty { default_branch: String },
    ExistingContent { default_branch: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InitializationStrategy {
    DirectPush,
    DraftPullRequest { base_branch: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub content: String,
    pub overwrites_existing: bool,
}

#[derive(Debug, Default)]
pub struct PreviewRegistry {
    previews: Mutex<HashMap<Uuid, InitializationPreview>>,
}

impl PreviewRegistry {
    pub fn insert(&self, preview: InitializationPreview) -> Result<(), AppError> {
        let mut previews = self
            .previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match previews.entry(preview.id) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(preview);
                Ok(())
            }
            std::collections::hash_map::Entry::Occupied(entry) => Err(AppError::new(
                ErrorCode::WorkspaceChangedSincePreview,
                "같은 ID의 초기화 미리보기가 이미 등록되어 있습니다.",
            )
            .with_detail("previewId", entry.key().to_string())),
        }
    }

    pub fn get(&self, id: Uuid) -> Option<InitializationPreview> {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .cloned()
    }

    pub fn remove(&self, id: Uuid) -> Option<InitializationPreview> {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id)
    }

    pub fn clear(&self) {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }
}
