use std::collections::HashMap;
use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::service::AuthService;
use crate::github::GithubService;
use crate::repository::git2_adapter::Git2RepositoryAdapter;
use crate::repository::service::GitRepositoryPort;
use crate::settings::model::PendingInitializationContext;
use crate::settings::service::LocalSettingsService;
use crate::workspace::service::PreviewRegistry;

pub struct AppServices {
    /// Populated by the desktop app. Settings-only tests deliberately leave it
    /// empty so they never initialize the developer's real credential store.
    pub auth: Option<Arc<AuthService>>,
    pub github: Option<Arc<GithubService>>,
    #[allow(dead_code)] // Consumed by Task 8 command wiring.
    pub(crate) repository_git: Arc<dyn GitRepositoryPort>,
    pub initialization_previews: Arc<PreviewRegistry>,
    pub local_settings: LocalSettingsService,
    pub(crate) auth_jobs: JobRegistry,
    pub(crate) clone_jobs: JobRegistry,
    pub(crate) initialization_contexts: InitializationContextRegistry,
    #[cfg(test)]
    pub(crate) initialization_test_boundaries: Option<InitializationTestBoundaries>,
}

#[cfg(test)]
#[derive(Clone)]
pub(crate) struct InitializationTestBoundaries {
    pub(crate) git: Arc<dyn crate::repository::service::GitRepositoryPort>,
    pub(crate) remote: Arc<dyn crate::repository::service::RepositoryRemotePort>,
    pub(crate) credentials: Arc<dyn crate::repository::service::RepositoryCredentialPort>,
    pub(crate) user: crate::auth::model::GithubUserSummary,
    pub(crate) repository: crate::github::model::GithubRepositoryDetail,
}

#[derive(Clone, Default)]
pub(crate) struct JobRegistry {
    jobs: Arc<std::sync::Mutex<HashMap<Uuid, JobEntry>>>,
}

struct JobEntry {
    cancellation: CancellationToken,
    phase: JobPhase,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JobPhase {
    Running,
    Cancelling,
    Completing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JobTerminal {
    Completed,
    Cancelled,
    AlreadyTerminal,
}

impl JobRegistry {
    pub(crate) fn insert(&self, request_id: Uuid, cancellation: CancellationToken) {
        self.jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                request_id,
                JobEntry {
                    cancellation,
                    phase: JobPhase::Running,
                },
            );
    }

    pub(crate) fn begin_completion(&self, request_id: Uuid) -> bool {
        let mut jobs = self
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match jobs.get_mut(&request_id) {
            Some(job) if job.phase == JobPhase::Running => {
                job.phase = JobPhase::Completing;
                true
            }
            Some(job) if job.phase == JobPhase::Completing => true,
            _ => false,
        }
    }

    pub(crate) fn cancel(&self, request_id: Uuid) -> bool {
        let mut jobs = self
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match jobs.get_mut(&request_id) {
            Some(job) if job.phase == JobPhase::Running => {
                job.phase = JobPhase::Cancelling;
                job.cancellation.cancel();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn cancel_all(&self) -> Vec<Uuid> {
        let mut jobs = self
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut won = Vec::new();
        for (request_id, job) in jobs.iter_mut() {
            if job.phase == JobPhase::Running {
                job.phase = JobPhase::Cancelling;
                job.cancellation.cancel();
                won.push(*request_id);
            }
        }
        won
    }

    pub(crate) fn finish(&self, request_id: Uuid) -> JobTerminal {
        let entry = self
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&request_id);
        match entry.map(|entry| entry.phase) {
            Some(JobPhase::Cancelling) => JobTerminal::Cancelled,
            Some(JobPhase::Running | JobPhase::Completing) => JobTerminal::Completed,
            None => JobTerminal::AlreadyTerminal,
        }
    }

    #[cfg(test)]
    pub(crate) fn contains(&self, request_id: Uuid) -> bool {
        self.jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(&request_id)
    }
}

#[derive(Debug, Default)]
struct InitializationContextState {
    context: Option<PendingInitializationContext>,
    active: Option<Uuid>,
    replacing: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct InitializationContextRegistry {
    state: Arc<std::sync::Mutex<InitializationContextState>>,
    mutation: Arc<tokio::sync::Mutex<()>>,
}

impl InitializationContextRegistry {
    pub(crate) async fn lock_mutation(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.mutation.clone().lock_owned().await
    }

    pub(crate) fn begin_replace(
        &self,
        context: PendingInitializationContext,
    ) -> Result<InitializationContextReplacement, crate::error::AppError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active.is_some() || state.replacing {
            return Err(initialization_in_progress_error());
        }
        state.replacing = true;
        Ok(InitializationContextReplacement {
            registry: self.clone(),
            context: Some(context),
        })
    }

    pub(crate) fn begin_clear(&self) -> Result<InitializationContextClear, crate::error::AppError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active.is_some() || state.replacing {
            return Err(initialization_in_progress_error());
        }
        state.replacing = true;
        Ok(InitializationContextClear {
            registry: self.clone(),
            committed: false,
        })
    }

    pub(crate) fn insert(
        &self,
        context: PendingInitializationContext,
    ) -> Result<Option<PendingInitializationContext>, crate::error::AppError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active.is_some() || state.replacing {
            return Err(initialization_in_progress_error());
        }
        Ok(state.context.replace(context))
    }

    pub(crate) fn claim(
        &self,
        preview_id: Uuid,
    ) -> Result<InitializationContextClaim, crate::error::AppError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active.is_some() || state.replacing {
            return Err(initialization_in_progress_error());
        }
        let context = state
            .context
            .as_ref()
            .filter(|context| context.preview_id == preview_id)
            .cloned()
            .ok_or_else(initialization_context_missing_error)?;
        state.active = Some(preview_id);
        Ok(InitializationContextClaim {
            registry: self.clone(),
            context,
            completed: false,
        })
    }

