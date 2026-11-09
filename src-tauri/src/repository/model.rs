use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// 문서 저장소 최신화 결과. 받지 않은 경우에는 이유를 알려 준다.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PullOutcome {
    Updated,
    UpToDate,
    SkippedLocalChanges,
    SkippedNotOnDefaultBranch,
    SkippedDiverged,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub root: PathBuf,
    pub head_oid: Option<String>,
    pub default_branch: Option<String>,
    pub is_dirty: bool,
    pub has_content: bool,
    pub remote_url: Option<String>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloneRequest {
    pub repository_id: String,
    pub full_name: String,
    pub https_url: String,
    pub parent_directory: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloneProgressStage {
    ReceivingObjects,
    ResolvingDeltas,
    CheckingOut,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub stage: CloneProgressStage,
    pub completed: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializationResult {
    pub root: PathBuf,
    pub branch: String,
    pub commit_oid: String,
    pub commit_message: String,
    pub pushed: bool,
    pub draft_pull_request_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryIdentity {
    pub database_id: u64,
    pub login: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct CommitOutcome {
    pub branch: String,
    pub commit_oid: String,
    pub original_branch: Option<String>,
}
