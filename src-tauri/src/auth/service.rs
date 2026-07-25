use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use secrecy::SecretString;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::auth::model::{AccessToken, AuthStatusEvent, DeviceAuthorization, DeviceTokenPoll};
use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
use crate::error::{AppError, ErrorCode, RecoveryAction};

const EXPIRY_SAFETY_WINDOW_SECONDS: i64 = 60;

struct PendingAuthorization {
    device_code: SecretString,
    expires_at_unix: i64,
    interval_seconds: u64,
}

pub struct AuthService {
    client_id: String,
    api: Arc<dyn DeviceFlowApi>,
    credentials: Arc<dyn CredentialStore>,
    clock: Arc<dyn Clock>,
    delay: Arc<dyn Delay>,
    events: Arc<dyn AuthEventSink>,
    pending: Mutex<HashMap<Uuid, PendingAuthorization>>,
}

impl AuthService {
    pub fn new(
        client_id: impl Into<String>,
        api: impl DeviceFlowApi + 'static,
        credentials: impl CredentialStore + 'static,
        clock: impl Clock + 'static,
        delay: impl Delay + 'static,
        events: impl AuthEventSink + 'static,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            api: Arc::new(api),
            credentials: Arc::new(credentials),
            clock: Arc::new(clock),
            delay: Arc::new(delay),
            events: Arc::new(events),
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub async fn begin(&self) -> Result<DeviceAuthorization, AppError> {
        self.ensure_client_id()?;
        let response = self.api.request_device_code(&self.client_id).await?;
        let (device_code, user_code, verification_uri, expires_in, interval_seconds) =
            response.into_parts();
        let request_id = Uuid::new_v4();
        let expires_at_unix = self.clock.now_unix().saturating_add(expires_in as i64);
        let authorization = DeviceAuthorization {
            request_id,
            user_code,
            verification_uri,
            expires_at_unix,
            interval_seconds,
        };
        self.pending.lock().expect("auth pending mutex").insert(
            request_id,
            PendingAuthorization {
                device_code,
                expires_at_unix,
                interval_seconds,
            },
        );
        Ok(authorization)
    }

    pub async fn run(
        &self,
        request_id: Uuid,
        cancellation: CancellationToken,
    ) -> Result<(), AppError> {
        let Some(mut authorization) = self
            .pending
            .lock()
            .expect("auth pending mutex")
            .remove(&request_id)
        else {
            let error = authentication_expired_error();
            self.emit_failed(request_id, &error);
            return Err(error);
        };

        self.events
            .emit(AuthStatusEvent::WaitingForUser { request_id });

        loop {
            if cancellation.is_cancelled() {
                self.events.emit(AuthStatusEvent::Cancelled { request_id });
                return Ok(());
            }
            if self.clock.now_unix() >= authorization.expires_at_unix {
                let error = authentication_expired_error();
                self.emit_failed(request_id, &error);
                return Err(error);
            }

            tokio::select! {
                _ = cancellation.cancelled() => {
                    self.events.emit(AuthStatusEvent::Cancelled { request_id });
                    return Ok(());
                }
                _ = self.delay.wait(authorization.interval_seconds) => {}
            }

            if self.clock.now_unix() >= authorization.expires_at_unix {
                let error = authentication_expired_error();
                self.emit_failed(request_id, &error);
                return Err(error);
            }

            let poll_result = tokio::select! {
                _ = cancellation.cancelled() => {
                    self.events.emit(AuthStatusEvent::Cancelled { request_id });
                    return Ok(());
                }
                result = self.api.poll_access_token(
                    &self.client_id,
                    &authorization.device_code,
                ) => result,
            };
            let poll = match poll_result {
                Ok(poll) => poll,
                Err(error) => {
                    self.emit_failed(request_id, &error);
                    return Err(error);
                }
            };

            match poll {
                DeviceTokenPoll::Pending => {}
                DeviceTokenPoll::SlowDown => {
                    authorization.interval_seconds =
                        authorization.interval_seconds.saturating_add(5);
                }
                DeviceTokenPoll::Denied => {
                    let error = AppError::new(
                        ErrorCode::AuthenticationDenied,
                        "GitHub 로그인이 승인되지 않았습니다.",
                    )
                    .with_recovery(RecoveryAction::RestartLogin);
                    self.emit_failed(request_id, &error);
                    return Err(error);
                }
                DeviceTokenPoll::Expired => {
                    let error = authentication_expired_error();
                    self.emit_failed(request_id, &error);
                    return Err(error);
                }
                DeviceTokenPoll::Authorized(grant) => {
                    let user_result = tokio::select! {
                        _ = cancellation.cancelled() => {
                            self.events.emit(AuthStatusEvent::Cancelled { request_id });
                            return Ok(());
                        }
                        result = self.api.authenticated_user(grant.access_token()) => result,
                    };
                    let user = match user_result {
                        Ok(user) => user,
                        Err(error) => {
                            self.emit_failed(request_id, &error);
                            return Err(error);
                        }
                    };
                    let tokens = grant.into_stored(self.clock.now_unix());
                    if let Err(error) = self.credentials.save(&tokens) {
                        self.emit_failed(request_id, &error);
                        return Err(error);
                    }
                    self.events
                        .emit(AuthStatusEvent::Authenticated { request_id, user });
                    return Ok(());
                }
            }
        }
    }

    pub async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
        self.ensure_client_id()?;
        let Some(tokens) = self.credentials.load()? else {
            return Err(self.reauthentication_required());
        };
        let now = self.clock.now_unix();

        if tokens.access_expires_at_unix() > now.saturating_add(EXPIRY_SAFETY_WINDOW_SECONDS) {
            return Ok(AccessToken::from_secret(tokens.access_token().clone()));
        }
        if tokens.refresh_expires_at_unix() <= now {
            self.credentials.delete()?;
            return Err(self.reauthentication_required());
        }

        let grant = match self
            .api
            .refresh_access_token(&self.client_id, tokens.refresh_token())
            .await
        {
            Ok(grant) => grant,
            Err(error) if error.code == ErrorCode::GithubUnavailable => return Err(error),
            Err(_) => {
                self.credentials.delete()?;
                return Err(self.reauthentication_required());
            }
        };
        let refreshed = grant.into_stored(now);
        let access_token = AccessToken::from_secret(refreshed.access_token().clone());
        self.credentials.save(&refreshed)?;
        Ok(access_token)
    }

