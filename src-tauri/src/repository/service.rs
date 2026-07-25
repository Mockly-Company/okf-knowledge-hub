use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

use crate::auth::model::AccessToken;
use crate::auth::service::AuthService;
use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::github::model::{DraftPullRequest, DraftPullRequestRequest, GithubRepositoryDetail};
use crate::github::GithubService;
use crate::repository::model::{
    CloneProgress, CloneRequest, CommitOutcome, InitializationResult, RepositoryIdentity,
    RepositorySnapshot,
};
use crate::workspace::service::{
    InitializationPreview, InitializationStrategy, PreviewRegistry, WorkspaceService,
};

pub trait CloneProgressSink: Send + Sync {
    fn emit(&self, progress: CloneProgress);
}

pub trait GitRepositoryPort: Send + Sync {
    fn inspect(&self, path: &Path) -> Result<RepositorySnapshot, AppError>;

    fn clone_repository(
        &self,
        clean_remote_url: &str,
        target: &Path,
        access_token: AccessToken,
        progress: Arc<dyn CloneProgressSink>,
    ) -> Result<RepositorySnapshot, AppError>;

    fn commit_initialization(
        &self,
        root: &Path,
        preview: &InitializationPreview,
        identity: &RepositoryIdentity,
    ) -> Result<CommitOutcome, AppError>;

    fn push_branch(
        &self,
        root: &Path,
        branch: &str,
        access_token: AccessToken,
    ) -> Result<(), AppError>;

    fn checkout_branch(&self, root: &Path, branch: &str) -> Result<(), AppError>;
}

#[async_trait]
pub trait RepositoryCredentialPort: Send + Sync {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError>;
}

#[async_trait]
impl RepositoryCredentialPort for AuthService {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
        AuthService::valid_access_token(self).await
    }
}

#[async_trait]
pub trait RepositoryRemotePort: Send + Sync {
    async fn resolve_remote_repository(
        &self,
        remote_url: &str,
        expected_repository_id: &str,
    ) -> Result<GithubRepositoryDetail, AppError>;

    async fn create_draft_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<DraftPullRequest, AppError>;
}

#[async_trait]
impl RepositoryRemotePort for GithubService {
    async fn resolve_remote_repository(
        &self,
        remote_url: &str,
        expected_repository_id: &str,
    ) -> Result<GithubRepositoryDetail, AppError> {
        GithubService::resolve_remote_repository(self, remote_url, expected_repository_id).await
    }

    async fn create_draft_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<DraftPullRequest, AppError> {
        GithubService::create_draft_pull_request(self, request).await
    }
}

pub struct RepositoryService {
    git: Arc<dyn GitRepositoryPort>,
    github: Arc<dyn RepositoryRemotePort>,
    credentials: Option<Arc<dyn RepositoryCredentialPort>>,
    previews: Option<Arc<PreviewRegistry>>,
    root: Option<PathBuf>,
    repository: Option<GithubRepositoryDetail>,
    identity: Option<RepositoryIdentity>,
    attempts: Mutex<std::collections::HashMap<Uuid, InitializationAttempt>>,
    initialization: Mutex<()>,
}

#[derive(Clone)]
struct InitializationAttempt {
    preview: InitializationPreview,
    outcome: CommitOutcome,
    pushed: bool,
}

impl RepositoryService {
    pub fn for_inspection(
        git: Arc<dyn GitRepositoryPort>,
        github: Arc<dyn RepositoryRemotePort>,
    ) -> Self {
        Self {
            git,
            github,
            credentials: None,
            previews: None,
            root: None,
            repository: None,
            identity: None,
            attempts: Mutex::new(Default::default()),
            initialization: Mutex::new(()),
        }
    }

    pub fn for_clone(
        git: Arc<dyn GitRepositoryPort>,
        github: Arc<dyn RepositoryRemotePort>,
        credentials: Arc<dyn RepositoryCredentialPort>,
    ) -> Self {
        Self {
            git,
            github,
            credentials: Some(credentials),
            previews: None,
            root: None,
            repository: None,
            identity: None,
            attempts: Mutex::new(Default::default()),
            initialization: Mutex::new(()),
        }
    }

