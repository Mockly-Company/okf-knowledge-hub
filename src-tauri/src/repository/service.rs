use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::{fs, io::Write};

use async_trait::async_trait;
use same_file::Handle as SameFileHandle;
use serde::{Deserialize, Serialize};
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
    /// Returns `false` when the caller has cancelled the clone.
    fn emit(&self, progress: CloneProgress) -> bool;

    /// Atomically makes publication non-cancellable. A `false` result keeps
    /// the owned staging directory for explicit recovery.
    fn begin_finalization(&self) -> bool {
        true
    }
}

pub(crate) trait GitRepositoryPort: Send + Sync {
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

    fn verify_initialization_commit(
        &self,
        root: &Path,
        preview: &InitializationPreview,
        outcome: &CommitOutcome,
        identity: &RepositoryIdentity,
    ) -> Result<(), AppError>;

    fn push_branch(
        &self,
        root: &Path,
        branch: &str,
        approved_remote_url: &str,
        access_token: AccessToken,
    ) -> Result<(), AppError>;

    fn checkout_initialization(
        &self,
        root: &Path,
        preview: &InitializationPreview,
        outcome: &CommitOutcome,
    ) -> Result<(), AppError>;

    fn origin_url(&self, root: &Path) -> Result<String, AppError>;

    fn attempt_directory(&self, root: &Path) -> Result<PathBuf, AppError>;

    fn remote_branch_oid(
        &self,
        root: &Path,
        branch: &str,
        approved_remote_url: &str,
        access_token: AccessToken,
    ) -> Result<Option<String>, AppError>;
}

#[async_trait]
pub(crate) trait RepositoryCredentialPort: Send + Sync {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError>;
}

#[async_trait]
impl RepositoryCredentialPort for AuthService {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
        AuthService::valid_access_token(self).await
    }
}

#[async_trait]
pub(crate) trait RepositoryRemotePort: Send + Sync {
    async fn resolve_remote_repository(
        &self,
        remote_url: &str,
        expected_repository_id: &str,
    ) -> Result<GithubRepositoryDetail, AppError>;

    async fn create_draft_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<DraftPullRequest, AppError>;

    async fn find_open_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<Option<DraftPullRequest>, AppError>;
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

    async fn find_open_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<Option<DraftPullRequest>, AppError> {
        GithubService::find_open_pull_request(self, request).await
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
    initialization: Mutex<()>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct DurableInitializationAttempt {
    preview: InitializationPreview,
    outcome: Option<CommitOutcome>,
    pushed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AttemptPhase {
    Prepared,
    Committed,
    Pushed,
}

impl AttemptPhase {
    fn file_name(self) -> &'static str {
        match self {
            Self::Prepared => "prepared.json",
            Self::Committed => "committed.json",
            Self::Pushed => "pushed.json",
        }
    }
}

struct LoadedInitializationAttempt {
    phase: AttemptPhase,
    attempt: DurableInitializationAttempt,
}

impl DurableInitializationAttempt {
    fn phase_file(&self) -> &'static str {
        if self.pushed {
            "pushed.json"
        } else if self.outcome.is_some() {
            "committed.json"
        } else {
            "prepared.json"
        }
    }
}

impl RepositoryService {
    #[allow(dead_code)] // Consumed by Task 8 command wiring.
    pub(crate) fn for_inspection(
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
            initialization: Mutex::new(()),
        }
    }

