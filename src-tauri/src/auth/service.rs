use std::collections::HashMap;
use std::sync::Arc;

use secrecy::SecretString;
use tokio::sync::Mutex;
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
    generation: u64,
    cancellation: CancellationToken,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JobKind {
    Login,
    Refresh,
}

struct ActiveJob {
    generation: u64,
    kind: JobKind,
    cancellation: CancellationToken,
}

enum AccessSession {
    Uninitialized,
    SignedOut,
    Authenticated {
        access_token: SecretString,
        expires_at_unix: i64,
    },
    ReauthenticationRequired,
}

#[derive(Default)]
struct Lifecycle {
    generation: u64,
    pending: HashMap<Uuid, PendingAuthorization>,
    active: HashMap<Uuid, ActiveJob>,
}

struct BeginReservation {
    reservations: Arc<std::sync::Mutex<HashMap<Uuid, u64>>>,
    request_id: Uuid,
    generation: u64,
}

impl BeginReservation {
    fn new(
        reservations: Arc<std::sync::Mutex<HashMap<Uuid, u64>>>,
        request_id: Uuid,
        generation: u64,
    ) -> Self {
        let mut entries = reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entries.retain(|_, reserved_generation| *reserved_generation == generation);
        entries.insert(request_id, generation);
        drop(entries);
        Self {
            reservations,
            request_id,
            generation,
        }
    }
}

impl Drop for BeginReservation {
    fn drop(&mut self) {
        let mut entries = self
            .reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if entries.get(&self.request_id) == Some(&self.generation) {
            entries.remove(&self.request_id);
        }
    }
}