    pub fn new(
        git: Arc<dyn GitRepositoryPort>,
        github: Arc<dyn RepositoryRemotePort>,
        credentials: Arc<dyn RepositoryCredentialPort>,
        previews: Arc<PreviewRegistry>,
        root: PathBuf,
        repository: GithubRepositoryDetail,
        identity: RepositoryIdentity,
    ) -> Self {
        Self {
            git,
            github,
            credentials: Some(credentials),
            previews: Some(previews),
            root: Some(root),
            repository: Some(repository),
            identity: Some(identity),
            attempts: Mutex::new(Default::default()),
            initialization: Mutex::new(()),
        }
    }

    pub fn clone_target(parent: &Path, repository_name: &str) -> Result<PathBuf, AppError> {
        let mut components = Path::new(repository_name).components();
        if repository_name.is_empty()
            || !matches!(components.next(), Some(Component::Normal(_)))
            || components.next().is_some()
        {
            return Err(path_conflict(parent));
        }
        Ok(parent.join(repository_name))
    }

    pub fn ensure_clone_target(target: &Path) -> Result<(), AppError> {
        if target.exists() {
            return Err(path_conflict(target));
        }
        Ok(())
    }

    pub async fn inspect_existing(
        &self,
        path: &Path,
        expected_repository_id: &str,
    ) -> Result<RepositorySnapshot, AppError> {
        let snapshot = self.git.inspect(path)?;
        let remote_url = snapshot.remote_url.as_deref().ok_or_else(|| {
            AppError::new(
                ErrorCode::RepositoryRemoteMismatch,
                "연결한 Git 저장소에 origin remote가 없습니다.",
            )
        })?;
        let resolved = self
            .github
            .resolve_remote_repository(remote_url, expected_repository_id)
            .await?;
        if resolved.id != expected_repository_id {
            return Err(AppError::new(
                ErrorCode::RepositoryRemoteMismatch,
                "선택한 GitHub 저장소와 로컬 저장소의 origin이 다릅니다.",
            )
            .with_detail("expectedRepositoryId", expected_repository_id)
            .with_detail("actualRepositoryId", resolved.id));
        }
        Ok(snapshot)
    }

    pub async fn clone(
        &self,
        request: CloneRequest,
        progress: Arc<dyn CloneProgressSink>,
    ) -> Result<RepositorySnapshot, AppError> {
        let clean_url = clean_github_https_url(&request.https_url, &request.full_name)?;
        let target = Self::clone_target(
            &request.parent_directory,
            repository_name(&request.full_name)?,
        )?;
        Self::ensure_clone_target(&target)?;
        let token = self.credentials()?.valid_access_token().await?;
        let snapshot = self
            .git
            .clone_repository(&clean_url, &target, token, progress)?;
        self.github
            .resolve_remote_repository(
                snapshot.remote_url.as_deref().unwrap_or(&clean_url),
                &request.repository_id,
            )
            .await?;
        Ok(snapshot)
    }

    pub async fn initialize(&self, preview_id: Uuid) -> Result<InitializationResult, AppError> {
        let _initialization = self.initialization.lock().await;
        let existing_attempt = {
            let attempts = self.attempts.lock().await;
            attempts.get(&preview_id).cloned()
        };
        if let Some(attempt) = existing_attempt {
            return self.resume_initialization(preview_id, attempt).await;
        }

        let root = self.root()?;
        let preview = self
            .previews()?
            .get(preview_id)
            .ok_or_else(stale_preview_error)?;
        let snapshot = self.git.inspect(root)?;
        if snapshot.fingerprint != preview.repository_fingerprint || snapshot.is_dirty {
            return Err(stale_preview_error());
        }
        if let InitializationStrategy::DraftPullRequest { base_branch } = &preview.strategy {
            if snapshot.default_branch.as_deref() != Some(base_branch.as_str()) {
                return Err(stale_preview_error());
            }
        }
        WorkspaceService::validate_preview_paths(root, &preview.files)?;
        for file in &preview.files {
            if std::fs::symlink_metadata(root.join(&file.path)).is_ok() {
                return Err(stale_preview_error());
            }
        }

        let outcome = self
            .git
            .commit_initialization(root, &preview, self.identity()?)?;
        let attempt = InitializationAttempt {
            preview,
            outcome,
            pushed: false,
        };
        self.attempts
            .lock()
            .await
            .insert(preview_id, attempt.clone());
        self.resume_initialization(preview_id, attempt).await
    }

