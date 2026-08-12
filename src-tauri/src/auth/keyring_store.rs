#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;

use async_trait::async_trait;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::auth::model::StoredTokens;
use crate::auth::ports::CredentialStore;
use crate::error::{AppError, ErrorCode, RecoveryAction};

pub const SERVICE_NAME: &str = "com.okhub.desktop.github";
#[cfg(target_os = "macos")]
pub const DEVELOPMENT_SERVICE_NAME: &str = "com.okhub.desktop.github.dev";
pub const ACCOUNT_NAME: &str = "current-user";

#[cfg(target_os = "macos")]
static NEXT_CREDENTIAL_OPERATION_ID: AtomicU64 = AtomicU64::new(1);

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MacCredentialBackend {
    File,
    DataProtection,
}

#[cfg(target_os = "macos")]
impl MacCredentialBackend {
    fn label(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::DataProtection => "data-protection",
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MacCredentialTarget {
    backend: MacCredentialBackend,
    service: &'static str,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SaveFollowUp {
    Complete,
    Update,
    Fail(i32),
}

#[cfg(target_os = "macos")]
fn save_follow_up(add_status: i32) -> SaveFollowUp {
    match add_status {
        security_framework_sys::base::errSecSuccess => SaveFollowUp::Complete,
        security_framework_sys::base::errSecDuplicateItem => SaveFollowUp::Update,
        status => SaveFollowUp::Fail(status),
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct CredentialOperation {
    pid: u32,
    id: u64,
    backend: MacCredentialBackend,
    action: &'static str,
}

#[cfg(target_os = "macos")]
impl CredentialOperation {
    fn new(backend: MacCredentialBackend, action: &'static str) -> Self {
        Self {
            pid: std::process::id(),
            id: NEXT_CREDENTIAL_OPERATION_ID.fetch_add(1, Ordering::Relaxed),
            backend,
            action,
        }
    }

    fn log(self, stage: &str, result: &str, os_status: i32) {
        if cfg!(debug_assertions) {
            eprintln!(
                "{}",
                credential_log_line(
                    self.pid,
                    self.id,
                    self.backend,
                    self.action,
                    stage,
                    result,
                    os_status,
                )
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_credential_target(debug_build: bool) -> MacCredentialTarget {
    if debug_build {
        MacCredentialTarget {
            backend: MacCredentialBackend::File,
            service: DEVELOPMENT_SERVICE_NAME,
        }
    } else {
        MacCredentialTarget {
            backend: MacCredentialBackend::DataProtection,
            service: SERVICE_NAME,
        }
    }
}

#[cfg(target_os = "macos")]
fn password_options(target: MacCredentialTarget) -> security_framework::passwords::PasswordOptions {
    let mut options = security_framework::passwords::PasswordOptions::new_generic_password(
        target.service,
        ACCOUNT_NAME,
    );
    if target.backend == MacCredentialBackend::DataProtection {
        options.use_protected_keychain();
    }
    options
}

#[cfg(target_os = "macos")]
fn map_keychain_load(
    operation: CredentialOperation,
    result: security_framework::base::Result<Vec<u8>>,
) -> Result<Option<Vec<u8>>, AppError> {
    match result {
        Ok(record) => {
            operation.log("complete", "ok", 0);
            Ok(Some(record))
        }
        Err(error) if error.code() == security_framework_sys::base::errSecItemNotFound => {
            operation.log("complete", "not-found", error.code());
            Ok(None)
        }
        Err(error) => {
            log_keychain_error(operation, "complete", &error);
            Err(store_error())
        }
    }
}

#[cfg(target_os = "macos")]
fn map_keychain_delete(
    operation: CredentialOperation,
    result: security_framework::base::Result<()>,
) -> Result<(), AppError> {
    match result {
        Ok(()) => {
            operation.log("complete", "ok", 0);
            Ok(())
        }
        Err(error) if error.code() == security_framework_sys::base::errSecItemNotFound => {
            operation.log("complete", "not-found", error.code());
            Ok(())
        }
        Err(error) => {
            log_keychain_error(operation, "complete", &error);
            Err(store_error())
        }
    }
}

#[cfg(target_os = "macos")]
fn decode_record(record: Vec<u8>) -> Result<StoredTokens, AppError> {
    let record = String::from_utf8(record).map_err(|_| invalid_stored_credentials_error())?;
    decode_tokens(&record)
}

#[cfg(target_os = "macos")]
fn log_keychain_error(
    operation: CredentialOperation,
    stage: &str,
    error: &security_framework::base::Error,
) {
    operation.log(stage, "error", error.code());
}

#[cfg(target_os = "macos")]
fn credential_log_line(
    pid: u32,
    operation_id: u64,
    backend: MacCredentialBackend,
    action: &str,
    stage: &str,
    result: &str,
    os_status: i32,
) -> String {
    format!(
        "macOS credential pid={pid} operation_id={operation_id} backend={} action={action} stage={stage} result={result} os_status={os_status}",
        backend.label()
    )
}

#[cfg(target_os = "macos")]
fn set_password_with_diagnostics(
    operation: CredentialOperation,
    password: &[u8],
    mut options: security_framework::passwords::PasswordOptions,
) -> security_framework::base::Result<()> {
    use core_foundation::base::TCFType;
    use core_foundation::data::CFData;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use security_framework::base::Error;
    use security_framework_sys::item::kSecValueData;
    use security_framework_sys::keychain_item::{SecItemAdd, SecItemUpdate};

    #[allow(deprecated)]
    let query_without_password = options.query.len();
    #[allow(deprecated)]
    options.query.push((
        unsafe { CFString::wrap_under_get_rule(kSecValueData) },
        CFData::from_buffer(password).into_CFType(),
    ));
    #[allow(deprecated)]
    let params = CFDictionary::from_CFType_pairs(&options.query);
    let add_status = unsafe { SecItemAdd(params.as_concrete_TypeRef(), std::ptr::null_mut()) };

    match save_follow_up(add_status) {
        SaveFollowUp::Complete => {
            operation.log("sec-item-add", "ok", add_status);
            Ok(())
        }
        SaveFollowUp::Update => {
            operation.log("sec-item-add", "duplicate", add_status);
            #[allow(deprecated)]
            let (query, value) = options.query.split_at(query_without_password);
            let query = CFDictionary::from_CFType_pairs(query);
            let update = CFDictionary::from_CFType_pairs(value);
            let update_status =
                unsafe { SecItemUpdate(query.as_concrete_TypeRef(), update.as_concrete_TypeRef()) };
            if update_status == security_framework_sys::base::errSecSuccess {
                operation.log("sec-item-update", "ok", update_status);
                Ok(())
            } else {
                operation.log("sec-item-update", "error", update_status);
                Err(Error::from_code(update_status))
            }
        }
        SaveFollowUp::Fail(status) => {
            operation.log("sec-item-add", "error", status);
            Err(Error::from_code(status))
        }
    }
}

#[cfg(target_os = "macos")]
pub struct KeyringCredentialStore {
    target: MacCredentialTarget,
}

#[cfg(target_os = "windows")]
pub struct KeyringCredentialStore {
    entry: Arc<keyring::Entry>,
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub struct KeyringCredentialStore;

impl KeyringCredentialStore {
    #[cfg(target_os = "macos")]
    pub fn new() -> Result<Self, AppError> {
        Ok(Self {
            target: macos_credential_target(cfg!(debug_assertions)),
        })
    }

    #[cfg(target_os = "windows")]
    pub fn new() -> Result<Self, AppError> {
        let entry = keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|_| store_error())?;
        Ok(Self {
            entry: Arc::new(entry),
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn new() -> Result<Self, AppError> {
        Err(store_error())
    }
}

#[async_trait]
#[cfg(target_os = "macos")]
impl CredentialStore for KeyringCredentialStore {
    async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
        let target = self.target;
        let operation = CredentialOperation::new(target.backend, "load");
        operation.log("start", "pending", 0);
        let result = tauri::async_runtime::spawn_blocking(move || {
            security_framework::passwords::generic_password(password_options(target))
        })
        .await
        .map_err(|_| store_error())?;
        map_keychain_load(operation, result)?
            .map_or(Ok(None), |record| decode_record(record).map(Some))
    }

    async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
        let record = encode_tokens(tokens)?.into_bytes();
        let target = self.target;
        let operation = CredentialOperation::new(target.backend, "save");
        operation.log("start", "pending", 0);
        let result = tauri::async_runtime::spawn_blocking(move || {
            set_password_with_diagnostics(operation, &record, password_options(target))
        })
        .await
        .map_err(|_| store_error())?;
        match result {
            Ok(()) => {
                operation.log("complete", "ok", 0);
                Ok(())
            }
            Err(error) => {
                log_keychain_error(operation, "complete", &error);
                Err(store_error())
            }
        }
    }

    async fn delete(&self) -> Result<(), AppError> {
        let target = self.target;
        let operation = CredentialOperation::new(target.backend, "delete");
        operation.log("start", "pending", 0);
        let result = tauri::async_runtime::spawn_blocking(move || {
            security_framework::passwords::delete_generic_password_options(password_options(target))
        })
        .await
        .map_err(|_| store_error())?;
        map_keychain_delete(operation, result)
    }
}

#[async_trait]
#[cfg(target_os = "windows")]
impl CredentialStore for KeyringCredentialStore {
    async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
        let entry = self.entry.clone();
        let result = tauri::async_runtime::spawn_blocking(move || entry.get_password())
            .await
            .map_err(|_| store_error())?;
        match result {
            Ok(record) => decode_tokens(&record).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(store_error()),
        }
    }

    async fn save(&self, tokens: &StoredTokens) -> Result<(), AppError> {
        let record = encode_tokens(tokens)?;
        let entry = self.entry.clone();
        tauri::async_runtime::spawn_blocking(move || entry.set_password(&record))
            .await
            .map_err(|_| store_error())?
            .map_err(|_| store_error())
    }

    async fn delete(&self) -> Result<(), AppError> {
        let entry = self.entry.clone();
        let result = tauri::async_runtime::spawn_blocking(move || entry.delete_credential())
            .await
            .map_err(|_| store_error())?;
        match result {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(store_error()),
        }
    }
}

#[async_trait]
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl CredentialStore for KeyringCredentialStore {
    async fn load(&self) -> Result<Option<StoredTokens>, AppError> {
        Err(store_error())
    }

    async fn save(&self, _tokens: &StoredTokens) -> Result<(), AppError> {
        Err(store_error())
    }

    async fn delete(&self) -> Result<(), AppError> {
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
    let record: CredentialRecord =
        serde_json::from_str(record).map_err(|_| invalid_stored_credentials_error())?;
    if record.access_token.is_empty()
        || record.refresh_token.is_empty()
        || record.access_expires_at_unix <= 0
        || record.refresh_expires_at_unix <= 0
    {
        return Err(invalid_stored_credentials_error());
    }
    Ok(StoredTokens::new(
        record.access_token,
        record.refresh_token,
        record.access_expires_at_unix,
        record.refresh_expires_at_unix,
    ))
}

fn invalid_stored_credentials_error() -> AppError {
    AppError::new(
        ErrorCode::ReauthenticationRequired,
        "저장된 GitHub 인증 정보를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::RestartLogin)
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

    #[cfg(target_os = "macos")]
    fn test_operation(action: &'static str) -> super::CredentialOperation {
        super::CredentialOperation {
            pid: 41,
            id: 7,
            backend: super::MacCredentialBackend::DataProtection,
            action,
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_debug_build_selects_the_file_keychain_and_development_namespace() {
        let target = super::macos_credential_target(true);

        assert_eq!(target.backend, super::MacCredentialBackend::File);
        assert_eq!(target.service, super::DEVELOPMENT_SERVICE_NAME);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_release_build_selects_the_data_protection_keychain_and_production_namespace() {
        let target = super::macos_credential_target(false);

        assert_eq!(target.backend, super::MacCredentialBackend::DataProtection);
        assert_eq!(target.service, super::SERVICE_NAME);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_file_keychain_query_omits_the_data_protection_flag() {
        use core_foundation::base::TCFType;
        use core_foundation::string::CFString;
        use security_framework_sys::item::kSecUseDataProtectionKeychain;

        let target = super::macos_credential_target(true);
        let options = super::password_options(target);
        let protected_key = unsafe { CFString::wrap_under_get_rule(kSecUseDataProtectionKeychain) };
        #[allow(deprecated)]
        let protected_value = options
            .query
            .iter()
            .find_map(|(key, value)| (key == &protected_key).then_some(value));

        assert!(protected_value.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_data_protection_query_sets_the_data_protection_flag() {
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::string::CFString;
        use security_framework_sys::item::kSecUseDataProtectionKeychain;

        let target = super::macos_credential_target(false);
        let options = super::password_options(target);
        let protected_key = unsafe { CFString::wrap_under_get_rule(kSecUseDataProtectionKeychain) };
        #[allow(deprecated)]
        let value = options
            .query
            .iter()
            .find_map(|(key, value)| (key == &protected_key).then_some(value))
            .expect("data protection keychain flag must be present");
        let enabled = value
            .downcast::<CFBoolean>()
            .expect("data protection keychain flag must be a boolean");

        assert!(bool::from(enabled));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_missing_item_is_treated_as_signed_out() {
        use security_framework::base::Error;
        use security_framework_sys::base::errSecItemNotFound;

        let result = super::map_keychain_load(
            test_operation("load"),
            Err(Error::from_code(errSecItemNotFound)),
        );

        assert_eq!(result.unwrap(), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_security_failure_is_sanitized_as_store_unavailable() {
        use security_framework::base::Error;

        let error = super::map_keychain_load(test_operation("load"), Err(Error::from_code(-25293)))
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::CredentialStoreUnavailable);
        assert!(!serde_json::to_string(&error).unwrap().contains("-25293"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_diagnostic_line_contains_only_backend_operation_and_status() {
        let line = super::credential_log_line(
            41,
            7,
            super::MacCredentialBackend::File,
            "save",
            "complete",
            "ok",
            0,
        );

        assert_eq!(
            line,
            "macOS credential pid=41 operation_id=7 backend=file action=save stage=complete result=ok os_status=0"
        );
        assert!(!line.contains("token"));
        assert!(!line.contains(super::ACCOUNT_NAME));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_save_updates_only_after_sec_item_add_reports_a_duplicate() {
        use security_framework_sys::base::{errSecDuplicateItem, errSecSuccess};

        assert_eq!(
            super::save_follow_up(errSecSuccess),
            super::SaveFollowUp::Complete
        );
        assert_eq!(
            super::save_follow_up(errSecDuplicateItem),
            super::SaveFollowUp::Update
        );
        assert_eq!(
            super::save_follow_up(-25293),
            super::SaveFollowUp::Fail(-25293)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_delete_is_idempotent_when_item_is_missing() {
        use security_framework::base::Error;
        use security_framework_sys::base::errSecItemNotFound;

        let result = super::map_keychain_delete(
            test_operation("delete"),
            Err(Error::from_code(errSecItemNotFound)),
        );

        assert!(result.is_ok());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_non_utf8_record_requires_reauthentication() {
        let error = match super::decode_record(vec![0xff, 0xfe]) {
            Ok(_) => panic!("non-UTF-8 credentials must not be accepted"),
            Err(error) => error,
        };

        assert_eq!(error.code, ErrorCode::ReauthenticationRequired);
    }

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
