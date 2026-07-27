use std::path::Path;

use crate::error::AppError;

pub use super::contract::{
    InitializationPreview, InitializationStrategy, PreviewFile, PreviewRegistry,
    RepositoryPopulation, WorkspaceDiagnostic, WorkspaceDiagnosticCode, WorkspaceInspection,
    WorkspaceSummary,
};

pub struct WorkspaceService;

impl WorkspaceService {
    pub fn inspect(repository_path: &Path) -> Result<WorkspaceInspection, AppError> {
        super::inspection::inspect(repository_path)
    }

    pub fn create_initialization_preview(
        repository_path: &Path,
        workspace_name: &str,
        repository_fingerprint: &str,
        population: RepositoryPopulation,
    ) -> Result<InitializationPreview, AppError> {
        super::initialization::create_initialization_preview(
            repository_path,
            workspace_name,
            repository_fingerprint,
            population,
        )
    }

    pub fn validate_preview_paths(
        repository_path: &Path,
        files: &[PreviewFile],
    ) -> Result<(), AppError> {
        super::initialization::validate_preview_paths(repository_path, files)
    }

    pub(crate) fn validate_generated_initialization_preview(
        preview: &InitializationPreview,
    ) -> Result<(), AppError> {
        super::initialization::validate_generated_initialization_preview(preview)
    }
}

#[cfg(test)]
use crate::error::ErrorCode;
#[cfg(test)]
use uuid::Uuid;

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
