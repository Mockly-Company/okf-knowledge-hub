use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::service::AuthService;
use crate::github::model::GithubRepositoryDetail;
use crate::github::GithubService;
use crate::repository::git2_adapter::Git2RepositoryAdapter;
use crate::repository::model::RepositoryIdentity;
use crate::repository::service::GitRepositoryPort;
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
}

#[derive(Clone, Default)]
pub(crate) struct JobRegistry {
    jobs: Arc<Mutex<HashMap<Uuid, CancellationToken>>>,
}

impl JobRegistry {
    pub(crate) async fn insert(&self, request_id: Uuid, cancellation: CancellationToken) {
        self.jobs.lock().await.insert(request_id, cancellation);
    }

    pub(crate) async fn remove(&self, request_id: Uuid) -> Option<CancellationToken> {
        self.jobs.lock().await.remove(&request_id)
    }

    pub(crate) async fn cancel(&self, request_id: Uuid) -> bool {
        self.remove(request_id).await.is_some_and(|cancellation| {
            cancellation.cancel();
            true
        })
    }

    pub(crate) async fn cancel_all(&self) {
        let jobs = std::mem::take(&mut *self.jobs.lock().await);
        for cancellation in jobs.into_values() {
            cancellation.cancel();
        }
    }

    #[cfg(test)]
    pub(crate) async fn contains(&self, request_id: Uuid) -> bool {
        self.jobs.lock().await.contains_key(&request_id)
    }
}

#[derive(Clone)]
pub(crate) struct InitializationContext {
    pub(crate) root: PathBuf,
    pub(crate) repository: GithubRepositoryDetail,
    pub(crate) identity: RepositoryIdentity,
}

#[derive(Clone, Default)]
pub(crate) struct InitializationContextRegistry {
    contexts: Arc<Mutex<HashMap<Uuid, InitializationContext>>>,
}

impl InitializationContextRegistry {
    pub(crate) async fn insert(&self, preview_id: Uuid, context: InitializationContext) {
        self.contexts.lock().await.insert(preview_id, context);
    }

    pub(crate) async fn get(&self, preview_id: Uuid) -> Option<InitializationContext> {
        self.contexts.lock().await.get(&preview_id).cloned()
    }

    pub(crate) async fn remove(&self, preview_id: Uuid) -> Option<InitializationContext> {
        self.contexts.lock().await.remove(&preview_id)
    }
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
        }
    }

    pub fn with_auth(local_settings: LocalSettingsService, auth: AuthService) -> Self {
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
            auth_jobs: JobRegistry::default(),
            clone_jobs: JobRegistry::default(),
            initialization_contexts: InitializationContextRegistry::default(),
        }
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

    use super::*;
    use crate::auth::model::{
        AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
        TokenGrant,
    };
    use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
    use crate::error::AppError;
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};

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
        fn emit(&self, _event: AuthStatusEvent) {}
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