    pub fn logout(&self) -> Result<(), AppError> {
        self.pending.lock().expect("auth pending mutex").clear();
        self.credentials.delete()
    }

    fn ensure_client_id(&self) -> Result<(), AppError> {
        if self.client_id.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::GithubUnavailable,
                "GitHub App Client ID가 설정되지 않았습니다.",
            ));
        }
        Ok(())
    }

    fn reauthentication_required(&self) -> AppError {
        let request_id = Uuid::new_v4();
        self.events
            .emit(AuthStatusEvent::ReauthenticationRequired { request_id });
        AppError::new(
            ErrorCode::ReauthenticationRequired,
            "GitHub에 다시 로그인해 주세요.",
        )
        .with_recovery(RecoveryAction::RestartLogin)
    }

    fn emit_failed(&self, request_id: Uuid, error: &AppError) {
        self.events.emit(AuthStatusEvent::Failed {
            request_id,
            error: error.clone(),
        });
    }
}

fn authentication_expired_error() -> AppError {
    AppError::new(
        ErrorCode::AuthenticationExpired,
        "GitHub 로그인 요청이 만료되었습니다.",
    )
    .with_recovery(RecoveryAction::RestartLogin)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::future::pending;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use async_trait::async_trait;
    use secrecy::{ExposeSecret, SecretString};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    use super::AuthService;
    use crate::auth::model::{
        AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
        TokenGrant,
    };
    use crate::auth::ports::{AuthEventSink, Clock, CredentialStore, Delay, DeviceFlowApi};
    use crate::error::{AppError, ErrorCode};

    const CLIENT_ID: &str = "Iv1.public-client-id";

    #[derive(Clone)]
    struct FakeClock(Arc<AtomicI64>);

    impl FakeClock {
        fn at(now: i64) -> Self {
            Self(Arc::new(AtomicI64::new(now)))
        }

        fn advance(&self, seconds: u64) {
            self.0.fetch_add(seconds as i64, Ordering::SeqCst);
        }
    }

    impl Clock for FakeClock {
        fn now_unix(&self) -> i64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[derive(Clone)]
    struct AdvancingDelay {
        clock: FakeClock,
        waits: Arc<Mutex<Vec<u64>>>,
    }

    impl AdvancingDelay {
        fn new(clock: FakeClock) -> Self {
            Self {
                clock,
                waits: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn waits(&self) -> Vec<u64> {
            self.waits.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl Delay for AdvancingDelay {
        async fn wait(&self, seconds: u64) {
            self.waits.lock().unwrap().push(seconds);
            self.clock.advance(seconds);
        }
    }

    #[derive(Clone, Default)]
    struct NeverDelay;

    #[async_trait]
    impl Delay for NeverDelay {
        async fn wait(&self, _seconds: u64) {
            pending::<()>().await;
        }
    }

    #[derive(Clone, Default)]
    struct MemoryCredentialStore {
        tokens: Arc<Mutex<Option<StoredTokens>>>,
        deletes: Arc<Mutex<usize>>,
    }

    impl MemoryCredentialStore {
        fn with_tokens(tokens: StoredTokens) -> Self {
            Self {
                tokens: Arc::new(Mutex::new(Some(tokens))),
                deletes: Arc::new(Mutex::new(0)),
            }
        }

        fn saved_access_token(&self) -> Option<String> {
            self.tokens
                .lock()
                .unwrap()
                .as_ref()
                .map(|tokens| tokens.access_token().expose_secret().to_owned())
        }

        fn saved_refresh_token(&self) -> Option<String> {
            self.tokens
                .lock()
                .unwrap()
                .as_ref()
                .map(|tokens| tokens.refresh_token().expose_secret().to_owned())
        }

        fn delete_count(&self) -> usize {
            *self.deletes.lock().unwrap()
        }
    }

    impl CredentialStore for MemoryCredentialStore {
        fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Ok(self.tokens.lock().unwrap().clone())
        }

        fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
            *self.tokens.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        fn delete(&self) -> Result<(), AppError> {
            *self.tokens.lock().unwrap() = None;
            *self.deletes.lock().unwrap() += 1;
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct RecordingAuthEvents(Arc<Mutex<Vec<AuthStatusEvent>>>);

    impl RecordingAuthEvents {
        fn events(&self) -> Vec<AuthStatusEvent> {
            self.0.lock().unwrap().clone()
        }

        fn statuses(&self) -> Vec<&'static str> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .map(|event| match event {
                    AuthStatusEvent::WaitingForUser { .. } => "waiting_for_user",
                    AuthStatusEvent::Authenticated { .. } => "authenticated",
                    AuthStatusEvent::ReauthenticationRequired { .. } => "reauthentication_required",
                    AuthStatusEvent::Failed { .. } => "failed",
                    AuthStatusEvent::Cancelled { .. } => "cancelled",
                })
                .collect()
        }
    }

    impl AuthEventSink for RecordingAuthEvents {
        fn emit(&self, event: AuthStatusEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[derive(Clone)]
    struct FakeDeviceFlowApi {
        polls: Arc<Mutex<VecDeque<DeviceTokenPoll>>>,
        poll_count: Arc<Mutex<usize>>,
        refresh_result: Arc<Mutex<Option<Result<TokenGrant, AppError>>>>,
        refresh_calls: Arc<Mutex<Vec<RefreshCall>>>,
    }

    struct RefreshCall {
        client_id: String,
        refresh_token: String,
        client_secret: Option<String>,
    }

    impl FakeDeviceFlowApi {
        fn with_polls(polls: impl IntoIterator<Item = DeviceTokenPoll>) -> Self {
            Self {
                polls: Arc::new(Mutex::new(polls.into_iter().collect())),
                poll_count: Arc::new(Mutex::new(0)),
                refresh_result: Arc::new(Mutex::new(None)),
                refresh_calls: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn approved_after_two_polls() -> Self {
            Self::with_polls([
                DeviceTokenPoll::Pending,
                DeviceTokenPoll::Authorized(TokenGrant::new(
                    "ghu_private",
                    "ghr_private",
                    28_800,
                    15_897_600,
                )),
            ])
        }

        fn with_refresh_result(grant: TokenGrant) -> Self {
            let api = Self::with_polls([]);
            *api.refresh_result.lock().unwrap() = Some(Ok(grant));
            api
        }

        fn poll_count(&self) -> usize {
            *self.poll_count.lock().unwrap()
        }

        fn refresh_count(&self) -> usize {
            self.refresh_calls.lock().unwrap().len()
        }

        fn last_refresh_client_secret(&self) -> Option<String> {
            self.refresh_calls
                .lock()
                .unwrap()
                .last()
                .and_then(|call| call.client_secret.clone())
        }

        fn last_refresh_public_inputs(&self) -> Option<(String, String)> {
            self.refresh_calls
                .lock()
                .unwrap()
                .last()
                .map(|call| (call.client_id.clone(), call.refresh_token.clone()))
        }
    }

    #[async_trait]
    impl DeviceFlowApi for FakeDeviceFlowApi {
        async fn request_device_code(
            &self,
            client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            assert_eq!(client_id, CLIENT_ID);
            Ok(DeviceCodeResponse::new(
                SecretString::new("private-device-code".into()),
                "ABCD-EFGH",
                "https://github.com/login/device",
                900,
                5,
            ))
        }

        async fn poll_access_token(
            &self,
            client_id: &str,
            device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            assert_eq!(client_id, CLIENT_ID);
            assert_eq!(device_code.expose_secret(), "private-device-code");
            *self.poll_count.lock().unwrap() += 1;
            self.polls
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| AppError::new(ErrorCode::GithubUnavailable, "unexpected extra poll"))
        }

        async fn refresh_access_token(
            &self,
            client_id: &str,
            refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            self.refresh_calls.lock().unwrap().push(RefreshCall {
                client_id: client_id.to_owned(),
                refresh_token: refresh_token.expose_secret().to_owned(),
                client_secret: None,
            });
            self.refresh_result
                .lock()
                .unwrap()
                .take()
                .expect("refresh result")
        }

        async fn authenticated_user(
            &self,
            access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            assert!(access_token.expose_secret().starts_with("ghu_"));
            Ok(GithubUserSummary {
                id: 42,
                login: "hyeeun".into(),
                avatar_url: "https://avatars.example/42".into(),
            })
        }
    }

    #[derive(Clone, Default)]
    struct BlockingPollApi {
        poll_started: Arc<Notify>,
    }

    #[async_trait]
    impl DeviceFlowApi for BlockingPollApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(DeviceCodeResponse::new(
                SecretString::new("private-device-code".into()),
                "ABCD-EFGH",
                "https://github.com/login/device",
                900,
                5,
            ))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            self.poll_started.notify_one();
            pending().await
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            panic!("refresh is not used by this test")
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            panic!("user lookup is not used by this test")
        }
    }

    fn authorization_tokens() -> StoredTokens {
        StoredTokens::new("ghu_old", "ghr_old", 900, 20_000)
    }

    fn service(
        api: FakeDeviceFlowApi,
        credentials: MemoryCredentialStore,
        clock: FakeClock,
        delay: impl Delay + 'static,
        events: RecordingAuthEvents,
    ) -> AuthService {
        AuthService::new(CLIENT_ID, api, credentials, clock, delay, events)
    }

    #[tokio::test]
    async fn device_flow_stores_tokens_and_emits_only_public_status() {
        let api = FakeDeviceFlowApi::approved_after_two_polls();
        let credentials = MemoryCredentialStore::default();
        let events = RecordingAuthEvents::default();
        let clock = FakeClock::at(1_000);
        let service = service(
            api,
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            events.clone(),
        );

        let authorization = service.begin().await.unwrap();
        service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap();

        assert_eq!(
            credentials.saved_access_token().as_deref(),
            Some("ghu_private")
        );
        assert_eq!(events.statuses(), vec!["waiting_for_user", "authenticated"]);
        let public_json = serde_json::to_string(&events.events()).unwrap();
        assert!(!public_json.contains("ghu_private"));
        assert!(!public_json.contains("ghr_private"));
        assert!(!public_json.contains("private-device-code"));
    }

    #[tokio::test]
    async fn expired_access_token_rotates_both_tokens_without_a_client_secret() {
        let api = FakeDeviceFlowApi::with_refresh_result(TokenGrant::new(
            "ghu_new", "ghr_new", 28_800, 15_897_600,
        ));
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let clock = FakeClock::at(1_000);
        let service = service(
            api.clone(),
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        );

        let token = service.valid_access_token().await.unwrap();

        assert_eq!(token.expose_secret(), "ghu_new");
        assert_eq!(
            credentials.saved_refresh_token().as_deref(),
            Some("ghr_new")
        );
        assert_eq!(api.refresh_count(), 1);
        assert_eq!(
            api.last_refresh_public_inputs(),
            Some((CLIENT_ID.to_owned(), "ghr_old".to_owned()))
        );
        assert_eq!(api.last_refresh_client_secret(), None);
    }

    #[tokio::test]
    async fn authorization_denial_emits_a_public_failure() {
        let api = FakeDeviceFlowApi::with_polls([DeviceTokenPoll::Denied]);
        let credentials = MemoryCredentialStore::default();
        let events = RecordingAuthEvents::default();
        let clock = FakeClock::at(1_000);
        let service = service(
            api,
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            events.clone(),
        );
        let authorization = service.begin().await.unwrap();

        let error = service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::AuthenticationDenied);
        assert_eq!(events.statuses(), vec!["waiting_for_user", "failed"]);
        assert_eq!(credentials.saved_access_token(), None);
    }

    #[tokio::test]
    async fn expired_device_code_stops_polling() {
        let api = FakeDeviceFlowApi::with_polls([DeviceTokenPoll::Expired]);
        let clock = FakeClock::at(1_000);
        let service = service(
            api.clone(),
            MemoryCredentialStore::default(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        );
        let authorization = service.begin().await.unwrap();

        let error = service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::AuthenticationExpired);
        assert_eq!(api.poll_count(), 1);
    }

    #[tokio::test]
    async fn slow_down_adds_five_seconds_to_subsequent_poll_intervals() {
        let api = FakeDeviceFlowApi::with_polls([
            DeviceTokenPoll::SlowDown,
            DeviceTokenPoll::Pending,
            DeviceTokenPoll::Authorized(TokenGrant::new(
                "ghu_private",
                "ghr_private",
                28_800,
                15_897_600,
            )),
        ]);
        let clock = FakeClock::at(1_000);
        let delay = AdvancingDelay::new(clock.clone());
        let service = service(
            api,
            MemoryCredentialStore::default(),
            clock,
            delay.clone(),
            RecordingAuthEvents::default(),
        );
        let authorization = service.begin().await.unwrap();

        service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap();

        assert_eq!(delay.waits(), vec![5, 10, 10]);
    }

    #[tokio::test]
    async fn cancellation_stops_waiting_without_polling_or_storing_tokens() {
        let api = FakeDeviceFlowApi::approved_after_two_polls();
        let credentials = MemoryCredentialStore::default();
        let events = RecordingAuthEvents::default();
        let service = service(
            api.clone(),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            events.clone(),
        );
        let authorization = service.begin().await.unwrap();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        service
            .run(authorization.request_id, cancellation)
            .await
            .unwrap();

        assert_eq!(api.poll_count(), 0);
        assert_eq!(credentials.saved_access_token(), None);
        assert_eq!(events.statuses(), vec!["waiting_for_user", "cancelled"]);
    }

    #[tokio::test]
    async fn cancellation_interrupts_an_in_flight_poll_request() {
        let api = BlockingPollApi::default();
        let poll_started = api.poll_started.clone();
        let events = RecordingAuthEvents::default();
        let clock = FakeClock::at(1_000);
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::default(),
            clock.clone(),
            AdvancingDelay::new(clock),
            events.clone(),
        ));
        let authorization = service.begin().await.unwrap();
        let cancellation = CancellationToken::new();
        let run = tokio::spawn({
            let service = service.clone();
            let cancellation = cancellation.clone();
            async move { service.run(authorization.request_id, cancellation).await }
        });
        poll_started.notified().await;

        cancellation.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), run).await;

        assert!(result.is_ok(), "cancellation must interrupt an active poll");
        assert!(result.unwrap().unwrap().is_ok());
        assert_eq!(events.statuses(), vec!["waiting_for_user", "cancelled"]);
    }

    #[tokio::test]
    async fn missing_credentials_require_reauthentication() {
        let api = FakeDeviceFlowApi::with_polls([]);
        let events = RecordingAuthEvents::default();
        let service = service(
            api,
            MemoryCredentialStore::default(),
            FakeClock::at(1_000),
            NeverDelay,
            events.clone(),
        );

        let error = match service.valid_access_token().await {
            Ok(_) => panic!("missing credentials must not produce an access token"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert_eq!(events.statuses(), vec!["reauthentication_required"]);
    }

    #[tokio::test]
    async fn expired_refresh_token_is_deleted_without_calling_refresh() {
        let api = FakeDeviceFlowApi::with_polls([]);
        let credentials =
            MemoryCredentialStore::with_tokens(StoredTokens::new("ghu_old", "ghr_old", 900, 999));
        let events = RecordingAuthEvents::default();
        let service = service(
            api.clone(),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            events.clone(),
        );

        let error = match service.valid_access_token().await {
            Ok(_) => panic!("an expired refresh token must not produce an access token"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert_eq!(api.refresh_count(), 0);
        assert_eq!(credentials.delete_count(), 1);
        assert_eq!(events.statuses(), vec!["reauthentication_required"]);
    }

    #[tokio::test]
    async fn logout_removes_credentials() {
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let service = service(
            FakeDeviceFlowApi::with_polls([]),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        service.logout().unwrap();

        assert_eq!(credentials.saved_access_token(), None);
        assert_eq!(credentials.delete_count(), 1);
    }
}
