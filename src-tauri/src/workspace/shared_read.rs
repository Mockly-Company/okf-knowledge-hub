//! Internal app/MCP read bridge. No registration, settings or mutation capability.
use super::shared::{SharedWorkspaceLookup, WorkspaceSourceRef};
use crate::{error::AppError, github::GithubService};

pub async fn read_shared_workspace(
    github: &GithubService,
    source: &WorkspaceSourceRef,
    commit: Option<&str>,
) -> Result<SharedWorkspaceLookup, AppError> {
    super::shared_source::resolve_shared_workspace(github, source, commit).await
}
