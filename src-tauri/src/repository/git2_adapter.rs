use std::path::Path;
use std::sync::Arc;
use std::{fs, io::Write};

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    Cred, FetchOptions, PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use sha2::{Digest, Sha256};
use url::Url;

use crate::auth::model::AccessToken;
use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::repository::model::{
    CloneProgress, CloneProgressStage, CommitOutcome, RepositoryIdentity, RepositorySnapshot,
};
use crate::repository::service::{CloneProgressSink, GitRepositoryPort};
use crate::workspace::service::{InitializationPreview, InitializationStrategy};

#[derive(Default)]
pub struct Git2RepositoryAdapter;

impl GitRepositoryPort for Git2RepositoryAdapter {
    fn inspect(&self, path: &Path) -> Result<RepositorySnapshot, AppError> {
        let root = path
            .canonicalize()
            .map_err(|_| repository_path_error(path))?;
        let repository = Repository::open(&root).map_err(|_| repository_path_error(&root))?;
        if repository.is_bare() || repository.workdir() != Some(root.as_path()) {
            return Err(repository_path_error(&root));
        }

        let head_oid = repository
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|oid| oid.to_string());
        let default_branch = repository
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(str::to_owned));
        let raw_remote_url = repository
            .find_remote("origin")
            .ok()
            .and_then(|remote| remote.url().map(str::to_owned));
        let remote_url = raw_remote_url.as_deref().map(public_remote_url);
        let status_entries = status_entries(&repository)?;
        let fingerprint = repository_fingerprint(
            &root,
            head_oid.as_deref(),
            &status_entries,
            raw_remote_url.as_deref(),
        );

        Ok(RepositorySnapshot {
            root,
            head_oid: head_oid.clone(),
            default_branch,
            is_dirty: !status_entries.is_empty(),
            has_content: head_oid.is_some(),
            remote_url,
            fingerprint,
        })
    }

    fn clone_repository(
        &self,
        clean_remote_url: &str,
        target: &Path,
        access_token: AccessToken,
        progress: Arc<dyn CloneProgressSink>,
    ) -> Result<RepositorySnapshot, AppError> {
        progress.emit(CloneProgress {
            stage: CloneProgressStage::ReceivingObjects,
            completed: 0,
            total: 0,
        });

        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username, _allowed| {
            Cred::userpass_plaintext("x-access-token", access_token.expose_secret())
        });
        let transfer_progress = progress.clone();
        callbacks.transfer_progress(move |stats| {
            transfer_progress.emit(CloneProgress {
                stage: CloneProgressStage::ReceivingObjects,
                completed: stats.received_objects(),
                total: stats.total_objects(),
            });
            true
        });
        let mut fetch = FetchOptions::new();
        fetch.remote_callbacks(callbacks);

        let checkout_progress = progress.clone();
        let mut checkout = CheckoutBuilder::new();
        checkout.progress(move |_path, completed, total| {
            checkout_progress.emit(CloneProgress {
                stage: CloneProgressStage::CheckingOut,
                completed,
                total,
            });
        });

        let mut builder = RepoBuilder::new();
        builder.fetch_options(fetch).with_checkout(checkout);
        let repository = match builder.clone(clean_remote_url, target) {
            Ok(repository) => repository,
            Err(_) => {
                // libgit2 may clean an incomplete checkout. Keep an explicit
                // recovery location so the app never silently deletes the
                // path it reported to the user.
                let _ = fs::create_dir_all(target);
                return Err(clone_error(target));
            }
        };
        progress.emit(CloneProgress {
            stage: CloneProgressStage::ResolvingDeltas,
            completed: 1,
            total: 1,
        });
        progress.emit(CloneProgress {
            stage: CloneProgressStage::CheckingOut,
            completed: 1,
            total: 1,
        });
        repository
            .remote_set_url("origin", clean_remote_url)
            .map_err(|_| clone_error(target))?;
        drop(repository);
        self.inspect(target)
    }

    fn commit_initialization(
        &self,
        root: &Path,
        preview: &InitializationPreview,
        identity: &RepositoryIdentity,
    ) -> Result<CommitOutcome, AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        let original_branch = repository
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(str::to_owned));
        let parent_oid = repository.head().ok().and_then(|head| head.target());

        if repository
            .find_reference(&format!("refs/heads/{}", preview.branch))
            .is_ok()
            && original_branch.as_deref() != Some(preview.branch.as_str())
        {
            return Err(AppError::new(
                ErrorCode::RepositoryPathConflict,
                "초기화 branch가 이미 존재합니다.",
            )
            .with_detail("branch", &preview.branch));
        }

        match (&preview.strategy, parent_oid) {
            (InitializationStrategy::DraftPullRequest { .. }, Some(oid)) => {
                let commit = repository
                    .find_commit(oid)
                    .map_err(|_| repository_git_error("기준 commit을 찾지 못했습니다."))?;
                repository
                    .branch(&preview.branch, &commit, false)
                    .map_err(|_| repository_git_error("초기화 branch를 만들지 못했습니다."))?;
                checkout(&repository, &preview.branch)?;
            }
            (InitializationStrategy::DirectPush, Some(oid)) => {
                if original_branch.as_deref() != Some(preview.branch.as_str()) {
                    let commit = repository
                        .find_commit(oid)
                        .map_err(|_| repository_git_error("기준 commit을 찾지 못했습니다."))?;
                    repository
                        .branch(&preview.branch, &commit, false)
                        .map_err(|_| repository_git_error("기본 branch를 만들지 못했습니다."))?;
                    checkout(&repository, &preview.branch)?;
                }
            }
            (InitializationStrategy::DraftPullRequest { .. }, None) => {
                return Err(repository_git_error("기준 commit이 없습니다."));
            }
            (InitializationStrategy::DirectPush, None) => repository
                .set_head(&format!("refs/heads/{}", preview.branch))
                .map_err(|_| repository_git_error("기본 branch를 준비하지 못했습니다."))?,
        }

        for file in &preview.files {
            let path = root.join(&file.path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|_| initialization_write_error(&file.path))?;
            }
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| initialization_write_error(&file.path))?;
            output
                .write_all(file.content.as_bytes())
                .and_then(|()| output.sync_all())
                .map_err(|_| initialization_write_error(&file.path))?;
        }

        let mut index = repository
            .index()
            .map_err(|_| repository_git_error("Git index를 열지 못했습니다."))?;
        for file in &preview.files {
            index.add_path(Path::new(&file.path)).map_err(|_| {
                repository_git_error("초기화 파일을 Git index에 추가하지 못했습니다.")
            })?;
        }
        index
            .write()
            .map_err(|_| repository_git_error("Git index를 저장하지 못했습니다."))?;
        let tree_oid = index
            .write_tree()
            .map_err(|_| repository_git_error("초기화 tree를 만들지 못했습니다."))?;
        let tree = repository
            .find_tree(tree_oid)
            .map_err(|_| repository_git_error("초기화 tree를 읽지 못했습니다."))?;
        let email = format!(
            "{}+{}@users.noreply.github.com",
            identity.database_id, identity.login
        );
        let signature = Signature::now(&identity.login, &email)
            .map_err(|_| repository_git_error("Git 작성자 정보를 만들지 못했습니다."))?;
        let parent = parent_oid
            .map(|oid| repository.find_commit(oid))
            .transpose()
            .map_err(|_| repository_git_error("기준 commit을 읽지 못했습니다."))?;
        let parents = parent.iter().collect::<Vec<_>>();
        let commit_oid = repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                &preview.commit_message,
                &tree,
                &parents,
            )
            .map_err(|_| repository_git_error("초기화 commit을 만들지 못했습니다."))?;

        Ok(CommitOutcome {
            branch: preview.branch.clone(),
            commit_oid: commit_oid.to_string(),
            original_branch,
        })
    }

    fn push_branch(
        &self,
        root: &Path,
        branch: &str,
        access_token: AccessToken,
    ) -> Result<(), AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username, _allowed| {
            Cred::userpass_plaintext("x-access-token", access_token.expose_secret())
        });
        let mut options = PushOptions::new();
        options.remote_callbacks(callbacks);
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
        repository
            .find_remote("origin")
            .and_then(|mut remote| remote.push(&[&refspec], Some(&mut options)))
            .map_err(|_| push_error(branch))
    }

    fn checkout_branch(&self, root: &Path, branch: &str) -> Result<(), AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        checkout(&repository, branch)
    }
}

