use std::sync::Arc;

use crate::auth::service::AuthService;
use crate::github::client::{GithubService, ReqwestHttpTransport};
use crate::settings::service::LocalSettingsService;
use crate::workspace::service::PreviewRegistry;

pub struct AppServices {
    /// Populated by the desktop app. Settings-only tests deliberately leave it
    /// empty so they never initialize the developer's real credential store.
    pub auth: Option<Arc<AuthService>>,
    pub github: Option<GithubService>,
    pub initialization_previews: PreviewRegistry,
    pub local_settings: LocalSettingsService,
}

impl AppServices {
    pub fn new(local_settings: LocalSettingsService) -> Self {
        Self {
            auth: None,
            github: None,
            initialization_previews: PreviewRegistry::default(),
            local_settings,
        }
    }

    pub fn with_auth(local_settings: LocalSettingsService, auth: AuthService) -> Self {
        let auth = Arc::new(auth);
        let github = GithubService::with_shared_auth(auth.clone(), ReqwestHttpTransport::new())
            .expect("the static GitHub API base URL must be valid");
        Self {
            auth: Some(auth),
            github: Some(github),
            initialization_previews: PreviewRegistry::default(),
            local_settings,
        }
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
