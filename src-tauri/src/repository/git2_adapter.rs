use std::path::Path;
use std::sync::Arc;

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    Cred, Direction, FetchOptions, IndexEntry, IndexTime, Oid, PushOptions, RemoteCallbacks,
    Repository, Signature, StatusOptions,
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
        let remote_url = raw_remote_url.as_deref().and_then(public_remote_url);
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
        let approved_remote_url = clean_remote_url.to_owned();
        callbacks.credentials(move |url, _username, _allowed| {
            clone_credential_for_callback(url, &approved_remote_url, &access_token)
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
            Err(_) => return Err(clone_error(target)),
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

        if matches!(
            preview.strategy,
            InitializationStrategy::DraftPullRequest { .. }
        ) && parent_oid.is_none()
        {
            return Err(repository_git_error("기준 commit이 없습니다."));
        }

        let tree_oid = expected_initialization_tree(&repository, preview, parent_oid)?;
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
        let reference_name = format!("refs/heads/{}", preview.branch);
        if let Ok(reference) = repository.find_reference(&reference_name) {
            let existing = reference
                .peel_to_commit()
                .map_err(|_| repository_git_error("기존 초기화 branch를 읽지 못했습니다."))?;
            if commit_matches(
                &existing,
                tree_oid,
                parent_oid,
                &preview.commit_message,
                &identity.login,
                &email,
            ) {
                return Ok(CommitOutcome {
                    branch: preview.branch.clone(),
                    commit_oid: existing.id().to_string(),
                    original_branch,
                });
            }
            return Err(AppError::new(
                ErrorCode::RepositoryPathConflict,
                "초기화 branch가 다른 변경을 포함하고 있습니다.",
            )
            .with_detail("branch", &preview.branch));
        }
        let commit_oid = repository
            .commit(
                None,
                &signature,
                &signature,
                &preview.commit_message,
                &tree,
                &parents,
            )
            .map_err(|_| repository_git_error("초기화 commit을 만들지 못했습니다."))?;
        repository
            .reference(
                &reference_name,
                commit_oid,
                false,
                "OkHub workspace initialization",
            )
            .map_err(|_| repository_git_error("초기화 branch를 기록하지 못했습니다."))?;

        Ok(CommitOutcome {
            branch: preview.branch.clone(),
            commit_oid: commit_oid.to_string(),
            original_branch,
        })
    }

    fn verify_initialization_commit(
        &self,
        root: &Path,
        preview: &InitializationPreview,
        outcome: &CommitOutcome,
        identity: &RepositoryIdentity,
    ) -> Result<(), AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        let parent_oid = match &preview.strategy {
            InitializationStrategy::DraftPullRequest { base_branch } => Some(
                repository
                    .find_reference(&format!("refs/heads/{base_branch}"))
                    .ok()
                    .and_then(|reference| reference.target())
                    .ok_or_else(|| repository_git_error("기준 branch를 확인하지 못했습니다."))?,
            ),
            InitializationStrategy::DirectPush => None,
        };
        let expected_tree = expected_initialization_tree(&repository, preview, parent_oid)?;
        let expected_oid = Oid::from_str(&outcome.commit_oid)
            .map_err(|_| repository_git_error("초기화 commit ID가 올바르지 않습니다."))?;
        let reference = repository
            .find_reference(&format!("refs/heads/{}", outcome.branch))
            .map_err(|_| repository_git_error("초기화 branch를 확인하지 못했습니다."))?;
        if reference.target() != Some(expected_oid) {
            return Err(repository_git_error(
                "초기화 branch와 commit ID가 일치하지 않습니다.",
            ));
        }
        let commit = repository
            .find_commit(expected_oid)
            .map_err(|_| repository_git_error("초기화 commit을 확인하지 못했습니다."))?;
        let email = format!(
            "{}+{}@users.noreply.github.com",
            identity.database_id, identity.login
        );
        if !commit_matches(
            &commit,
            expected_tree,
            parent_oid,
            &preview.commit_message,
            &identity.login,
            &email,
        ) {
            return Err(repository_git_error(
                "초기화 commit 내용이 승인된 preview와 일치하지 않습니다.",
            ));
        }
        Ok(())
    }

    fn push_branch(
        &self,
        root: &Path,
        branch: &str,
        approved_remote_url: &str,
        access_token: AccessToken,
    ) -> Result<(), AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        let mut callbacks = RemoteCallbacks::new();
        let remote_url = approved_remote_url.to_owned();
        let callback_approved_url = remote_url.clone();
        callbacks.credentials(move |url, _username, _allowed| {
            credential_for_approved_remote(url, &callback_approved_url, &access_token)
        });
        let mut options = PushOptions::new();
        options.remote_callbacks(callbacks);
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
        repository
            .remote_anonymous(&remote_url)
            .and_then(|mut remote| remote.push(&[&refspec], Some(&mut options)))
            .map_err(|_| push_error(branch))
    }

    fn checkout_initialization(
        &self,
        root: &Path,
        _preview: &InitializationPreview,
        outcome: &CommitOutcome,
    ) -> Result<(), AppError> {
        checkout_initialization_with_failure_hook(root, outcome, || {})
    }

    fn origin_url(&self, root: &Path) -> Result<String, AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        repository
            .find_remote("origin")
            .ok()
            .and_then(|remote| remote.url().map(str::to_owned))
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::RepositoryRemoteMismatch,
                    "연결한 Git 저장소에 origin remote가 없습니다.",
                )
            })
    }

    fn attempt_directory(&self, root: &Path) -> Result<std::path::PathBuf, AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        Ok(repository.path().join("okhub"))
    }

    fn remote_branch_oid(
        &self,
        root: &Path,
        branch: &str,
        approved_remote_url: &str,
        access_token: AccessToken,
    ) -> Result<Option<String>, AppError> {
        let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
        remote_branch_oid_with_hook(
            &repository,
            branch,
            approved_remote_url,
            access_token,
            || {},
        )
    }
}

