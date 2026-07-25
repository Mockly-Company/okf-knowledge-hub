use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;

/// An access token that may only be consumed by Rust-side adapters.
///
/// Intentionally does not implement `Debug` or `Serialize`.
pub struct AccessToken(SecretString);

impl AccessToken {
    pub(crate) fn from_secret(secret: SecretString) -> Self {
        Self(secret)
    }

    pub fn expose_secret(&self) -> &str {
        self.0.expose_secret()
    }
}

/// The private credential record persisted only by `CredentialStore`.
///
/// Intentionally does not implement `Debug` or `Serialize`.
#[derive(Clone)]
pub struct StoredTokens {
    access_token: SecretString,
    refresh_token: SecretString,
    access_expires_at_unix: i64,
    refresh_expires_at_unix: i64,
}

impl StoredTokens {
    pub fn new(
        access_token: impl Into<String>,
        refresh_token: impl Into<String>,
        access_expires_at_unix: i64,
        refresh_expires_at_unix: i64,
    ) -> Self {
        Self {
            access_token: SecretString::new(access_token.into()),
            refresh_token: SecretString::new(refresh_token.into()),
            access_expires_at_unix,
            refresh_expires_at_unix,
        }
    }

    pub fn access_token(&self) -> &SecretString {
        &self.access_token
    }

    pub fn refresh_token(&self) -> &SecretString {
        &self.refresh_token
    }

    pub fn access_expires_at_unix(&self) -> i64 {
        self.access_expires_at_unix
    }

    pub fn refresh_expires_at_unix(&self) -> i64 {
        self.refresh_expires_at_unix
    }
}

/// Private response returned by GitHub's device-code endpoint.
///
/// Intentionally does not implement `Debug` or `Serialize` because it holds a
/// device code that authenticates the polling request.
pub struct DeviceCodeResponse {
    device_code: SecretString,
    user_code: String,
    verification_uri: String,
    expires_in_seconds: u64,
    interval_seconds: u64,
}

impl DeviceCodeResponse {
    pub fn new(
        device_code: SecretString,
        user_code: impl Into<String>,
        verification_uri: impl Into<String>,
        expires_in_seconds: u64,
        interval_seconds: u64,
    ) -> Self {
        Self {
            device_code,
            user_code: user_code.into(),
            verification_uri: verification_uri.into(),
            expires_in_seconds,
            interval_seconds,
        }
    }

    pub(crate) fn into_parts(self) -> (SecretString, String, String, u64, u64) {
        (
            self.device_code,
            self.user_code,
            self.verification_uri,
            self.expires_in_seconds,
            self.interval_seconds,
        )
    }
}

/// Private token response from either approval or refresh.
///
/// Intentionally does not implement `Debug` or `Serialize`.
pub struct TokenGrant {
    access_token: SecretString,
    refresh_token: SecretString,
    access_expires_in_seconds: u64,
    refresh_expires_in_seconds: u64,
}

impl TokenGrant {
    pub fn new(
        access_token: impl Into<String>,
        refresh_token: impl Into<String>,
        access_expires_in_seconds: u64,
        refresh_expires_in_seconds: u64,
    ) -> Self {
        Self {
            access_token: SecretString::new(access_token.into()),
            refresh_token: SecretString::new(refresh_token.into()),
            access_expires_in_seconds,
            refresh_expires_in_seconds,
        }
    }

    pub(crate) fn access_token(&self) -> &SecretString {
        &self.access_token
    }

    pub(crate) fn into_stored(self, now_unix: i64) -> StoredTokens {
        StoredTokens {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            access_expires_at_unix: now_unix.saturating_add(self.access_expires_in_seconds as i64),
            refresh_expires_at_unix: now_unix
                .saturating_add(self.refresh_expires_in_seconds as i64),
        }
    }
}

pub enum DeviceTokenPoll {
    Pending,
    SlowDown,
    Denied,
    Expired,
    Authorized(TokenGrant),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthorization {
    pub request_id: Uuid,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at_unix: i64,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubUserSummary {
    pub id: u64,
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AuthStatusEvent {
    WaitingForUser {
        request_id: Uuid,
    },
    Authenticated {
        request_id: Uuid,
        user: GithubUserSummary,
    },
    ReauthenticationRequired {
        request_id: Uuid,
    },
    Failed {
        request_id: Uuid,
        error: AppError,
    },
    Cancelled {
        request_id: Uuid,
    },
}