    #[allow(dead_code)] // Consumed by Task 8 command wiring.
    pub(crate) fn for_clone(
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
            initialization: Mutex::new(()),
        }
    }

    #[allow(dead_code)] // Consumed by Task 8 command wiring.
    pub(crate) fn new(
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
        match std::fs::symlink_metadata(target) {
            Ok(_) => Err(path_conflict(target)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(clone_reservation_error(target)),
        }
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
        let resolved = self
            .github
            .resolve_remote_repository(&clean_url, &request.repository_id)
            .await?;
        if resolved.id != request.repository_id {
            return Err(remote_mismatch_error(&request.repository_id, &resolved.id));
        }
        let approved_url = clean_github_https_url(&resolved.https_url, &resolved.full_name)
            .map_err(|_| remote_mismatch_error(&request.repository_id, &resolved.id))?;
        let token = self.credentials()?.valid_access_token().await?;
        Self::ensure_clone_target(&target)?;
        let staging = create_clone_staging(
            target.parent().ok_or_else(|| path_conflict(&target))?,
            repository_name(&request.full_name)?,
        )?;
        let _snapshot = self
            .git
            .clone_repository(&approved_url, &staging.path, token, progress.clone())
            .map_err(|error| error.with_detail("stagingPath", staging.path.to_string_lossy()))?;
        if !progress.begin_finalization() {
            return Err(clone_finalization_cancelled(&staging.path));
        }
        publish_owned_clone_with_hooks(&staging, &target, || {}, || {})?;
        self.git.inspect(&target)
    }

    pub async fn initialize(&self, preview_id: Uuid) -> Result<InitializationResult, AppError> {
        let _initialization = self.initialization.lock().await;
        let root = self.root()?;
        let mut attempt = match self.load_attempt(preview_id)? {
            Some(loaded) => {
                self.validate_loaded_attempt(preview_id, &loaded)?;
                loaded.attempt
            }
            None => {
                let preview = self
                    .previews()?
                    .get(preview_id)
                    .ok_or_else(stale_preview_error)?;
                let snapshot = self.git.inspect(root)?;
                if snapshot.fingerprint != preview.repository_fingerprint || snapshot.is_dirty {
                    return Err(stale_preview_error());
                }
                if let InitializationStrategy::DraftPullRequest { base_branch } = &preview.strategy
                {
                    if snapshot.default_branch.as_deref() != Some(base_branch.as_str()) {
                        return Err(stale_preview_error());
                    }
                }
                WorkspaceService::validate_preview_paths(root, &preview.files)?;
                for file in &preview.files {
                    if fs::symlink_metadata(root.join(&file.path)).is_ok() {
                        return Err(stale_preview_error());
                    }
                }
                let attempt = DurableInitializationAttempt {
                    preview,
                    outcome: None,
                    pushed: false,
                };
                self.write_attempt(&attempt)?;
                attempt
            }
        };

        if attempt.outcome.is_none() {
            let snapshot = self.git.inspect(root)?;
            if snapshot.fingerprint != attempt.preview.repository_fingerprint || snapshot.is_dirty {
                return Err(stale_preview_error());
            }
            let outcome =
                self.git
                    .commit_initialization(root, &attempt.preview, self.identity()?)?;
            attempt.outcome = Some(outcome);
            self.write_attempt(&attempt)?;
        }
        self.resume_initialization(preview_id, attempt).await
    }

    async fn resume_initialization(
        &self,
        preview_id: Uuid,
        mut attempt: DurableInitializationAttempt,
    ) -> Result<InitializationResult, AppError> {
        let outcome = attempt.outcome.clone().ok_or_else(stale_preview_error)?;
        let origin = self.git.origin_url(self.root()?)?;
        let resolved = self
            .github
            .resolve_remote_repository(&origin, &self.repository()?.id)
            .await?;
        if resolved.id != self.repository()?.id {
            return Err(remote_mismatch_error(
                self.repository()?.id.as_str(),
                &resolved.id,
            ));
        }
        let selected_repository_id = self.repository()?.id.clone();
        let approved_remote_url = clean_github_https_url(&resolved.https_url, &resolved.full_name)
            .map_err(|_| remote_mismatch_error(&selected_repository_id, &resolved.id))?;
        let token = self.credentials()?.valid_access_token().await?;
        let remote_oid = self
            .git
            .remote_branch_oid(self.root()?, &outcome.branch, &approved_remote_url, token)
            .map_err(|error| {
                error
                    .with_detail("branch", &outcome.branch)
                    .with_detail("commit", &outcome.commit_oid)
            })?;
        match remote_oid {
            Some(remote_oid) if remote_oid == outcome.commit_oid => {}
            Some(remote_oid) => {
                return Err(AppError::new(
                    ErrorCode::PushFailed,
                    "원격 초기화 branch가 다른 commit을 가리킵니다.",
                )
                .with_recovery(RecoveryAction::Retry)
                .with_detail("branch", &outcome.branch)
                .with_detail("commit", &outcome.commit_oid)
                .with_detail("remoteCommit", remote_oid));
            }
            None if attempt.pushed => return Err(untrusted_attempt_error()),
            None => {
                let token = self.credentials()?.valid_access_token().await?;
                self.git
                    .push_branch(self.root()?, &outcome.branch, &approved_remote_url, token)
                    .map_err(|error| {
                        error
                            .with_detail("branch", &outcome.branch)
                            .with_detail("commit", &outcome.commit_oid)
                    })?;
            }
        }
        if !attempt.pushed {
            attempt.pushed = true;
            self.write_attempt(&attempt)?;
        }

        let mut draft_pull_request_url = None;
        if let InitializationStrategy::DraftPullRequest { base_branch } = &attempt.preview.strategy
        {
            let request = DraftPullRequestRequest::initialize_workspace(
                &resolved.full_name,
                &outcome.branch,
                base_branch,
            );
            let pull_request = match self.github.find_open_pull_request(&request).await? {
                Some(pull_request) => pull_request,
                None => self.github.create_draft_pull_request(&request).await?,
            };
            draft_pull_request_url = Some(pull_request.html_url);
        } else {
            self.git
                .checkout_initialization(self.root()?, &attempt.preview, &outcome)?;
        }

        self.remove_attempt(preview_id)?;
        self.previews()?.remove(preview_id);
        Ok(InitializationResult {
            root: self.root()?.to_path_buf(),
            branch: outcome.branch,
            commit_oid: outcome.commit_oid,
            commit_message: attempt.preview.commit_message,
            pushed: true,
            draft_pull_request_url,
        })
    }

    fn validate_loaded_attempt(
        &self,
        requested_preview_id: Uuid,
        loaded: &LoadedInitializationAttempt,
    ) -> Result<(), AppError> {
        let attempt = &loaded.attempt;
        let phase_is_valid = match loaded.phase {
            AttemptPhase::Prepared => attempt.outcome.is_none() && !attempt.pushed,
            AttemptPhase::Committed => attempt.outcome.is_some() && !attempt.pushed,
            AttemptPhase::Pushed => attempt.outcome.is_some() && attempt.pushed,
        };
        if !phase_is_valid || attempt.preview.id != requested_preview_id {
            return Err(untrusted_attempt_error());
        }
        WorkspaceService::validate_generated_initialization_preview(&attempt.preview)
            .map_err(|_| untrusted_attempt_error())?;
        WorkspaceService::validate_preview_paths(self.root()?, &attempt.preview.files)
            .map_err(|_| untrusted_attempt_error())?;

        let selected = self.repository()?;
        match &attempt.preview.strategy {
            InitializationStrategy::DraftPullRequest { base_branch }
                if !selected.is_empty
                    && attempt.preview.branch == "okf/init-workspace"
                    && selected.default_branch.as_deref() == Some(base_branch.as_str()) => {}
            InitializationStrategy::DirectPush
                if (selected.is_empty || attempt.outcome.is_some())
                    && attempt.preview.branch
                        == selected.default_branch.as_deref().unwrap_or("main") => {}
            _ => return Err(untrusted_attempt_error()),
        }

        if let Some(outcome) = &attempt.outcome {
            if outcome.branch != attempt.preview.branch {
                return Err(untrusted_attempt_error());
            }
            match &attempt.preview.strategy {
                InitializationStrategy::DraftPullRequest { base_branch }
                    if outcome.original_branch.as_deref() == Some(base_branch.as_str()) => {}
                InitializationStrategy::DirectPush if outcome.original_branch.is_none() => {}
                _ => return Err(untrusted_attempt_error()),
            }
            self.git
                .verify_initialization_commit(
                    self.root()?,
                    &attempt.preview,
                    outcome,
                    self.identity()?,
                )
                .map_err(|_| untrusted_attempt_error())?;
        }
        Ok(())
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

    fn attempt_path(&self, preview_id: Uuid) -> Result<PathBuf, AppError> {
        Ok(self
            .git
            .attempt_directory(self.root()?)?
            .join(preview_id.to_string()))
    }

    fn write_attempt(&self, attempt: &DurableInitializationAttempt) -> Result<(), AppError> {
        let directory = self.attempt_path(attempt.preview.id)?;
        fs::create_dir_all(&directory).map_err(|_| attempt_storage_error())?;
        let destination = directory.join(attempt.phase_file());
        if destination.exists() {
            let existing = read_attempt_file(&destination)?;
            if existing == *attempt {
                return Ok(());
            }
            return Err(attempt_storage_error());
        }
        let temporary = directory.join(format!(".tmp-{}", Uuid::new_v4()));
        let bytes = serde_json::to_vec(attempt).map_err(|_| attempt_storage_error())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| attempt_storage_error())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| attempt_storage_error())?;
        match fs::rename(&temporary, &destination) {
            Ok(()) => Ok(()),
            Err(_) if destination.exists() => {
                let _ = fs::remove_file(&temporary);
                (read_attempt_file(&destination)? == *attempt)
                    .then_some(())
                    .ok_or_else(attempt_storage_error)
            }
            Err(_) => {
                let _ = fs::remove_file(&temporary);
                Err(attempt_storage_error())
            }
        }
    }

    fn load_attempt(
        &self,
        preview_id: Uuid,
    ) -> Result<Option<LoadedInitializationAttempt>, AppError> {
        let directory = self.attempt_path(preview_id)?;
        for phase in [
            AttemptPhase::Pushed,
            AttemptPhase::Committed,
            AttemptPhase::Prepared,
        ] {
            let path = directory.join(phase.file_name());
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.is_file() => {
                    return read_attempt_file(&path)
                        .map(|attempt| Some(LoadedInitializationAttempt { phase, attempt }))
                }
                Ok(_) => return Err(attempt_storage_error()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(attempt_storage_error()),
            }
        }
        Ok(None)
    }

    fn remove_attempt(&self, preview_id: Uuid) -> Result<(), AppError> {
        let directory = self.attempt_path(preview_id)?;
        for phase in ["prepared.json", "committed.json", "pushed.json"] {
            match fs::remove_file(directory.join(phase)) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(attempt_storage_error()),
            }
        }
        match fs::remove_dir(directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(attempt_storage_error()),
        }
    }
}

fn read_attempt_file(path: &Path) -> Result<DurableInitializationAttempt, AppError> {
    let bytes = fs::read(path).map_err(|_| attempt_storage_error())?;
    serde_json::from_slice(&bytes).map_err(|_| attempt_storage_error())
}

fn attempt_storage_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "초기화 복구 상태를 안전하게 저장하거나 읽지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn untrusted_attempt_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceChangedSincePreview,
        "저장된 초기화 복구 정보가 현재 요청이나 저장소와 일치하지 않습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn remote_mismatch_error(expected: &str, actual: &str) -> AppError {
    AppError::new(
        ErrorCode::RepositoryRemoteMismatch,
        "선택한 GitHub 저장소와 로컬 저장소의 origin이 다릅니다.",
    )
    .with_detail("expectedRepositoryId", expected)
    .with_detail("actualRepositoryId", actual)
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