fn checkout_initialization_with_failure_hook(
    root: &Path,
    outcome: &CommitOutcome,
    after_failure: impl FnOnce(),
) -> Result<(), AppError> {
    let repository = Repository::open(root).map_err(|_| repository_path_error(root))?;
    let commit_oid = Oid::from_str(&outcome.commit_oid)
        .map_err(|_| repository_git_error("초기화 commit ID가 올바르지 않습니다."))?;
    let commit = repository
        .find_commit(commit_oid)
        .map_err(|_| repository_git_error("초기화 commit을 읽지 못했습니다."))?;
    let checkout_result = repository
        .checkout_tree(
            commit.as_object(),
            Some(CheckoutBuilder::new().safe().dry_run()),
        )
        .and_then(|()| {
            repository.checkout_tree(commit.as_object(), Some(CheckoutBuilder::new().safe()))
        });
    if checkout_result.is_err() {
        after_failure();
        return Err(checkout_failure("checkoutTree"));
    }
    if repository
        .set_head(&format!("refs/heads/{}", outcome.branch))
        .is_err()
    {
        after_failure();
        return Err(checkout_failure("setHead"));
    }
    Ok(())
}

fn remote_branch_oid_with_hook(
    repository: &Repository,
    branch: &str,
    approved_remote_url: &str,
    access_token: AccessToken,
    after_connect: impl FnOnce(),
) -> Result<Option<String>, AppError> {
    let mut remote = repository
        .remote_anonymous(approved_remote_url)
        .map_err(|_| push_error(branch))?;
    let mut callbacks = RemoteCallbacks::new();
    let approved_remote_url = approved_remote_url.to_owned();
    callbacks.credentials(move |url, _username, _allowed| {
        credential_for_approved_remote(url, &approved_remote_url, &access_token)
    });
    let connection = remote
        .connect_auth(Direction::Fetch, Some(callbacks), None)
        .map_err(|_| push_error(branch))?;
    after_connect();

    // git2 0.19 builds a Rust slice from libgit2's advertisement pointer.
    // An empty repository can return a null pointer with length zero, so guard
    // `list` behind a successfully advertised default branch.
    if connection.default_branch().is_err() {
        return Ok(None);
    }
    let wanted = format!("refs/heads/{branch}");
    connection
        .list()
        .map_err(|_| push_error(branch))
        .map(|heads| {
            heads
                .iter()
                .find(|head| head.name() == wanted)
                .map(|head| head.oid().to_string())
        })
}