pub struct AuthService {
    client_id: String,
    api: Arc<dyn DeviceFlowApi>,
    credentials: Arc<dyn CredentialStore>,
    clock: Arc<dyn Clock>,
    delay: Arc<dyn Delay>,
    events: Arc<dyn AuthEventSink>,
    lifecycle: Mutex<Lifecycle>,
    begin_reservations: Arc<std::sync::Mutex<HashMap<Uuid, u64>>>,
    refresh: Mutex<()>,
    access_session: Mutex<AccessSession>,
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
            lifecycle: Mutex::new(Lifecycle::default()),
            begin_reservations: Arc::new(std::sync::Mutex::new(HashMap::new())),
            refresh: Mutex::new(()),
            access_session: Mutex::new(AccessSession::Uninitialized),
        }
    }

    pub async fn begin(&self, request_id: Uuid) -> Result<DeviceAuthorization, AppError> {
        self.ensure_client_id()?;
        let (generation, reservation) = {
            let mut lifecycle = self.lifecycle.lock().await;
            invalidate_lifecycle(&mut lifecycle);
            let generation = lifecycle.generation;
            let reservation =
                BeginReservation::new(self.begin_reservations.clone(), request_id, generation);
            (generation, reservation)
        };

        let response = self.api.request_device_code(&self.client_id).await?;
        let (device_code, user_code, verification_uri, expires_in, interval_seconds) =
            response.into_parts();
        let expires_in = match i64::try_from(expires_in) {
            Ok(expires_in) => expires_in,
            Err(_) => return Err(invalid_duration_error()),
        };
        let expires_at_unix = self.clock.now_unix().saturating_add(expires_in);
        let authorization = DeviceAuthorization {
            request_id,
            user_code,
            verification_uri,
            expires_at_unix,
            interval_seconds,
        };
        let cancellation = CancellationToken::new();
        let mut lifecycle = self.lifecycle.lock().await;
        if lifecycle.generation != generation {
            return Err(authentication_expired_error());
        }
        lifecycle.active.insert(
            request_id,
            ActiveJob {
                generation,
                kind: JobKind::Login,
                cancellation: cancellation.clone(),
            },
        );
        lifecycle.pending.insert(
            request_id,
            PendingAuthorization {
                device_code,
                expires_at_unix,
                interval_seconds,
                generation,
                cancellation,
            },
        );
        drop(reservation);
        Ok(authorization)
    }

    pub async fn run(
        &self,
        request_id: Uuid,
        cancellation: CancellationToken,
    ) -> Result<(), AppError> {
        let authorization = self.lifecycle.lock().await.pending.remove(&request_id);
        let Some(mut authorization) = authorization else {
            if cancellation.is_cancelled() {
                return self.cancel_run(request_id).await;
            }
            let error = authentication_expired_error();
            self.emit_failed(request_id, &error);
            return Err(error);
        };

        let _ = self
            .events
            .emit(AuthStatusEvent::WaitingForUser { request_id });

        loop {
            if cancellation.is_cancelled() || authorization.cancellation.is_cancelled() {
                return self.cancel_run(request_id).await;
            }
            let remaining =
                match remaining_seconds(self.clock.now_unix(), authorization.expires_at_unix) {
                    Some(remaining) => remaining,
                    None => return self.expire_run(request_id).await,
                };
            let interval = authorization.interval_seconds.min(remaining);

            tokio::select! {
                _ = cancellation.cancelled() => {
                    return self.cancel_run(request_id).await;
                }
                _ = authorization.cancellation.cancelled() => {
                    return self.cancel_run(request_id).await;
                }
                _ = self.delay.wait(interval) => {}
            }

            if self.clock.now_unix() >= authorization.expires_at_unix {
                return self.expire_run(request_id).await;
            }

            let remaining = remaining_seconds(self.clock.now_unix(), authorization.expires_at_unix)
                .unwrap_or_default();
            let poll_result = tokio::select! {
                biased;
                _ = cancellation.cancelled() => {
                    return self.cancel_run(request_id).await;
                }
                _ = authorization.cancellation.cancelled() => {
                    return self.cancel_run(request_id).await;
                }
                result = self.api.poll_access_token(
                    &self.client_id,
                    &authorization.device_code,
                ) => result,
                _ = self.delay.wait(remaining) => {
                    return self.expire_run(request_id).await;
                }
            };
            let poll = match poll_result {
                Ok(poll) => poll,
                Err(error) => {
                    self.finish_job(request_id).await;
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
                    self.finish_job(request_id).await;
                    self.emit_failed(request_id, &error);
                    return Err(error);
                }
                DeviceTokenPoll::Expired => {
                    return self.expire_run(request_id).await;
                }
                DeviceTokenPoll::Authorized(grant) => {
                    let user_result = tokio::select! {
                        _ = cancellation.cancelled() => {
                            return self.cancel_run(request_id).await;
                        }
                        _ = authorization.cancellation.cancelled() => {
                            return self.cancel_run(request_id).await;
                        }
                        result = self.api.authenticated_user(grant.access_token()) => result,
                    };
                    let user = match user_result {
                        Ok(user) => user,
                        Err(error) => {
                            self.finish_job(request_id).await;
                            self.emit_failed(request_id, &error);
                            return Err(error);
                        }
                    };
                    tokio::task::yield_now().await;
                    if cancellation.is_cancelled() || authorization.cancellation.is_cancelled() {
                        return self.cancel_run(request_id).await;
                    }
                    let tokens = match grant.into_stored(self.clock.now_unix()) {
                        Ok(tokens) => tokens,
                        Err(error) => {
                            self.finish_job(request_id).await;
                            self.emit_failed(request_id, &error);
                            return Err(error);
                        }
                    };
                    let mut lifecycle = self.lifecycle.lock().await;
                    if !job_is_current(&lifecycle, request_id, authorization.generation)
                        || cancellation.is_cancelled()
                        || authorization.cancellation.is_cancelled()
                    {
                        lifecycle.active.remove(&request_id);
                        drop(lifecycle);
                        let _ = self.events.emit(AuthStatusEvent::Cancelled { request_id });
                        return Ok(());
                    }
                    if let Err(error) = self.credentials.save(&tokens).await {
                        lifecycle.active.remove(&request_id);
                        drop(lifecycle);
                        self.emit_failed(request_id, &error);
                        return Err(error);
                    }
                    if cancellation.is_cancelled() {
                        let delete_result = self.credentials.delete().await;
                        lifecycle.active.remove(&request_id);
                        drop(lifecycle);
                        let _ = self.events.emit(AuthStatusEvent::Cancelled { request_id });
                        return delete_result;
                    }
                    lifecycle.active.remove(&request_id);
                    drop(lifecycle);
                    *self.access_session.lock().await = AccessSession::Authenticated {
                        access_token: tokens.access_token().clone(),
                        expires_at_unix: tokens.access_expires_at_unix(),
                    };
                    if !self
                        .events
                        .emit(AuthStatusEvent::Authenticated { request_id, user })
                    {
                        self.credentials.delete().await?;
                        *self.access_session.lock().await = AccessSession::SignedOut;
                    }
                    return Ok(());
                }
            }
        }
    }

    pub(crate) async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
        self.ensure_client_id()?;
        let _single_flight = self.refresh.lock().await;
        self.access_token_locked()
            .await?
            .ok_or_else(|| self.reauthentication_required())
    }

    async fn access_token_locked(&self) -> Result<Option<AccessToken>, AppError> {
        let now = self.clock.now_unix();
        {
            let session = self.access_session.lock().await;
            match &*session {
                AccessSession::Authenticated {
                    access_token,
                    expires_at_unix,
                } if *expires_at_unix > now.saturating_add(EXPIRY_SAFETY_WINDOW_SECONDS) => {
                    return Ok(Some(AccessToken::from_secret(access_token.clone())));
                }
                AccessSession::SignedOut => return Ok(None),
                AccessSession::ReauthenticationRequired => return Err(reauthentication_error()),
                AccessSession::Uninitialized | AccessSession::Authenticated { .. } => {}
            }
        }

        let job_id = Uuid::new_v4();
        let (generation, cancellation) = {
            let mut lifecycle = self.lifecycle.lock().await;
            if lifecycle
                .active
                .values()
                .any(|job| job.kind == JobKind::Login)
                || self.has_begin_reservation(lifecycle.generation)
            {
                return Err(self.reauthentication_required());
            }
            let generation = lifecycle.generation;
            let cancellation = CancellationToken::new();
            lifecycle.active.insert(
                job_id,
                ActiveJob {
                    generation,
                    kind: JobKind::Refresh,
                    cancellation: cancellation.clone(),
                },
            );
            (generation, cancellation)
        };
        let loaded = {
            let mut lifecycle = self.lifecycle.lock().await;
            if !job_is_current(&lifecycle, job_id, generation) {
                return Err(self.reauthentication_required());
            }
            let result = self.credentials.load().await;
            if result.is_err() {
                lifecycle.active.remove(&job_id);
            }
            result
        };
        let tokens = match loaded {
            Ok(Some(tokens)) => tokens,
            Ok(None) => {
                *self.access_session.lock().await = AccessSession::SignedOut;
                self.finish_job(job_id).await;
                return Ok(None);
            }
            Err(error) => {
                if error.code == ErrorCode::ReauthenticationRequired {
                    *self.access_session.lock().await = AccessSession::ReauthenticationRequired;
                    self.emit_reauthentication_required();
                }
                return Err(error);
            }
        };

        if tokens.access_expires_at_unix() > now.saturating_add(EXPIRY_SAFETY_WINDOW_SECONDS) {
            if !self.finish_job_if_current(job_id, generation).await {
                return Err(self.reauthentication_required());
            }
            *self.access_session.lock().await = AccessSession::Authenticated {
                access_token: tokens.access_token().clone(),
                expires_at_unix: tokens.access_expires_at_unix(),
            };
            return Ok(Some(AccessToken::from_secret(
                tokens.access_token().clone(),
            )));
        }
        if tokens.refresh_expires_at_unix() <= now {
            self.delete_if_current(job_id, generation).await?;
            return Err(self.reauthentication_required());
        }

        self.ensure_client_id()?;
        let refresh_result = tokio::select! {
            _ = cancellation.cancelled() => {
                self.finish_job(job_id).await;
                return Err(self.reauthentication_required());
            }
            result = self.api.refresh_access_token(&self.client_id, tokens.refresh_token()) => result,
        };
        let grant = match refresh_result {
            Ok(grant) => grant,
            Err(error) if error.code == ErrorCode::GithubUnavailable => {
                self.finish_job(job_id).await;
                return Err(error);
            }
            Err(_) => {
                self.delete_if_current(job_id, generation).await?;
                return Err(self.reauthentication_required());
            }
        };
        let refreshed = match grant.into_stored(now) {
            Ok(tokens) => tokens,
            Err(error) => {
                self.delete_if_current(job_id, generation).await?;
                self.emit_reauthentication_required();
                return Err(error);
            }
        };
        let access_token = AccessToken::from_secret(refreshed.access_token().clone());
        let mut lifecycle = self.lifecycle.lock().await;
        if !job_is_current(&lifecycle, job_id, generation) || cancellation.is_cancelled() {
            lifecycle.active.remove(&job_id);
            return Err(self.reauthentication_required());
        }
        let save_result = self.credentials.save(&refreshed).await;
        lifecycle.active.remove(&job_id);
        save_result?;
        *self.access_session.lock().await = AccessSession::Authenticated {
            access_token: refreshed.access_token().clone(),
            expires_at_unix: refreshed.access_expires_at_unix(),
        };
        Ok(Some(access_token))
    }

    pub async fn logout(&self) -> Result<(), AppError> {
        let mut lifecycle = self.lifecycle.lock().await;
        invalidate_lifecycle(&mut lifecycle);
        self.clear_begin_reservations();
        let result = self.credentials.delete().await;
        if result.is_ok() {
            *self.access_session.lock().await = AccessSession::SignedOut;
        }
        result
    }

    fn has_begin_reservation(&self, generation: u64) -> bool {
        self.begin_reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .any(|reserved_generation| *reserved_generation == generation)
    }

    fn clear_begin_reservations(&self) {
        self.begin_reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    pub(crate) async fn lifecycle_generation(&self) -> Option<u64> {
        let lifecycle = self.lifecycle.lock().await;
        lifecycle
            .active
            .values()
            .all(|job| job.kind != JobKind::Login)
            .then_some(lifecycle.generation)
    }

    pub(crate) async fn has_stored_credentials(&self) -> Result<bool, AppError> {
        let _single_flight = self.refresh.lock().await;
        Ok(self.access_token_locked().await?.is_some())
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
        self.emit_reauthentication_required();
        reauthentication_error()
    }

    fn emit_reauthentication_required(&self) {
        let _ = self.events.emit(AuthStatusEvent::ReauthenticationRequired {
            request_id: Uuid::new_v4(),
        });
    }

    async fn finish_job(&self, job_id: Uuid) {
        self.lifecycle.lock().await.active.remove(&job_id);
    }

    async fn finish_job_if_current(&self, job_id: Uuid, generation: u64) -> bool {
        let mut lifecycle = self.lifecycle.lock().await;
        if !job_is_current(&lifecycle, job_id, generation) {
            return false;
        }
        lifecycle.active.remove(&job_id);
        true
    }

    async fn delete_if_current(&self, job_id: Uuid, generation: u64) -> Result<(), AppError> {
        let mut lifecycle = self.lifecycle.lock().await;
        if !job_is_current(&lifecycle, job_id, generation) {
            return Err(self.reauthentication_required());
        }
        let result = self.credentials.delete().await;
        lifecycle.active.remove(&job_id);
        if result.is_ok() {
            *self.access_session.lock().await = AccessSession::ReauthenticationRequired;
        }
        result
    }

    async fn cancel_run(&self, request_id: Uuid) -> Result<(), AppError> {
        self.finish_job(request_id).await;
        let _ = self.events.emit(AuthStatusEvent::Cancelled { request_id });
        Ok(())
    }

    async fn expire_run(&self, request_id: Uuid) -> Result<(), AppError> {
        self.finish_job(request_id).await;
        let error = authentication_expired_error();
        self.emit_failed(request_id, &error);
        Err(error)
    }

    fn emit_failed(&self, request_id: Uuid, error: &AppError) {
        let _ = self.events.emit(AuthStatusEvent::Failed {
            request_id,
            error: error.clone(),
        });
    }
}