    pub(crate) fn claim_if_present(
        &self,
        preview_id: Uuid,
    ) -> Result<Option<InitializationContextClaim>, crate::error::AppError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active.is_some() || state.replacing {
            return Err(initialization_in_progress_error());
        }
        let Some(context) = state
            .context
            .as_ref()
            .filter(|context| context.preview_id == preview_id)
            .cloned()
        else {
            return Ok(None);
        };
        state.active = Some(preview_id);
        Ok(Some(InitializationContextClaim {
            registry: self.clone(),
            context,
            completed: false,
        }))
    }

    pub(crate) fn clear(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.context = None;
        state.replacing = false;
    }
}

pub(crate) struct InitializationContextClear {
    registry: InitializationContextRegistry,
    committed: bool,
}

impl InitializationContextClear {
    pub(crate) fn commit(mut self) {
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.context = None;
        state.replacing = false;
        self.committed = true;
    }
}

impl Drop for InitializationContextClear {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        self.registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replacing = false;
    }
}

pub(crate) struct InitializationContextReplacement {
    registry: InitializationContextRegistry,
    context: Option<PendingInitializationContext>,
}

impl InitializationContextReplacement {
    pub(crate) fn commit(mut self) -> Option<PendingInitializationContext> {
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.replacing = false;
        state
            .context
            .replace(self.context.take().expect("replacement context is present"))
    }
}

impl Drop for InitializationContextReplacement {
    fn drop(&mut self) {
        if self.context.is_none() {
            return;
        }
        self.registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replacing = false;
    }
}

#[derive(Debug)]
pub(crate) struct InitializationContextClaim {
    registry: InitializationContextRegistry,
    context: PendingInitializationContext,
    completed: bool,
}

impl InitializationContextClaim {
    pub(crate) fn context(&self) -> &PendingInitializationContext {
        &self.context
    }

    pub(crate) fn record_completion(
        &mut self,
        result: crate::repository::model::InitializationResult,
    ) {
        self.context.completed_result = Some(result);
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active == Some(self.context.preview_id) {
            state.context = Some(self.context.clone());
        }
    }

    pub(crate) fn complete(mut self) {
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active == Some(self.context.preview_id) {
            state.active = None;
            if state
                .context
                .as_ref()
                .is_some_and(|context| context.preview_id == self.context.preview_id)
            {
                state.context = None;
            }
        }
        self.completed = true;
    }
}

impl Drop for InitializationContextClaim {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let mut state = self
            .registry
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.active == Some(self.context.preview_id) {
            state.active = None;
        }
    }
}

fn initialization_context_missing_error() -> crate::error::AppError {
    crate::error::AppError::new(
        crate::error::ErrorCode::WorkspaceChangedSincePreview,
        "초기화 미리보기가 없거나 더 이상 유효하지 않습니다.",
    )
    .with_recovery(crate::error::RecoveryAction::Retry)
}