fn credential_for_approved_remote(
    callback_url: &str,
    approved_remote_url: &str,
    access_token: &AccessToken,
) -> Result<Cred, git2::Error> {
    if callback_url != approved_remote_url {
        return Err(git2::Error::from_str("credential URL rejected"));
    }
    Cred::userpass_plaintext("x-access-token", access_token.expose_secret())
}

fn clone_credential_for_callback(
    callback_url: &str,
    approved_remote_url: &str,
    access_token: &AccessToken,
) -> Result<Cred, git2::Error> {
    credential_for_approved_remote(callback_url, approved_remote_url, access_token)
}

fn expected_initialization_tree(
    repository: &Repository,
    preview: &InitializationPreview,
    parent_oid: Option<Oid>,
) -> Result<Oid, AppError> {
    // `Index::new` has no repository ODB owner, so `add_frombuffer`
    // cannot create blobs. This handle is ODB-backed but remains isolated
    // because we replace its in-memory contents and never call `write`.
    let mut index = repository
        .index()
        .map_err(|_| repository_git_error("격리된 Git index를 만들지 못했습니다."))?;
    if let Some(oid) = parent_oid {
        let tree = repository
            .find_commit(oid)
            .and_then(|commit| commit.tree())
            .map_err(|_| repository_git_error("기준 tree를 읽지 못했습니다."))?;
        index
            .read_tree(&tree)
            .map_err(|_| repository_git_error("기준 tree를 복제하지 못했습니다."))?;
    } else {
        index
            .clear()
            .map_err(|_| repository_git_error("격리된 Git index를 비우지 못했습니다."))?;
    }
    for file in &preview.files {
        let entry = IndexEntry {
            ctime: IndexTime::new(0, 0),
            mtime: IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: 0,
            id: Oid::zero(),
            flags: 0,
            flags_extended: 0,
            path: file.path.as_bytes().to_vec(),
        };
        index
            .add_frombuffer(&entry, file.content.as_bytes())
            .map_err(|_| repository_git_error("초기화 blob을 만들지 못했습니다."))?;
    }
    index
        .write_tree_to(repository)
        .map_err(|_| repository_git_error("초기화 tree를 만들지 못했습니다."))
}

fn commit_matches(
    commit: &git2::Commit<'_>,
    tree_oid: Oid,
    parent_oid: Option<Oid>,
    message: &str,
    author_name: &str,
    author_email: &str,
) -> bool {
    commit.tree_id() == tree_oid
        && commit.parent_count() == usize::from(parent_oid.is_some())
        && parent_oid.is_none_or(|oid| commit.parent_id(0).ok() == Some(oid))
        && commit.message() == Some(message)
        && commit.author().name() == Some(author_name)
        && commit.author().email() == Some(author_email)
        && commit.committer().name() == Some(author_name)
        && commit.committer().email() == Some(author_email)
}

fn public_remote_url(value: &str) -> Option<String> {
    if let Some(path) = value.strip_prefix("git@github.com:") {
        return valid_github_repository_path(path).then(|| format!("git@github.com:{path}"));
    }
    let Ok(mut url) = Url::parse(value) else {
        return None;
    };
    if url.host_str() != Some("github.com")
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_github_repository_path(url.path().trim_start_matches('/'))
    {
        return None;
    }
    match url.scheme() {
        "https" => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
            Some(url.into())
        }
        "ssh" if url.username() == "git" && url.password().is_none() => Some(url.into()),
        _ => None,
    }
}