fn clone_reservation_error(path: &Path) -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "clone 대상 폴더를 안전하게 예약하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("path", path.to_string_lossy())
}

fn clone_finalization_cancelled(staging: &Path) -> AppError {
    AppError::new(ErrorCode::CloneFailed, "저장소 clone이 취소되었습니다.")
        .with_recovery(RecoveryAction::Retry)
        .with_detail("stagingPath", staging.to_string_lossy())
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

struct OwnedCloneStaging {
    path: PathBuf,
    identity: SameFileHandle,
}

impl OwnedCloneStaging {
    fn capture(path: PathBuf) -> Result<Self, AppError> {
        let identity = directory_identity(&path).map_err(|_| clone_reservation_error(&path))?;
        Ok(Self { path, identity })
    }

    fn matches_path(&self, path: &Path) -> bool {
        directory_identity(path).is_ok_and(|current| current == self.identity)
    }
}

fn directory_identity(path: &Path) -> std::io::Result<SameFileHandle> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(std::io::Error::other("clone staging is not a directory"));
    }
    SameFileHandle::from_path(path)
}

fn create_clone_staging(
    parent: &Path,
    repository_name: &str,
) -> Result<OwnedCloneStaging, AppError> {
    for _ in 0..16 {
        let staging = parent.join(format!(".okhub-clone-{repository_name}-{}", Uuid::new_v4()));
        match fs::create_dir(&staging) {
            Ok(()) => return OwnedCloneStaging::capture(staging),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(clone_reservation_error(&staging)),
        }
    }
    Err(clone_reservation_error(parent))
}

fn publish_owned_clone_with_hooks(
    staging: &OwnedCloneStaging,
    target: &Path,
    before_publish: impl FnOnce(),
    after_publish: impl FnOnce(),
) -> Result<(), AppError> {
    before_publish();
    if !staging.matches_path(&staging.path) {
        return Err(clone_identity_error(
            staging,
            target,
            "sourceIdentityMismatch",
            &staging.path,
        ));
    }
    publish_clone_no_replace(&staging.path, target).map_err(|error| {
        let mut app_error = if fs::symlink_metadata(target).is_ok() {
            path_conflict(target)
        } else {
            clone_reservation_error(target)
        };
        app_error = app_error
            .with_detail("stagingPath", staging.path.to_string_lossy())
            .with_detail("publishError", error.to_string());
        app_error
    })?;
    after_publish();
    if !staging.matches_path(target) {
        return Err(clone_identity_error(
            staging,
            target,
            "publishedIdentityMismatch",
            target,
        ));
    }
    Ok(())
}

fn clone_identity_error(
    staging: &OwnedCloneStaging,
    target: &Path,
    state: &str,
    identity_check_path: &Path,
) -> AppError {
    AppError::new(
        ErrorCode::CloneFailed,
        "clone staging identity를 안전하게 확인하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("stagingPath", staging.path.to_string_lossy())
    .with_detail("targetPath", target.to_string_lossy())
    .with_detail("publicationState", state)
    .with_detail("identityCheckPath", identity_check_path.to_string_lossy())
    .with_detail("ownedPathUnknown", "true")
}

#[cfg(target_os = "linux")]
fn publish_clone_no_replace(staging: &Path, target: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renameat2(
            olddirfd: i32,
            oldpath: *const std::ffi::c_char,
            newdirfd: i32,
            newpath: *const std::ffi::c_char,
            flags: u32,
        ) -> i32;
    }
    const AT_FDCWD: i32 = -100;
    const RENAME_NOREPLACE: u32 = 1;
    let old = CString::new(staging.as_os_str().as_bytes())?;
    let new = CString::new(target.as_os_str().as_bytes())?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the call.
    let result = unsafe {
        renameat2(
            AT_FDCWD,
            old.as_ptr(),
            AT_FDCWD,
            new.as_ptr(),
            RENAME_NOREPLACE,
        )
    };
    (result == 0)
        .then_some(())
        .ok_or_else(std::io::Error::last_os_error)
}

#[cfg(target_os = "macos")]
fn publish_clone_no_replace(staging: &Path, target: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renamex_np(
            old: *const std::ffi::c_char,
            new: *const std::ffi::c_char,
            flags: u32,
        ) -> i32;
    }
    const RENAME_EXCL: u32 = 0x0000_0004;
    let old = CString::new(staging.as_os_str().as_bytes())?;
    let new = CString::new(target.as_os_str().as_bytes())?;
    // SAFETY: both C strings are NUL-terminated and remain alive for the call.
    let result = unsafe { renamex_np(old.as_ptr(), new.as_ptr(), RENAME_EXCL) };
    (result == 0)
        .then_some(())
        .ok_or_else(std::io::Error::last_os_error)
}

