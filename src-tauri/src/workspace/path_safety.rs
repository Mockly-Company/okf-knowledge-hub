use std::path::{Path, PathBuf};

use crate::error::{AppError, ErrorCode, RecoveryAction};

pub(super) fn canonical_repository_root(repository_path: &Path) -> Result<PathBuf, AppError> {
    repository_path
        .canonicalize()
        .map_err(|error| workspace_io_error(repository_path, error))
}

pub(super) fn workspace_io_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "워크스페이스 파일을 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::OpenWorkspaceFile)
    .with_detail("path", path.display().to_string())
    .with_detail("reason", error.to_string())
}

pub(super) fn is_outside_repository_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let bytes = normalized.as_bytes();
    normalized.starts_with('/')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || normalized.split('/').any(|component| component == "..")
}