fn invalidate_lifecycle(lifecycle: &mut Lifecycle) {
    lifecycle.generation = lifecycle
        .generation
        .checked_add(1)
        .expect("authentication lifecycle generation exhausted");
    for job in lifecycle.active.values() {
        job.cancellation.cancel();
    }
    lifecycle.active.clear();
    lifecycle.pending.clear();
}

fn job_is_current(lifecycle: &Lifecycle, job_id: Uuid, generation: u64) -> bool {
    lifecycle.generation == generation
        && lifecycle
            .active
            .get(&job_id)
            .is_some_and(|job| job.generation == generation && !job.cancellation.is_cancelled())
}

fn remaining_seconds(now_unix: i64, expires_at_unix: i64) -> Option<u64> {
    let remaining = expires_at_unix.checked_sub(now_unix)?;
    (remaining > 0)
        .then(|| u64::try_from(remaining).ok())
        .flatten()
}

fn reauthentication_error() -> AppError {
    AppError::new(
        ErrorCode::ReauthenticationRequired,
        "GitHub에 다시 로그인해 주세요.",
    )
    .with_recovery(RecoveryAction::RestartLogin)
}

fn authentication_expired_error() -> AppError {
    AppError::new(
        ErrorCode::AuthenticationExpired,
        "GitHub 로그인 요청이 만료되었습니다.",
    )
    .with_recovery(RecoveryAction::RestartLogin)
}