fn initialization_in_progress_error() -> crate::error::AppError {
    crate::error::AppError::new(
        crate::error::ErrorCode::WorkspaceChangedSincePreview,
        "같은 워크스페이스 초기화가 이미 진행 중입니다.",
    )
    .with_recovery(crate::error::RecoveryAction::Retry)
}

impl AppServices {
    pub fn new(local_settings: LocalSettingsService) -> Self {
        Self {
            auth: None,
            github: None,
            repository_git: Arc::new(Git2RepositoryAdapter),
            initialization_previews: Arc::new(PreviewRegistry::default()),
            local_settings,
            auth_jobs: JobRegistry::default(),
            clone_jobs: JobRegistry::default(),
            initialization_contexts: InitializationContextRegistry::default(),
            #[cfg(test)]
            initialization_test_boundaries: None,
        }
    }

    pub fn with_auth(local_settings: LocalSettingsService, auth: AuthService) -> Self {
        Self::with_auth_jobs(local_settings, auth, JobRegistry::default())
    }

    pub(crate) fn with_auth_jobs(
        local_settings: LocalSettingsService,
        auth: AuthService,
        auth_jobs: JobRegistry,
    ) -> Self {
        let auth = Arc::new(auth);
        let github = Arc::new(
            GithubService::production(auth.clone())
                .expect("the static GitHub API base URL must be valid"),
        );
        Self {
            auth: Some(auth),
            github: Some(github),
            repository_git: Arc::new(Git2RepositoryAdapter),
            initialization_previews: Arc::new(PreviewRegistry::default()),
            local_settings,
            auth_jobs,
            clone_jobs: JobRegistry::default(),
            initialization_contexts: InitializationContextRegistry::default(),
            #[cfg(test)]
            initialization_test_boundaries: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn set_initialization_test_boundaries(
        &mut self,
        git: Arc<dyn crate::repository::service::GitRepositoryPort>,
        remote: Arc<dyn crate::repository::service::RepositoryRemotePort>,
        credentials: Arc<dyn crate::repository::service::RepositoryCredentialPort>,
        user: crate::auth::model::GithubUserSummary,
        repository: crate::github::model::GithubRepositoryDetail,
    ) {
        self.repository_git = git.clone();
        self.initialization_test_boundaries = Some(InitializationTestBoundaries {
            git,
            remote,
            credentials,
            user,
            repository,
        });
    }

    #[cfg(test)]
    pub(crate) fn for_command_tests(auth: AuthService) -> Self {
        Self::with_auth(LocalSettingsService::new(CommandTestSettings), auth)
    }

    #[cfg(test)]
    pub(crate) fn for_command_tests_without_auth() -> Self {
        Self::new(LocalSettingsService::new(CommandTestSettings))
    }
}

#[cfg(test)]
struct CommandTestSettings;

#[cfg(test)]
impl crate::settings::service::LocalSettingsStore for CommandTestSettings {
    fn read(&self, _key: &str) -> Result<Option<String>, crate::error::AppError> {
        Ok(None)
    }

    fn write(&self, _key: &str, _value: &str) -> Result<(), crate::error::AppError> {
        Ok(())
    }

    fn remove(&self, _key: &str) -> Result<(), crate::error::AppError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use secrecy::SecretString;
    use std::path::PathBuf;
    use std::sync::Barrier;
    use std::thread;

    use super::*;
    use crate::auth::model::{
        AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
        TokenGrant,
    };
    use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
    use crate::error::{AppError, ErrorCode};
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};

    #[test]
    fn completion_claim_wins_before_cancel_and_produces_one_completed_terminal() {
        let jobs = JobRegistry::default();
        let request_id = Uuid::new_v4();
        jobs.insert(request_id, CancellationToken::new());
        let claimed = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_jobs = jobs.clone();
        let worker_claimed = claimed.clone();
        let worker_release = release.clone();

        let worker = thread::spawn(move || {
            assert!(worker_jobs.begin_completion(request_id));
            worker_claimed.wait();
            worker_release.wait();
            worker_jobs.finish(request_id)
        });

        claimed.wait();
        assert!(!jobs.cancel(request_id));
        release.wait();
        assert_eq!(worker.join().unwrap(), JobTerminal::Completed);
        assert_eq!(jobs.finish(request_id), JobTerminal::AlreadyTerminal);
    }

    #[test]
    fn cancellation_claim_wins_before_worker_and_produces_one_cancelled_terminal() {
        let jobs = JobRegistry::default();
        let request_id = Uuid::new_v4();
        let cancellation = CancellationToken::new();
        jobs.insert(request_id, cancellation.clone());
        let cancelled = Arc::new(Barrier::new(2));
        let worker_jobs = jobs.clone();
        let worker_cancelled = cancelled.clone();

        assert!(jobs.cancel(request_id));
        let worker = thread::spawn(move || {
            worker_cancelled.wait();
            worker_jobs.finish(request_id)
        });
        cancelled.wait();

        assert!(cancellation.is_cancelled());
        assert_eq!(worker.join().unwrap(), JobTerminal::Cancelled);
        assert_eq!(jobs.finish(request_id), JobTerminal::AlreadyTerminal);
    }

    #[test]
    fn logout_cancellation_claims_only_running_jobs_and_workers_emit_cancelled_once() {
        let jobs = JobRegistry::default();
        let running = Uuid::new_v4();
        let completing = Uuid::new_v4();
        jobs.insert(running, CancellationToken::new());
        jobs.insert(completing, CancellationToken::new());
        assert!(jobs.begin_completion(completing));

        let won = jobs.cancel_all();

        assert_eq!(won, vec![running]);
        assert_eq!(jobs.finish(running), JobTerminal::Cancelled);
        assert_eq!(jobs.finish(completing), JobTerminal::Completed);
        assert_eq!(jobs.finish(running), JobTerminal::AlreadyTerminal);
    }

    #[test]
    fn initialization_context_is_single_flight_and_retryable_until_success() {
        let registry = InitializationContextRegistry::default();
        let context = PendingInitializationContext {
            preview_id: Uuid::new_v4(),
            root: PathBuf::from("/tmp/mockly-knowledge"),
            repository_id: "R_kgDOMockly".into(),
            repository_full_name: "Mockly-Company/mockly-knowledge".into(),
            author_id: 42,
            author_login: "hyeeun".into(),
            created_at_unix: 1_000,
            expires_at_unix: 1_900,
            completed_result: None,
        };
        registry.insert(context.clone()).unwrap();

        let claimed = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_registry = registry.clone();
        let worker_claimed = claimed.clone();
        let worker_release = release.clone();
        let preview_id = context.preview_id;
        let worker = thread::spawn(move || {
            let claim = worker_registry.claim(preview_id).unwrap();
            worker_claimed.wait();
            worker_release.wait();
            drop(claim);
        });

        claimed.wait();
        let duplicate = registry.claim(preview_id).unwrap_err();
        assert_eq!(duplicate.code, ErrorCode::WorkspaceChangedSincePreview);
        release.wait();
        worker.join().unwrap();

        let retry = registry.claim(preview_id).unwrap();
        assert_eq!(retry.context(), &context);
        retry.complete();
        assert!(registry.claim(preview_id).is_err());
    }

    struct UnusedDeviceFlow;

    #[async_trait]
    impl DeviceFlowApi for UnusedDeviceFlow {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            unreachable!()
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            unreachable!()
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            unreachable!()
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            unreachable!()
        }
    }