fn valid_github_repository_path(path: &str) -> bool {
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default();
    !owner.is_empty() && !repository.is_empty() && parts.next().is_none()
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

fn checkout_failure(stage: &str) -> AppError {
    AppError::new(
        ErrorCode::RepositoryDirty,
        "checkout을 완료하지 못해 저장소 상태를 수동으로 확인해야 합니다.",
    )
    .with_recovery(RecoveryAction::CleanWorkingTree)
    .with_detail("failureStage", stage)
}

fn clone_error(path: &Path) -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "저장소 clone을 완료하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("path", path.to_string_lossy())
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
    use crate::repository::model::RepositoryIdentity;
    use crate::repository::model::{CloneProgress, CloneProgressStage};
    use crate::repository::service::{CloneProgressSink, GitRepositoryPort};
    use crate::workspace::service::{InitializationPreview, InitializationStrategy, PreviewFile};
    use uuid::Uuid;

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

    fn initialization_preview() -> InitializationPreview {
        InitializationPreview {
            id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            workspace_name: "Mockly".into(),
            repository_fingerprint: "fixture".into(),
            branch: "okf/init-workspace".into(),
            commit_message: "chore: initialize OkHub workspace".into(),
            strategy: InitializationStrategy::DraftPullRequest {
                base_branch: "master".into(),
            },
            files: vec![PreviewFile {
                path: ".okf/workspace.yml".into(),
                content: "schema_version: 1\n".into(),
                overwrites_existing: false,
            }],
        }
    }

    fn direct_initialization_preview() -> InitializationPreview {
        InitializationPreview {
            id: Uuid::new_v4(),
            workspace_id: Uuid::new_v4(),
            workspace_name: "Mockly".into(),
            repository_fingerprint: "fixture".into(),
            branch: "main".into(),
            commit_message: "chore: initialize OkHub workspace".into(),
            strategy: InitializationStrategy::DirectPush,
            files: vec![
                PreviewFile {
                    path: ".okf/workspace.yml".into(),
                    content: "approved workspace".into(),
                    overwrites_existing: false,
                },
                PreviewFile {
                    path: "docs/.gitkeep".into(),
                    content: String::new(),
                    overwrites_existing: false,
                },
            ],
        }
    }

    fn identity(login: &str) -> RepositoryIdentity {
        RepositoryIdentity {
            database_id: 42,
            login: login.into(),
        }
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
    fn credential_callback_rejects_every_url_except_the_approved_repository_url() {
        let token = AccessToken::from_secret(SecretString::new("secret-not-for-output".into()));
        let approved = "https://github.com/example/knowledge.git";

        assert!(super::credential_for_approved_remote(approved, approved, &token).is_ok());
        for callback_url in [
            "https://attacker.example/example/knowledge.git",
            "https://github.com/example/other.git",
            "https://token@github.com/example/knowledge.git",
        ] {
            assert!(super::credential_for_approved_remote(callback_url, approved, &token).is_err());
        }
    }

    #[test]
    fn clone_transport_never_issues_credentials_to_a_redirected_or_mismatched_url() {
        let token = AccessToken::from_secret(SecretString::new("secret-not-for-output".into()));
        let approved = "https://github.com/example/knowledge.git";

        assert!(super::clone_credential_for_callback(approved, approved, &token).is_ok());
        for redirected in [
            "https://attacker.example/collect.git",
            "https://github.com/example/other.git",
            "https://token@github.com/example/knowledge.git",
        ] {
            assert!(
                super::clone_credential_for_callback(redirected, approved, &token).is_err(),
                "redirected callback unexpectedly received credentials: {redirected}"
            );
        }
    }

    #[test]
    fn snapshot_omits_credential_like_scp_and_unsupported_remote_schemes() {
        for remote in [
            "secret-value@github.com:example/knowledge.git",
            "ftp://github.com/example/knowledge.git",
            "helper::github.com/example/knowledge.git",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let repository = Repository::init(directory.path()).unwrap();
            commit_file(&repository, "README.md", "ready");
            repository.remote("origin", remote).unwrap();

            let snapshot = Git2RepositoryAdapter.inspect(directory.path()).unwrap();
            let json = serde_json::to_string(&snapshot).unwrap();

            assert_eq!(snapshot.remote_url, None, "{remote}");
            assert!(!json.contains("secret-value"));
            assert!(!json.contains("ftp://"));
            assert!(!json.contains("helper::"));
        }
    }

    #[test]
    fn snapshot_normalizes_supported_github_ssh_and_scp_remotes() {
        for (remote, expected) in [
            (
                "git@github.com:example/knowledge.git",
                "git@github.com:example/knowledge.git",
            ),
            (
                "ssh://git@github.com/example/knowledge.git",
                "ssh://git@github.com/example/knowledge.git",
            ),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let repository = Repository::init(directory.path()).unwrap();
            commit_file(&repository, "README.md", "ready");
            repository.remote("origin", remote).unwrap();

            let snapshot = Git2RepositoryAdapter.inspect(directory.path()).unwrap();

            assert_eq!(snapshot.remote_url.as_deref(), Some(expected));
        }
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
        fs::create_dir(&target).unwrap();
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
        fs::create_dir(&target).unwrap();
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
        assert!(target.is_dir());
    }

    #[test]
    fn failed_clone_never_removes_or_rewrites_a_preexisting_target_file() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
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
        fs::create_dir(&target).unwrap();
        let sentinel = target.join("keep.txt");
        fs::write(&sentinel, b"local content that must survive").unwrap();

        let error = Git2RepositoryAdapter
            .clone_repository(
                bare_directory.path().to_str().unwrap(),
                &target,
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
                Arc::new(RecordingProgress::default()),
            )
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::CloneFailed);
        assert_eq!(
            fs::read(&sentinel).unwrap(),
            b"local content that must survive"
        );
        assert!(!target.join("README.md").exists());
    }

    fn assert_remote_probe_metadata_is_untouched(
        repository: &Repository,
        original_fetch_head: &[u8],
    ) {
        assert_eq!(
            fs::read(repository.path().join("FETCH_HEAD")).unwrap(),
            original_fetch_head
        );
        assert_eq!(
            repository
                .references_glob("refs/okhub/remote-check/*")
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn remote_oid_probe_preserves_fetch_head_and_temporary_refs_on_success() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
        let bare_directory = tempfile::tempdir().unwrap();
        let bare = Repository::init_bare(bare_directory.path()).unwrap();
        source
            .remote("origin", bare_directory.path().to_str().unwrap())
            .unwrap();
        source
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/master:refs/heads/main"], None)
            .unwrap();
        bare.set_head("refs/heads/main").unwrap();
        let original_fetch_head = b"user-owned fetch state\n";
        fs::write(source.path().join("FETCH_HEAD"), original_fetch_head).unwrap();

        let oid = Git2RepositoryAdapter
            .remote_branch_oid(
                source_directory.path(),
                "main",
                bare_directory.path().to_str().unwrap(),
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
            )
            .unwrap();

        assert!(oid.is_some());
        assert_remote_probe_metadata_is_untouched(&source, original_fetch_head);
    }

    #[test]
    fn remote_oid_probe_preserves_fetch_head_and_temporary_refs_when_branch_is_missing() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
        let bare_directory = tempfile::tempdir().unwrap();
        Repository::init_bare(bare_directory.path()).unwrap();
        source
            .remote("origin", bare_directory.path().to_str().unwrap())
            .unwrap();
        let original_fetch_head = b"user-owned fetch state\n";
        fs::write(source.path().join("FETCH_HEAD"), original_fetch_head).unwrap();

        let oid = Git2RepositoryAdapter
            .remote_branch_oid(
                source_directory.path(),
                "missing",
                bare_directory.path().to_str().unwrap(),
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
            )
            .unwrap();

        assert_eq!(oid, None);
        assert_remote_probe_metadata_is_untouched(&source, original_fetch_head);
    }

    #[test]
    fn remote_oid_probe_preserves_fetch_head_and_temporary_refs_on_failure() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
        source
            .remote("origin", "/definitely/missing/remote.git")
            .unwrap();
        let original_fetch_head = b"user-owned fetch state\n";
        fs::write(source.path().join("FETCH_HEAD"), original_fetch_head).unwrap();

        let error = Git2RepositoryAdapter
            .remote_branch_oid(
                source_directory.path(),
                "main",
                "/definitely/missing/remote.git",
                AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
            )
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::PushFailed);
        assert_remote_probe_metadata_is_untouched(&source, original_fetch_head);
    }

    #[test]
    fn remote_oid_probe_never_overwrites_a_concurrent_fetch_head_update() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
        let bare_directory = tempfile::tempdir().unwrap();
        let bare = Repository::init_bare(bare_directory.path()).unwrap();
        source
            .remote("origin", bare_directory.path().to_str().unwrap())
            .unwrap();
        source
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/master:refs/heads/main"], None)
            .unwrap();
        bare.set_head("refs/heads/main").unwrap();
        let fetch_head = source.path().join("FETCH_HEAD");
        fs::write(&fetch_head, b"state before probe\n").unwrap();

        let oid = super::remote_branch_oid_with_hook(
            &source,
            "main",
            bare_directory.path().to_str().unwrap(),
            AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
            || fs::write(&fetch_head, b"concurrent state\n").unwrap(),
        )
        .unwrap();

        assert!(oid.is_some());
        assert_eq!(fs::read(&fetch_head).unwrap(), b"concurrent state\n");
    }

    #[test]
    fn remote_oid_probe_never_deletes_a_concurrently_created_fetch_head() {
        let source_directory = tempfile::tempdir().unwrap();
        let source = Repository::init(source_directory.path()).unwrap();
        commit_file(&source, "README.md", "remote content");
        let bare_directory = tempfile::tempdir().unwrap();
        let bare = Repository::init_bare(bare_directory.path()).unwrap();
        source
            .remote("origin", bare_directory.path().to_str().unwrap())
            .unwrap();
        source
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/master:refs/heads/main"], None)
            .unwrap();
        bare.set_head("refs/heads/main").unwrap();
        let fetch_head = source.path().join("FETCH_HEAD");
        assert!(!fetch_head.exists());

        let oid = super::remote_branch_oid_with_hook(
            &source,
            "main",
            bare_directory.path().to_str().unwrap(),
            AccessToken::from_secret(SecretString::new("secret-not-for-output".into())),
            || fs::write(&fetch_head, b"concurrent state\n").unwrap(),
        )
        .unwrap();

        assert!(oid.is_some());
        assert_eq!(fs::read(&fetch_head).unwrap(), b"concurrent state\n");
    }

    #[test]
    fn object_tree_commit_leaves_the_user_worktree_index_and_head_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        let original_head = repository.head().unwrap().target().unwrap();
        let original_index_tree = repository.index().unwrap().write_tree().unwrap();
        drop(repository);

        let outcome = Git2RepositoryAdapter
            .commit_initialization(
                directory.path(),
                &initialization_preview(),
                &identity("hyeeun"),
            )
            .unwrap();

        let repository = Repository::open(directory.path()).unwrap();
        assert_eq!(repository.head().unwrap().target(), Some(original_head));
        assert_eq!(repository.head().unwrap().shorthand(), Some("master"));
        assert_eq!(
            repository.index().unwrap().write_tree().unwrap(),
            original_index_tree
        );
        assert!(!directory.path().join(".okf/workspace.yml").exists());
        assert_eq!(
            repository
                .find_reference("refs/heads/okf/init-workspace")
                .unwrap()
                .target()
                .map(|oid| oid.to_string()),
            Some(outcome.commit_oid)
        );
    }

    #[test]
    fn failed_empty_checkout_fails_closed_then_allows_retry_after_manual_cleanup() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        let preview = direct_initialization_preview();
        let outcome = Git2RepositoryAdapter
            .commit_initialization(directory.path(), &preview, &identity("hyeeun"))
            .unwrap();
        let original_head = repository
            .find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .unwrap()
            .to_owned();
        let original_index = fs::read(repository.path().join("index")).ok();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        let collision = directory.path().join(".okf/workspace.yml");
        fs::write(&collision, b"concurrent user content").unwrap();

        let error = Git2RepositoryAdapter
            .checkout_initialization(directory.path(), &preview, &outcome)
            .unwrap_err();

        let repository = Repository::open(directory.path()).unwrap();
        assert_eq!(
            repository.find_reference("HEAD").unwrap().symbolic_target(),
            Some(original_head.as_str())
        );
        assert_eq!(
            fs::read(repository.path().join("index")).ok(),
            original_index
        );
        assert_eq!(fs::read(&collision).unwrap(), b"concurrent user content");
        assert!(!directory.path().join("docs/.gitkeep").exists());
        assert_eq!(error.code, crate::error::ErrorCode::RepositoryDirty);
        assert_eq!(
            error.recovery,
            Some(crate::error::RecoveryAction::CleanWorkingTree)
        );

        fs::remove_file(&collision).unwrap();
        Git2RepositoryAdapter
            .checkout_initialization(directory.path(), &preview, &outcome)
            .unwrap();

        let repository = Repository::open(directory.path()).unwrap();
        assert_eq!(repository.head().unwrap().shorthand(), Some("main"));
        assert_eq!(
            fs::read_to_string(directory.path().join(".okf/workspace.yml")).unwrap(),
            "approved workspace"
        );
        assert!(directory.path().join("docs/.gitkeep").exists());
    }

    #[test]
    fn failed_empty_checkout_preserves_a_concurrent_same_content_file() {
        let directory = tempfile::tempdir().unwrap();
        Repository::init(directory.path()).unwrap();
        let preview = direct_initialization_preview();
        let outcome = Git2RepositoryAdapter
            .commit_initialization(directory.path(), &preview, &identity("hyeeun"))
            .unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        let collision = directory.path().join(".okf/workspace.yml");
        fs::write(&collision, b"approved workspace").unwrap();

        Git2RepositoryAdapter
            .checkout_initialization(directory.path(), &preview, &outcome)
            .unwrap_err();

        assert_eq!(fs::read(&collision).unwrap(), b"approved workspace");
        assert!(!directory.path().join("docs/.gitkeep").exists());
    }

    #[test]
    fn failed_checkout_never_overwrites_a_concurrent_head_update() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        let commit = repository.head().unwrap().peel_to_commit().unwrap();
        repository.branch("external", &commit, false).unwrap();
        drop(commit);
        drop(repository);
        let preview = direct_initialization_preview();
        let outcome = Git2RepositoryAdapter
            .commit_initialization(directory.path(), &preview, &identity("hyeeun"))
            .unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        fs::write(
            directory.path().join(".okf/workspace.yml"),
            b"concurrent collision",
        )
        .unwrap();
        let root = directory.path().to_path_buf();

        let error =
            super::checkout_initialization_with_failure_hook(directory.path(), &outcome, || {
                Repository::open(&root)
                    .unwrap()
                    .set_head("refs/heads/external")
                    .unwrap();
            })
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::RepositoryDirty);
        assert_eq!(
            Repository::open(directory.path())
                .unwrap()
                .find_reference("HEAD")
                .unwrap()
                .symbolic_target(),
            Some("refs/heads/external")
        );
    }

    #[test]
    fn failed_checkout_never_overwrites_a_concurrent_index_update() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        drop(repository);
        let preview = direct_initialization_preview();
        let outcome = Git2RepositoryAdapter
            .commit_initialization(directory.path(), &preview, &identity("hyeeun"))
            .unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        fs::write(
            directory.path().join(".okf/workspace.yml"),
            b"concurrent collision",
        )
        .unwrap();
        let index = directory.path().join(".git/index");
        let concurrent_bytes = b"concurrent index update";

        super::checkout_initialization_with_failure_hook(directory.path(), &outcome, || {
            fs::write(&index, concurrent_bytes).unwrap();
        })
        .unwrap_err();

        assert_eq!(fs::read(index).unwrap(), concurrent_bytes);
    }

    #[test]
    fn failed_checkout_never_removes_a_concurrently_created_index() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        drop(repository);
        let preview = direct_initialization_preview();
        let outcome = Git2RepositoryAdapter
            .commit_initialization(directory.path(), &preview, &identity("hyeeun"))
            .unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        fs::write(
            directory.path().join(".okf/workspace.yml"),
            b"concurrent collision",
        )
        .unwrap();
        let index = directory.path().join(".git/index");
        fs::remove_file(&index).unwrap();
        let concurrent_bytes = b"concurrently created index";

        super::checkout_initialization_with_failure_hook(directory.path(), &outcome, || {
            fs::write(&index, concurrent_bytes).unwrap();
        })
        .unwrap_err();

        assert_eq!(fs::read(index).unwrap(), concurrent_bytes);
    }

    #[test]
    fn post_notification_concurrent_file_and_empty_directory_are_never_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_path_buf();
        let concurrent_root = root.clone();
        let (notification_sent, notification_received) = std::sync::mpsc::channel();
        let concurrent_writer = std::thread::spawn(move || {
            notification_received.recv().unwrap();
            fs::create_dir_all(concurrent_root.join(".okf")).unwrap();
            fs::write(
                concurrent_root.join(".okf/workspace.yml"),
                b"approved workspace",
            )
            .unwrap();
            fs::create_dir(concurrent_root.join("docs")).unwrap();
        });

        // The notification is only an intent to write. A concurrent owner can
        // create these entries before checkout reports its later failure.
        notification_sent.send(()).unwrap();
        concurrent_writer.join().unwrap();
        let error = super::checkout_failure("checkoutTree");

        assert_eq!(error.code, crate::error::ErrorCode::RepositoryDirty);
        assert_eq!(
            error.recovery,
            Some(crate::error::RecoveryAction::CleanWorkingTree)
        );
        assert_eq!(
            fs::read(root.join(".okf/workspace.yml")).unwrap(),
            b"approved workspace"
        );
        assert_eq!(fs::read_dir(root.join("docs")).unwrap().count(), 0);
    }

    #[test]
    fn checkout_failure_reports_the_ambiguous_stage_without_attempting_rollback() {
        for stage in ["checkoutTree", "setHead"] {
            let error = super::checkout_failure(stage);
            assert_eq!(error.code, crate::error::ErrorCode::RepositoryDirty);
            assert_eq!(
                error.recovery,
                Some(crate::error::RecoveryAction::CleanWorkingTree)
            );
            assert_eq!(
                error.details.get("failureStage").map(String::as_str),
                Some(stage)
            );
        }
    }

    #[test]
    fn pre_ref_commit_failure_leaves_the_user_repository_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        let original_head = repository.head().unwrap().target().unwrap();
        let original_index_tree = repository.index().unwrap().write_tree().unwrap();
        drop(repository);

        let error = Git2RepositoryAdapter
            .commit_initialization(
                directory.path(),
                &initialization_preview(),
                &identity("bad\0login"),
            )
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::GithubUnavailable);
        let repository = Repository::open(directory.path()).unwrap();
        assert_eq!(repository.head().unwrap().target(), Some(original_head));
        assert_eq!(
            repository.index().unwrap().write_tree().unwrap(),
            original_index_tree
        );
        assert!(repository
            .find_reference("refs/heads/okf/init-workspace")
            .is_err());
        assert!(!directory.path().join(".okf/workspace.yml").exists());
    }

    #[cfg(unix)]
    #[test]
    fn object_tree_commit_never_follows_a_swapped_parent_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        commit_file(&repository, "README.md", "ready");
        symlink(outside.path(), directory.path().join(".okf")).unwrap();
        drop(repository);

        Git2RepositoryAdapter
            .commit_initialization(
                directory.path(),
                &initialization_preview(),
                &identity("hyeeun"),
            )
            .unwrap();

        assert!(!outside.path().join("workspace.yml").exists());
        assert!(fs::symlink_metadata(directory.path().join(".okf"))
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