fn invalid_duration_error() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "GitHub 인증 응답의 만료 시간을 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::future::pending;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
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
    use crate::error::{AppError, ErrorCode, RecoveryAction};

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

    #[derive(Clone)]
    struct FirstAdvancingThenNeverDelay {
        clock: FakeClock,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl Delay for FirstAdvancingThenNeverDelay {
        async fn wait(&self, seconds: u64) {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                self.clock.advance(seconds);
            } else {
                pending::<()>().await;
            }
        }
    }

    #[derive(Clone, Default)]
    struct MemoryCredentialStore {
        tokens: Arc<Mutex<Option<StoredTokens>>>,
        deletes: Arc<Mutex<usize>>,
        loads: Arc<AtomicUsize>,
        saves: Arc<AtomicUsize>,
        fail_delete: Arc<AtomicBool>,
    }

    impl MemoryCredentialStore {
        fn with_tokens(tokens: StoredTokens) -> Self {
            Self {
                tokens: Arc::new(Mutex::new(Some(tokens))),
                deletes: Arc::new(Mutex::new(0)),
                loads: Arc::new(AtomicUsize::new(0)),
                saves: Arc::new(AtomicUsize::new(0)),
                fail_delete: Arc::new(AtomicBool::new(false)),
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

        fn load_count(&self) -> usize {
            self.loads.load(Ordering::SeqCst)
        }

        fn save_count(&self) -> usize {
            self.saves.load(Ordering::SeqCst)
        }

        fn fail_delete(&self) {
            self.fail_delete.store(true, Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl CredentialStore for MemoryCredentialStore {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            self.loads.fetch_add(1, Ordering::SeqCst);
            Ok(self.tokens.lock().unwrap().clone())
        }

        async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
            self.saves.fetch_add(1, Ordering::SeqCst);
            *self.tokens.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        async fn delete(&self) -> Result<(), AppError> {
            if self.fail_delete.swap(false, Ordering::SeqCst) {
                return Err(AppError::new(
                    ErrorCode::CredentialStoreUnavailable,
                    "fixture delete failure",
                ));
            }
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
        fn emit(&self, event: AuthStatusEvent) -> bool {
            self.0.lock().unwrap().push(event);
            true
        }
    }

    fn operation_event_request_id(event: &AuthStatusEvent) -> Option<uuid::Uuid> {
        match event {
            AuthStatusEvent::WaitingForUser { request_id }
            | AuthStatusEvent::Authenticated { request_id, .. }
            | AuthStatusEvent::Failed { request_id, .. }
            | AuthStatusEvent::Cancelled { request_id } => Some(*request_id),
            AuthStatusEvent::ReauthenticationRequired { .. } => None,
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

    #[derive(Clone, Default)]
    struct BeginBarrierApi {
        started: Arc<Notify>,
        release: Arc<Notify>,
    }

    #[derive(Clone, Default)]
    struct BeginWithRefreshApi {
        begin_started: Arc<Notify>,
        release_begin: Arc<Notify>,
        refresh_calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl DeviceFlowApi for BeginBarrierApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            self.started.notify_one();
            self.release.notified().await;
            Ok(device_code_response("begin-device-code", 900, 5))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            panic!("poll is not used by this test")
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

    #[async_trait]
    impl DeviceFlowApi for BeginWithRefreshApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            self.begin_started.notify_one();
            self.release_begin.notified().await;
            Ok(device_code_response("reserved-begin-device-code", 900, 5))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            panic!("poll is not used by this test")
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            self.refresh_calls.fetch_add(1, Ordering::SeqCst);
            Ok(TokenGrant::new(
                "ghu_stale_refresh",
                "ghr_stale_refresh",
                28_800,
                15_897_600,
            ))
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            panic!("user lookup is not used by this test")
        }
    }

    #[derive(Clone, Default)]
    struct PollBarrierApi {
        started: Arc<Notify>,
        release: Arc<Notify>,
    }

    #[async_trait]
    impl DeviceFlowApi for PollBarrierApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(device_code_response("poll-device-code", 900, 1))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            self.started.notify_one();
            self.release.notified().await;
            Ok(DeviceTokenPoll::Authorized(TokenGrant::new(
                "ghu_stale",
                "ghr_stale",
                28_800,
                15_897_600,
            )))
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
            Ok(test_user())
        }
    }

    #[derive(Clone, Default)]
    struct RefreshBarrierApi {
        started: Arc<Notify>,
        release: Arc<Notify>,
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl DeviceFlowApi for RefreshBarrierApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            panic!("device flow is not used by this test")
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            panic!("poll is not used by this test")
        }

        async fn refresh_access_token(
            &self,
            _client_id: &str,
            _refresh_token: &SecretString,
        ) -> Result<TokenGrant, AppError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.started.notify_one();
            self.release.notified().await;
            Ok(TokenGrant::new(
                "ghu_rotated",
                "ghr_rotated",
                28_800,
                15_897_600,
            ))
        }

        async fn authenticated_user(
            &self,
            _access_token: &SecretString,
        ) -> Result<GithubUserSummary, AppError> {
            panic!("user lookup is not used by this test")
        }
    }

    #[derive(Clone, Default)]
    struct OutOfOrderBeginApi {
        calls: Arc<AtomicUsize>,
        first_started: Arc<Notify>,
        release_first: Arc<Notify>,
    }

    #[async_trait]
    impl DeviceFlowApi for OutOfOrderBeginApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                self.first_started.notify_one();
                self.release_first.notified().await;
                Ok(device_code_response("older-device-code", 900, 5))
            } else {
                Ok(device_code_response("newer-device-code", 900, 5))
            }
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            Ok(DeviceTokenPoll::Denied)
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

    #[derive(Clone)]
    struct ShortExpiryApi {
        expires_in: u64,
        interval: u64,
        polls: Arc<AtomicUsize>,
        never_resolve_poll: bool,
    }

    #[derive(Clone, Default)]
    struct PostLookupBarrierApi {
        lookup_finished: Arc<Notify>,
    }

    #[async_trait]
    impl DeviceFlowApi for PostLookupBarrierApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(device_code_response("post-lookup-device-code", 900, 1))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            Ok(DeviceTokenPoll::Authorized(TokenGrant::new(
                "ghu_post_lookup",
                "ghr_post_lookup",
                28_800,
                15_897_600,
            )))
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
            self.lookup_finished.notify_one();
            Ok(test_user())
        }
    }

    #[async_trait]
    impl DeviceFlowApi for ShortExpiryApi {
        async fn request_device_code(
            &self,
            _client_id: &str,
        ) -> Result<DeviceCodeResponse, AppError> {
            Ok(device_code_response(
                "short-device-code",
                self.expires_in,
                self.interval,
            ))
        }

        async fn poll_access_token(
            &self,
            _client_id: &str,
            _device_code: &SecretString,
        ) -> Result<DeviceTokenPoll, AppError> {
            self.polls.fetch_add(1, Ordering::SeqCst);
            if self.never_resolve_poll {
                pending().await
            } else {
                Ok(DeviceTokenPoll::Pending)
            }
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

    #[derive(Clone, Default)]
    struct MalformedCredentialStore;

    #[async_trait]
    impl CredentialStore for MalformedCredentialStore {
        async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
            Err(AppError::new(
                ErrorCode::ReauthenticationRequired,
                "저장된 GitHub 인증 정보를 사용할 수 없습니다.",
            ))
        }

        async fn save(&self, _tokens: &StoredTokens) -> Result<(), AppError> {
            panic!("save is not used by this test")
        }

        async fn delete(&self) -> Result<(), AppError> {
            Ok(())
        }
    }

    fn device_code_response(code: &str, expires_in: u64, interval: u64) -> DeviceCodeResponse {
        DeviceCodeResponse::new(
            SecretString::new(code.to_owned()),
            "ABCD-EFGH",
            "https://github.com/login/device",
            expires_in,
            interval,
        )
    }

    fn test_user() -> GithubUserSummary {
        GithubUserSummary {
            id: 42,
            login: "hyeeun".into(),
            avatar_url: "https://avatars.example/42".into(),
        }
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

    #[test]
    fn token_boundary_serializes_every_public_auth_and_error_variant_without_credentials() {
        let request_id = uuid::Uuid::parse_str("599a739c-bde8-4fed-b750-d085adf562eb").unwrap();
        let user = GithubUserSummary {
            id: 7,
            login: "octocat".into(),
            avatar_url: "https://example.test/avatar.png".into(),
        };
        let secret_like_value = "access_token refresh_token device_code ghu_private ghr_private";
        let error_codes = [
            ErrorCode::AuthenticationExpired,
            ErrorCode::AuthenticationDenied,
            ErrorCode::ReauthenticationRequired,
            ErrorCode::CredentialStoreUnavailable,
            ErrorCode::GithubPermissionDenied,
            ErrorCode::GithubUnavailable,
            ErrorCode::RepositoryPathConflict,
            ErrorCode::RepositoryRemoteMismatch,
            ErrorCode::RepositoryDirty,
            ErrorCode::CloneFailed,
            ErrorCode::WorkspaceMissing,
            ErrorCode::WorkspaceInvalid,
            ErrorCode::WorkspaceVersionUnsupported,
            ErrorCode::WorkspaceChangedSincePreview,
            ErrorCode::PushFailed,
            ErrorCode::DraftPullRequestFailed,
            ErrorCode::LocalSettingsUnavailable,
            ErrorCode::DesktopOnly,
        ];
        let recovery_actions = [
            RecoveryAction::RestartLogin,
            RecoveryAction::ReinstallGithubApp,
            RecoveryAction::ChooseAnotherDirectory,
            RecoveryAction::ConnectExistingClone,
            RecoveryAction::CleanWorkingTree,
            RecoveryAction::OpenWorkspaceFile,
            RecoveryAction::UpdateOkhub,
            RecoveryAction::Retry,
        ];
        let errors = error_codes
            .into_iter()
            .zip(recovery_actions.into_iter().cycle())
            .map(|(code, recovery)| {
                AppError::new(code, secret_like_value)
                    .with_recovery(recovery)
                    .with_detail("diagnostic", secret_like_value)
            });
        let events = vec![
            AuthStatusEvent::WaitingForUser { request_id },
            AuthStatusEvent::Authenticated { request_id, user },
            AuthStatusEvent::ReauthenticationRequired { request_id },
            AuthStatusEvent::Failed {
                request_id,
                error: AppError::new(ErrorCode::GithubUnavailable, secret_like_value)
                    .with_detail("diagnostic", secret_like_value),
            },
            AuthStatusEvent::Cancelled { request_id },
        ];

        for value in errors
            .map(|error| serde_json::to_string(&error))
            .chain(std::iter::once(serde_json::to_string(&events)))
        {
            assert_token_boundary(value.unwrap());
        }
    }

    fn assert_token_boundary(serialized: String) {
        for marker in [
            "access_token",
            "refresh_token",
            "device_code",
            "ghu_",
            "ghr_",
        ] {
            assert!(
                !serialized.contains(marker),
                "public Rust boundary leaked {marker}: {serialized}"
            );
        }
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
    async fn begin_preserves_the_caller_supplied_request_id() {
        let request_id = uuid::Uuid::parse_str("599a739c-bde8-4fed-b750-d085adf562eb").unwrap();
        let service = service(
            FakeDeviceFlowApi::with_polls([]),
            MemoryCredentialStore::default(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        let authorization = service.begin(request_id).await.unwrap();

        assert_eq!(authorization.request_id, request_id);
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

        let request_id = uuid::Uuid::new_v4();
        let authorization = service.begin(request_id).await.unwrap();
        service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap();

        assert_eq!(
            credentials.saved_access_token().as_deref(),
            Some("ghu_private")
        );
        assert_eq!(credentials.save_count(), 1);
        assert_eq!(events.statuses(), vec!["waiting_for_user", "authenticated"]);
        assert!(events.events().iter().all(|event| match event {
            AuthStatusEvent::WaitingForUser { request_id: actual }
            | AuthStatusEvent::Authenticated {
                request_id: actual, ..
            }
            | AuthStatusEvent::Failed {
                request_id: actual, ..
            }
            | AuthStatusEvent::Cancelled { request_id: actual } => *actual == request_id,
            AuthStatusEvent::ReauthenticationRequired { .. } => false,
        }));
        let public_json = serde_json::to_string(&events.events()).unwrap();
        assert!(!public_json.contains("ghu_private"));
        assert!(!public_json.contains("ghr_private"));
        assert!(!public_json.contains("private-device-code"));
    }

    #[tokio::test]
    async fn device_flow_seeds_the_access_session_after_durable_save() {
        let api = FakeDeviceFlowApi::approved_after_two_polls();
        let credentials = MemoryCredentialStore::default();
        let clock = FakeClock::at(1_000);
        let service = service(
            api,
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        );

        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();
        service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap();

        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_private"
        );
        assert_eq!(credentials.load_count(), 0);
    }

    #[tokio::test]
    async fn auth_probe_and_repeated_requests_share_one_credential_load() {
        let credentials = MemoryCredentialStore::with_tokens(StoredTokens::new(
            "ghu_cached",
            "ghr_durable",
            10_000,
            20_000,
        ));
        let service = service(
            FakeDeviceFlowApi::with_polls([]),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        assert!(service.has_stored_credentials().await.unwrap());
        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_cached"
        );
        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_cached"
        );

        assert_eq!(credentials.load_count(), 1);
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
    async fn auth_probe_refreshes_an_expired_access_token_from_one_credential_load() {
        let api = FakeDeviceFlowApi::with_refresh_result(TokenGrant::new(
            "ghu_new", "ghr_new", 28_800, 15_897_600,
        ));
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let service = service(
            api.clone(),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        assert!(service.has_stored_credentials().await.unwrap());
        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_new"
        );

        assert_eq!(credentials.load_count(), 1);
        assert_eq!(api.refresh_count(), 1);
    }

    #[tokio::test]
    async fn authorization_denial_emits_a_public_failure() {
        let request_id = uuid::Uuid::parse_str("ad15b51d-1625-46bd-83ff-ce7ba8c2ae33").unwrap();
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
        let authorization = service.begin(request_id).await.unwrap();

        let error = service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::AuthenticationDenied);
        assert_eq!(events.statuses(), vec!["waiting_for_user", "failed"]);
        assert!(events
            .events()
            .iter()
            .all(|event| operation_event_request_id(event) == Some(request_id)));
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
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();

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
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();

        service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap();

        assert_eq!(delay.waits(), vec![5, 10, 10]);
    }

    #[tokio::test]
    async fn cancellation_stops_waiting_without_polling_or_storing_tokens() {
        let request_id = uuid::Uuid::parse_str("f895aaed-b5f2-4f49-aac6-bd8a945246f6").unwrap();
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
        let authorization = service.begin(request_id).await.unwrap();
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        service
            .run(authorization.request_id, cancellation)
            .await
            .unwrap();

        assert_eq!(api.poll_count(), 0);
        assert_eq!(credentials.saved_access_token(), None);
        assert_eq!(events.statuses(), vec!["waiting_for_user", "cancelled"]);
        assert!(events
            .events()
            .iter()
            .all(|event| operation_event_request_id(event) == Some(request_id)));
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
            FirstAdvancingThenNeverDelay {
                clock,
                calls: Arc::new(AtomicUsize::new(0)),
            },
            events.clone(),
        ));
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();
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
    async fn cancellation_after_user_lookup_prevents_credential_save() {
        let api = PostLookupBarrierApi::default();
        let lookup_finished = api.lookup_finished.clone();
        let credentials = MemoryCredentialStore::default();
        let events = RecordingAuthEvents::default();
        let clock = FakeClock::at(1_000);
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            events.clone(),
        ));
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();
        let cancellation = CancellationToken::new();
        let run = tokio::spawn({
            let service = service.clone();
            let cancellation = cancellation.clone();
            async move { service.run(authorization.request_id, cancellation).await }
        });
        lookup_finished.notified().await;

        cancellation.cancel();
        let result = run.await.unwrap();

        assert!(result.is_ok());
        assert_eq!(credentials.saved_access_token(), None);
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
        let repeated = service.valid_access_token().await;

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert!(repeated.is_err());
        assert_eq!(api.refresh_count(), 0);
        assert_eq!(credentials.delete_count(), 1);
        assert_eq!(credentials.load_count(), 1);
        assert_eq!(events.statuses(), vec!["reauthentication_required"]);
    }

    #[tokio::test]
    async fn logout_during_begin_prevents_late_authorization_insertion() {
        let api = BeginBarrierApi::default();
        let started = api.started.clone();
        let release = api.release.clone();
        let credentials = MemoryCredentialStore::default();
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        ));
        let begin = tokio::spawn({
            let service = service.clone();
            async move { service.begin(uuid::Uuid::new_v4()).await }
        });
        started.notified().await;

        service.logout().await.unwrap();
        release.notify_one();
        let result = begin.await.unwrap();

        assert!(
            result.is_err(),
            "a logged-out begin must not become pending"
        );
        assert_eq!(credentials.saved_access_token(), None);
    }

    #[tokio::test]
    async fn aborting_device_code_request_does_not_leave_login_active() {
        let api = BeginBarrierApi::default();
        let started = api.started.clone();
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::default(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        ));
        let begin = tokio::spawn({
            let service = service.clone();
            async move { service.begin(uuid::Uuid::new_v4()).await }
        });
        started.notified().await;

        begin.abort();
        assert!(begin.await.unwrap_err().is_cancelled());

        assert!(
            service.lifecycle_generation().await.is_some(),
            "a dropped device-code request must not retain an active login"
        );
    }

    #[tokio::test]
    async fn device_code_request_reserves_login_intent_against_refresh() {
        let api = BeginWithRefreshApi::default();
        let begin_started = api.begin_started.clone();
        let refresh_calls = api.refresh_calls.clone();
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::with_tokens(authorization_tokens()),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        ));
        let begin = tokio::spawn({
            let service = service.clone();
            async move { service.begin(uuid::Uuid::new_v4()).await }
        });
        begin_started.notified().await;

        let error = match service.valid_access_token().await {
            Ok(_) => panic!("refresh must not run while device login is reserved"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert_eq!(refresh_calls.load(Ordering::SeqCst), 0);
        begin.abort();
        assert!(begin.await.unwrap_err().is_cancelled());
        assert!(service.lifecycle_generation().await.is_some());
    }

    #[tokio::test]
    async fn logout_during_poll_prevents_late_credential_save() {
        let api = PollBarrierApi::default();
        let started = api.started.clone();
        let release = api.release.clone();
        let credentials = MemoryCredentialStore::default();
        let clock = FakeClock::at(1_000);
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            credentials.clone(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        ));
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();
        let run = tokio::spawn({
            let service = service.clone();
            async move {
                service
                    .run(authorization.request_id, CancellationToken::new())
                    .await
            }
        });
        started.notified().await;

        service.logout().await.unwrap();
        release.notify_one();
        let _ = run.await.unwrap();

        assert_eq!(credentials.saved_access_token(), None);
    }

    #[tokio::test]
    async fn logout_during_refresh_prevents_late_rotation_save() {
        let api = RefreshBarrierApi::default();
        let started = api.started.clone();
        let release = api.release.clone();
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        ));
        let refresh = tokio::spawn({
            let service = service.clone();
            async move { service.valid_access_token().await }
        });
        started.notified().await;

        service.logout().await.unwrap();
        release.notify_one();
        let _ = refresh.await.unwrap();

        assert_eq!(credentials.saved_access_token(), None);
    }

    #[tokio::test]
    async fn newer_begin_invalidates_an_older_begin_that_finishes_last() {
        let api = OutOfOrderBeginApi::default();
        let first_started = api.first_started.clone();
        let release_first = api.release_first.clone();
        let clock = FakeClock::at(1_000);
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::default(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        ));
        let older = tokio::spawn({
            let service = service.clone();
            async move { service.begin(uuid::Uuid::new_v4()).await }
        });
        first_started.notified().await;

        let newer = service.begin(uuid::Uuid::new_v4()).await.unwrap();
        release_first.notify_one();
        let older_result = older.await.unwrap();

        assert!(older_result.is_err());
        let newer_result = service
            .run(newer.request_id, CancellationToken::new())
            .await;
        assert_eq!(
            newer_result.unwrap_err().code,
            ErrorCode::AuthenticationDenied
        );
    }

    #[tokio::test]
    async fn concurrent_refresh_is_single_flight_and_returns_one_retained_rotation() {
        let api = RefreshBarrierApi::default();
        let started = api.started.clone();
        let release = api.release.clone();
        let calls = api.calls.clone();
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        ));
        let first = tokio::spawn({
            let service = service.clone();
            async move { service.valid_access_token().await }
        });
        started.notified().await;
        let second = tokio::spawn({
            let service = service.clone();
            async move { service.valid_access_token().await }
        });
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        release.notify_waiters();

        let first_token = first.await.unwrap().unwrap();
        let second_token = second.await.unwrap().unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(credentials.load_count(), 1);
        assert_eq!(first_token.expose_secret(), "ghu_rotated");
        assert_eq!(second_token.expose_secret(), "ghu_rotated");
        assert_eq!(
            credentials.saved_refresh_token().as_deref(),
            Some("ghr_rotated")
        );
    }

    #[tokio::test]
    async fn interval_wait_is_bounded_by_remaining_authorization_lifetime() {
        let api = ShortExpiryApi {
            expires_in: 3,
            interval: 5,
            polls: Arc::new(AtomicUsize::new(0)),
            never_resolve_poll: false,
        };
        let clock = FakeClock::at(1_000);
        let delay = AdvancingDelay::new(clock.clone());
        let service = AuthService::new(
            CLIENT_ID,
            api.clone(),
            MemoryCredentialStore::default(),
            clock,
            delay.clone(),
            RecordingAuthEvents::default(),
        );
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();

        let error = service
            .run(authorization.request_id, CancellationToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::AuthenticationExpired);
        assert_eq!(delay.waits(), vec![3]);
        assert_eq!(api.polls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn authorization_deadline_interrupts_a_never_resolving_poll() {
        let api = ShortExpiryApi {
            expires_in: 3,
            interval: 1,
            polls: Arc::new(AtomicUsize::new(0)),
            never_resolve_poll: true,
        };
        let clock = FakeClock::at(1_000);
        let service = Arc::new(AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::default(),
            clock.clone(),
            AdvancingDelay::new(clock),
            RecordingAuthEvents::default(),
        ));
        let authorization = service.begin(uuid::Uuid::new_v4()).await.unwrap();

        let result = tokio::time::timeout(
            Duration::from_secs(1),
            service.run(authorization.request_id, CancellationToken::new()),
        )
        .await;

        assert!(result.is_ok(), "the deadline must interrupt a stalled poll");
        assert_eq!(
            result.unwrap().unwrap_err().code,
            ErrorCode::AuthenticationExpired
        );
    }

    #[tokio::test]
    async fn malformed_credentials_emit_reauthentication_required() {
        let events = RecordingAuthEvents::default();
        let service = AuthService::new(
            CLIENT_ID,
            FakeDeviceFlowApi::with_polls([]),
            MalformedCredentialStore,
            FakeClock::at(1_000),
            NeverDelay,
            events.clone(),
        );

        let error = match service.valid_access_token().await {
            Ok(_) => panic!("malformed credentials must not produce a token"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert_eq!(events.statuses(), vec!["reauthentication_required"]);
    }

    #[tokio::test]
    async fn oversized_device_expiry_is_rejected_before_becoming_pending() {
        let api = ShortExpiryApi {
            expires_in: u64::MAX,
            interval: 5,
            polls: Arc::new(AtomicUsize::new(0)),
            never_resolve_poll: false,
        };
        let service = AuthService::new(
            CLIENT_ID,
            api,
            MemoryCredentialStore::default(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        let error = service.begin(uuid::Uuid::new_v4()).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
    }

    #[tokio::test]
    async fn oversized_token_expiry_is_rejected_without_persisting_the_grant() {
        let api = FakeDeviceFlowApi::with_refresh_result(TokenGrant::new(
            "ghu_oversized",
            "ghr_oversized",
            u64::MAX,
            15_897_600,
        ));
        let credentials = MemoryCredentialStore::with_tokens(authorization_tokens());
        let service = service(
            api,
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        let result = service.valid_access_token().await;

        assert!(result.is_err());
        assert_ne!(
            credentials.saved_access_token().as_deref(),
            Some("ghu_oversized")
        );
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

        service.logout().await.unwrap();

        assert_eq!(credentials.saved_access_token(), None);
        assert_eq!(credentials.delete_count(), 1);
    }

    #[tokio::test]
    async fn successful_logout_clears_the_cached_access_session() {
        let credentials = MemoryCredentialStore::with_tokens(StoredTokens::new(
            "ghu_cached",
            "ghr_durable",
            10_000,
            20_000,
        ));
        let service = service(
            FakeDeviceFlowApi::with_polls([]),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_cached"
        );
        service.logout().await.unwrap();

        assert!(service.valid_access_token().await.is_err());
        assert_eq!(credentials.load_count(), 1);
    }

    #[tokio::test]
    async fn failed_logout_keeps_the_cached_access_session() {
        let credentials = MemoryCredentialStore::with_tokens(StoredTokens::new(
            "ghu_cached",
            "ghr_durable",
            10_000,
            20_000,
        ));
        let service = service(
            FakeDeviceFlowApi::with_polls([]),
            credentials.clone(),
            FakeClock::at(1_000),
            NeverDelay,
            RecordingAuthEvents::default(),
        );

        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_cached"
        );
        credentials.fail_delete();

        let error = service.logout().await.unwrap_err();

        assert_eq!(error.code, ErrorCode::CredentialStoreUnavailable);
        assert_eq!(
            service.valid_access_token().await.unwrap().expose_secret(),
            "ghu_cached"
        );
        assert_eq!(credentials.load_count(), 1);
    }
}
