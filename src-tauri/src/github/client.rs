use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use url::Url;

use crate::auth::model::{AccessToken, GithubUserSummary};
use crate::auth::service::AuthService;
use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::github::model::{
    DraftPullRequest, DraftPullRequestRequest, GithubRepositoryDetail, GithubRepositorySummary,
    Page,
};

pub const INITIALIZATION_DRAFT_PR_BODY: &str = "## Summary\n\n- Initialize this repository as an OkHub knowledge workspace\n\n## Why\n\n- Share OKF documents and workspace metadata through Git\n\n## Changes\n\n- Add `.okf/workspace.yml`\n- Add the initial document and template roots when missing\n\n## Test Plan\n\n- Validate `.okf/workspace.yml` in OkHub\n- Confirm the configured document root stays inside the repository\n\n## Review Notes\n\n- This change contains workspace metadata only";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
struct GithubRepositoryPageResponse {
    total_count: usize,
    repositories: Vec<GithubRepositoryResponse>,
}

impl GithubRepositoryPageResponse {
    fn into_page(self, next_cursor: Option<String>) -> Page<GithubRepositorySummary> {
        Page {
            items: self
                .repositories
                .into_iter()
                .map(GithubRepositoryResponse::into_summary)
                .collect(),
            next_cursor,
        }
    }
}

#[derive(Deserialize)]
struct GithubInstallationsPageResponse {
    total_count: usize,
    installations: Vec<GithubInstallationResponse>,
}

#[derive(Deserialize)]
struct GithubUserResponse {
    id: u64,
    login: String,
    avatar_url: String,
}

impl GithubUserResponse {
    fn into_public(self) -> GithubUserSummary {
        GithubUserSummary {
            id: self.id,
            login: self.login,
            avatar_url: self.avatar_url,
        }
    }
}

#[derive(Deserialize)]
struct GithubInstallationResponse {
    id: u64,
}

#[derive(Deserialize)]
struct GithubRepositoryResponse {
    node_id: String,
    name: String,
    full_name: String,
    owner: GithubRepositoryOwnerResponse,
    default_branch: Option<String>,
    clone_url: String,
}

impl GithubRepositoryResponse {
    fn into_summary(self) -> GithubRepositorySummary {
        let is_empty = self.default_branch.is_none();
        GithubRepositorySummary {
            id: self.node_id,
            owner: self.owner.login,
            name: self.name,
            full_name: self.full_name,
            default_branch: self.default_branch,
            is_empty,
        }
    }

    fn into_detail(self) -> GithubRepositoryDetail {
        let is_empty = self.default_branch.is_none();
        GithubRepositoryDetail {
            id: self.node_id,
            owner: self.owner.login,
            name: self.name,
            full_name: self.full_name,
            default_branch: self.default_branch,
            is_empty,
            https_url: self.clone_url,
        }
    }
}

#[derive(Deserialize)]
struct GithubRepositoryOwnerResponse {
    login: String,
}

#[derive(Deserialize)]
struct DraftPullRequestResponse {
    number: u64,
    html_url: String,
    draft: bool,
}

impl DraftPullRequestResponse {
    fn into_public(self) -> DraftPullRequest {
        DraftPullRequest {
            number: self.number,
            html_url: self.html_url,
            is_draft: self.draft,
        }
    }
}

impl DraftPullRequestRequest {
    pub fn initialize_workspace(
        repository_full_name: impl Into<String>,
        head: impl Into<String>,
        base: impl Into<String>,
    ) -> Self {
        Self {
            repository_full_name: repository_full_name.into(),
            head: head.into(),
            base: base.into(),
            title: "Initialize OkHub workspace".into(),
            body: INITIALIZATION_DRAFT_PR_BODY.into(),
        }
    }

    fn payload(&self) -> serde_json::Value {
        json!({
            "head": self.head,
            "base": self.base,
            "title": "Initialize OkHub workspace",
            "body": INITIALIZATION_DRAFT_PR_BODY,
            "draft": true,
        })
    }
}

#[derive(Clone, Copy)]
enum HttpFailureContext {
    Installation,
    Repository,
}

type HeaderMap = BTreeMap<String, String>;

fn headers(values: &[(&str, &str)]) -> HeaderMap {
    values
        .iter()
        .map(|(key, value)| (key.to_ascii_lowercase(), (*value).to_owned()))
        .collect()
}

