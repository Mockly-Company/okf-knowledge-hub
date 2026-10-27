pub mod model;

pub use model::{
    parse_project_url, BoardIssue, BoardLayer, BoardStatus, ParsedProjectUrl, ProjectBoard,
    ProjectOwnerScope, ResolvedGithubProject,
};

use std::path::{Path, PathBuf};

use crate::error::{AppError, ErrorCode, RecoveryAction};

/// 프로젝트별 보드 캐시 파일명 접두사. 구버전의 단일 `board.json`은 읽지 않는다.
fn sanitize_cache_key(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn project_board_cache_file(cache_root: &Path, cache_key: &str) -> PathBuf {
    cache_root.join(format!("board-{}.json", sanitize_cache_key(cache_key)))
}

/// 캐시된 보드를 읽는다. 캐시가 없으면 빈 보드를 반환한다.
/// `cache_key`는 프로젝트 ID 등 워크스페이스·프로젝트를 구분하는 값이다.
pub async fn load_cached_board(
    cache_root: &Path,
    cache_key: &str,
) -> Result<ProjectBoard, AppError> {
    let path = project_board_cache_file(cache_root, cache_key);
    match tokio::fs::read_to_string(&path).await {
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

    #[tokio::test]
    async fn missing_cache_reads_as_an_empty_board() {
        let dir = tempfile::tempdir().expect("temp dir");
        let board = load_cached_board(dir.path(), "test")
            .await
            .expect("empty board");
        assert_eq!(board, ProjectBoard::empty());
    }

    #[tokio::test]
    async fn cached_board_keeps_issues_and_fetch_time() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join("board-test.json"),
            r#"{"issues": [], "fetchedAt": "2026-10-25T12:00:00+09:00"}"#,
        )
        .expect("cache file");
        let board = load_cached_board(dir.path(), "test")
            .await
            .expect("cached board");
        assert_eq!(
            board.fetched_at.as_deref(),
            Some("2026-10-25T12:00:00+09:00")
        );
    }

    #[tokio::test]
    async fn broken_cache_reports_a_readable_error() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("board-test.json"), "{oops").expect("cache file");
        let error = load_cached_board(dir.path(), "test")
            .await
            .expect_err("broken cache");
        assert_eq!(error.message, "저장된 Project 보드를 읽을 수 없습니다.");
    }
}