    async fn resume_initialization(
        &self,
        preview_id: Uuid,
        mut attempt: InitializationAttempt,
    ) -> Result<InitializationResult, AppError> {
        if !attempt.pushed {
            let token = self.credentials()?.valid_access_token().await?;
            self.git
                .push_branch(self.root()?, &attempt.outcome.branch, token)
                .map_err(|error| {
                    error
                        .with_detail("branch", &attempt.outcome.branch)
                        .with_detail("commit", &attempt.outcome.commit_oid)
                })?;
            attempt.pushed = true;
            self.attempts
                .lock()
                .await
                .insert(preview_id, attempt.clone());
        }

        let mut draft_pull_request_url = None;
        if let InitializationStrategy::DraftPullRequest { base_branch } = &attempt.preview.strategy
        {
            if let Some(original) = &attempt.outcome.original_branch {
                self.git.checkout_branch(self.root()?, original)?;
            }
            let request = DraftPullRequestRequest::initialize_workspace(
                &self.repository()?.full_name,
                &attempt.outcome.branch,
                base_branch,
            );
            let pull_request = self.github.create_draft_pull_request(&request).await?;
            draft_pull_request_url = Some(pull_request.html_url);
        }

        self.attempts.lock().await.remove(&preview_id);
        self.previews()?.remove(preview_id);
        Ok(InitializationResult {
            root: self.root()?.to_path_buf(),
            branch: attempt.outcome.branch,
            commit_oid: attempt.outcome.commit_oid,
            commit_message: attempt.preview.commit_message,
            pushed: true,
            draft_pull_request_url,
        })
    }

    fn credentials(&self) -> Result<&Arc<dyn RepositoryCredentialPort>, AppError> {
        self.credentials.as_ref().ok_or_else(service_unavailable)
    }

    fn previews(&self) -> Result<&Arc<PreviewRegistry>, AppError> {
        self.previews.as_ref().ok_or_else(service_unavailable)
    }

    fn root(&self) -> Result<&Path, AppError> {
        self.root.as_deref().ok_or_else(service_unavailable)
    }

    fn repository(&self) -> Result<&GithubRepositoryDetail, AppError> {
        self.repository.as_ref().ok_or_else(service_unavailable)
    }

    fn identity(&self) -> Result<&RepositoryIdentity, AppError> {
        self.identity.as_ref().ok_or_else(service_unavailable)
    }
}

fn repository_name(full_name: &str) -> Result<&str, AppError> {
    let mut parts = full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return Err(service_unavailable());
    }
    Ok(name)
}

fn clean_github_https_url(value: &str, full_name: &str) -> Result<String, AppError> {
    let parsed = Url::parse(value).map_err(|_| clone_url_error())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(clone_url_error());
    }
    let expected_path = format!("/{full_name}.git");
    if parsed.path() != expected_path {
        return Err(clone_url_error());
    }
    Ok(format!("https://github.com/{full_name}.git"))
}

fn clone_url_error() -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "GitHub clone 주소가 올바르지 않습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn stale_preview_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "미리보기 이후 저장소 상태가 변경되었습니다.",
    )
}