fn map_http_error(
    context: HttpFailureContext,
    status: u16,
    response_headers: &HeaderMap,
) -> AppError {
    if status == 401 {
        return AppError::new(
            ErrorCode::ReauthenticationRequired,
            "GitHub에 다시 로그인해 주세요.",
        )
        .with_recovery(RecoveryAction::RestartLogin);
    }
    if is_rate_limited(status, response_headers) {
        return github_unavailable_error();
    }
    if matches!(status, 403 | 404)
        && matches!(
            context,
            HttpFailureContext::Installation | HttpFailureContext::Repository
        )
    {
        return AppError::new(
            ErrorCode::GithubPermissionDenied,
            "GitHub App에서 이 저장소에 접근할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::ReinstallGithubApp);
    }
    github_unavailable_error()
}

fn map_draft_pull_request_error(
    status: u16,
    response_headers: &HeaderMap,
    branch: &str,
) -> AppError {
    let error = if status == 401
        || matches!(status, 403 | 404)
        || is_rate_limited(status, response_headers)
    {
        map_http_error(HttpFailureContext::Repository, status, response_headers)
    } else {
        AppError::new(
            ErrorCode::DraftPullRequestFailed,
            "branch는 push되었지만 Draft PR을 만들지 못했습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
    };
    error.with_detail("branch", branch)
}

fn is_rate_limited(status: u16, response_headers: &HeaderMap) -> bool {
    status == 429
        || (status == 403
            && (response_headers
                .get("x-ratelimit-remaining")
                .is_some_and(|remaining| remaining == "0")
                || response_headers.contains_key("retry-after")))
}

fn github_unavailable_error() -> AppError {
    AppError::new(ErrorCode::GithubUnavailable, "GitHub에 연결할 수 없습니다.")
        .with_recovery(RecoveryAction::Retry)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RepositoryCursor {
    installation_id: u64,
    page: u32,
}

impl RepositoryCursor {
    fn parse(value: &str) -> Result<Self, AppError> {
        let parts = value.split(':').collect::<Vec<_>>();
        if parts.len() != 4 || parts[0] != "installation" || parts[2] != "page" {
            return Err(invalid_cursor_error());
        }
        let installation_id = parts[1].parse().map_err(|_| invalid_cursor_error())?;
        let page = parts[3].parse().map_err(|_| invalid_cursor_error())?;
        if page == 0 {
            return Err(invalid_cursor_error());
        }
        Ok(Self {
            installation_id,
            page,
        })
    }

    fn encode(self) -> String {
        format!("installation:{}:page:{}", self.installation_id, self.page)
    }
}

fn invalid_cursor_error() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "저장소 목록 cursor가 올바르지 않습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[async_trait]
trait AccessTokenProvider: Send + Sync {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError>;
}

#[async_trait]
impl AccessTokenProvider for AuthService {
    async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
        AuthService::valid_access_token(self).await
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpMethod {
    Get,
    Post,
}

struct HttpRequest {
    method: HttpMethod,
    url: String,
    headers: HeaderMap,
    access_token: AccessToken,
    body: Option<serde_json::Value>,
}

impl HttpRequest {
    #[cfg(test)]
    fn method(&self) -> HttpMethod {
        self.method
    }

    #[cfg(test)]
    fn url(&self) -> &str {
        &self.url
    }

    #[cfg(test)]
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }

    #[cfg(test)]
    fn bearer_token(&self) -> &str {
        self.access_token.expose_secret()
    }

    #[cfg(test)]
    fn body(&self) -> Option<&serde_json::Value> {
        self.body.as_ref()
    }
}

struct HttpResponse {
    status: u16,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl HttpResponse {
    fn new(status: u16, headers: HeaderMap, body: Vec<u8>) -> Self {
        Self {
            status,
            headers,
            body,
        }
    }
}

struct TransportError;

impl TransportError {
    #[cfg(test)]
    fn unavailable() -> Self {
        Self
    }
}

#[async_trait]
trait HttpTransport: Send + Sync {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

struct ReqwestHttpTransport {
    client: reqwest::Client,
}

impl ReqwestHttpTransport {
    fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(TOTAL_TIMEOUT)
                .build()
                .expect("static GitHub HTTP client configuration must be valid"),
        }
    }
}

impl Default for ReqwestHttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl HttpTransport for ReqwestHttpTransport {
    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        let method = match request.method {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
        };
        let mut builder = self
            .client
            .request(method, &request.url)
            .bearer_auth(request.access_token.expose_secret());
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
        let response = builder.send().await.map_err(|_| TransportError)?;
        let status = response.status().as_u16();
        let mut response_headers = HeaderMap::new();
        for name in ["x-ratelimit-remaining", "retry-after"] {
            if let Some(value) = response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
            {
                response_headers.insert(name.to_owned(), value.to_owned());
            }
        }
        let body = response.bytes().await.map_err(|_| TransportError)?.to_vec();
        Ok(HttpResponse::new(status, response_headers, body))
    }
}

pub struct GithubHttpClient {
    auth: Arc<dyn AccessTokenProvider>,
    transport: Arc<dyn HttpTransport>,
    api_base_url: Url,
}

pub type GithubService = GithubHttpClient;

impl GithubHttpClient {
    pub(crate) fn production(auth: Arc<AuthService>) -> Result<Self, AppError> {
        Self::from_parts(
            auth,
            Arc::new(ReqwestHttpTransport::new()),
            "https://api.github.com/",
        )
    }

    #[cfg(test)]
    fn with_base_url(
        auth: impl AccessTokenProvider + 'static,
        transport: impl HttpTransport + 'static,
        api_base_url: &str,
    ) -> Result<Self, AppError> {
        Self::from_parts(Arc::new(auth), Arc::new(transport), api_base_url)
    }

    fn from_parts(
        auth: Arc<dyn AccessTokenProvider>,
        transport: Arc<dyn HttpTransport>,
        api_base_url: &str,
    ) -> Result<Self, AppError> {
        let api_base_url = Url::parse(api_base_url).map_err(|_| github_unavailable_error())?;
        if !api_base_url.path().ends_with('/') {
            return Err(github_unavailable_error());
        }
        Ok(Self {
            auth,
            transport,
            api_base_url,
        })
    }

    pub async fn current_user(&self) -> Result<GithubUserSummary, AppError> {
        let response: GithubUserResponse = self
            .get_json(&["user"], &[], HttpFailureContext::Repository)
            .await?;
        Ok(response.into_public())
    }

    pub async fn list_repositories(
        &self,
        cursor: Option<&str>,
    ) -> Result<Page<GithubRepositorySummary>, AppError> {
        let installations = self.list_installations().await?;
        let cursor = match cursor {
            Some(cursor) => RepositoryCursor::parse(cursor)?,
            None => match installations.first() {
                Some(installation_id) => RepositoryCursor {
                    installation_id: *installation_id,
                    page: 1,
                },
                None => {
                    return Ok(Page {
                        items: Vec::new(),
                        next_cursor: None,
                    })
                }
            },
        };
        let installation_index = installations
            .iter()
            .position(|id| *id == cursor.installation_id)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::GithubPermissionDenied,
                    "GitHub App의 저장소 접근 권한이 변경되었습니다.",
                )
                .with_recovery(RecoveryAction::ReinstallGithubApp)
            })?;
        let response: GithubRepositoryPageResponse = self
            .get_json(
                &[
                    "user",
                    "installations",
                    &cursor.installation_id.to_string(),
                    "repositories",
                ],
                &[
                    ("per_page", "100".to_owned()),
                    ("page", cursor.page.to_string()),
                ],
                HttpFailureContext::Installation,
            )
            .await?;
        let next_cursor = if u128::from(cursor.page) * 100 < response.total_count as u128 {
            let next_page = cursor.page.checked_add(1).ok_or_else(|| {
                AppError::new(
                    ErrorCode::GithubUnavailable,
                    "저장소 목록 cursor의 다음 페이지를 계산할 수 없습니다.",
                )
                .with_recovery(RecoveryAction::Retry)
            })?;
            Some(
                RepositoryCursor {
                    installation_id: cursor.installation_id,
                    page: next_page,
                }
                .encode(),
            )
        } else {
            installations
                .get(installation_index + 1)
                .map(|installation_id| RepositoryCursor {
                    installation_id: *installation_id,
                    page: 1,
                })
                .map(RepositoryCursor::encode)
        };
        Ok(response.into_page(next_cursor))
    }

    pub async fn repository_detail(
        &self,
        expected_repository_id: &str,
        repository_full_name: &str,
    ) -> Result<GithubRepositoryDetail, AppError> {
        let (owner, name) = split_repository_full_name(repository_full_name)?;
        let response: GithubRepositoryResponse = self
            .get_json(&["repos", owner, name], &[], HttpFailureContext::Repository)
            .await?;
        ensure_repository_identity(response.into_detail(), expected_repository_id)
    }

    pub async fn resolve_remote_repository(
        &self,
        remote_url: &str,
        expected_repository_id: &str,
    ) -> Result<GithubRepositoryDetail, AppError> {
        let (owner, name) = parse_github_remote(remote_url)?;
        let response: GithubRepositoryResponse = self
            .get_json(
                &["repos", &owner, &name],
                &[],
                HttpFailureContext::Repository,
            )
            .await?;
        ensure_repository_identity(response.into_detail(), expected_repository_id)
    }

    pub async fn create_draft_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<DraftPullRequest, AppError> {
        let (owner, name) =
            split_repository_full_name(&request.repository_full_name).map_err(|error| {
                error
                    .with_recovery(RecoveryAction::Retry)
                    .with_detail("branch", &request.head)
            })?;
        let response = self
            .send(
                HttpMethod::Post,
                &["repos", owner, name, "pulls"],
                &[],
                Some(request.payload()),
            )
            .await
            .map_err(|error| error.with_detail("branch", &request.head))?;
        if !(200..300).contains(&response.status) {
            return Err(map_draft_pull_request_error(
                response.status,
                &response.headers,
                &request.head,
            ));
        }
        deserialize_response(response)
            .map(DraftPullRequestResponse::into_public)
            .map_err(|_| draft_pull_request_invalid_response(&request.head))
    }

    pub(crate) async fn find_open_pull_request(
        &self,
        request: &DraftPullRequestRequest,
    ) -> Result<Option<DraftPullRequest>, AppError> {
        let (owner, name) =
            split_repository_full_name(&request.repository_full_name).map_err(|error| {
                error
                    .with_recovery(RecoveryAction::Retry)
                    .with_detail("branch", &request.head)
            })?;
        let response: Vec<DraftPullRequestResponse> = self
            .get_json(
                &["repos", owner, name, "pulls"],
                &[
                    ("state", "open".to_owned()),
                    ("head", format!("{owner}:{}", request.head)),
                    ("base", request.base.clone()),
                ],
                HttpFailureContext::Repository,
            )
            .await
            .map_err(|error| error.with_detail("branch", &request.head))?;
        Ok(response
            .into_iter()
            .map(DraftPullRequestResponse::into_public)
            .next())
    }

    async fn list_installations(&self) -> Result<Vec<u64>, AppError> {
        let mut page = 1_u32;
        let mut installation_ids = Vec::new();
        loop {
            let response: GithubInstallationsPageResponse = self
                .get_json(
                    &["user", "installations"],
                    &[("per_page", "100".to_owned()), ("page", page.to_string())],
                    HttpFailureContext::Installation,
                )
                .await?;
            let returned = response.installations.len();
            installation_ids.extend(response.installations.into_iter().map(|item| item.id));
            if installation_ids.len() >= response.total_count || returned == 0 {
                break;
            }
            page = page.checked_add(1).ok_or_else(github_unavailable_error)?;
        }
        Ok(installation_ids)
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        path_segments: &[&str],
        query: &[(&str, String)],
        context: HttpFailureContext,
    ) -> Result<T, AppError> {
        let response = self
            .send(HttpMethod::Get, path_segments, query, None)
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(map_http_error(context, response.status, &response.headers));
        }
        deserialize_response(response).map_err(|_| github_unavailable_error())
    }

    async fn send(
        &self,
        method: HttpMethod,
        path_segments: &[&str],
        query: &[(&str, String)],
        body: Option<serde_json::Value>,
    ) -> Result<HttpResponse, AppError> {
        let mut url = self.api_base_url.clone();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| github_unavailable_error())?;
            segments.pop_if_empty();
            segments.extend(path_segments.iter().copied());
        }
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (name, value) in query {
                pairs.append_pair(name, value);
            }
        }
        let access_token = self.auth.valid_access_token().await?;
        let request = HttpRequest {
            method,
            url: url.into(),
            headers: headers(&[
                ("accept", "application/vnd.github+json"),
                ("x-github-api-version", "2026-03-10"),
                ("user-agent", concat!("OkHub/", env!("CARGO_PKG_VERSION"))),
            ]),
            access_token,
            body,
        };
        self.transport
            .send(request)
            .await
            .map_err(|_| github_unavailable_error())
    }
}

