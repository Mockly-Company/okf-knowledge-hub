//! 앱 데이터 폴더 아래에 두는 문서 저장소 clone과 AI 작업용 worktree 위치.

use std::path::{Path, PathBuf};

use crate::error::{AppError, ErrorCode};

/// 문서 저장소 clone 위치: `{app_data}/repos/{owner}/{name}`.
pub fn managed_clone_dir(app_data: &Path, full_name: &str) -> Result<PathBuf, AppError> {
    let (owner, name) = split_full_name(full_name)?;
    Ok(app_data.join("repos").join(owner).join(name))
}

/// AI 작업용 worktree를 모아 두는 위치: `{app_data}/worktrees/{owner}/{name}`.
pub fn managed_worktrees_dir(app_data: &Path, full_name: &str) -> Result<PathBuf, AppError> {
    let (owner, name) = split_full_name(full_name)?;
    Ok(app_data.join("worktrees").join(owner).join(name))
}

/// GitHub owner·저장소 이름에 쓰이는 글자만 허용해 경로 조작을 막는다.
fn split_full_name(full_name: &str) -> Result<(&str, &str), AppError> {
    let mut parts = full_name.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(invalid_repository_name());
    };
    if [owner, name].iter().all(|part| valid_segment(part)) {
        Ok((owner, name))
    } else {
        Err(invalid_repository_name())
    }
}

fn valid_segment(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
}

fn invalid_repository_name() -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "선택한 GitHub 저장소 이름이 올바르지 않습니다.",
    )
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{managed_clone_dir, managed_worktrees_dir};

    #[test]
    fn managed_clone_paths_differ_by_owner() {
        let root = Path::new("app-data");

        let first = managed_clone_dir(root, "a/docs").unwrap();
        let second = managed_clone_dir(root, "b/docs").unwrap();

        assert_ne!(first, second);
        assert_eq!(first, root.join("repos").join("a").join("docs"));
        assert_eq!(
            managed_worktrees_dir(root, "a/docs").unwrap(),
            root.join("worktrees").join("a").join("docs")
        );
    }

    #[test]
    fn managed_clone_dir_rejects_path_tricks() {
        let root = Path::new("app-data");
        for name in [
            "../x", "a/..", "a", "a/b/c", "./docs", "a/.", r"a\b/c", " a/docs", "",
        ] {
            assert!(managed_clone_dir(root, name).is_err(), "{name:?}");
        }
    }
}
