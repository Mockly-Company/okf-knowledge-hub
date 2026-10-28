pub mod model;

pub use model::{
    parse_project_url, BoardIssue, BoardLayer, BoardStatus, GithubProjectList, ParsedProjectUrl,
    ProjectBoard, ProjectOwnerScope, ResolvedGithubProject,
};

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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

/// FNV-1a 64비트: 표준 라이브러리만으로 안정적인 해시.
/// `DefaultHasher`는 버전 간 안정성을 보장하지 않아 영속 파일명에 쓸 수 없다.
fn stable_hash64(raw: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in raw.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn cache_file_parts(cache_key: &str) -> (String, String) {
    let stem: String = sanitize_cache_key(cache_key).chars().take(32).collect();
    let digest = format!("{:016x}", stable_hash64(cache_key));
    (stem, digest)
}

pub fn project_board_cache_file(cache_root: &Path, cache_key: &str) -> PathBuf {
    let (stem, digest) = cache_file_parts(cache_key);
    cache_root.join(format!("board-{stem}-{digest}.json"))
}

static CACHE_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 동시 sync가 같은 tmp를 덮어쓰지 않도록 pid·일련번호를 붙인 임시 경로.
pub fn project_board_cache_tmp_file(cache_root: &Path, cache_key: &str) -> PathBuf {
    let (stem, digest) = cache_file_parts(cache_key);
    let seq = CACHE_TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    cache_root.join(format!(
        "board-{stem}-{digest}.{}.{seq}.tmp",
        std::process::id()
    ))
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
                ErrorCode::CacheUnavailable,
                "저장된 Project 보드를 읽을 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("path", path.display().to_string())
            .with_detail("reason", error.to_string())
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ProjectBoard::empty()),
        Err(error) => Err(AppError::new(
            ErrorCode::CacheUnavailable,
            "저장된 Project 보드를 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("path", path.display().to_string())
        .with_detail("reason", error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::{load_cached_board, project_board_cache_file};
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
            project_board_cache_file(dir.path(), "test"),
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
        std::fs::write(project_board_cache_file(dir.path(), "test"), "{oops").expect("cache file");
        let error = load_cached_board(dir.path(), "test")
            .await
            .expect_err("broken cache");
        assert_eq!(error.message, "저장된 Project 보드를 읽을 수 없습니다.");
    }

    #[test]
    fn cache_keys_with_same_sanitized_form_stay_distinct() {
        let dir = tempfile::tempdir().expect("temp dir");
        let left = project_board_cache_file(dir.path(), "PVT:1");
        let right = project_board_cache_file(dir.path(), "PVT/1");
        assert_ne!(left, right);
        assert_eq!(
            project_board_cache_file(dir.path(), "PVT:1"),
            left,
            "same key must map to the same file"
        );
    }
}