fn deserialize_response<T: DeserializeOwned>(
    response: HttpResponse,
) -> Result<T, serde_json::Error> {
    serde_json::from_slice(&response.body)
}

fn split_repository_full_name(value: &str) -> Result<(&str, &str), AppError> {
    let mut parts = value.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return Err(invalid_repository_reference());
    }
    Ok((owner, name))
}

fn parse_github_remote(value: &str) -> Result<(String, String), AppError> {
    if let Some(path) = value.strip_prefix("git@github.com:") {
        return split_remote_path(path);
    }
    let parsed = Url::parse(value).map_err(|_| invalid_repository_reference())?;
    if parsed.host_str() != Some("github.com")
        || !matches!(parsed.scheme(), "https" | "ssh")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid_repository_reference());
    }
    split_remote_path(parsed.path().trim_start_matches('/'))
}

fn split_remote_path(path: &str) -> Result<(String, String), AppError> {
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = split_repository_full_name(path)?;
    Ok((owner.to_owned(), name.to_owned()))
}

fn invalid_repository_reference() -> AppError {
    AppError::new(
        ErrorCode::RepositoryRemoteMismatch,
        "GitHub 저장소 주소가 올바르지 않습니다.",
    )
}

fn ensure_repository_identity(
    detail: GithubRepositoryDetail,
    expected_repository_id: &str,
) -> Result<GithubRepositoryDetail, AppError> {
    if detail.id != expected_repository_id {
        return Err(AppError::new(
            ErrorCode::RepositoryRemoteMismatch,
            "선택한 GitHub 저장소와 확인한 저장소가 다릅니다.",
        )
        .with_detail("expectedRepositoryId", expected_repository_id)
        .with_detail("actualRepositoryId", &detail.id)
        .with_detail("actualRepository", &detail.full_name));
    }
    Ok(detail)
}

