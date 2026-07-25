use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::auth::model::StoredTokens;
use crate::auth::ports::CredentialStore;
use crate::error::{AppError, ErrorCode, RecoveryAction};

pub const SERVICE_NAME: &str = "com.okhub.desktop.github";
pub const ACCOUNT_NAME: &str = "current-user";

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub struct KeyringCredentialStore {
    entry: keyring::Entry,
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub struct KeyringCredentialStore;

impl KeyringCredentialStore {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn new() -> Result<Self, AppError> {
        let entry = keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|_| store_error())?;
        Ok(Self { entry })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn new() -> Result<Self, AppError> {
        Err(store_error())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl CredentialStore for KeyringCredentialStore {
    fn load(&self) -> Result<Option<StoredTokens>, AppError> {
        match self.entry.get_password() {
            Ok(record) => decode_tokens(&record).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(store_error()),
        }
    }

    fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
        let record = encode_tokens(tokens)?;
        self.entry.set_password(&record).map_err(|_| store_error())
    }

    fn delete(&self) -> Result<(), AppError> {
        match self.entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(store_error()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl CredentialStore for KeyringCredentialStore {
    fn load(&self) -> Result<Option<StoredTokens>, AppError> {
        Err(store_error())
    }

    fn save(&self, _tokens: &StoredTokens) -> Result<(), AppError> {
        Err(store_error())
    }

    fn delete(&self) -> Result<(), AppError> {
        Err(store_error())
    }
}

#[derive(Serialize, Deserialize)]
struct CredentialRecord {
    access_token: String,
    refresh_token: String,
    access_expires_at_unix: i64,
    refresh_expires_at_unix: i64,
}

fn encode_tokens(tokens: &StoredTokens) -> Result<String, AppError> {
    serde_json::to_string(&CredentialRecord {
        access_token: tokens.access_token().expose_secret().to_owned(),
        refresh_token: tokens.refresh_token().expose_secret().to_owned(),
        access_expires_at_unix: tokens.access_expires_at_unix(),
        refresh_expires_at_unix: tokens.refresh_expires_at_unix(),
    })
    .map_err(|_| store_error())
}

fn decode_tokens(record: &str) -> Result<StoredTokens, AppError> {
    let record: CredentialRecord = serde_json::from_str(record).map_err(|_| {
        AppError::new(
            ErrorCode::ReauthenticationRequired,
            "저장된 GitHub 인증 정보를 사용할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::RestartLogin)
    })?;
    if record.access_token.is_empty()
        || record.refresh_token.is_empty()
        || record.access_expires_at_unix <= 0
        || record.refresh_expires_at_unix <= 0
    {
        return Err(AppError::new(
            ErrorCode::ReauthenticationRequired,
            "저장된 GitHub 인증 정보를 사용할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::RestartLogin));
    }
    Ok(StoredTokens::new(
        record.access_token,
        record.refresh_token,
        record.access_expires_at_unix,
        record.refresh_expires_at_unix,
    ))
}

fn store_error() -> AppError {
    AppError::new(
        ErrorCode::CredentialStoreUnavailable,
        "운영체제 보안 저장소를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use super::decode_tokens;
    use crate::error::ErrorCode;

    #[test]
    fn malformed_keyring_record_requires_reauthentication_without_echoing_contents() {
        let malformed = r#"{"access_token":"ghu_private","broken":true}"#;

        let error = match decode_tokens(malformed) {
            Ok(_) => panic!("malformed credentials must not be accepted"),
            Err(error) => error,
        };
        let public_json = serde_json::to_string(&error).unwrap();

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
        assert!(!public_json.contains("ghu_private"));
        assert!(!public_json.contains("broken"));
    }
}
