pub mod model;

pub use model::{BoardIssue, BoardLayer, BoardStatus, ProjectBoard};

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, ErrorCode, RecoveryAction};

const CACHE_FILE_NAME: &str = "board.json";

pub fn project_board_cache_file(cache_root: &Path) -> PathBuf {
    cache_root.join(CACHE_FILE_NAME)
}

/// 캐시된 보드를 읽는다. 캐시가 없으면 빈 보드를 반환한다.
/// 실제 GitHub 동기화는 후속 작업에서 이 파일에 쓴다.
pub fn load_cached_board(cache_root: &Path) -> Result<ProjectBoard, AppError> {
    let path = project_board_cache_file(cache_root);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "저장된 Project 보드를 읽을 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", path.display().to_string())
            .with_detail("reason", error.to_string())
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ProjectBoard::empty()),
        Err(error) => Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "저장된 Project 보드를 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", path.display().to_string())
        .with_detail("reason", error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::load_cached_board;
    use crate::project_board::ProjectBoard;

    #[test]
    fn missing_cache_reads_as_an_empty_board() {
        let dir = tempfile::tempdir().expect("temp dir");
        let board = load_cached_board(dir.path()).expect("empty board");
        assert_eq!(board, ProjectBoard::empty());
    }

    #[test]
    fn cached_board_keeps_issues_and_fetch_time() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("board.json"),
            r#"{"issues": [], "fetchedAt": "2026-10-25T12:00:00+09:00"}"#,
        )
        .expect("cache file");
        let board = load_cached_board(dir.path()).expect("cached board");
        assert_eq!(
            board.fetched_at.as_deref(),
            Some("2026-10-25T12:00:00+09:00")
        );
    }

    #[test]
    fn broken_cache_reports_a_readable_error() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("board.json"), "{oops").expect("cache file");
        let error = load_cached_board(dir.path()).expect_err("broken cache");
        assert_eq!(error.message, "저장된 Project 보드를 읽을 수 없습니다.");
    }
}