#[cfg(target_os = "windows")]
fn publish_clone_no_replace(staging: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let old = staging
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let new = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // SAFETY: both UTF-16 buffers are NUL-terminated and remain alive for the call.
    let result = unsafe { MoveFileExW(old.as_ptr(), new.as_ptr(), 0) };
    (result != 0)
        .then_some(())
        .ok_or_else(std::io::Error::last_os_error)
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
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Barrier;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use git2::{Repository, Signature};

    use super::{clean_github_https_url, RepositoryService};
    use crate::error::ErrorCode;
    use crate::github::model::{DraftPullRequest, DraftPullRequestRequest, GithubRepositoryDetail};
    use crate::repository::git2_adapter::Git2RepositoryAdapter;
    use crate::repository::model::{CloneProgress, CloneRequest, RepositoryIdentity};
    use crate::repository::service::{
        CloneProgressSink, GitRepositoryPort, RepositoryCredentialPort, RepositoryRemotePort,
    };
    use crate::workspace::service::{PreviewRegistry, RepositoryPopulation, WorkspaceService};

    struct NoopProgress;

    impl CloneProgressSink for NoopProgress {
        fn emit(&self, _progress: CloneProgress) -> bool {
            true
        }
    }

    struct RejectFinalization;

    impl CloneProgressSink for RejectFinalization {
        fn emit(&self, _progress: CloneProgress) -> bool {
            true
        }

        fn begin_finalization(&self) -> bool {
            false
        }
    }

    struct BarrierFinalization {
        arrived: Arc<Barrier>,
        release: Arc<Barrier>,
        allow_publication: Arc<AtomicBool>,
    }

    impl CloneProgressSink for BarrierFinalization {
        fn emit(&self, _progress: CloneProgress) -> bool {
            true
        }

        fn begin_finalization(&self) -> bool {
            self.arrived.wait();
            self.release.wait();
            self.allow_publication.load(Ordering::SeqCst)
        }
    }

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

    #[cfg(unix)]
    #[test]
    fn a_dangling_clone_target_symlink_is_a_conflict() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        symlink(parent.path().join("missing"), &target).unwrap();

        let error = RepositoryService::ensure_clone_target(&target).unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    fn clone_test_remote() -> FakeRemote {
        FakeRemote {
            resolved_id: "R_expected".into(),
            accepted_remote_url: Default::default(),
            resolve_requests: Default::default(),
            resolve_action: Default::default(),
            origin_swap_after_resolve: Default::default(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
            draft_failures_after_create: Default::default(),
            open_pull_request: Default::default(),
        }
    }

    #[tokio::test]
    async fn clone_resolves_repository_identity_before_any_staging_entry_exists() {
        let parent = tempfile::tempdir().unwrap();
        let parent_path = parent.path().to_path_buf();
        let resolution_observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed_in_callback = resolution_observed.clone();
        let remote = clone_test_remote();
        *remote.resolve_action.lock().unwrap() = Some(Box::new(move || {
            observed_in_callback.store(true, std::sync::atomic::Ordering::SeqCst);
            assert!(fs::read_dir(&parent_path).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".okhub-clone-")));
        }));
        let service = RepositoryService::for_clone(
            Arc::new(CloneWritingGit::default()),
            Arc::new(remote),
            Arc::new(FakeCredentials),
        );

        let snapshot = service
            .clone(
                CloneRequest {
                    repository_id: "R_expected".into(),
                    full_name: "example/knowledge".into(),
                    https_url: "https://github.com/example/knowledge.git".into(),
                    parent_directory: parent.path().to_path_buf(),
                },
                Arc::new(NoopProgress),
            )
            .await
            .unwrap();

        assert!(resolution_observed.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(snapshot.root, parent.path().join("knowledge"));
        assert_eq!(
            fs::read_to_string(snapshot.root.join("owned.txt")).unwrap(),
            "clone content"
        );
    }

    #[tokio::test]
    async fn clone_authentication_precedes_final_path_ownership_and_preserves_attacker_directory() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        let attack_target = target.clone();
        let attack_parent = parent.path().to_path_buf();
        let credentials = AttackingCredentials {
            attack: Mutex::new(Some(Box::new(move || {
                assert!(fs::read_dir(&attack_parent).unwrap().all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".okhub-clone-")));
                let _ = fs::remove_dir(&attack_target);
                fs::create_dir(&attack_target).unwrap();
                fs::write(attack_target.join("mine.txt"), "user content").unwrap();
            }))),
        };
        let git = Arc::new(CloneWritingGit::default());
        let service = RepositoryService::for_clone(
            git.clone(),
            Arc::new(clone_test_remote()),
            Arc::new(credentials),
        );

        let error = service
            .clone(
                CloneRequest {
                    repository_id: "R_expected".into(),
                    full_name: "example/knowledge".into(),
                    https_url: "https://github.com/example/knowledge.git".into(),
                    parent_directory: parent.path().to_path_buf(),
                },
                Arc::new(NoopProgress),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert_eq!(
            fs::read_to_string(target.join("mine.txt")).unwrap(),
            "user content"
        );
        assert!(!target.join("owned.txt").exists());
        assert!(git.clone_targets.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn clone_authentication_precedes_final_path_ownership_and_preserves_external_symlink() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        let attack_target = target.clone();
        let outside_path = outside.path().to_path_buf();
        let credentials = AttackingCredentials {
            attack: Mutex::new(Some(Box::new(move || {
                let _ = fs::remove_dir(&attack_target);
                symlink(&outside_path, &attack_target).unwrap();
            }))),
        };
        let git = Arc::new(CloneWritingGit::default());
        let service = RepositoryService::for_clone(
            git.clone(),
            Arc::new(clone_test_remote()),
            Arc::new(credentials),
        );

        let error = service
            .clone(
                CloneRequest {
                    repository_id: "R_expected".into(),
                    full_name: "example/knowledge".into(),
                    https_url: "https://github.com/example/knowledge.git".into(),
                    parent_directory: parent.path().to_path_buf(),
                },
                Arc::new(NoopProgress),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert!(fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
        assert!(git.clone_targets.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn clone_publish_collision_preserves_final_path_and_reports_owned_staging() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        let git = Arc::new(CloneWritingGit {
            clone_targets: Default::default(),
            publish_collision: Some(target.clone()),
        });
        let service = RepositoryService::for_clone(
            git.clone(),
            Arc::new(clone_test_remote()),
            Arc::new(FakeCredentials),
        );

        let error = service
            .clone(
                CloneRequest {
                    repository_id: "R_expected".into(),
                    full_name: "example/knowledge".into(),
                    https_url: "https://github.com/example/knowledge.git".into(),
                    parent_directory: parent.path().to_path_buf(),
                },
                Arc::new(NoopProgress),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
        assert_eq!(
            fs::read_to_string(target.join("mine.txt")).unwrap(),
            "user content"
        );
        assert!(!target.join("owned.txt").exists());
        let staging = std::path::PathBuf::from(error.details.get("stagingPath").unwrap());
        assert!(staging.is_dir());
        assert_eq!(
            fs::read_to_string(staging.join("owned.txt")).unwrap(),
            "clone content"
        );
    }

    #[tokio::test]
    async fn cancellation_at_finalization_keeps_the_owned_staging_and_never_publishes_target() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        let service = RepositoryService::for_clone(
            Arc::new(CloneWritingGit::default()),
            Arc::new(clone_test_remote()),
            Arc::new(FakeCredentials),
        );

        let error = service
            .clone(
                CloneRequest {
                    repository_id: "R_expected".into(),
                    full_name: "example/knowledge".into(),
                    https_url: "https://github.com/example/knowledge.git".into(),
                    parent_directory: parent.path().to_path_buf(),
                },
                Arc::new(RejectFinalization),
            )
            .await
            .unwrap_err();

        let staging = std::path::PathBuf::from(error.details.get("stagingPath").unwrap());
        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(staging.join("owned.txt")).unwrap(),
            "clone content"
        );
    }

    #[test]
    fn cancellation_at_the_prepublication_barrier_retains_staging_and_target_absence() {
        let parent = tempfile::tempdir().unwrap();
        let target = parent.path().join("knowledge");
        let service = RepositoryService::for_clone(
            Arc::new(CloneWritingGit::default()),
            Arc::new(clone_test_remote()),
            Arc::new(FakeCredentials),
        );
        let arrived = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let allow_publication = Arc::new(AtomicBool::new(true));
        let sink = Arc::new(BarrierFinalization {
            arrived: arrived.clone(),
            release: release.clone(),
            allow_publication: allow_publication.clone(),
        });
        let request = CloneRequest {
            repository_id: "R_expected".into(),
            full_name: "example/knowledge".into(),
            https_url: "https://github.com/example/knowledge.git".into(),
            parent_directory: parent.path().to_path_buf(),
        };

        let worker = std::thread::spawn(move || {
            tauri::async_runtime::block_on(service.clone(request, sink))
        });
        arrived.wait();
        allow_publication.store(false, Ordering::SeqCst);
        release.wait();
        let error = worker.join().unwrap().unwrap_err();

        let staging = std::path::PathBuf::from(error.details.get("stagingPath").unwrap());
        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(staging.join("owned.txt")).unwrap(),
            "clone content"
        );
    }

    #[test]
    fn clone_publication_rejects_a_replacement_directory_at_the_staging_path() {
        let parent = tempfile::tempdir().unwrap();
        let staging = parent.path().join("staging");
        let retained = parent.path().join("retained-owned-clone");
        let target = parent.path().join("knowledge");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("owned.txt"), "owned clone").unwrap();
        let owned = super::OwnedCloneStaging::capture(staging.clone()).unwrap();

        let error = super::publish_owned_clone_with_hooks(
            &owned,
            &target,
            || {
                fs::rename(&staging, &retained).unwrap();
                fs::create_dir(&staging).unwrap();
                fs::write(staging.join("attacker.txt"), "replacement").unwrap();
            },
            || {},
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert_eq!(
            error.details.get("publicationState").map(String::as_str),
            Some("sourceIdentityMismatch")
        );
        assert_eq!(
            error.details.get("identityCheckPath").map(String::as_str),
            staging.to_str()
        );
        assert_eq!(
            error.details.get("ownedPathUnknown").map(String::as_str),
            Some("true")
        );
        assert!(!error.details.contains_key("retainedRecoveryPath"));
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(retained.join("owned.txt")).unwrap(),
            "owned clone"
        );
        assert_eq!(
            fs::read_to_string(staging.join("attacker.txt")).unwrap(),
            "replacement"
        );
    }

    #[cfg(unix)]
    #[test]
    fn clone_publication_rejects_a_replacement_symlink_at_the_staging_path() {
        use std::os::unix::fs::symlink;

        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let staging = parent.path().join("staging");
        let retained = parent.path().join("retained-owned-clone");
        let target = parent.path().join("knowledge");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("owned.txt"), "owned clone").unwrap();
        let owned = super::OwnedCloneStaging::capture(staging.clone()).unwrap();

        let error = super::publish_owned_clone_with_hooks(
            &owned,
            &target,
            || {
                fs::rename(&staging, &retained).unwrap();
                symlink(outside.path(), &staging).unwrap();
            },
            || {},
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert_eq!(
            error.details.get("publicationState").map(String::as_str),
            Some("sourceIdentityMismatch")
        );
        assert_eq!(
            error.details.get("identityCheckPath").map(String::as_str),
            staging.to_str()
        );
        assert_eq!(
            error.details.get("ownedPathUnknown").map(String::as_str),
            Some("true")
        );
        assert!(!error.details.contains_key("retainedRecoveryPath"));
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(retained.join("owned.txt")).unwrap(),
            "owned clone"
        );
        assert!(fs::symlink_metadata(&staging)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn clone_publication_reports_that_the_owned_path_is_unknown_after_target_identity_changes() {
        let parent = tempfile::tempdir().unwrap();
        let staging = parent.path().join("staging");
        let retained = parent.path().join("retained-owned-clone");
        let target = parent.path().join("knowledge");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("owned.txt"), "owned clone").unwrap();
        let owned = super::OwnedCloneStaging::capture(staging.clone()).unwrap();

        let error = super::publish_owned_clone_with_hooks(
            &owned,
            &target,
            || {},
            || {
                fs::rename(&target, &retained).unwrap();
                fs::create_dir(&target).unwrap();
                fs::write(target.join("attacker.txt"), "replacement").unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::CloneFailed);
        assert_eq!(
            error.details.get("publicationState").map(String::as_str),
            Some("publishedIdentityMismatch")
        );
        assert_eq!(
            error.details.get("identityCheckPath").map(String::as_str),
            target.to_str()
        );
        assert_eq!(
            error.details.get("ownedPathUnknown").map(String::as_str),
            Some("true")
        );
        assert!(!error.details.contains_key("retainedRecoveryPath"));
        assert_eq!(
            fs::read_to_string(retained.join("owned.txt")).unwrap(),
            "owned clone"
        );
        assert_eq!(
            fs::read_to_string(target.join("attacker.txt")).unwrap(),
            "replacement"
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

    type ResolveAction = Box<dyn Fn() + Send + Sync>;

    #[derive(Clone)]
    struct FakeRemote {
        resolved_id: String,
        accepted_remote_url: Arc<Mutex<Option<String>>>,
        resolve_requests: Arc<Mutex<Vec<String>>>,
        resolve_action: Arc<Mutex<Option<ResolveAction>>>,
        origin_swap_after_resolve: Arc<Mutex<Option<(std::path::PathBuf, String)>>>,
        draft_requests: Arc<Mutex<Vec<DraftPullRequestRequest>>>,
        draft_failures_remaining: Arc<Mutex<usize>>,
        draft_failures_after_create: Arc<Mutex<usize>>,
        open_pull_request: Arc<Mutex<Option<DraftPullRequest>>>,
    }

    #[async_trait]
    impl RepositoryRemotePort for FakeRemote {
        async fn resolve_remote_repository(
            &self,
            remote_url: &str,
            _expected_repository_id: &str,
        ) -> Result<GithubRepositoryDetail, crate::error::AppError> {
            self.resolve_requests
                .lock()
                .unwrap()
                .push(remote_url.to_owned());
            if let Some(action) = self.resolve_action.lock().unwrap().take() {
                action();
            }
            if let Some((root, replacement)) = self.origin_swap_after_resolve.lock().unwrap().take()
            {
                Repository::open(root)
                    .unwrap()
                    .remote_set_url("origin", &replacement)
                    .unwrap();
            }
            let accepted = self
                .accepted_remote_url
                .lock()
                .unwrap()
                .as_deref()
                .is_none_or(|expected| expected == remote_url);
            let resolved_id = if accepted {
                self.resolved_id.clone()
            } else {
                "R_other".into()
            };
            let (name, full_name, https_url, is_empty) = if resolved_id == "R_empty" {
                (
                    "empty",
                    "example/empty",
                    "https://github.com/example/empty.git",
                    true,
                )
            } else {
                (
                    "knowledge",
                    "example/knowledge",
                    "https://github.com/example/knowledge.git",
                    false,
                )
            };
            Ok(GithubRepositoryDetail {
                id: resolved_id,
                owner: "example".into(),
                name: name.into(),
                full_name: full_name.into(),
                default_branch: Some("main".into()),
                is_empty,
                https_url: https_url.into(),
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
            let pull_request = DraftPullRequest {
                number: 7,
                html_url: "https://github.com/example/knowledge/pull/7".into(),
                is_draft: true,
            };
            *self.open_pull_request.lock().unwrap() = Some(pull_request.clone());
            let mut failures = self.draft_failures_after_create.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err(crate::error::AppError::new(
                    ErrorCode::GithubUnavailable,
                    "fixture response lost after PR creation",
                )
                .with_recovery(crate::error::RecoveryAction::Retry)
                .with_detail("branch", &request.head));
            }
            Ok(pull_request)
        }

        async fn find_open_pull_request(
            &self,
            _request: &DraftPullRequestRequest,
        ) -> Result<Option<DraftPullRequest>, crate::error::AppError> {
            Ok(self.open_pull_request.lock().unwrap().clone())
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

    struct AttackingCredentials {
        attack: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    }

    #[async_trait]
    impl RepositoryCredentialPort for AttackingCredentials {
        async fn valid_access_token(
            &self,
        ) -> Result<crate::auth::model::AccessToken, crate::error::AppError> {
            if let Some(attack) = self.attack.lock().unwrap().take() {
                attack();
            }
            Ok(crate::auth::model::AccessToken::from_secret(
                secrecy::SecretString::new("fixture-token".into()),
            ))
        }
    }

    #[derive(Default)]
    struct CloneWritingGit {
        clone_targets: Arc<Mutex<Vec<std::path::PathBuf>>>,
        publish_collision: Option<std::path::PathBuf>,
    }

    impl GitRepositoryPort for CloneWritingGit {
        fn inspect(
            &self,
            path: &std::path::Path,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            Ok(crate::repository::model::RepositorySnapshot {
                root: path.to_path_buf(),
                head_oid: Some("fixture".into()),
                default_branch: Some("main".into()),
                is_dirty: false,
                has_content: true,
                remote_url: Some("https://github.com/example/knowledge.git".into()),
                fingerprint: "fixture".into(),
            })
        }

        fn clone_repository(
            &self,
            _clean_remote_url: &str,
            target: &std::path::Path,
            _access_token: crate::auth::model::AccessToken,
            _progress: Arc<dyn crate::repository::service::CloneProgressSink>,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            self.clone_targets
                .lock()
                .unwrap()
                .push(target.to_path_buf());
            fs::write(target.join("owned.txt"), "clone content").unwrap();
            if let Some(final_path) = &self.publish_collision {
                fs::create_dir(final_path).unwrap();
                fs::write(final_path.join("mine.txt"), "user content").unwrap();
            }
            self.inspect(target)
        }

        fn commit_initialization(
            &self,
            _root: &std::path::Path,
            _preview: &crate::workspace::service::InitializationPreview,
            _identity: &RepositoryIdentity,
        ) -> Result<crate::repository::model::CommitOutcome, crate::error::AppError> {
            unreachable!()
        }

        fn verify_initialization_commit(
            &self,
            _root: &std::path::Path,
            _preview: &crate::workspace::service::InitializationPreview,
            _outcome: &crate::repository::model::CommitOutcome,
            _identity: &RepositoryIdentity,
        ) -> Result<(), crate::error::AppError> {
            unreachable!()
        }

        fn push_branch(
            &self,
            _root: &std::path::Path,
            _branch: &str,
            _approved_remote_url: &str,
            _access_token: crate::auth::model::AccessToken,
        ) -> Result<(), crate::error::AppError> {
            unreachable!()
        }

        fn checkout_initialization(
            &self,
            _root: &std::path::Path,
            _preview: &crate::workspace::service::InitializationPreview,
            _outcome: &crate::repository::model::CommitOutcome,
        ) -> Result<(), crate::error::AppError> {
            unreachable!()
        }

        fn origin_url(&self, _root: &std::path::Path) -> Result<String, crate::error::AppError> {
            unreachable!()
        }

        fn attempt_directory(
            &self,
            _root: &std::path::Path,
        ) -> Result<std::path::PathBuf, crate::error::AppError> {
            unreachable!()
        }

        fn remote_branch_oid(
            &self,
            _root: &std::path::Path,
            _branch: &str,
            _approved_remote_url: &str,
            _access_token: crate::auth::model::AccessToken,
        ) -> Result<Option<String>, crate::error::AppError> {
            unreachable!()
        }
    }

    struct LocalRemoteGit {
        inner: Git2RepositoryAdapter,
        transport_url: String,
        approved_url: String,
    }

    impl GitRepositoryPort for LocalRemoteGit {
        fn inspect(
            &self,
            path: &std::path::Path,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            self.inner.inspect(path)
        }

        fn clone_repository(
            &self,
            clean_remote_url: &str,
            target: &std::path::Path,
            access_token: crate::auth::model::AccessToken,
            progress: Arc<dyn crate::repository::service::CloneProgressSink>,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            self.inner
                .clone_repository(clean_remote_url, target, access_token, progress)
        }

        fn commit_initialization(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            identity: &RepositoryIdentity,
        ) -> Result<crate::repository::model::CommitOutcome, crate::error::AppError> {
            self.inner.commit_initialization(root, preview, identity)
        }

        fn verify_initialization_commit(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            outcome: &crate::repository::model::CommitOutcome,
            identity: &RepositoryIdentity,
        ) -> Result<(), crate::error::AppError> {
            self.inner
                .verify_initialization_commit(root, preview, outcome, identity)
        }

        fn push_branch(
            &self,
            root: &std::path::Path,
            branch: &str,
            approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<(), crate::error::AppError> {
            assert_eq!(approved_remote_url, self.approved_url);
            self.inner
                .push_branch(root, branch, &self.transport_url, access_token)?;
            Repository::open_bare(&self.transport_url)
                .unwrap()
                .set_head(&format!("refs/heads/{branch}"))
                .unwrap();
            Ok(())
        }

        fn checkout_initialization(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            outcome: &crate::repository::model::CommitOutcome,
        ) -> Result<(), crate::error::AppError> {
            self.inner.checkout_initialization(root, preview, outcome)
        }

        fn origin_url(&self, root: &std::path::Path) -> Result<String, crate::error::AppError> {
            self.inner.origin_url(root)
        }

        fn attempt_directory(
            &self,
            root: &std::path::Path,
        ) -> Result<std::path::PathBuf, crate::error::AppError> {
            self.inner.attempt_directory(root)
        }

        fn remote_branch_oid(
            &self,
            root: &std::path::Path,
            branch: &str,
            approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<Option<String>, crate::error::AppError> {
            assert_eq!(approved_remote_url, self.approved_url);
            self.inner
                .remote_branch_oid(root, branch, &self.transport_url, access_token)
        }
    }

    struct AmbiguousPushGit {
        inner: LocalRemoteGit,
        fail_after_push_once: Mutex<bool>,
    }

    impl GitRepositoryPort for AmbiguousPushGit {
        fn inspect(
            &self,
            path: &std::path::Path,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            self.inner.inspect(path)
        }

        fn clone_repository(
            &self,
            clean_remote_url: &str,
            target: &std::path::Path,
            access_token: crate::auth::model::AccessToken,
            progress: Arc<dyn crate::repository::service::CloneProgressSink>,
        ) -> Result<crate::repository::model::RepositorySnapshot, crate::error::AppError> {
            self.inner
                .clone_repository(clean_remote_url, target, access_token, progress)
        }

        fn commit_initialization(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            identity: &RepositoryIdentity,
        ) -> Result<crate::repository::model::CommitOutcome, crate::error::AppError> {
            self.inner.commit_initialization(root, preview, identity)
        }

        fn verify_initialization_commit(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            outcome: &crate::repository::model::CommitOutcome,
            identity: &RepositoryIdentity,
        ) -> Result<(), crate::error::AppError> {
            self.inner
                .verify_initialization_commit(root, preview, outcome, identity)
        }

        fn push_branch(
            &self,
            root: &std::path::Path,
            branch: &str,
            approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<(), crate::error::AppError> {
            self.inner
                .push_branch(root, branch, approved_remote_url, access_token)?;
            let mut fail = self.fail_after_push_once.lock().unwrap();
            if *fail {
                *fail = false;
                return Err(crate::error::AppError::new(
                    ErrorCode::PushFailed,
                    "fixture lost the successful push response",
                )
                .with_recovery(crate::error::RecoveryAction::Retry));
            }
            Ok(())
        }

        fn checkout_initialization(
            &self,
            root: &std::path::Path,
            preview: &crate::workspace::service::InitializationPreview,
            outcome: &crate::repository::model::CommitOutcome,
        ) -> Result<(), crate::error::AppError> {
            self.inner.checkout_initialization(root, preview, outcome)
        }

        fn origin_url(&self, root: &std::path::Path) -> Result<String, crate::error::AppError> {
            self.inner.origin_url(root)
        }

        fn attempt_directory(
            &self,
            root: &std::path::Path,
        ) -> Result<std::path::PathBuf, crate::error::AppError> {
            self.inner.attempt_directory(root)
        }

        fn remote_branch_oid(
            &self,
            root: &std::path::Path,
            branch: &str,
            approved_remote_url: &str,
            access_token: crate::auth::model::AccessToken,
        ) -> Result<Option<String>, crate::error::AppError> {
            self.inner
                .remote_branch_oid(root, branch, approved_remote_url, access_token)
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
                accepted_remote_url: Default::default(),
                resolve_requests: Default::default(),
                resolve_action: Default::default(),
                origin_swap_after_resolve: Default::default(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
                draft_failures_after_create: Default::default(),
                open_pull_request: Default::default(),
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
                accepted_remote_url: Default::default(),
                resolve_requests: Default::default(),
                resolve_action: Default::default(),
                origin_swap_after_resolve: Default::default(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
                draft_failures_after_create: Default::default(),
                open_pull_request: Default::default(),
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
                accepted_remote_url: Default::default(),
                resolve_requests: Default::default(),
                resolve_action: Default::default(),
                origin_swap_after_resolve: Default::default(),
                draft_requests: Default::default(),
                draft_failures_remaining: Default::default(),
                draft_failures_after_create: Default::default(),
                open_pull_request: Default::default(),
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

        fn restarted_service(&self) -> RepositoryService {
            RepositoryService::new(
                Arc::new(LocalRemoteGit {
                    inner: Git2RepositoryAdapter,
                    transport_url: self._bare_remote.path().to_string_lossy().into_owned(),
                    approved_url: "https://github.com/example/knowledge.git".into(),
                }),
                Arc::new(self.remote.clone()),
                Arc::new(FakeCredentials),
                Arc::new(PreviewRegistry::default()),
                self.root.clone(),
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
            )
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
        Repository::open_bare(bare_remote.path())
            .unwrap()
            .set_head("refs/heads/main")
            .unwrap();
        let root = directory.path().to_path_buf();
        drop(branch);
        drop(repository);
        let previews = Arc::new(PreviewRegistry::default());
        let remote = FakeRemote {
            resolved_id: "R_expected".into(),
            accepted_remote_url: Default::default(),
            resolve_requests: Default::default(),
            resolve_action: Default::default(),
            origin_swap_after_resolve: Default::default(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
            draft_failures_after_create: Default::default(),
            open_pull_request: Default::default(),
        };
        let service = RepositoryService::new(
            Arc::new(LocalRemoteGit {
                inner: Git2RepositoryAdapter,
                transport_url: bare_remote.path().to_string_lossy().into_owned(),
                approved_url: "https://github.com/example/knowledge.git".into(),
            }),
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

    async fn persisted_pushed_attempt(
        fixture: &InitializationFixture,
    ) -> crate::workspace::service::InitializationPreview {
        *fixture.remote.draft_failures_remaining.lock().unwrap() = 1;
        let preview = fixture.preview();
        let error = fixture.service.initialize(preview.id).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::DraftPullRequestFailed);
        preview
    }

    fn persisted_phase_path(
        fixture: &InitializationFixture,
        preview_id: uuid::Uuid,
        phase: &str,
    ) -> std::path::PathBuf {
        Repository::open(&fixture.root)
            .unwrap()
            .path()
            .join("okhub")
            .join(preview_id.to_string())
            .join(phase)
    }

    fn rewrite_pushed_attempt(
        fixture: &InitializationFixture,
        preview_id: uuid::Uuid,
        mutate: impl FnOnce(&mut serde_json::Value),
    ) {
        let path = persisted_phase_path(fixture, preview_id, "pushed.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        mutate(&mut value);
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    #[tokio::test]
    async fn persisted_attempt_rejects_a_mismatched_preview_id_and_retains_evidence() {
        let fixture = initialized_repository_with_existing_content();
        let preview = persisted_pushed_attempt(&fixture).await;
        rewrite_pushed_attempt(&fixture, preview.id, |value| {
            value["preview"]["id"] = serde_json::json!(uuid::Uuid::new_v4());
        });
        let request_count = fixture.remote.draft_requests.lock().unwrap().len();

        let error = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(
            fixture.remote.draft_requests.lock().unwrap().len(),
            request_count
        );
        assert!(persisted_phase_path(&fixture, preview.id, "pushed.json").exists());
    }

    #[tokio::test]
    async fn persisted_attempt_rejects_phase_branch_base_oid_and_seed_corruption() {
        for case in ["phase", "branch", "base", "oid", "seed"] {
            let fixture = initialized_repository_with_existing_content();
            let preview = persisted_pushed_attempt(&fixture).await;
            rewrite_pushed_attempt(&fixture, preview.id, |value| match case {
                "phase" => value["pushed"] = serde_json::json!(false),
                "branch" => {
                    value["preview"]["branch"] = serde_json::json!("malicious");
                    value["outcome"]["branch"] = serde_json::json!("malicious");
                }
                "base" => {
                    value["preview"]["strategy"]["baseBranch"] = serde_json::json!("malicious");
                }
                "oid" => {
                    value["outcome"]["commit_oid"] =
                        serde_json::json!("0000000000000000000000000000000000000000");
                }
                "seed" => {
                    value["preview"]["files"][0]["content"] =
                        serde_json::json!("malicious workspace")
                }
                _ => unreachable!(),
            });
            let request_count = fixture.remote.draft_requests.lock().unwrap().len();

            let error = fixture
                .restarted_service()
                .initialize(preview.id)
                .await
                .unwrap_err();

            assert_eq!(
                error.code,
                ErrorCode::WorkspaceChangedSincePreview,
                "case: {case}"
            );
            assert_eq!(
                fixture.remote.draft_requests.lock().unwrap().len(),
                request_count,
                "case: {case}"
            );
            assert!(persisted_phase_path(&fixture, preview.id, "pushed.json").exists());
        }
    }

    #[tokio::test]
    async fn persisted_attempt_rejects_a_local_ref_that_no_longer_points_to_the_outcome() {
        let fixture = initialized_repository_with_existing_content();
        let preview = persisted_pushed_attempt(&fixture).await;
        let repository = Repository::open(&fixture.root).unwrap();
        let main_oid = repository
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        repository
            .reference(
                "refs/heads/okf/init-workspace",
                main_oid,
                true,
                "fixture corruption",
            )
            .unwrap();
        let request_count = fixture.remote.draft_requests.lock().unwrap().len();

        let error = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(
            fixture.remote.draft_requests.lock().unwrap().len(),
            request_count
        );
    }

    #[tokio::test]
    async fn persisted_attempt_rejects_a_commit_with_an_unapproved_tree() {
        let fixture = initialized_repository_with_existing_content();
        let preview = persisted_pushed_attempt(&fixture).await;
        let repository = Repository::open(&fixture.root).unwrap();
        let main = repository
            .find_reference("refs/heads/main")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        let blob = repository.blob(b"malicious").unwrap();
        let mut builder = repository.treebuilder(Some(&main.tree().unwrap())).unwrap();
        builder.insert("malicious.md", blob, 0o100644).unwrap();
        let tree_oid = builder.write().unwrap();
        let tree = repository.find_tree(tree_oid).unwrap();
        let signature = Signature::now("hyeeun", "42+hyeeun@users.noreply.github.com").unwrap();
        let commit_oid = repository
            .commit(
                None,
                &signature,
                &signature,
                "chore: initialize OkHub workspace",
                &tree,
                &[&main],
            )
            .unwrap();
        repository
            .reference(
                "refs/heads/okf/init-workspace",
                commit_oid,
                true,
                "fixture corruption",
            )
            .unwrap();
        rewrite_pushed_attempt(&fixture, preview.id, |value| {
            value["outcome"]["commit_oid"] = serde_json::json!(commit_oid.to_string());
        });
        let request_count = fixture.remote.draft_requests.lock().unwrap().len();

        let error = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(
            fixture.remote.draft_requests.lock().unwrap().len(),
            request_count
        );
    }

    #[tokio::test]
    async fn persisted_attempt_revalidates_a_changed_origin_before_pr_mutation() {
        let fixture = initialized_repository_with_existing_content();
        let preview = persisted_pushed_attempt(&fixture).await;
        let original_origin = fixture._bare_remote.path().to_string_lossy().into_owned();
        *fixture.remote.accepted_remote_url.lock().unwrap() = Some(original_origin);
        Repository::open(&fixture.root)
            .unwrap()
            .remote_set_url("origin", "/different/repository.git")
            .unwrap();
        let request_count = fixture.remote.draft_requests.lock().unwrap().len();

        let error = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryRemoteMismatch);
        assert_eq!(
            fixture.remote.draft_requests.lock().unwrap().len(),
            request_count
        );
        assert!(persisted_phase_path(&fixture, preview.id, "pushed.json").exists());
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
    async fn authenticated_git_operations_stay_bound_to_the_resolved_https_url_after_origin_swap() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        *fixture.remote.origin_swap_after_resolve.lock().unwrap() = Some((
            fixture.root.clone(),
            "https://attacker.example/exfiltrate.git".into(),
        ));

        let result = fixture.service.initialize(preview.id).await.unwrap();

        assert_eq!(result.branch, "okf/init-workspace");
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 1);
        assert_eq!(
            Repository::open(&fixture.root)
                .unwrap()
                .find_remote("origin")
                .unwrap()
                .url(),
            Some("https://attacker.example/exfiltrate.git")
        );
        assert!(Repository::open_bare(fixture._bare_remote.path())
            .unwrap()
            .find_reference("refs/heads/okf/init-workspace")
            .is_ok());
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
        let preview = fixture.preview();
        let service = RepositoryService::new(
            Arc::new(LocalRemoteGit {
                inner: Git2RepositoryAdapter,
                transport_url: "/definitely/missing/remote.git".into(),
                approved_url: "https://github.com/example/knowledge.git".into(),
            }),
            Arc::new(fixture.remote.clone()),
            Arc::new(FakeCredentials),
            fixture.previews.clone(),
            fixture.root.clone(),
            fixture.service.repository().unwrap().clone(),
            RepositoryIdentity {
                database_id: 42,
                login: "hyeeun".into(),
            },
        );

        let error = service.initialize(preview.id).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::PushFailed);
        assert_eq!(
            error.details.get("branch").map(String::as_str),
            Some("okf/init-workspace")
        );
        let repository = Repository::open(&fixture.root).unwrap();
        assert_eq!(repository.head().unwrap().shorthand(), Some("main"));
        assert!(!fixture.root.join(".okf/workspace.yml").exists());
        assert!(repository
            .find_reference("refs/heads/okf/init-workspace")
            .is_ok());
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
    async fn restart_after_local_commit_resumes_without_the_preview_registry() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        let service = RepositoryService::new(
            Arc::new(LocalRemoteGit {
                inner: Git2RepositoryAdapter,
                transport_url: "/definitely/missing/remote.git".into(),
                approved_url: "https://github.com/example/knowledge.git".into(),
            }),
            Arc::new(fixture.remote.clone()),
            Arc::new(FakeCredentials),
            fixture.previews.clone(),
            fixture.root.clone(),
            fixture.service.repository().unwrap().clone(),
            RepositoryIdentity {
                database_id: 42,
                login: "hyeeun".into(),
            },
        );
        let first_error = service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::PushFailed);

        let result = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap();

        assert_eq!(result.branch, "okf/init-workspace");
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn restart_after_push_resumes_pr_without_the_preview_registry() {
        let fixture = initialized_repository_with_existing_content();
        *fixture.remote.draft_failures_remaining.lock().unwrap() = 1;
        let preview = fixture.preview();
        let first_error = fixture.service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::DraftPullRequestFailed);

        let result = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap();

        assert_eq!(result.branch, "okf/init-workspace");
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn restart_after_an_ambiguous_pr_response_finds_the_existing_pr() {
        let fixture = initialized_repository_with_existing_content();
        *fixture.remote.draft_failures_after_create.lock().unwrap() = 1;
        let preview = fixture.preview();

        let first_error = fixture.service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::GithubUnavailable);

        let result = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap();

        assert_eq!(
            result.draft_pull_request_url.as_deref(),
            Some("https://github.com/example/knowledge/pull/7")
        );
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn restart_after_an_ambiguous_push_response_accepts_the_same_remote_oid() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        let service = RepositoryService::new(
            Arc::new(AmbiguousPushGit {
                inner: LocalRemoteGit {
                    inner: Git2RepositoryAdapter,
                    transport_url: fixture._bare_remote.path().to_string_lossy().into_owned(),
                    approved_url: "https://github.com/example/knowledge.git".into(),
                },
                fail_after_push_once: Mutex::new(true),
            }),
            Arc::new(fixture.remote.clone()),
            Arc::new(FakeCredentials),
            fixture.previews.clone(),
            fixture.root.clone(),
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

        let first_error = service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::PushFailed);

        let result = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap();

        assert_eq!(result.branch, "okf/init-workspace");
        assert_eq!(fixture.remote.draft_requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn retry_refuses_to_replace_a_different_remote_initialization_commit() {
        let fixture = initialized_repository_with_existing_content();
        let preview = fixture.preview();
        let service = RepositoryService::new(
            Arc::new(AmbiguousPushGit {
                inner: LocalRemoteGit {
                    inner: Git2RepositoryAdapter,
                    transport_url: fixture._bare_remote.path().to_string_lossy().into_owned(),
                    approved_url: "https://github.com/example/knowledge.git".into(),
                },
                fail_after_push_once: Mutex::new(true),
            }),
            Arc::new(fixture.remote.clone()),
            Arc::new(FakeCredentials),
            fixture.previews.clone(),
            fixture.root.clone(),
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
        let first_error = service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::PushFailed);
        let bare = Repository::open_bare(fixture._bare_remote.path()).unwrap();
        let main_oid = bare
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        bare.reference(
            "refs/heads/okf/init-workspace",
            main_oid,
            true,
            "fixture conflict",
        )
        .unwrap();

        let error = fixture
            .restarted_service()
            .initialize(preview.id)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::PushFailed);
        assert_eq!(
            error.details.get("remoteCommit").map(String::as_str),
            Some(main_oid.to_string()).as_deref()
        );
        assert!(fixture.remote.draft_requests.lock().unwrap().is_empty());
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
            accepted_remote_url: Default::default(),
            resolve_requests: Default::default(),
            resolve_action: Default::default(),
            origin_swap_after_resolve: Default::default(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
            draft_failures_after_create: Default::default(),
            open_pull_request: Default::default(),
        };
        let service = RepositoryService::new(
            Arc::new(LocalRemoteGit {
                inner: Git2RepositoryAdapter,
                transport_url: bare_remote.path().to_string_lossy().into_owned(),
                approved_url: "https://github.com/example/empty.git".into(),
            }),
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

    #[tokio::test]
    async fn empty_repository_retry_accepts_its_commit_after_the_remote_becomes_non_empty() {
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
            accepted_remote_url: Default::default(),
            resolve_requests: Default::default(),
            resolve_action: Default::default(),
            origin_swap_after_resolve: Default::default(),
            draft_requests: Default::default(),
            draft_failures_remaining: Default::default(),
            draft_failures_after_create: Default::default(),
            open_pull_request: Default::default(),
        };
        let repository_detail = |is_empty| GithubRepositoryDetail {
            id: "R_empty".into(),
            owner: "example".into(),
            name: "empty".into(),
            full_name: "example/empty".into(),
            default_branch: Some("main".into()),
            is_empty,
            https_url: "https://github.com/example/empty.git".into(),
        };
        let service = RepositoryService::new(
            Arc::new(AmbiguousPushGit {
                inner: LocalRemoteGit {
                    inner: Git2RepositoryAdapter,
                    transport_url: bare_remote.path().to_string_lossy().into_owned(),
                    approved_url: "https://github.com/example/empty.git".into(),
                },
                fail_after_push_once: Mutex::new(true),
            }),
            Arc::new(remote.clone()),
            Arc::new(FakeCredentials),
            previews.clone(),
            root.clone(),
            repository_detail(true),
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

        let first_error = service.initialize(preview.id).await.unwrap_err();
        assert_eq!(first_error.code, ErrorCode::PushFailed);

        let restarted = RepositoryService::new(
            Arc::new(LocalRemoteGit {
                inner: Git2RepositoryAdapter,
                transport_url: bare_remote.path().to_string_lossy().into_owned(),
                approved_url: "https://github.com/example/empty.git".into(),
            }),
            Arc::new(remote.clone()),
            Arc::new(FakeCredentials),
            Arc::new(PreviewRegistry::default()),
            root,
            repository_detail(false),
            RepositoryIdentity {
                database_id: 42,
                login: "hyeeun".into(),
            },
        );

        let result = restarted.initialize(preview.id).await.unwrap();

        assert_eq!(result.branch, "main");
        assert!(result.draft_pull_request_url.is_none());
    }
}
