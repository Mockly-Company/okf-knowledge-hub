use std::collections::BTreeMap;

use serde::Serialize;

pub type CommandResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AuthenticationExpired,
    AuthenticationDenied,
    ReauthenticationRequired,
    CredentialStoreUnavailable,
    GithubPermissionDenied,
    GithubUnavailable,
    RepositoryPathConflict,
    RepositoryRemoteMismatch,
    RepositoryDirty,
    CloneFailed,
    WorkspaceMissing,
    WorkspaceInvalid,
    WorkspaceVersionUnsupported,
    WorkspaceChangedSincePreview,
    DocumentPathInvalid,
    DocumentSessionConflict,
    DocumentIndexUnavailable,
    PushFailed,
    DraftPullRequestFailed,
    LocalSettingsUnavailable,
    DesktopOnly,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    RestartLogin,
    ReinstallGithubApp,
    ChooseAnotherDirectory,
    ConnectExistingClone,
    CleanWorkingTree,
    OpenWorkspaceFile,
    UpdateOkhub,
    Retry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub recovery: Option<RecoveryAction>,
    pub details: BTreeMap<String, String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            code,
            message: if is_secret_like_value(&message) {
                "연결 작업을 완료할 수 없습니다.".to_owned()
            } else {
                message
            },
            recovery: None,
            details: BTreeMap::new(),
        }
    }

    pub fn with_recovery(mut self, recovery: RecoveryAction) -> Self {
        self.recovery = Some(recovery);
        self
    }

    pub fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let key = key.into();
        let value = value.into();
        if !is_secret_like_detail_key(&key) && !is_secret_like_detail_value(&value) {
            self.details.insert(key, value);
        }
        self
    }
}

fn is_secret_like_detail_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["authorization", "password", "secret", "token"]
        .iter()
        .any(|marker| key.contains(marker))
}

fn is_secret_like_detail_value(value: &str) -> bool {
    is_secret_like_value(value)
}

fn is_secret_like_value(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    [
        "access_token",
        "refresh_token",
        "device_code",
        "ghu_",
        "ghr_",
    ]
    .iter()
    .any(|marker| value.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_error_contains_code_message_and_recovery_without_secrets() {
        let error = AppError::new(
            ErrorCode::RepositoryPathConflict,
            "선택한 위치에 같은 이름의 폴더가 있습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory)
        .with_detail("path", "/workspace/mockly-knowledge");

        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], "repository_path_conflict");
        assert_eq!(json["recovery"], "choose_another_directory");
        assert_eq!(json["details"]["path"], "/workspace/mockly-knowledge");
        assert!(json.to_string().find("token").is_none());
    }

    #[test]
    fn public_error_excludes_secret_like_detail_keys() {
        let error = AppError::new(ErrorCode::GithubUnavailable, "GitHub에 연결할 수 없습니다.")
            .with_detail("path", "/workspace/mockly-knowledge")
            .with_detail("access_token", "github_pat_secret")
            .with_detail("password", "not-for-public-output")
            .with_detail("authorization", "Bearer secret");

        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["details"]["path"], "/workspace/mockly-knowledge");
        assert!(json["details"].get("access_token").is_none());
        assert!(json["details"].get("password").is_none());
        assert!(json["details"].get("authorization").is_none());
        assert!(!json.to_string().contains("github_pat_secret"));
        assert!(!json.to_string().contains("not-for-public-output"));
        assert!(!json.to_string().contains("Bearer secret"));
    }
}