fn service_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "저장소 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn path_conflict(path: &Path) -> AppError {
    AppError::new(
        ErrorCode::RepositoryPathConflict,
        "선택한 위치에 같은 이름의 경로가 있습니다.",
    )
    .with_recovery(RecoveryAction::ChooseAnotherDirectory)
    .with_detail("path", path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use git2::{Repository, Signature};

    use super::{clean_github_https_url, RepositoryService};
    use crate::error::ErrorCode;
    use crate::github::model::{DraftPullRequest, DraftPullRequestRequest, GithubRepositoryDetail};
    use crate::repository::git2_adapter::Git2RepositoryAdapter;
    use crate::repository::model::RepositoryIdentity;
    use crate::repository::service::{
        GitRepositoryPort, RepositoryCredentialPort, RepositoryRemotePort,
    };
    use crate::workspace::service::{PreviewRegistry, RepositoryPopulation, WorkspaceService};

    #[test]
    fn clone_target_is_repository_name_below_the_selected_parent() {
        let parent = tempfile::tempdir().unwrap();
        let target = RepositoryService::clone_target(parent.path(), "mockly-knowledge").unwrap();
        assert_eq!(target, parent.path().join("mockly-knowledge"));
    }

    #[test]
    fn an_existing_non_git_folder_is_a_conflict_and_is_not_deleted() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("mockly-knowledge");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("keep.txt"), "mine").unwrap();

        let error = RepositoryService::ensure_clone_target(&target).unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert_eq!(
            std::fs::read_to_string(target.join("keep.txt")).unwrap(),
            "mine"
        );
    }

    #[test]
    fn clone_url_must_be_clean_https_for_the_selected_repository() {
        assert_eq!(
            clean_github_https_url(
                "https://github.com/example/knowledge.git",
                "example/knowledge"
            )
            .unwrap(),
            "https://github.com/example/knowledge.git"
        );
        for unsafe_url in [
            "https://token@github.com/example/knowledge.git",
            "https://github.com/example/knowledge.git?token=secret",
            "https://github.com/example/other.git",
            "http://github.com/example/knowledge.git",
        ] {
            assert_eq!(
                clean_github_https_url(unsafe_url, "example/knowledge")
                    .unwrap_err()
                    .code,
                ErrorCode::CloneFailed
            );
        }
    }

    #[derive(Clone)]
    struct FakeRemote {
        resolved_id: String,
        draft_requests: Arc<Mutex<Vec<DraftPullRequestRequest>>>,
        draft_failures_remaining: Arc<Mutex<usize>>,
    }

    #[async_trait]
    impl RepositoryRemotePort for FakeRemote {
        async fn resolve_remote_repository(
            &self,
            _remote_url: &str,
            _expected_repository_id: &str,
        ) -> Result<GithubRepositoryDetail, crate::error::AppError> {
            Ok(GithubRepositoryDetail {
                id: self.resolved_id.clone(),
                owner: "example".into(),
                name: "knowledge".into(),
                full_name: "example/knowledge".into(),
                default_branch: Some("main".into()),
                is_empty: false,
                https_url: "https://github.com/example/knowledge.git".into(),
            })
        }

        async fn create_draft_pull_request(
            &self,
            request: &DraftPullRequestRequest,
        ) -> Result<DraftPullRequest, crate::error::AppError> {
            self.draft_requests.lock().unwrap().push(request.clone());
            let mut failures = self.draft_failures_remaining.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err(crate::error::AppError::new(
                    ErrorCode::DraftPullRequestFailed,
                    "fixture PR failure",
                )
                .with_recovery(crate::error::RecoveryAction::Retry)
                .with_detail("branch", &request.head));
            }
            Ok(DraftPullRequest {
                number: 7,
                html_url: "https://github.com/example/knowledge/pull/7".into(),
                is_draft: true,
            })
        }
    }

    struct FakeCredentials;

    #[async_trait]
    impl RepositoryCredentialPort for FakeCredentials {
        async fn valid_access_token(
            &self,
        ) -> Result<crate::auth::model::AccessToken, crate::error::AppError> {
            Ok(crate::auth::model::AccessToken::from_secret(
                secrecy::SecretString::new("fixture-token".into()),
            ))
        }
    }

    fn committed_repository() -> (tempfile::TempDir, Repository) {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        fs::write(directory.path().join("README.md"), "knowledge").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(std::path::Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("fixture", "fixture@example.com").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap();
        drop(tree);
        repository
            .remote("origin", "https://github.com/example/knowledge.git")
            .unwrap();
        (directory, repository)
    }

    #[tokio::test]
    async fn existing_clone_is_accepted_only_when_github_node_id_matches() {
        let (directory, _repository) = committed_repository();
        let service = RepositoryService::for_inspection(
            Arc::new(Git2RepositoryAdapter),
            Arc::new(FakeRemote {
                resolved_id: "R_expected".into(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
            }),
        );

        let snapshot = service
            .inspect_existing(directory.path(), "R_expected")
            .await
            .unwrap();

        assert_eq!(snapshot.head_oid.as_deref().map(str::len), Some(40));
        assert!(!snapshot.is_dirty);
    }

    #[tokio::test]
    async fn mismatched_remote_node_id_is_rejected() {
        let (directory, _repository) = committed_repository();
        let service = RepositoryService::for_inspection(
            Arc::new(Git2RepositoryAdapter),
            Arc::new(FakeRemote {
                resolved_id: "R_other".into(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
            }),
        );

        let error = service
            .inspect_existing(directory.path(), "R_expected")
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryRemoteMismatch);
    }

    #[tokio::test]
    async fn dirty_existing_clone_can_be_inspected_for_read_only_connection() {
        let (directory, _repository) = committed_repository();
        fs::write(directory.path().join("README.md"), "local change").unwrap();
        let service = RepositoryService::for_inspection(
            Arc::new(Git2RepositoryAdapter),
            Arc::new(FakeRemote {
                resolved_id: "R_expected".into(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
            }),
        );

        let snapshot = service
            .inspect_existing(directory.path(), "R_expected")
            .await
            .unwrap();

        assert!(snapshot.is_dirty);
    }

    struct InitializationFixture {
        _directory: tempfile::TempDir,
        _bare_remote: tempfile::TempDir,
        service: RepositoryService,
        previews: Arc<PreviewRegistry>,
        remote: FakeRemote,
        root: std::path::PathBuf,
    }

    impl InitializationFixture {
        fn preview(&self) -> crate::workspace::service::InitializationPreview {
            let snapshot = Git2RepositoryAdapter.inspect(&self.root).unwrap();
            let preview = WorkspaceService::create_initialization_preview(
                &self.root,
                "Mockly",
                &snapshot.fingerprint,
                RepositoryPopulation::ExistingContent {
                    default_branch: "main".into(),
                },
            )
            .unwrap();
            self.previews.insert(preview.clone()).unwrap();
            preview
        }
    }

    fn initialized_repository_with_existing_content() -> InitializationFixture {
        let (directory, repository) = committed_repository();
        let mut branch = repository
            .find_branch("master", git2::BranchType::Local)
            .unwrap();
        branch.rename("main", true).unwrap();
        repository.set_head("refs/heads/main").unwrap();
        let bare_remote = tempfile::tempdir().unwrap();
        Repository::init_bare(bare_remote.path()).unwrap();
        repository
            .remote_set_url("origin", bare_remote.path().to_str().unwrap())
            .unwrap();
        repository
            .find_remote("origin")
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
        let root = directory.path().to_path_buf();
        drop(branch);
        drop(repository);
        let previews = Arc::new(PreviewRegistry::default());
        let remote = FakeRemote {
            resolved_id: "R_expected".into(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
        };
        let service = RepositoryService::new(
            Arc::new(Git2RepositoryAdapter),
            Arc::new(remote.clone()),
            Arc::new(FakeCredentials),
            previews.clone(),
            root.clone(),
            GithubRepositoryDetail {
                id: "R_expected".into(),
                owner: "example".into(),
                name: "knowledge".into(),
                full_name: "example/knowledge".into(),
                default_branch: Some("main".into()),
                is_empty: false,
                https_url: "https://github.com/example/knowledge.git".into(),
            },
            RepositoryIdentity {
                database_id: 42,
                login: "hyeeun".into(),
            },
        );
        InitializationFixture {
            _directory: directory,
            _bare_remote: bare_remote,
            service,
            previews,
            remote,
            root,
        }
    }

    #[tokio::test]
    async fn stale_preview_does_not_write_or_commit() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        fs::write(fixture.root.join("changed.md"), "changed").unwrap();

        let error = fixture.service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert!(!fixture.root.join(".okf/workspace.yml").exists());
    }

    #[tokio::test]
    async fn existing_content_uses_init_branch_and_requests_one_draft_pr() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();

        let result = fixture.service.initialize(preview.id).await.unwrap();

        assert_eq!(result.branch, "okf/init-workspace");
        assert_eq!(result.commit_message, "chore: initialize OkHub workspace");
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 1);
        let repository = Repository::open(&fixture.root).unwrap();
        assert_eq!(repository.head().unwrap().shorthand(), Some("main"));
        let commit = repository
            .find_commit(git2::Oid::from_str(&result.commit_oid).unwrap())
            .unwrap();
        assert_eq!(commit.author().name(), Some("hyeeun"));
        assert_eq!(
            commit.author().email(),
            Some("42+hyeeun@users.noreply.github.com")
        );
    }

    #[tokio::test]
    async fn target_created_after_preview_is_never_overwritten() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        fs::create_dir_all(fixture.root.join(".okf")).unwrap();
        fs::write(fixture.root.join(".okf/workspace.yml"), "mine").unwrap();
        let original_head = Repository::open(&fixture.root)
            .unwrap()
            .head()
            .unwrap()
            .target()
            .unwrap();

        let error = fixture.service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(
            fs::read_to_string(fixture.root.join(".okf/workspace.yml")).unwrap(),
            "mine"
        );
        assert_eq!(
            Repository::open(&fixture.root)
                .unwrap()
                .head()
                .unwrap()
                .target(),
            Some(original_head)
        );
    }

    #[tokio::test]
    async fn existing_initialization_branch_is_refused_before_writing() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        let repository = Repository::open(&fixture.root).unwrap();
        let head = repository.head().unwrap().peel_to_commit().unwrap();
        repository
            .branch("okf/init-workspace", &head, false)
            .unwrap();

        let error = fixture.service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert!(!fixture.root.join(".okf/workspace.yml").exists());
    }

    #[tokio::test]
    async fn existing_content_must_start_from_the_previewed_default_branch_head() {
        let fixture = initialized_repository_with_existing_content();
        let repository = Repository::open(&fixture.root).unwrap();
        let head = repository.head().unwrap().peel_to_commit().unwrap();
        repository.branch("feature", &head, false).unwrap();
        repository.set_head("refs/heads/feature").unwrap();
        repository.checkout_head(None).unwrap();
        drop(head);
        drop(repository);
        let preview = fixture.preview();

        let error = fixture.service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert!(!fixture.root.join(".okf/workspace.yml").exists());
    }

    #[tokio::test]
    async fn push_failure_preserves_the_local_commit_and_branch_for_retry() {
        let fixture = initialized_repository_with_existing_content();
        let repository = Repository::open(&fixture.root).unwrap();
        repository
            .remote_set_url("origin", "/definitely/missing/remote.git")
            .unwrap();
        let preview = fixture.preview();

        let error = fixture.service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::PushFailed);
        assert_eq!(
            error.details.get("branch").map(String::as_str),
            Some("okf/init-workspace")
        );
        let repository = Repository::open(&fixture.root).unwrap();
        assert_eq!(
            repository.head().unwrap().shorthand(),
            Some("okf/init-workspace")
        );
        assert!(fixture.root.join(".okf/workspace.yml").is_file());
        assert!(error.details.contains_key("commit"));
    }

    #[tokio::test]
    async fn retry_after_push_and_pr_failure_reuses_the_same_commit() {
        let fixture = initialized_repository_with_existing_content();
        *fixture.remote.draft_failures_remaining.lock().unwrap() = 1;
        let preview = fixture.preview();

        let first_error = fixture.service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::DraftPullRequestFailed);
        let first_oid = Repository::open(&fixture.root)
            .unwrap()
            .find_reference("refs/heads/okf/init-workspace")
            .unwrap()
            .target()
            .unwrap();

        let result = fixture.service.initialize(preview.id).await.unwrap();

        assert_eq!(result.commit_oid, first_oid.to_string());
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 2);
        assert_eq!(
            Repository::open(&fixture.root)
                .unwrap()
                .head()
                .unwrap()
                .shorthand(),
            Some("main")
        );
    }

    #[tokio::test]
    async fn empty_repository_pushes_the_initial_default_branch_without_a_pr() {
        let directory = tempfile::tempdir().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        let bare_remote = tempfile::tempdir().unwrap();
        Repository::init_bare(bare_remote.path()).unwrap();
        repository
            .remote("origin", bare_remote.path().to_str().unwrap())
            .unwrap();
        drop(repository);
        let root = directory.path().to_path_buf();
        let previews = Arc::new(PreviewRegistry::default());
        let remote = FakeRemote {
            resolved_id: "R_empty".into(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
        };
        let service = RepositoryService::new(
            Arc::new(Git2RepositoryAdapter),
            Arc::new(remote.clone()),
            Arc::new(FakeCredentials),
            previews.clone(),
            root.clone(),
            GithubRepositoryDetail {
                id: "R_empty".into(),
                owner: "example".into(),
                name: "empty".into(),
                full_name: "example/empty".into(),
                default_branch: None,
                is_empty: true,
                https_url: "https://github.com/example/empty.git".into(),
            },
            RepositoryIdentity {
                database_id: 42,
                login: "hyeeun".into(),
            },
        );
        let snapshot = Git2RepositoryAdapter.inspect(&root).unwrap();
        let preview = WorkspaceService::create_initialization_preview(
            &root,
            "Empty",
            &snapshot.fingerprint,
            RepositoryPopulation::Empty {
                default_branch: "main".into(),
            },
        )
        .unwrap();
        previews.insert(preview.clone()).unwrap();

        let result = service.initialize(preview.id).await.unwrap();

        assert_eq!(result.branch, "main");
        assert!(Repository::open_bare(bare_remote.path())
            .unwrap()
            .find_reference("refs/heads/main")
            .is_ok());
        assert!(remote.draft_requests.lock().unwrap().is_empty());
    }
}