fn public_remote_url(value: &str) -> String {
    let Ok(mut url) = Url::parse(value) else {
        return value.to_owned();
    };
    if matches!(url.scheme(), "http" | "https" | "ssh") {
        let _ = url.set_username("");
        let _ = url.set_password(None);
        url.set_query(None);
        url.set_fragment(None);
        return url.into();
    }
    value.to_owned()
}

fn status_entries(repository: &Repository) -> Result<Vec<String>, AppError> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(|_| repository_git_error("저장소 변경 상태를 확인하지 못했습니다."))?;
    let mut entries = statuses
        .iter()
        .map(|entry| {
            format!(
                "{:08x}:{}",
                entry.status().bits(),
                entry.path().unwrap_or("<non-utf8>")
            )
        })
        .collect::<Vec<_>>();
    entries.sort_unstable();
    Ok(entries)
}

fn repository_fingerprint(
    root: &Path,
    head_oid: Option<&str>,
    status_entries: &[String],
    remote_url: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    for value in std::iter::once(root.to_string_lossy().as_bytes().to_vec())
        .chain(std::iter::once(
            head_oid.unwrap_or("empty").as_bytes().to_vec(),
        ))
        .chain(status_entries.iter().map(|value| value.as_bytes().to_vec()))
        .chain(std::iter::once(
            remote_url.unwrap_or("").as_bytes().to_vec(),
        ))
    {
        hasher.update(value.len().to_be_bytes());
        hasher.update(value);
    }
    format!("{:x}", hasher.finalize())
}

