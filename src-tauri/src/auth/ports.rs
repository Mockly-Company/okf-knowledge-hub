use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use secrecy::SecretString;

use crate::auth::model::{
    AuthStatusEvent, DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, StoredTokens,
    TokenGrant,
};
use crate::error::AppError;

pub trait CredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<StoredTokens>, AppError>;
    fn save(&self, tokens: &StoredTokens) -> Result<(), AppError>;
    fn delete(&self) -> Result<(), AppError>;
}

#[async_trait]
pub trait DeviceFlowApi: Send + Sync {
    async fn request_device_code(&self, client_id: &str) -> Result<DeviceCodeResponse, AppError>;

    async fn poll_access_token(
        &self,
        client_id: &str,
        device_code: &SecretString,
    ) -> Result<DeviceTokenPoll, AppError>;

    async fn refresh_access_token(
        &self,
        client_id: &str,
        refresh_token: &SecretString,
    ) -> Result<TokenGrant, AppError>;

    async fn authenticated_user(
        &self,
        access_token: &SecretString,
    ) -> Result<GithubUserSummary, AppError>;
}

pub trait Clock: Send + Sync {
    fn now_unix(&self) -> i64;
}

#[async_trait]
pub trait Delay: Send + Sync {
    async fn wait(&self, seconds: u64);
}

pub trait AuthEventSink: Send + Sync {
    fn emit(&self, event: AuthStatusEvent);
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_unix(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }
}

pub struct TokioDelay;

#[async_trait]
impl Delay for TokioDelay {
    async fn wait(&self, seconds: u64) {
        tokio::time::sleep(Duration::from_secs(seconds)).await;
    }
}

pub struct NoopAuthEvents;

impl AuthEventSink for NoopAuthEvents {
    fn emit(&self, _event: AuthStatusEvent) {}
}