fn draft_pull_request_invalid_response(branch: &str) -> AppError {
    AppError::new(
        ErrorCode::DraftPullRequestFailed,
        "branch는 push되었지만 Draft PR 응답을 확인하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("branch", branch)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use secrecy::SecretString;

    use super::*;
    use crate::auth::model::AccessToken;
    use crate::error::{ErrorCode, RecoveryAction};

    #[derive(Clone, Default)]
    struct SequenceTokenProvider {
        next: Arc<Mutex<usize>>,
    }

    impl SequenceTokenProvider {
        fn issued(&self) -> usize {
            *self.next.lock().unwrap()
        }
    }

    #[async_trait]
    impl AccessTokenProvider for SequenceTokenProvider {
        async fn valid_access_token(&self) -> Result<AccessToken, AppError> {
            let mut next = self.next.lock().unwrap();
            *next += 1;
            Ok(AccessToken::from_secret(SecretString::new(format!(
                "ghu_test_{}",
                *next
            ))))
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct RequestSnapshot {
        method: HttpMethod,
        url: String,
        accept: String,
        api_version: String,
        user_agent: String,
        bearer_token: String,
        body: Option<serde_json::Value>,
    }

    #[derive(Clone, Default)]
    struct RecordingTransport {
        responses: Arc<Mutex<VecDeque<Result<HttpResponse, TransportError>>>>,
        requests: Arc<Mutex<Vec<RequestSnapshot>>>,
    }

    impl RecordingTransport {
        fn with_responses(responses: Vec<HttpResponse>) -> Self {
            Self {
                responses: Arc::new(Mutex::new(
                    responses.into_iter().map(Ok).collect::<VecDeque<_>>(),
                )),
                requests: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn with_network_failure() -> Self {
            Self {
                responses: Arc::new(Mutex::new(VecDeque::from([Err(
                    TransportError::unavailable(),
                )]))),
                requests: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn requests(&self) -> Vec<RequestSnapshot> {
            self.requests.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl HttpTransport for RecordingTransport {
        async fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
            self.requests.lock().unwrap().push(RequestSnapshot {
                method: request.method(),
                url: request.url().to_owned(),
                accept: request.header("accept").unwrap().to_owned(),
                api_version: request.header("x-github-api-version").unwrap().to_owned(),
                user_agent: request.header("user-agent").unwrap().to_owned(),
                bearer_token: request.bearer_token().to_owned(),
                body: request.body().cloned(),
            });
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("test response")
        }
    }

    fn client(tokens: SequenceTokenProvider, transport: RecordingTransport) -> GithubHttpClient {
        GithubHttpClient::with_base_url(tokens, transport, "https://api.example.test/").unwrap()
    }

    fn response(status: u16, body: &str) -> HttpResponse {
        HttpResponse::new(status, headers(&[]), body.as_bytes().to_vec())
    }

    fn response_with_headers(status: u16, values: &[(&str, &str)]) -> HttpResponse {
        HttpResponse::new(status, headers(values), Vec::new())
    }

    #[test]
    fn maps_installation_repositories_to_public_summaries() {
        let response: GithubRepositoryPageResponse =
            serde_json::from_str(include_str!("fixtures/repository-page.json")).unwrap();

        let page = response.into_page(Some("installation:42:page:2".into()));
        assert_eq!(page.items[0].id, "R_kgDOExample");
        assert_eq!(page.items[0].full_name, "Mockly-Company/mockly-knowledge");
        assert_eq!(page.next_cursor.as_deref(), Some("installation:42:page:2"));
        assert!(serde_json::to_string(&page)
            .unwrap()
            .find("token")
            .is_none());
    }

    #[test]
    fn maps_a_repository_without_a_default_branch_as_empty() {
        let response: GithubRepositoryPageResponse = serde_json::from_str(
            r#"{
              "total_count": 1,
              "repositories": [{
                "id": 3001,
                "node_id": "R_empty",
                "name": "empty-knowledge",
                "full_name": "Mockly-Company/empty-knowledge",
                "private": true,
                "owner": {"login": "Mockly-Company"},
                "html_url": "https://github.com/Mockly-Company/empty-knowledge",
                "clone_url": "https://github.com/Mockly-Company/empty-knowledge.git",
                "ssh_url": "git@github.com:Mockly-Company/empty-knowledge.git",
                "default_branch": null,
                "size": 0,
                "archived": false,
                "disabled": false,
                "visibility": "private"
              }]
            }"#,
        )
        .unwrap();

        let page = response.into_page(None);
        assert!(page.items[0].is_empty);
        assert_eq!(page.items[0].default_branch, None);
    }

    #[test]
    fn authentication_installation_and_rate_limit_failures_have_stable_codes() {
        let authentication = map_http_error(HttpFailureContext::Repository, 401, &headers(&[]));
        assert_eq!(authentication.code, ErrorCode::ReauthenticationRequired);
        assert_eq!(authentication.recovery, Some(RecoveryAction::RestartLogin));

        let forbidden = map_http_error(HttpFailureContext::Installation, 403, &headers(&[]));
        assert_eq!(forbidden.code, ErrorCode::GithubPermissionDenied);
        assert_eq!(forbidden.recovery, Some(RecoveryAction::ReinstallGithubApp));

        let missing = map_http_error(HttpFailureContext::Repository, 404, &headers(&[]));
        assert_eq!(missing.code, ErrorCode::GithubPermissionDenied);

        let limited = map_http_error(
            HttpFailureContext::Repository,
            403,
            &headers(&[("x-ratelimit-remaining", "0")]),
        );
        assert_eq!(limited.code, ErrorCode::GithubUnavailable);
        assert_eq!(limited.recovery, Some(RecoveryAction::Retry));
    }

    #[test]
    fn draft_pull_request_failure_reports_only_the_pushed_branch() {
        let error = map_draft_pull_request_error(422, &headers(&[]), "okf/init-workspace");

        assert_eq!(error.code, ErrorCode::DraftPullRequestFailed);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
        assert_eq!(error.details["branch"], "okf/init-workspace");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("authorization"));
    }

    #[test]
    fn initialization_draft_pull_request_uses_the_approved_convention() {
        let mut request = DraftPullRequestRequest::initialize_workspace(
            "Mockly-Company/mockly-knowledge",
            "okf/init-workspace",
            "main",
        );
        request.title = "caller supplied title".into();
        request.body = "caller supplied body".into();
        let payload = request.payload();

        assert_eq!(payload["title"], "Initialize OkHub workspace");
        assert_eq!(payload["body"], INITIALIZATION_DRAFT_PR_BODY);
        assert_eq!(payload["head"], "okf/init-workspace");
        assert_eq!(payload["base"], "main");
        assert_eq!(payload["draft"], true);
    }

    #[test]
    fn maps_draft_pull_request_response_without_private_request_data() {
        let response: DraftPullRequestResponse = serde_json::from_str(
            r#"{
              "number": 18,
              "html_url": "https://github.com/Mockly-Company/mockly-knowledge/pull/18",
              "draft": true,
              "node_id": "PR_kwDOExample"
            }"#,
        )
        .unwrap();

        let result = response.into_public();
        assert_eq!(result.number, 18);
        assert!(result.is_draft);
        assert!(!serde_json::to_string(&result).unwrap().contains("token"));
    }

    #[test]
    fn cursor_rejects_malformed_or_zero_pages() {
        assert!(RepositoryCursor::parse("installation:42:page:2").is_ok());
        assert!(RepositoryCursor::parse("installation:42:page:0").is_err());
        assert!(RepositoryCursor::parse("page:2").is_err());
        assert!(RepositoryCursor::parse("installation:x:page:2").is_err());
    }

    #[tokio::test]
    async fn current_user_is_public_and_each_request_uses_fresh_standard_headers() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"id":1002,"login":"hyeeun","avatar_url":"https://avatars.example/hyeeun"}"#,
        )]);
        let service = client(tokens.clone(), transport.clone());

        let user = service.current_user().await.unwrap();

        assert_eq!(user.login, "hyeeun");
        assert_eq!(tokens.issued(), 1);
        let requests = transport.requests();
        assert_eq!(requests[0].method, HttpMethod::Get);
        assert_eq!(requests[0].url, "https://api.example.test/user");
        assert_eq!(requests[0].accept, "application/vnd.github+json");
        assert_eq!(requests[0].api_version, "2026-03-10");
        assert_eq!(requests[0].user_agent, "OkHub/0.1.0");
        assert_eq!(requests[0].bearer_token, "ghu_test_1");
        assert!(!serde_json::to_string(&user).unwrap().contains("ghu_test"));
    }

    #[tokio::test]
    async fn repository_listing_pages_across_accessible_installations() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![
            response(200, include_str!("fixtures/installations-page.json")),
            response(200, include_str!("fixtures/repository-page.json")),
        ]);
        let service = client(tokens.clone(), transport.clone());

        let page = service.list_repositories(None).await.unwrap();

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.next_cursor.as_deref(), Some("installation:77:page:1"));
        assert_eq!(tokens.issued(), 2);
        assert_eq!(
            transport
                .requests()
                .iter()
                .map(|request| request.url.as_str())
                .collect::<Vec<_>>(),
            vec![
                "https://api.example.test/user/installations?per_page=100&page=1",
                "https://api.example.test/user/installations/42/repositories?per_page=100&page=1",
            ]
        );
        assert_eq!(transport.requests()[0].bearer_token, "ghu_test_1");
        assert_eq!(transport.requests()[1].bearer_token, "ghu_test_2");
    }

    #[tokio::test]
    async fn repository_listing_cursor_resumes_the_installation_page() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![
            response(200, include_str!("fixtures/installations-page.json")),
            response(200, r#"{"total_count":250,"repositories":[]}"#),
        ]);
        let service = client(tokens, transport.clone());

        let page = service
            .list_repositories(Some("installation:42:page:2"))
            .await
            .unwrap();

        assert_eq!(page.next_cursor.as_deref(), Some("installation:42:page:3"));
        assert_eq!(
            transport.requests()[1].url,
            "https://api.example.test/user/installations/42/repositories?per_page=100&page=2"
        );
    }

    #[tokio::test]
    async fn repository_listing_rejects_a_cursor_page_overflow() {
        let transport = RecordingTransport::with_responses(vec![
            response(200, include_str!("fixtures/installations-page.json")),
            response(
                200,
                &format!(r#"{{"total_count":{},"repositories":[]}}"#, usize::MAX),
            ),
        ]);
        let service = client(SequenceTokenProvider::default(), transport);

        let error = service
            .list_repositories(Some(&format!("installation:42:page:{}", u32::MAX)))
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
    }

    #[tokio::test]
    async fn repository_list_request_maps_auth_permission_and_rate_limit_responses() {
        let cases = [
            (
                response_with_headers(401, &[]),
                ErrorCode::ReauthenticationRequired,
                RecoveryAction::RestartLogin,
            ),
            (
                response_with_headers(403, &[]),
                ErrorCode::GithubPermissionDenied,
                RecoveryAction::ReinstallGithubApp,
            ),
            (
                response_with_headers(404, &[]),
                ErrorCode::GithubPermissionDenied,
                RecoveryAction::ReinstallGithubApp,
            ),
            (
                response_with_headers(403, &[("x-ratelimit-remaining", "0")]),
                ErrorCode::GithubUnavailable,
                RecoveryAction::Retry,
            ),
            (
                response_with_headers(403, &[("retry-after", "60")]),
                ErrorCode::GithubUnavailable,
                RecoveryAction::Retry,
            ),
        ];

        for (response, expected_code, expected_recovery) in cases {
            let service = client(
                SequenceTokenProvider::default(),
                RecordingTransport::with_responses(vec![response]),
            );
            let error = service.list_repositories(None).await.unwrap_err();
            assert_eq!(error.code, expected_code);
            assert_eq!(error.recovery, Some(expected_recovery));
        }

        let service = client(
            SequenceTokenProvider::default(),
            RecordingTransport::with_network_failure(),
        );
        let error = service.list_repositories(None).await.unwrap_err();
        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
    }

    #[tokio::test]
    async fn repository_detail_maps_clone_information_without_credentials() {
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            &serde_json::to_string(
                &serde_json::from_str::<serde_json::Value>(include_str!(
                    "fixtures/repository-page.json"
                ))
                .unwrap()["repositories"][0],
            )
            .unwrap(),
        )]);
        let service = client(SequenceTokenProvider::default(), transport);

        let detail = service
            .repository_detail("R_kgDOExample", "Mockly-Company/mockly-knowledge")
            .await
            .unwrap();

        assert_eq!(detail.id, "R_kgDOExample");
        assert_eq!(
            detail.https_url,
            "https://github.com/Mockly-Company/mockly-knowledge.git"
        );
        assert!(!serde_json::to_string(&detail).unwrap().contains("token"));
    }

    #[tokio::test]
    async fn repository_detail_rejects_a_full_name_that_resolves_to_another_node_id() {
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{
              "id":2002,
              "node_id":"R_other",
              "name":"mockly-knowledge",
              "full_name":"Other/mockly-knowledge",
              "owner":{"login":"Other"},
              "clone_url":"https://github.com/Other/mockly-knowledge.git",
              "default_branch":"main"
            }"#,
        )]);
        let service = client(SequenceTokenProvider::default(), transport);

        let error = service
            .repository_detail("R_kgDOExample", "Mockly-Company/mockly-knowledge")
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryRemoteMismatch);
    }

    #[tokio::test]
    async fn remote_resolution_accepts_a_renamed_repository_only_by_node_id() {
        let renamed = r#"{
          "id":2001,
          "node_id":"R_kgDOExample",
          "name":"knowledge",
          "full_name":"Mockly-Company/knowledge",
          "owner":{"login":"Mockly-Company"},
          "clone_url":"https://github.com/Mockly-Company/knowledge.git",
          "default_branch":"main"
        }"#;
        let transport = RecordingTransport::with_responses(vec![response(200, renamed)]);
        let service = client(SequenceTokenProvider::default(), transport.clone());

        let detail = service
            .resolve_remote_repository(
                "git@github.com:Mockly-Company/mockly-knowledge.git",
                "R_kgDOExample",
            )
            .await
            .unwrap();

        assert_eq!(detail.full_name, "Mockly-Company/knowledge");
        assert_eq!(
            transport.requests()[0].url,
            "https://api.example.test/repos/Mockly-Company/mockly-knowledge"
        );
    }

    #[tokio::test]
    async fn remote_resolution_rejects_a_different_repository_identity() {
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{
              "id":2002,
              "node_id":"R_other",
              "name":"mockly-knowledge",
              "full_name":"Other/mockly-knowledge",
              "owner":{"login":"Other"},
              "clone_url":"https://github.com/Other/mockly-knowledge.git",
              "default_branch":"main"
            }"#,
        )]);
        let service = client(SequenceTokenProvider::default(), transport);

        let error = service
            .resolve_remote_repository(
                "https://github.com/Mockly-Company/mockly-knowledge.git",
                "R_kgDOExample",
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryRemoteMismatch);
        assert_eq!(error.details["expectedRepositoryId"], "R_kgDOExample");
        assert_eq!(error.details["actualRepositoryId"], "R_other");
    }

    #[tokio::test]
    async fn create_draft_pull_request_sends_the_fixed_payload_and_maps_result() {
        let transport = RecordingTransport::with_responses(vec![response(
            201,
            r#"{"number":18,"html_url":"https://github.com/Mockly-Company/mockly-knowledge/pull/18","draft":true}"#,
        )]);
        let service = client(SequenceTokenProvider::default(), transport.clone());
        let request = DraftPullRequestRequest::initialize_workspace(
            "Mockly-Company/mockly-knowledge",
            "okf/init-workspace",
            "main",
        );

        let pull_request = service.create_draft_pull_request(&request).await.unwrap();

        assert_eq!(pull_request.number, 18);
        let sent = &transport.requests()[0];
        assert_eq!(sent.method, HttpMethod::Post);
        assert_eq!(
            sent.url,
            "https://api.example.test/repos/Mockly-Company/mockly-knowledge/pulls"
        );
        assert_eq!(
            sent.body.as_ref().unwrap()["title"],
            "Initialize OkHub workspace"
        );
        assert_eq!(
            sent.body.as_ref().unwrap()["body"],
            INITIALIZATION_DRAFT_PR_BODY
        );
        assert_eq!(sent.body.as_ref().unwrap()["draft"], true);
    }

    #[tokio::test]
    async fn finds_an_existing_open_initialization_pull_request_without_posting() {
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"[{"number":18,"html_url":"https://github.com/Mockly-Company/mockly-knowledge/pull/18","draft":true}]"#,
        )]);
        let service = client(SequenceTokenProvider::default(), transport.clone());
        let request = DraftPullRequestRequest::initialize_workspace(
            "Mockly-Company/mockly-knowledge",
            "okf/init-workspace",
            "main",
        );

        let pull_request = service
            .find_open_pull_request(&request)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(pull_request.number, 18);
        let sent = &transport.requests()[0];
        assert_eq!(sent.method, HttpMethod::Get);
        assert_eq!(
            sent.url,
            "https://api.example.test/repos/Mockly-Company/mockly-knowledge/pulls?state=open&head=Mockly-Company%3Aokf%2Finit-workspace&base=main"
        );
        assert!(sent.body.is_none());
    }

    #[tokio::test]
    async fn draft_pull_request_maps_every_post_push_failure_and_preserves_the_branch() {
        let cases = [
            (
                response_with_headers(401, &[]),
                ErrorCode::ReauthenticationRequired,
                RecoveryAction::RestartLogin,
            ),
            (
                response_with_headers(403, &[]),
                ErrorCode::GithubPermissionDenied,
                RecoveryAction::ReinstallGithubApp,
            ),
            (
                response_with_headers(404, &[]),
                ErrorCode::GithubPermissionDenied,
                RecoveryAction::ReinstallGithubApp,
            ),
            (
                response_with_headers(403, &[("x-ratelimit-remaining", "0")]),
                ErrorCode::GithubUnavailable,
                RecoveryAction::Retry,
            ),
            (
                response_with_headers(403, &[("retry-after", "60")]),
                ErrorCode::GithubUnavailable,
                RecoveryAction::Retry,
            ),
            (
                response_with_headers(422, &[]),
                ErrorCode::DraftPullRequestFailed,
                RecoveryAction::Retry,
            ),
        ];
        let request = DraftPullRequestRequest::initialize_workspace(
            "Mockly-Company/mockly-knowledge",
            "okf/init-workspace",
            "main",
        );

        for (response, expected_code, expected_recovery) in cases {
            let service = client(
                SequenceTokenProvider::default(),
                RecordingTransport::with_responses(vec![response]),
            );
            let error = service
                .create_draft_pull_request(&request)
                .await
                .unwrap_err();
            assert_eq!(error.code, expected_code);
            assert_eq!(error.recovery, Some(expected_recovery));
            assert_eq!(error.details["branch"], "okf/init-workspace");
        }

        let service = client(
            SequenceTokenProvider::default(),
            RecordingTransport::with_network_failure(),
        );
        let error = service
            .create_draft_pull_request(&request)
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
        assert_eq!(error.details["branch"], "okf/init-workspace");
    }

    #[tokio::test]
    async fn malformed_draft_pull_request_repository_preserves_the_pushed_branch() {
        let service = client(
            SequenceTokenProvider::default(),
            RecordingTransport::default(),
        );
        let request = DraftPullRequestRequest {
            repository_full_name: "missing-owner-or-name".into(),
            head: "okf/init-workspace".into(),
            base: "main".into(),
            title: "ignored caller title".into(),
            body: "ignored caller body".into(),
        };

        let error = service
            .create_draft_pull_request(&request)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepositoryRemoteMismatch);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
        assert_eq!(error.details["branch"], "okf/init-workspace");
    }

    #[tokio::test]
    async fn transport_failure_is_publicly_retryable_without_transport_details() {
        let service = client(
            SequenceTokenProvider::default(),
            RecordingTransport::with_network_failure(),
        );

        let error = service.current_user().await.unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
        assert_eq!(error.recovery, Some(RecoveryAction::Retry));
        assert!(error.details.is_empty());
    }
}
