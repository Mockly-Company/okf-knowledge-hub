use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::model::{AuthStatusEvent, DeviceAuthorization, GithubUserSummary};
use crate::auth::ports::AuthEventSink;
use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::state::{AppServices, JobRegistry, JobTerminal};

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
    fn emit(&self, event: AuthStatusEvent) -> bool {
        let _ = self.app.emit(GITHUB_AUTH_STATUS_EVENT, event);
        true
    }
}

pub struct LifecycleAuthEventSink<E> {
    inner: E,
    jobs: JobRegistry,
}

impl<E> LifecycleAuthEventSink<E> {
    pub(crate) fn new(inner: E, jobs: JobRegistry) -> Self {
        Self { inner, jobs }
    }
}

impl<E: AuthEventSink> AuthEventSink for LifecycleAuthEventSink<E> {
    fn emit(&self, event: AuthStatusEvent) -> bool {
        let request_id = match &event {
            AuthStatusEvent::Authenticated { request_id, .. }
            | AuthStatusEvent::Failed { request_id, .. }
            | AuthStatusEvent::Cancelled { request_id } => Some(*request_id),
            AuthStatusEvent::WaitingForUser { .. }
            | AuthStatusEvent::ReauthenticationRequired { .. } => None,
        };
        let Some(request_id) = request_id else {
            return self.inner.emit(event);
        };
        match self.jobs.finish(request_id) {
            JobTerminal::Completed => self.inner.emit(event),
            JobTerminal::Cancelled => {
                let original_was_cancelled = matches!(event, AuthStatusEvent::Cancelled { .. });
                let _ = self.inner.emit(AuthStatusEvent::Cancelled { request_id });
                original_was_cancelled
            }
            JobTerminal::AlreadyTerminal => false,
        }
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
    let _mutation = services.initialization_contexts.lock_mutation().await;
    crate::commands::workspace::invalidate_pending_initialization_for_auth_transition_locked(
        services,
    )
    .await?;
    let authorization_result = auth.begin().await;
    let _ =
        crate::commands::workspace::remove_pending_initialization_tombstone_locked(services).await;
    let authorization = authorization_result?;
    drop(_mutation);
    let request_id = authorization.request_id;
    let cancellation = CancellationToken::new();
    services.auth_jobs.insert(request_id, cancellation.clone());
    let jobs = services.auth_jobs.clone();
    tauri::async_runtime::spawn(async move {
        let _ = auth.run(request_id, cancellation).await;
        jobs.finish(request_id);
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
    Ok(services.auth_jobs.cancel(request_id))
}

#[tauri::command]
pub async fn cancel_github_auth(
    state: State<'_, AppServices>,
    request_id: Uuid,
) -> CommandResult<bool> {
    cancel_github_auth_inner(&state, request_id).await
}

pub(crate) async fn logout_github_inner(services: &AppServices) -> CommandResult<()> {
    let auth = services.auth.clone().ok_or_else(auth_unavailable)?;
    let _mutation = services.initialization_contexts.lock_mutation().await;
    crate::commands::workspace::invalidate_pending_initialization_for_auth_transition_locked(
        services,
    )
    .await?;
    services.auth_jobs.cancel_all();
    services.clone_jobs.cancel_all();
    let auth_result = auth.logout().await;
    let _ =
        crate::commands::workspace::remove_pending_initialization_tombstone_locked(services).await;
    auth_result
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
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;

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
    use crate::settings::model::PendingInitializationContext;
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};

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

    struct OtherAccountDeviceFlow;

    #[async_trait]
    impl DeviceFlowApi for OtherAccountDeviceFlow {
        async fn request_device_code(
            &self,
            client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            ApprovedDeviceFlow.request_device_code(client_id).await
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            Ok(DeviceTokenPoll::Authorized(TokenGrant::new(
                "account-b-access",
                "account-b-refresh",
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
                id: 84,
                login: "other-developer".into(),
                avatar_url: "https://avatars.example/other".into(),
            })
        }
    }

    #[derive(Clone, Default)]
    struct MemoryCredentials {
        tokens: Arc<Mutex<Option<StoredTokens>>>,
        fail_next_delete: Arc<AtomicBool>,
        delete_attempted: Arc<AtomicBool>,
    }

    impl MemoryCredentials {
        fn with_tokens(tokens: StoredTokens) -> Self {
            Self {
                tokens: Arc::new(Mutex::new(Some(tokens))),
                ..Self::default()
            }
        }

        fn fail_next_delete(&self) {
            self.fail_next_delete.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl CredentialStore for MemoryCredentials {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(self.tokens.lock().unwrap().clone())
        }

        async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
            *self.tokens.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            self.delete_attempted.store(true, Ordering::SeqCst);
            if self.fail_next_delete.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::CredentialStoreUnavailable,
                    "fixture delete failure",
                ));
            }
            *self.tokens.lock().unwrap() = None;
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct MemorySettings {
        values: Arc<Mutex<HashMap<String, String>>>,
        fail_next_write: Arc<AtomicBool>,
        fail_next_remove: Arc<AtomicBool>,
    }

    impl MemorySettings {
        fn fail_next_write(&self) {
            self.fail_next_write.store(true, Ordering::SeqCst);
        }

        fn fail_next_remove(&self) {
            self.fail_next_remove.store(true, Ordering::SeqCst);
        }
    }

    impl LocalSettingsStore for MemorySettings {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.values.lock().unwrap().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            if self.fail_next_write.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "fixture write failure",
                ));
            }
            self.values.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            if self.fail_next_remove.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "fixture remove failure",
                ));
            }
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn pending_context() -> PendingInitializationContext {
        PendingInitializationContext {
            preview_id: Uuid::new_v4(),
            root: PathBuf::from("/tmp/mockly-knowledge"),
            repository_id: "R_kgDOMockly".into(),
            repository_full_name: "Mockly-Company/mockly-knowledge".into(),
            author_id: 7,
            author_login: "hyeeun".into(),
            created_at_unix: 1_000,
            expires_at_unix: 1_900,
            completed_result: None,
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
        fn emit(&self, event: AuthStatusEvent) -> bool {
            self.0.lock().unwrap().push(event);
            true
        }
    }

    struct BlockingEvents {
        events: Events,
        terminal_claimed: Arc<Barrier>,
        release: Arc<Barrier>,
    }

    impl AuthEventSink for BlockingEvents {
        fn emit(&self, event: AuthStatusEvent) -> bool {
            self.events.0.lock().unwrap().push(event);
            self.terminal_claimed.wait();
            self.release.wait();
            true
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
            while state.auth_jobs.contains(authorization.request_id) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(!state.auth_jobs.contains(authorization.request_id));
    }

    #[tokio::test]
    async fn cancelling_one_auth_request_leaves_other_jobs_running() {
        let state = AppServices::for_command_tests_without_auth();
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        let first_token = tokio_util::sync::CancellationToken::new();
        let second_token = tokio_util::sync::CancellationToken::new();
        state.auth_jobs.insert(first, first_token.clone());
        state.auth_jobs.insert(second, second_token.clone());

        assert!(cancel_github_auth_inner(&state, first).await.unwrap());

        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(state.auth_jobs.contains(first));
        assert!(state.auth_jobs.contains(second));
        assert!(!cancel_github_auth_inner(&state, first).await.unwrap());
        assert_eq!(
            state.auth_jobs.finish(first),
            crate::state::JobTerminal::Cancelled
        );
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

    #[tokio::test]
    async fn logout_invalidates_pending_initialization_for_the_next_account() {
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let settings = LocalSettingsService::new(MemorySettings::default());
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = AppServices::with_auth(settings.clone(), auth);
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();

        logout_github_inner(&state).await.unwrap();

        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(state
            .initialization_contexts
            .claim(context.preview_id)
            .is_err());
    }

    #[tokio::test]
    async fn starting_a_new_login_proactively_clears_an_existing_preview() {
        let events = Events::default();
        let auth = AuthService::new(
            "Iv1.public-client-id",
            OtherAccountDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            events.clone(),
        );
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store);
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = AppServices::with_auth(settings.clone(), auth);
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        let generation_before = state
            .auth
            .as_ref()
            .unwrap()
            .lifecycle_generation()
            .await
            .unwrap();

        let authorization = begin_github_auth_inner(&state).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while state.auth_jobs.contains(authorization.request_id) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        assert!(
            state
                .auth
                .as_ref()
                .unwrap()
                .lifecycle_generation()
                .await
                .unwrap()
                > generation_before
        );
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(state
            .initialization_contexts
            .claim(context.preview_id)
            .is_err());
        assert!(events.0.lock().unwrap().iter().any(|event| matches!(
            event,
            AuthStatusEvent::Authenticated { user, .. } if user.id == 84
        )));
    }

    #[tokio::test]
    async fn login_invalidation_write_failure_preserves_the_original_auth_and_preview() {
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            MemoryCredentials::default(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = AppServices::with_auth(settings.clone(), auth);
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        let generation_before = state
            .auth
            .as_ref()
            .unwrap()
            .lifecycle_generation()
            .await
            .unwrap();
        store.fail_next_write();

        let error = begin_github_auth_inner(&state).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            state.auth.as_ref().unwrap().lifecycle_generation().await,
            Some(generation_before)
        );
        assert_eq!(
            settings.load_pending_initialization().unwrap(),
            Some(context.clone())
        );
        let claim = state
            .initialization_contexts
            .claim(context.preview_id)
            .unwrap();
        assert_eq!(claim.context(), &context);
    }

    #[tokio::test]
    async fn logout_dual_failure_leaves_only_a_restart_safe_invalidation_tombstone() {
        let credentials = MemoryCredentials::with_tokens(StoredTokens::new(
            "account-a-access",
            "account-a-refresh",
            4_600,
            8_200,
        ));
        credentials.fail_next_delete();
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            credentials.clone(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store.clone());
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = AppServices::with_auth(settings.clone(), auth);
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        store.fail_next_remove();

        let error = logout_github_inner(&state).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::CredentialStoreUnavailable);
        assert!(credentials.delete_attempted.load(Ordering::SeqCst));
        assert!(!store.fail_next_remove.load(Ordering::SeqCst));
        assert_eq!(settings.load_pending_initialization().unwrap(), None);
        assert!(state
            .initialization_contexts
            .claim(context.preview_id)
            .is_err());

        let restarted = AppServices::new(LocalSettingsService::new(store));
        let restart_error =
            crate::commands::workspace::initialize_workspace_inner(&restarted, context.preview_id)
                .await
                .unwrap_err();
        assert_eq!(restart_error.code, ErrorCode::WorkspaceChangedSincePreview);
    }

    #[test]
    fn logout_is_rejected_after_initialization_claim_and_durable_attempt() {
        let credentials = MemoryCredentials::with_tokens(StoredTokens::new(
            "account-a-access",
            "account-a-refresh",
            4_600,
            8_200,
        ));
        let auth = AuthService::new(
            "Iv1.public-client-id",
            ApprovedDeviceFlow,
            credentials.clone(),
            FixedClock,
            ImmediateDelay,
            Events::default(),
        );
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store);
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = Arc::new(AppServices::with_auth(settings.clone(), auth));
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        let durable_written = Arc::new(Barrier::new(2));
        let release_remote_mutations = Arc::new(Barrier::new(2));
        let worker_state = state.clone();
        let worker_durable_written = durable_written.clone();
        let worker_release = release_remote_mutations.clone();
        let preview_id = context.preview_id;

        let worker = thread::spawn(move || {
            let claim = worker_state
                .initialization_contexts
                .claim(preview_id)
                .unwrap();
            worker_durable_written.wait();
            worker_release.wait();
            let push_token = tauri::async_runtime::block_on(
                worker_state.auth.as_ref().unwrap().valid_access_token(),
            )
            .map(|token| token.expose_secret().to_owned());
            let pr_token = tauri::async_runtime::block_on(
                worker_state.auth.as_ref().unwrap().valid_access_token(),
            )
            .map(|token| token.expose_secret().to_owned());
            claim.complete();
            (push_token, pr_token)
        });

        durable_written.wait();
        let generation_before =
            tauri::async_runtime::block_on(state.auth.as_ref().unwrap().lifecycle_generation())
                .unwrap();
        let transition = tauri::async_runtime::block_on(logout_github_inner(&state)).unwrap_err();
        let duplicate = state.initialization_contexts.insert(context.clone());
        release_remote_mutations.wait();
        let (push_token, pr_token) = worker.join().unwrap();

        assert_eq!(transition.code, ErrorCode::WorkspaceChangedSincePreview);
        assert!(duplicate.is_err());
        assert_eq!(push_token.unwrap(), "account-a-access");
        assert_eq!(pr_token.unwrap(), "account-a-access");
        assert!(!credentials.delete_attempted.load(Ordering::SeqCst));
        assert_eq!(
            tauri::async_runtime::block_on(state.auth.as_ref().unwrap().lifecycle_generation()),
            Some(generation_before)
        );
        assert_eq!(
            settings.load_pending_initialization().unwrap(),
            Some(context)
        );
    }

    #[test]
    fn account_switch_is_rejected_after_initialization_claim_and_durable_attempt() {
        let credentials = MemoryCredentials::with_tokens(StoredTokens::new(
            "account-a-access",
            "account-a-refresh",
            4_600,
            8_200,
        ));
        let events = Events::default();
        let auth = AuthService::new(
            "Iv1.public-client-id",
            OtherAccountDeviceFlow,
            credentials,
            FixedClock,
            ImmediateDelay,
            events.clone(),
        );
        let store = MemorySettings::default();
        let settings = LocalSettingsService::new(store);
        let context = pending_context();
        settings.set_pending_initialization(&context).unwrap();
        let state = Arc::new(AppServices::with_auth(settings.clone(), auth));
        state
            .initialization_contexts
            .insert(context.clone())
            .unwrap();
        let durable_written = Arc::new(Barrier::new(2));
        let release_remote_mutations = Arc::new(Barrier::new(2));
        let worker_state = state.clone();
        let worker_durable_written = durable_written.clone();
        let worker_release = release_remote_mutations.clone();
        let preview_id = context.preview_id;

        let worker = thread::spawn(move || {
            let claim = worker_state
                .initialization_contexts
                .claim(preview_id)
                .unwrap();
            worker_durable_written.wait();
            worker_release.wait();
            let push_token = tauri::async_runtime::block_on(
                worker_state.auth.as_ref().unwrap().valid_access_token(),
            )
            .map(|token| token.expose_secret().to_owned());
            let pr_token = tauri::async_runtime::block_on(
                worker_state.auth.as_ref().unwrap().valid_access_token(),
            )
            .map(|token| token.expose_secret().to_owned());
            claim.complete();
            (push_token, pr_token)
        });

        durable_written.wait();
        let generation_before =
            tauri::async_runtime::block_on(state.auth.as_ref().unwrap().lifecycle_generation())
                .unwrap();
        let transition =
            tauri::async_runtime::block_on(begin_github_auth_inner(&state)).unwrap_err();
        let duplicate = state.initialization_contexts.insert(context.clone());
        release_remote_mutations.wait();
        let (push_token, pr_token) = worker.join().unwrap();

        assert_eq!(transition.code, ErrorCode::WorkspaceChangedSincePreview);
        assert!(duplicate.is_err());
        assert_eq!(push_token.unwrap(), "account-a-access");
        assert_eq!(pr_token.unwrap(), "account-a-access");
        assert_eq!(
            tauri::async_runtime::block_on(state.auth.as_ref().unwrap().lifecycle_generation()),
            Some(generation_before)
        );
        assert_eq!(
            settings.load_pending_initialization().unwrap(),
            Some(context)
        );
        assert!(!events.0.lock().unwrap().iter().any(|event| matches!(
            event,
            AuthStatusEvent::Authenticated { user, .. } if user.id == 84
        )));
    }

    #[test]
    fn auth_terminal_event_is_cancelled_when_cancel_wins_and_completed_when_worker_wins() {
        let jobs = crate::state::JobRegistry::default();
        let events = Events::default();

        let cancelled_id = uuid::Uuid::new_v4();
        jobs.insert(cancelled_id, CancellationToken::new());
        let worker_ready = Arc::new(Barrier::new(2));
        let worker_release = Arc::new(Barrier::new(2));
        let worker_jobs = jobs.clone();
        let worker_events = events.clone();
        let worker_ready_clone = worker_ready.clone();
        let worker_release_clone = worker_release.clone();
        let cancelled_worker = thread::spawn(move || {
            worker_ready_clone.wait();
            worker_release_clone.wait();
            LifecycleAuthEventSink::new(worker_events, worker_jobs).emit(
                AuthStatusEvent::Authenticated {
                    request_id: cancelled_id,
                    user: GithubUserSummary {
                        id: 1,
                        login: "first".into(),
                        avatar_url: String::new(),
                    },
                },
            )
        });
        worker_ready.wait();
        assert!(jobs.cancel(cancelled_id));
        worker_release.wait();
        assert!(!cancelled_worker.join().unwrap());

        let completed_id = uuid::Uuid::new_v4();
        jobs.insert(completed_id, CancellationToken::new());
        let terminal_claimed = Arc::new(Barrier::new(2));
        let terminal_release = Arc::new(Barrier::new(2));
        let completed_sink = LifecycleAuthEventSink::new(
            BlockingEvents {
                events: events.clone(),
                terminal_claimed: terminal_claimed.clone(),
                release: terminal_release.clone(),
            },
            jobs.clone(),
        );
        let completed_worker = thread::spawn(move || {
            completed_sink.emit(AuthStatusEvent::Authenticated {
                request_id: completed_id,
                user: GithubUserSummary {
                    id: 2,
                    login: "second".into(),
                    avatar_url: String::new(),
                },
            })
        });
        terminal_claimed.wait();
        assert!(!jobs.cancel(completed_id));
        terminal_release.wait();
        assert!(completed_worker.join().unwrap());

        let recorded = events.0.lock().unwrap();
        assert!(matches!(
            recorded[0],
            AuthStatusEvent::Cancelled { request_id } if request_id == cancelled_id
        ));
        assert!(matches!(
            recorded[1],
            AuthStatusEvent::Authenticated { request_id, .. } if request_id == completed_id
        ));
        assert_eq!(recorded.len(), 2);
    }
}