    struct EmptyCredentials;

    #[async_trait]
    impl CredentialStore for EmptyCredentials {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(None)
        }

        async fn save(&self, _tokens: &StoredTokens) -> Result<(), AppError> {
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            Ok(())
        }
    }

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_unix(&self) -> i64 {
            0
        }
    }

    struct NoDelay;
    #[async_trait]
    impl Delay for NoDelay {
        async fn wait(&self, _seconds: u64) {}
    }

    struct NoEvents;
    impl AuthEventSink for NoEvents {
        fn emit(&self, _event: AuthStatusEvent) -> bool {
            true
        }
    }

    struct EmptySettings;

    impl LocalSettingsStore for EmptySettings {
        fn read(&self, _key: &str) -> Result<Option<String>, AppError> {
            Ok(None)
        }

        fn write(&self, _key: &str, _value: &str) -> Result<(), AppError> {
            Ok(())
        }

        fn remove(&self, _key: &str) -> Result<(), AppError> {
            Ok(())
        }
    }

    #[test]
    fn authenticated_services_include_the_github_repository_client() {
        let auth = AuthService::new(
            "client-id",
            UnusedDeviceFlow,
            EmptyCredentials,
            FixedClock,
            NoDelay,
            NoEvents,
        );

        let services = AppServices::with_auth(LocalSettingsService::new(EmptySettings), auth);

        assert!(services.auth.is_some());
        assert!(services.github.is_some());
    }
}