fn repository_path_error(path: &Path) -> AppError {
    AppError::new(
        ErrorCode::RepositoryPathConflict,
        "선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.",
    )
    .with_recovery(RecoveryAction::ChooseAnotherDirectory)
    .with_detail("path", path.to_string_lossy())
}

fn repository_git_error(message: &str) -> AppError {
    AppError::new(ErrorCode::GithubUnavailable, message).with_recovery(RecoveryAction::Retry)
}

fn clone_error(path: &Path) -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "저장소 clone을 완료하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("path", path.to_string_lossy())
}

fn checkout(repository: &Repository, branch: &str) -> Result<(), AppError> {
    repository
        .set_head(&format!("refs/heads/{branch}"))
        .and_then(|()| repository.checkout_head(Some(CheckoutBuilder::new().safe())))
        .map_err(|_| repository_git_error("branch를 checkout하지 못했습니다."))
}

fn initialization_write_error(path: &str) -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "초기화 파일을 새 파일로 만들지 못했습니다.",
    )
    .with_detail("path", path)
}

fn push_error(branch: &str) -> AppError {
    AppError::new(
        ErrorCode::PushFailed,
        "초기화 branch를 push하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("branch", branch)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Mutex};

    use git2::{Repository, Signature};
    use secrecy::SecretString;

    use super::Git2RepositoryAdapter;
    use crate::auth::model::AccessToken;
    use crate::repository::model::{CloneProgress, CloneProgressStage};
    use crate::repository::service::{CloneProgressSink, GitRepositoryPort};

    #[derive(Clone, Default)]
    struct RecordingProgress(Arc<Mutex<Vec<CloneProgress>>>);

    impl CloneProgressSink for RecordingProgress {
        fn emit(&self, progress: CloneProgress) {
            self.0.lock().unwrap().push(progress);
        }
    }

    fn commit_file(repository: &Repository, path: &str, content: &str) {
        let root = repository.workdir().unwrap();
        fs::write(root.join(path), content).unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(std::path::Path::new(path)).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("fixture", "fixture@example.com").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap();
    }

    #[test]
    fn fingerprint_changes_when_the_worktree_changes() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        repository
            .remote("origin", "https://github.com/example/knowledge.git")
            .unwrap();
        let adapter = Git2RepositoryAdapter;

        let clean = adapter.inspect(directory.path()).unwrap();
        fs::write(directory.path().join("README.md"), "changed").unwrap();
        let dirty = adapter.inspect(directory.path()).unwrap();

        assert!(!clean.is_dirty);
        assert!(dirty.is_dirty);
        assert_ne!(clean.fingerprint, dirty.fingerprint);
        assert_eq!(
            clean.remote_url.as_deref(),
            Some("https://github.com/example/knowledge.git")
        );
    }

    #[test]
    fn fingerprint_is_stable_for_the_same_repository_state() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        let adapter = Git2RepositoryAdapter;

        let first = adapter.inspect(directory.path()).unwrap();
        let second = adapter.inspect(directory.path()).unwrap();

        assert_eq!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn snapshot_never_exposes_credentials_from_an_existing_origin_url() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        repository
            .remote(
                "origin",
                "https://secret-value@github.com/example/knowledge.git",
            )
            .unwrap();

        let snapshot = Git2RepositoryAdapter.inspect(directory.path()).unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();

        assert_eq!(
            snapshot.remote_url.as_deref(),
            Some("https://github.com/example/knowledge.git")
        );
        assert!(!json.contains("secret-value"));
    }

    #[test]
    fn clones_a_temporary_bare_remote_and_emits_only_public_stages() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "ready");
        let bare_directory = tempfile::tempdir().unwrap();
        Repository::init_bare(bare_directory.path()).unwrap();
        source
            .remote("origin", bare_directory.path().to_str().unwrap())
            .unwrap();
        source
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/master:refs/heads/master"], None)
            .unwrap();
        let target_parent = tempfile::tempdir().unwrap();
        let target = target_parent.path().join("knowledge");
        let progress = RecordingProgress::default();
        let adapter = Git2RepositoryAdapter;

        let snapshot = adapter
            .clone_repository(
                bare_directory.path().to_str().unwrap(),
                &target,
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
                Arc::new(progress.clone()),
            )
            .unwrap();

        assert_eq!(
            fs::read_to_string(target.join("README.md")).unwrap(),
            "ready"
        );
        assert!(!snapshot.is_dirty);
        let stages = progress
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|item| item.stage.clone())
            .collect::<Vec<_>>();
        assert!(stages.contains(&CloneProgressStage::ReceivingObjects));
        assert!(stages.contains(&CloneProgressStage::ResolvingDeltas));
        assert!(stages.contains(&CloneProgressStage::CheckingOut));
        assert!(!format!("{stages:?}").contains("secret-not-for-output"));
    }

    #[test]
    fn failed_clone_reports_and_preserves_the_incomplete_target_path() {
        let target_parent = tempfile::tempdir().unwrap();
        let target = target_parent.path().join("knowledge");
        let adapter = Git2RepositoryAdapter;

        let error = adapter
            .clone_repository(
                "/definitely/missing/remote.git",
                &target,
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
                Arc::new(RecordingProgress::default()),
            )
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::CloneFailed);
        assert_eq!(error.recovery, Some(crate::error::RecoveryAction::Retry));
        assert_eq!(
            error.details.get("path").map(String::as_str),
            target.to_str()
        );
        if target.exists() {
            assert!(target.is_dir());
        }
    }
}
