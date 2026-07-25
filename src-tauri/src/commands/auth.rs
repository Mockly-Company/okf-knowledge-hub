use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::model::{AuthStatusEvent, DeviceAuthorization, GithubUserSummary};
use crate::auth::ports::AuthEventSink;
use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::state::AppServices;

pub const GITHUB_AUTH_STATUS_EVENT: &str = "github-auth-status";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AuthState {
    SignedOut,
    Authenticated { user: GithubUserSummary },
    ReauthenticationRequired,
}

pub struct TauriAuthEventSink {
    app: AppHandle,
}

impl TauriAuthEventSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl AuthEventSink for TauriAuthEventSink {
    fn emit(&self, event: AuthStatusEvent) {
        let _ = self.app.emit(GITHUB_AUTH_STATUS_EVENT, event);
    }
}

pub(crate) async fn get_auth_state_inner(services: &AppServices) -> CommandResult<AuthState> {
    let auth = services.auth.clone().ok_or_else(auth_unavailable)?;
    match auth.has_stored_credentials().await {
        Ok(false) => return Ok(AuthState::SignedOut),
        Ok(true) => {}
        Err(error) if error.code == ErrorCode::ReauthenticationRequired => {
            return Ok(AuthState::ReauthenticationRequired)
        }
        Err(error) => return Err(error),
    }
    let github = services.github.clone().ok_or_else(auth_unavailable)?;
    match github.current_user().await {
        Ok(user) => Ok(AuthState::Authenticated { user }),
        Err(error) if error.code == ErrorCode::ReauthenticationRequired => {
            Ok(AuthState::ReauthenticationRequired)
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn get_auth_state(state: State<'_, AppServices>) -> CommandResult<AuthState> {
    get_auth_state_inner(&state).await
}

pub(crate) async fn begin_github_auth_inner(
    services: &AppServices,
) -> CommandResult<DeviceAuthorization> {
    let auth = services.auth.clone().ok_or_else(auth_unavailable)?;
    let authorization = auth.begin().await?;
    let request_id = authorization.request_id;
    let cancellation = CancellationToken::new();
    services
        .auth_jobs
        .insert(request_id, cancellation.clone())
        .await;
    let jobs = services.auth_jobs.clone();
    tauri::async_runtime::spawn(async move {
        let _ = auth.run(request_id, cancellation).await;
        jobs.remove(request_id).await;
    });
    Ok(authorization)
}

#[tauri::command]
pub async fn begin_github_auth(
    state: State<'_, AppServices>,
) -> CommandResult<DeviceAuthorization> {
    begin_github_auth_inner(&state).await
}

pub(crate) async fn cancel_github_auth_inner(
    services: &AppServices,
    request_id: Uuid,
) -> CommandResult<bool> {
    Ok(services.auth_jobs.cancel(request_id).await)
}

#[tauri::command]
pub async fn cancel_github_auth(
    state: State<'_, AppServices>,
    request_id: Uuid,
) -> CommandResult<bool> {
    cancel_github_auth_inner(&state, request_id).await
}

pub(crate) async fn logout_github_inner(services: &AppServices) -> CommandResult<()> {
    services.auth_jobs.cancel_all().await;
    services.clone_jobs.cancel_all().await;
    let auth = services.auth.clone().ok_or_else(auth_unavailable)?;
    auth.logout().await
}

#[tauri::command]
pub async fn logout_github(state: State<'_, AppServices>) -> CommandResult<()> {
    logout_github_inner(&state).await
}

fn auth_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "GitHub 인증 서비스를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use secrecy::SecretString;

    use super::*;
    use crate::auth::model::{
        AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
        TokenGrant,
    };
    use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
    use crate::auth::service::AuthService;
    use crate::error::AppError;

    struct ApprovedDeviceFlow;

    #[async_trait]
    impl DeviceFlowApi for ApprovedDeviceFlow {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(DeviceCodeResponse::new(
                SecretString::new("private-device-code".into()),
                "ABCD-EFGH",
                "https://github.com/login/device",
                900,
                0,
            ))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            Ok(DeviceTokenPoll::Authorized(TokenGrant::new(
                "ghu_private_access",
                "ghr_private_refresh",
                3_600,
                7_200,
            )))
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
            Ok(GithubUserSummary {
                id: 7,
                login: "hyeeun".into(),
                avatar_url: "https://avatars.example/hyeeun".into(),
            })
        }
    }

    #[derive(Default)]
    struct MemoryCredentials(Mutex<Option<StoredTokens>>);

    #[async_trait]
    impl CredentialStore for MemoryCredentials {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(self.0.lock().unwrap().clone())
        }

        async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
            *self.0.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_unix(&self) -> i64 {
            1_000
        }
    }

    struct ImmediateDelay;
    #[async_trait]
    impl Delay for ImmediateDelay {
        async fn wait(&self, _seconds: u64) {}
    }

    #[derive(Clone, Default)]
    struct Events(Arc<Mutex<Vec<AuthStatusEvent>>>);
    impl AuthEventSink for Events {
        fn emit(&self, event: AuthStatusEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[tokio::test]
    async fn begin_auth_returns_public_device_fields_only() {
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let state = AppServices::for_command_tests(auth);

        let result = begin_github_auth_inner(&state).await.unwrap();
        let json = serde_json::to_string(&result).unwrap();

        assert!(json.contains("userCode"));
        assert!(json.contains("verificationUri"));
        assert!(json.contains("requestId"));
        assert!(!json.contains("private-device-code"));
        assert!(!json.contains("ghu_private_access"));
        assert!(!json.contains("ghr_private_refresh"));
        assert!(!json.contains("device_code"));
        assert!(!json.contains("access_token"));
        assert!(!json.contains("refresh_token"));
    }

    #[tokio::test]
    async fn completed_auth_job_is_removed_from_command_state() {
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let state = AppServices::for_command_tests(auth);

        let authorization = begin_github_auth_inner(&state).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while state.auth_jobs.contains(authorization.request_id).await {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(!state.auth_jobs.contains(authorization.request_id).await);
    }

    #[tokio::test]
    async fn cancelling_one_auth_request_leaves_other_jobs_running() {
        let state = AppServices::for_command_tests_without_auth();
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        let first_token = tokio_util::sync::CancellationToken::new();
        let second_token = tokio_util::sync::CancellationToken::new();
        state.auth_jobs.insert(first, first_token.clone()).await;
        state.auth_jobs.insert(second, second_token.clone()).await;

        assert!(cancel_github_auth_inner(&state, first).await.unwrap());

        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(!state.auth_jobs.contains(first).await);
        assert!(state.auth_jobs.contains(second).await);
        assert!(!cancel_github_auth_inner(&state, first).await.unwrap());
    }

    #[test]
    fn authenticated_state_contains_only_public_profile_fields() {
        let state = AuthState::Authenticated {
            user: GithubUserSummary {
                id: 7,
                login: "hyeeun".into(),
                avatar_url: "https://avatars.example/hyeeun".into(),
            },
        };

        let json = serde_json::to_string(&state).unwrap();

        assert_eq!(
            json,
            r#"{"status":"authenticated","user":{"id":7,"login":"hyeeun","avatarUrl":"https://avatars.example/hyeeun"}}"#
        );
    }

    #[test]
    fn auth_status_events_use_the_public_camel_case_request_id() {
        let request_id = uuid::Uuid::new_v4();
        let json = serde_json::to_string(&AuthStatusEvent::WaitingForUser { request_id }).unwrap();

        assert!(json.contains("requestId"));
        assert!(!json.contains("request_id"));
    }

    #[tokio::test]
    async fn missing_credentials_are_reported_as_signed_out_without_calling_github() {
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let state = AppServices::for_command_tests(auth);

        let auth_state = get_auth_state_inner(&state).await.unwrap();
        let json = serde_json::to_string(&auth_state).unwrap();

        assert_eq!(json, r#"{"status":"signed_out"}"#);
    }
}
