use async_trait::async_trait;
use reqwest::header::{ACCEPT, USER_AGENT};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use crate::auth::model::{DeviceCodeResponse, DeviceTokenPoll, GithubUserSummary, TokenGrant};
use crate::auth::ports::DeviceFlowApi;
use crate::error::{AppError, ErrorCode, RecoveryAction};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const CURRENT_USER_URL: &str = "https://api.github.com/user";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Clone)]
pub struct ReqwestDeviceFlowApi {
    client: reqwest::Client,
}

impl ReqwestDeviceFlowApi {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    async fn post_form<T, F>(&self, url: &str, form: &F) -> Result<T, AppError>
    where
        T: for<'de> Deserialize<'de>,
        F: Serialize + ?Sized,
    {
        let response = self
            .client
            .post(url)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, "OkHub")
            .form(form)
            .send()
            .await
            .map_err(|_| github_unavailable())?;
        let status = response.status();
        if !status.is_success() {
            return Err(github_unavailable().with_detail("httpStatus", status.as_u16().to_string()));
        }
        response.json().await.map_err(|_| github_unavailable())
    }
}

impl Default for ReqwestDeviceFlowApi {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DeviceFlowApi for ReqwestDeviceFlowApi {
    async fn request_device_code(&self, client_id: &str) -> Result<DeviceCodeResponse, AppError> {
        let payload: DeviceCodePayload = self
            .post_form(DEVICE_CODE_URL, &ClientIdForm { client_id })
            .await?;
        Ok(DeviceCodeResponse::new(
            SecretString::new(payload.device_code),
            payload.user_code,
            payload.verification_uri,
            payload.expires_in,
            payload.interval,
        ))
    }

    async fn poll_access_token(
        &self,
        client_id: &str,
        device_code: &SecretString,
    ) -> Result<DeviceTokenPoll, AppError> {
        let payload: TokenPayload = self
            .post_form(
                ACCESS_TOKEN_URL,
                &DeviceTokenForm {
                    client_id,
                    device_code: device_code.expose_secret(),
                    grant_type: DEVICE_GRANT_TYPE,
                },
            )
            .await?;

        match payload.error.as_deref() {
            Some("authorization_pending") => Ok(DeviceTokenPoll::Pending),
            Some("slow_down") => Ok(DeviceTokenPoll::SlowDown),
            Some("access_denied") => Ok(DeviceTokenPoll::Denied),
            Some("expired_token") => Ok(DeviceTokenPoll::Expired),
            Some("incorrect_client_credentials") => Err(AppError::new(
                ErrorCode::GithubPermissionDenied,
                "GitHub App 설정을 확인해 주세요.",
            )
            .with_recovery(RecoveryAction::ReinstallGithubApp)),
            Some(_) => Err(github_unavailable()),
            None => Ok(DeviceTokenPoll::Authorized(payload.into_grant()?)),
        }
    }

    async fn refresh_access_token(
        &self,
        client_id: &str,
        refresh_token: &SecretString,
    ) -> Result<TokenGrant, AppError> {
        let payload: TokenPayload = self
            .post_form(
                ACCESS_TOKEN_URL,
                &RefreshForm::new(client_id, refresh_token),
            )
            .await?;
        if payload.error.is_some() {
            return Err(AppError::new(
                ErrorCode::ReauthenticationRequired,
                "GitHub에 다시 로그인해 주세요.",
            )
            .with_recovery(RecoveryAction::RestartLogin));
        }
        payload.into_grant()
    }

    async fn authenticated_user(
        &self,
        access_token: &SecretString,
    ) -> Result<GithubUserSummary, AppError> {
        let response = self
            .client
            .get(CURRENT_USER_URL)
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT, "OkHub")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(access_token.expose_secret())
            .send()
            .await
            .map_err(|_| github_unavailable())?;
        let status = response.status();
        if !status.is_success() {
            let code = if status == reqwest::StatusCode::UNAUTHORIZED {
                ErrorCode::ReauthenticationRequired
            } else if status == reqwest::StatusCode::FORBIDDEN {
                ErrorCode::GithubPermissionDenied
            } else {
                ErrorCode::GithubUnavailable
            };
            return Err(
                AppError::new(code, "GitHub 사용자 정보를 확인할 수 없습니다.")
                    .with_detail("httpStatus", status.as_u16().to_string()),
            );
        }
        let user: GithubUserPayload = response.json().await.map_err(|_| github_unavailable())?;
        Ok(GithubUserSummary {
            id: user.id,
            login: user.login,
            avatar_url: user.avatar_url,
        })
    }
}

#[derive(Serialize)]
struct ClientIdForm<'a> {
    client_id: &'a str,
}

#[derive(Serialize)]
struct DeviceTokenForm<'a> {
    client_id: &'a str,
    device_code: &'a str,
    grant_type: &'static str,
}

#[derive(Serialize)]
struct RefreshForm<'a> {
    client_id: &'a str,
    grant_type: &'static str,
    refresh_token: &'a str,
}

impl<'a> RefreshForm<'a> {
    fn new(client_id: &'a str, refresh_token: &'a SecretString) -> Self {
        Self {
            client_id,
            grant_type: "refresh_token",
            refresh_token: refresh_token.expose_secret(),
        }
    }
}

#[derive(Deserialize)]
struct DeviceCodePayload {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenPayload {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    error: Option<String>,
}

impl TokenPayload {
    fn into_grant(self) -> Result<TokenGrant, AppError> {
        let Some(access_token) = self.access_token else {
            return Err(invalid_token_response());
        };
        let Some(refresh_token) = self.refresh_token else {
            return Err(invalid_token_response());
        };
        let Some(expires_in) = self.expires_in else {
            return Err(invalid_token_response());
        };
        let Some(refresh_expires_in) = self.refresh_token_expires_in else {
            return Err(invalid_token_response());
        };
        Ok(TokenGrant::new(
            access_token,
            refresh_token,
            expires_in,
            refresh_expires_in,
        ))
    }
}

#[derive(Deserialize)]
struct GithubUserPayload {
    id: u64,
    login: String,
    avatar_url: String,
}

fn invalid_token_response() -> AppError {
    AppError::new(
        ErrorCode::ReauthenticationRequired,
        "GitHub 인증 응답을 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::RestartLogin)
}

fn github_unavailable() -> AppError {
    AppError::new(ErrorCode::GithubUnavailable, "GitHub에 연결할 수 없습니다.")
        .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use secrecy::SecretString;

    use super::RefreshForm;

    #[test]
    fn refresh_form_omits_client_secret() {
        let refresh_token = SecretString::new("ghr_private".into());
        let form = RefreshForm::new("Iv1.public-client-id", &refresh_token);

        let json = serde_json::to_value(form).unwrap();

        assert_eq!(json["client_id"], "Iv1.public-client-id");
        assert_eq!(json["grant_type"], "refresh_token");
        assert_eq!(json["refresh_token"], "ghr_private");
        assert!(json.get("client_secret").is_none());
    }
}
