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
    DraftPullRequest, DraftPullRequestRequest, GithubProjectListItem, GithubProjectSummary,
    GithubRepositoryDetail, GithubRepositorySummary, Page,
};
use crate::project_board::model::ProjectOwnerScope;

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
struct GithubProjectLookupResponse {
    data: Option<GithubProjectLookupData>,
    errors: Option<Vec<GithubProjectLookupError>>,
}

#[derive(Deserialize)]
struct GithubProjectLookupData {
    organization: Option<GithubProjectOwnerResponse>,
    user: Option<GithubProjectOwnerResponse>,
}

#[derive(Deserialize)]
struct GithubProjectOwnerResponse {
    #[serde(rename = "projectV2")]
    project_v2: Option<GithubProjectV2Response>,
}

#[derive(Deserialize)]
struct GithubProjectsListResponse {
    data: Option<GithubProjectsListData>,
    errors: Option<Vec<GithubProjectLookupError>>,
}

#[derive(Deserialize)]
struct GithubProjectsListData {
    viewer: Option<GithubProjectsViewer>,
}

#[derive(Deserialize)]
struct GithubProjectsViewer {
    login: Option<String>,
    organizations: Option<GithubOrganizationConnection>,
    #[serde(rename = "projectsV2")]
    projects_v2: Option<GithubProjectV2Connection>,
}

#[derive(Deserialize)]
struct GithubOrganizationConnection {
    #[serde(rename = "pageInfo", default)]
    page_info: Option<GithubProjectPageInfo>,
    #[serde(default)]
    nodes: Vec<Option<GithubOrganizationNode>>,
}

#[derive(Deserialize)]
struct GithubOrganizationNode {
    login: Option<String>,
    #[serde(rename = "projectsV2")]
    projects_v2: Option<GithubProjectV2Connection>,
}

#[derive(Deserialize)]
struct GithubProjectV2Connection {
    #[serde(rename = "pageInfo", default)]
    page_info: Option<GithubProjectPageInfo>,
    #[serde(default)]
    nodes: Vec<Option<GithubProjectV2ListItem>>,
}

#[derive(Deserialize)]
struct GithubProjectV2ListItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    number: i64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    closed: bool,
}

#[derive(Deserialize)]
struct GithubProjectV2Response {
    id: String,
    title: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubProjectItem {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub labels: Vec<String>,
    pub status: Option<String>,
    pub area: Option<String>,
}

#[derive(Deserialize)]
struct GithubProjectItemsResponse {
    data: Option<GithubProjectItemsData>,
    errors: Option<Vec<GithubProjectLookupError>>,
}

#[derive(Deserialize)]
struct GithubProjectItemsData {
    organization: Option<GithubProjectItemsOwner>,
    user: Option<GithubProjectItemsOwner>,
}

#[derive(Deserialize)]
struct GithubProjectItemsOwner {
    #[serde(rename = "projectV2")]
    project_v2: Option<GithubProjectV2Items>,
}

#[derive(Deserialize)]
struct GithubProjectV2Items {
    items: Option<GithubProjectItemsConnection>,
}

#[derive(Deserialize)]
struct GithubProjectItemsConnection {
    #[serde(rename = "pageInfo", default)]
    page_info: Option<GithubProjectPageInfo>,
    #[serde(default)]
    nodes: Vec<Option<GithubProjectItemNode>>,
}

#[derive(Deserialize)]
struct GithubProjectPageInfo {
    #[serde(rename = "hasNextPage", default)]
    has_next_page: bool,
    #[serde(rename = "endCursor", default)]
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
struct GithubProjectItemNode {
    content: Option<GithubProjectItemContent>,
    #[serde(rename = "fieldValues", default)]
    field_values: Option<GithubProjectFieldValues>,
}

#[derive(Deserialize)]
struct GithubProjectItemContent {
    #[serde(rename = "__typename")]
    kind: String,
    number: Option<u64>,
    title: Option<String>,
    url: Option<String>,
    labels: Option<GithubProjectLabelConnection>,
}

#[derive(Deserialize)]
struct GithubProjectLabelConnection {
    #[serde(default)]
    nodes: Vec<Option<GithubProjectLabel>>,
}

#[derive(Deserialize)]
struct GithubProjectLabel {
    name: String,
}

#[derive(Deserialize)]
struct GithubProjectFieldValues {
    #[serde(default)]
    nodes: Vec<Option<GithubProjectFieldValue>>,
}

#[derive(Deserialize)]
struct GithubProjectFieldValue {
    #[serde(rename = "__typename")]
    kind: String,
    name: Option<String>,
    field: Option<GithubProjectFieldName>,
}

#[derive(Deserialize)]
struct GithubProjectFieldName {
    name: Option<String>,
}

#[derive(Deserialize)]
struct GithubProjectLookupError {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    message: String,
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
struct GithubErrorResponse {
    message: String,
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

fn map_project_error(status: u16) -> AppError {
    if status == 401 {
        return AppError::new(
            ErrorCode::ReauthenticationRequired,
            "GitHub에 다시 로그인해 주세요.",
        )
        .with_recovery(RecoveryAction::RestartLogin);
    }
    if matches!(status, 403 | 404) {
        return project_permission_error();
    }
    github_unavailable_error()
}

fn map_project_lookup_errors(errors: &[GithubProjectLookupError]) -> AppError {
    let forbidden = errors.iter().any(|error| {
        error.kind.as_deref() == Some("FORBIDDEN")
            || error.message.contains("INSUFFICIENT_SCOPES")
            || error.message.contains("FORBIDDEN")
    });
    if forbidden {
        return project_permission_error();
    }
    let detail = errors
        .first()
        .map(|error| error.message.as_str())
        .unwrap_or("unknown GraphQL error");
    AppError::new(
        ErrorCode::GithubUnavailable,
        "GitHub 요청을 처리하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
    .with_detail("reason", detail.to_owned())
}

fn project_permission_error() -> AppError {
    AppError::new(
        ErrorCode::GithubPermissionDenied,
        "GitHub에서 프로젝트 정보를 읽을 권한이 없습니다.",
    )
    .with_recovery(RecoveryAction::ReinstallGithubApp)
}

fn project_items_query(root: &str) -> String {
    format!(
        "query($login:String!,$number:Int!,$after:String){{{root}(login:$login){{projectV2(number:$number){{items(first:100,after:$after){{pageInfo{{hasNextPage endCursor}}nodes{{content{{__typename ... on Issue{{number title url labels(first:100){{nodes{{name}}}}}} ... on PullRequest{{number title url labels(first:100){{nodes{{name}}}}}}}}fieldValues(first:100){{nodes{{__typename ... on ProjectV2ItemFieldSingleSelectValue{{name field{{... on ProjectV2SingleSelectField{{name}}}}}}}}}}}}}}}}}}}}",
    )
}

fn project_not_found_error() -> AppError {
    AppError::new(
        ErrorCode::GithubPermissionDenied,
        "해당 GitHub Project를 찾을 수 없습니다. URL의 번호를 확인하고, GitHub App에 Projects 읽기 권한이 있는지 확인해 주세요.",
    )
    .with_recovery(RecoveryAction::ReinstallGithubApp)
    .with_detail("reason", "project_not_found")
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
#[allow(
    clippy::double_must_use,
    reason = "async_trait adds must_use to its boxed Future return type"
)]
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
#[allow(
    clippy::double_must_use,
    reason = "async_trait adds must_use to its boxed Future return type"
)]
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
        let mut detail =
            ensure_repository_identity(response.into_detail(), expected_repository_id)?;
        if detail.default_branch.is_some() {
            detail.is_empty = self.repository_is_empty(owner, name).await?;
        }
        Ok(detail)
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

    pub async fn resolve_project(
        &self,
        owner_scope: ProjectOwnerScope,
        owner: &str,
        number: u64,
    ) -> Result<GithubProjectSummary, AppError> {
        let root = match owner_scope {
            ProjectOwnerScope::Organization => "organization",
            ProjectOwnerScope::User => "user",
        };
        let query = format!(
            "query($login:String!,$number:Int!){{{root}(login:$login){{projectV2(number:$number){{id title}}}}}}"
        );
        let response = self
            .send(
                HttpMethod::Post,
                &["graphql"],
                &[],
                Some(serde_json::json!({
                    "query": query,
                    "variables": { "login": owner, "number": number },
                })),
            )
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(map_project_error(response.status));
        }
        let body: GithubProjectLookupResponse =
            deserialize_response(response).map_err(|_| github_unavailable_error())?;
        if let Some(errors) = body.errors.filter(|errors| !errors.is_empty()) {
            return Err(map_project_lookup_errors(&errors));
        }
        let project = match owner_scope {
            ProjectOwnerScope::Organization => body.data.and_then(|data| data.organization),
            ProjectOwnerScope::User => body.data.and_then(|data| data.user),
        }
        .and_then(|owner| owner.project_v2)
        .ok_or_else(project_not_found_error)?;
        Ok(GithubProjectSummary {
            id: project.id,
            owner: owner.to_owned(),
            number,
            title: project.title,
        })
    }

    /// 프로젝트 보드 동기화용으로 Issue/PR 목록을 가져온다.
    /// `Status` 단일 선택 필드 값과 `layer:*` 라벨을 함께 반환한다.
    /// 두 번째 값은 페이지 상한(5페이지)에 걸려 잘렸는지, 세 번째 값은
    /// 내용이 없어 버린 항목 수다.
    pub async fn list_project_items(
        &self,
        owner_scope: ProjectOwnerScope,
        owner: &str,
        number: u64,
    ) -> Result<(Vec<GithubProjectItem>, bool, u32), AppError> {
        let root = match owner_scope {
            ProjectOwnerScope::Organization => "organization",
            ProjectOwnerScope::User => "user",
        };
        let mut items = Vec::new();
        let mut dropped = 0u32;
        let mut after: Option<String> = None;
        let query = project_items_query(root);
        for _ in 0..5 {
            let mut variables = serde_json::Map::new();
            variables.insert("login".to_owned(), serde_json::Value::from(owner));
            variables.insert("number".to_owned(), serde_json::Value::from(number));
            if let Some(cursor) = after.as_deref() {
                // `after: null`을 명시하면 GitHub이 커서 오류로 전체 요청을
                // 거부하므로, 첫 페이지는 키 자체를 빼고 보낸다.
                variables.insert("after".to_owned(), serde_json::Value::from(cursor));
            }
            let response = self
                .send(
                    HttpMethod::Post,
                    &["graphql"],
                    &[],
                    Some(serde_json::json!({
                        "query": query,
                        "variables": variables,
                    })),
                )
                .await?;
            if !(200..300).contains(&response.status) {
                return Err(map_project_error(response.status));
            }
            let body: GithubProjectItemsResponse =
                deserialize_response(response).map_err(|_| github_unavailable_error())?;
            if let Some(errors) = body.errors.filter(|errors| !errors.is_empty()) {
                return Err(map_project_lookup_errors(&errors));
            }
            let connection = match owner_scope {
                ProjectOwnerScope::Organization => body.data.and_then(|data| data.organization),
                ProjectOwnerScope::User => body.data.and_then(|data| data.user),
            }
            .and_then(|owner| owner.project_v2)
            .and_then(|project| project.items)
            .ok_or_else(project_not_found_error)?;
            for node in connection.nodes.into_iter().flatten() {
                let Some(content) = node.content else {
                    dropped += 1;
                    continue;
                };
                if content.kind != "Issue" && content.kind != "PullRequest" {
                    dropped += 1;
                    continue;
                }
                let (Some(number), Some(title), Some(url)) =
                    (content.number, content.title, content.url)
                else {
                    dropped += 1;
                    continue;
                };
                let labels = content
                    .labels
                    .map(|connection| {
                        connection
                            .nodes
                            .into_iter()
                            .flatten()
                            .map(|label| label.name)
                            .collect()
                    })
                    .unwrap_or_default();
                let single_selects = node
                    .field_values
                    .map(|fields| fields.nodes)
                    .unwrap_or_default()
                    .into_iter()
                    .flatten()
                    .filter(|value| value.kind == "ProjectV2ItemFieldSingleSelectValue")
                    .filter_map(|value| value.field.and_then(|field| field.name.zip(value.name)))
                    .collect::<Vec<_>>();
                let status = single_selects
                    .iter()
                    .find(|(field, _)| field == "Status")
                    .map(|(_, name)| name.clone());
                let area = single_selects
                    .iter()
                    .find(|(field, _)| field == "영역")
                    .map(|(_, name)| name.clone());
                items.push(GithubProjectItem {
                    number,
                    title,
                    url,
                    labels,
                    status,
                    area,
                });
            }
            // 5페이지·500개를 넘기면 나머지는 버린다. 잘림·누락 수는 호출자가 노출한다.
            match connection.page_info {
                Some(page) if page.has_next_page => match page.end_cursor {
                    Some(cursor) => after = Some(cursor),
                    None => return Ok((items, true, dropped)),
                },
                _ => return Ok((items, false, dropped)),
            }
        }
        Ok((items, true, dropped))
    }

    /// 연결된 계정이 볼 수 있는 Projects v2 목록을 가져온다.
    /// 조직 프로젝트와 개인 프로젝트를 합쳐서 반환한다.
    pub async fn list_projects(&self) -> Result<(Vec<GithubProjectListItem>, bool), AppError> {
        // 목록 조회용: 조직 최대 20개, 조직·개인별 Project 최대 100개까지만 읽는다
        // (연결 후보 선택용이라 페이지네이션하지 않는다). 닫힌 프로젝트는
        // 후보에서 제외한다. 잘림 여부는 bool로 함께 반환한다.
        let query = "query{viewer{login organizations(first:20){pageInfo{hasNextPage}nodes{login projectsV2(first:100){pageInfo{hasNextPage}nodes{id number title closed}}}} projectsV2(first:100){pageInfo{hasNextPage}nodes{id number title closed}}}}";
        let response = self
            .send(
                HttpMethod::Post,
                &["graphql"],
                &[],
                Some(serde_json::json!({ "query": query })),
            )
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(map_project_error(response.status));
        }
        let body: GithubProjectsListResponse =
            deserialize_response(response).map_err(|_| github_unavailable_error())?;
        if let Some(errors) = body.errors.filter(|errors| !errors.is_empty()) {
            return Err(map_project_lookup_errors(&errors));
        }
        let mut projects = Vec::new();
        let mut truncated = false;
        if let Some(viewer) = body.data.and_then(|data| data.viewer) {
            truncated = viewer
                .organizations
                .as_ref()
                .and_then(|connection| connection.page_info.as_ref())
                .map(|page| page.has_next_page)
                .unwrap_or(false);
            truncated = truncated
                || viewer
                    .projects_v2
                    .as_ref()
                    .and_then(|connection| connection.page_info.as_ref())
                    .map(|page| page.has_next_page)
                    .unwrap_or(false);
            for org in viewer
                .organizations
                .into_iter()
                .flat_map(|connection| connection.nodes)
                .flatten()
            {
                let owner = org.login.unwrap_or_default();
                if owner.is_empty() {
                    continue;
                }
                if org
                    .projects_v2
                    .as_ref()
                    .and_then(|connection| connection.page_info.as_ref())
                    .map(|page| page.has_next_page)
                    .unwrap_or(false)
                {
                    truncated = true;
                }
                for node in org
                    .projects_v2
                    .into_iter()
                    .flat_map(|connection| connection.nodes)
                    .flatten()
                {
                    if node.closed
                        || node.id.is_empty()
                        || node.title.is_empty()
                        || node.number <= 0
                    {
                        continue;
                    }
                    projects.push(GithubProjectListItem {
                        id: node.id,
                        owner: owner.clone(),
                        number: node.number.max(0) as u64,
                        title: node.title,
                        closed: node.closed,
                        organization: true,
                    });
                }
            }
            let login = viewer.login.unwrap_or_default();
            if login.is_empty() {
                return Ok((projects, truncated));
            }
            if viewer
                .projects_v2
                .as_ref()
                .and_then(|connection| connection.page_info.as_ref())
                .map(|page| page.has_next_page)
                .unwrap_or(false)
            {
                truncated = true;
            }
            for node in viewer
                .projects_v2
                .into_iter()
                .flat_map(|connection| connection.nodes)
                .flatten()
            {
                if node.closed || node.id.is_empty() || node.title.is_empty() || node.number <= 0 {
                    continue;
                }
                projects.push(GithubProjectListItem {
                    id: node.id,
                    owner: login.clone(),
                    number: node.number.max(0) as u64,
                    title: node.title,
                    closed: node.closed,
                    organization: false,
                });
            }
        }
        Ok((projects, truncated))
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

    async fn repository_is_empty(&self, owner: &str, name: &str) -> Result<bool, AppError> {
        let response = self
            .send(
                HttpMethod::Get,
                &["repos", owner, name, "contents"],
                &[],
                None,
            )
            .await?;
        if (200..300).contains(&response.status) {
            return Ok(false);
        }
        if response.status == 404 && is_empty_repository_response(&response.body) {
            return Ok(true);
        }
        Err(map_http_error(
            HttpFailureContext::Repository,
            response.status,
            &response.headers,
        ))
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

fn is_empty_repository_response(body: &[u8]) -> bool {
    serde_json::from_slice::<GithubErrorResponse>(body)
        .is_ok_and(|response| response.message == "This repository is empty.")
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
    async fn project_lookup_posts_graphql_and_returns_the_node_id() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"organization":{"projectV2":{"id":"PVT_kwDOExample","title":"Mockly Board"}}}}"#,
        )]);
        let service = client(tokens, transport.clone());

        let project = service
            .resolve_project(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap();

        assert_eq!(project.id, "PVT_kwDOExample");
        assert_eq!(project.owner, "Mockly-Company");
        assert_eq!(project.number, 1);
        assert_eq!(project.title, "Mockly Board");
        assert!(!serde_json::to_string(&project)
            .unwrap()
            .contains("ghu_test"));
        let sent = &transport.requests()[0];
        assert_eq!(sent.method, HttpMethod::Post);
        assert_eq!(sent.url, "https://api.example.test/graphql");
        assert!(sent
            .body
            .as_ref()
            .unwrap()
            .to_string()
            .contains("projectV2"));
    }

    #[tokio::test]
    async fn project_lookup_scope_errors_ask_for_reinstallation() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":null,"errors":[{"type":"FORBIDDEN","message":"INSUFFICIENT_SCOPES"}]}"#,
        )]);
        let service = client(tokens, transport);

        let error = service
            .resolve_project(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubPermissionDenied);
        assert_eq!(error.recovery, Some(RecoveryAction::ReinstallGithubApp));
    }

    #[tokio::test]
    async fn project_lookup_unrelated_scope_mention_is_not_a_permission_error() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":null,"errors":[{"type":"INTERNAL","message":"telescope query exceeded scopes limit"}]}"#,
        )]);
        let service = client(tokens, transport);

        let error = service
            .resolve_project(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
    }

    #[tokio::test]
    async fn project_lookup_empty_errors_do_not_fail() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"organization":{"projectV2":{"id":"PVT_kwDOExample","number":1,"title":"Mockly"}}},"errors":[]}"#,
        )]);
        let service = client(tokens, transport);

        let summary = service
            .resolve_project(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap();

        assert_eq!(summary.id, "PVT_kwDOExample");
    }

    #[tokio::test]
    async fn project_lookup_missing_project_is_not_found() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"organization":{"projectV2":null}}}"#,
        )]);
        let service = client(tokens, transport);

        let error = service
            .resolve_project(ProjectOwnerScope::Organization, "Mockly-Company", 9)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubPermissionDenied);
        assert_eq!(error.recovery, Some(RecoveryAction::ReinstallGithubApp));
    }

    #[tokio::test]
    async fn project_lookup_surfaces_unexpected_graphql_errors() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":null,"errors":[{"type":"ARGUMENT_ERROR","message":"after does not appear to be a valid cursor"}]}"#,
        )]);
        let service = client(tokens, transport);

        let error = service
            .list_project_items(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubUnavailable);
    }

    #[test]
    fn project_items_query_is_balanced_graphql() {
        for root in ["organization", "user"] {
            let query = super::project_items_query(root);
            assert_eq!(
                query.matches('{').count(),
                query.matches('}').count(),
                "unbalanced braces in project items query"
            );
            assert!(query.contains("projectV2(number:$number)"));
            assert!(query.contains("after:$after"));
        }
    }

    #[tokio::test]
    async fn project_items_report_truncation_at_page_cap() {
        let page = |cursor: &str| {
            response(
                200,
                &format!(
                    r#"{{"data":{{"organization":{{"projectV2":{{"items":{{"pageInfo":{{"hasNextPage":true,"endCursor":"{cursor}"}},"nodes":[{{"content":{{"__typename":"Issue","number":1,"title":"t","url":"https://example.test/issues/1","labels":{{"nodes":[]}}}},"fieldValues":{{"nodes":[]}}}}]}}}}}}}}}}"#,
                ),
            )
        };
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![
            page("c1"),
            page("c2"),
            page("c3"),
            page("c4"),
            page("c5"),
        ]);
        let service = client(tokens, transport.clone());

        let (items, truncated, dropped) = service
            .list_project_items(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap();

        assert!(truncated);
        assert_eq!(dropped, 0);
        assert_eq!(items.len(), 5);
        assert_eq!(transport.requests().len(), 5);
    }

    #[tokio::test]
    async fn project_items_come_with_status_and_labels_across_pages() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![
            response(
                200,
                r#"{"data":{"organization":{"projectV2":{"items":{"pageInfo":{"hasNextPage":true,"endCursor":"cursor-1"},"nodes":[{"content":{"__typename":"Issue","number":12,"title":"기획서 초안","url":"https://example.test/issues/12","labels":{"nodes":[{"name":"layer:planning"}]}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"In progress","field":{"name":"Status"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"백엔드","field":{"name":"영역"}}]}},{"content":{"__typename":"PullRequest","number":34,"title":"홈 화면 시안","url":"https://example.test/pulls/34","labels":{"nodes":[]}},"fieldValues":null}]}}}}}"#,
            ),
            response(
                200,
                r#"{"data":{"organization":{"projectV2":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"content":{"__typename":"DraftIssue"},"fieldValues":{"nodes":[]}}]}}}}}"#,
            ),
        ]);
        let service = client(tokens, transport.clone());

        let (items, truncated, dropped) = service
            .list_project_items(ProjectOwnerScope::Organization, "Mockly-Company", 1)
            .await
            .unwrap();

        assert!(!truncated);
        assert_eq!(dropped, 1);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].number, 12);
        assert_eq!(items[0].labels, vec!["layer:planning"]);
        assert_eq!(items[0].status.as_deref(), Some("In progress"));
        assert_eq!(items[0].area.as_deref(), Some("백엔드"));
        assert_eq!(items[1].number, 34);
        assert!(items[1].status.is_none());
        let bodies: Vec<_> = transport
            .requests()
            .iter()
            .map(|request| request.body.clone().unwrap().to_string())
            .collect();
        assert_eq!(bodies.len(), 2);
        assert!(!bodies[0].contains("\"after\""));
        assert!(bodies[1].contains("\"after\":\"cursor-1\""));
    }

    #[tokio::test]
    async fn project_listing_combines_organization_and_user_projects() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"viewer":{"login":"hyeeun","organizations":{"nodes":[{"login":"Mockly-Company","projectsV2":{"nodes":[{"id":"PVT_kwDOExample","number":1,"title":"Mockly","closed":false}]}}]},"projectsV2":{"nodes":[{"id":"PVT_kwDOUser","number":3,"title":"개인 정리","closed":true}]}}}}"#,
        )]);
        let service = client(tokens, transport.clone());

        let (projects, truncated) = service.list_projects().await.unwrap();

        assert!(!truncated);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, "PVT_kwDOExample");
        assert_eq!(projects[0].owner, "Mockly-Company");
        assert_eq!(projects[0].number, 1);
        assert!(!projects[0].closed);
        assert!(projects[0].organization);
        assert_eq!(
            transport.requests()[0].url,
            "https://api.example.test/graphql"
        );
    }

    #[tokio::test]
    async fn project_listing_skips_empty_login_and_closed_projects() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"viewer":{"login":null,"organizations":{"nodes":[]},"projectsV2":{"nodes":[{"id":"PVT_kwDOUser","number":3,"title":"개인 정리","closed":false}]}}}}"#,
        )]);
        let service = client(tokens, transport.clone());

        let (projects, truncated) = service.list_projects().await.unwrap();

        assert!(!truncated);
        assert!(projects.is_empty());
    }

    #[tokio::test]
    async fn project_listing_tolerates_null_nodes_and_missing_fields() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"viewer":{"login":"hyeeun","organizations":{"nodes":[null,{"login":"Mockly-Company","projectsV2":{"nodes":[null,{"id":"","number":0,"title":"","closed":false},{"id":"PVT_kwDOExample","number":1,"closed":true},{"id":"PVT_kwDOValid","number":2,"title":"유효","closed":false}]}}]},"projectsV2":{"nodes":[]}}}}"#,
        )]);
        let service = client(tokens, transport.clone());

        let (projects, truncated) = service.list_projects().await.unwrap();

        assert!(!truncated);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, "PVT_kwDOValid");
    }

    #[tokio::test]
    async fn project_listing_reports_truncation() {
        let tokens = SequenceTokenProvider::default();
        let transport = RecordingTransport::with_responses(vec![response(
            200,
            r#"{"data":{"viewer":{"login":"hyeeun","organizations":{"nodes":[]},"projectsV2":{"pageInfo":{"hasNextPage":true},"nodes":[]}}}}"#,
        )]);
        let service = client(tokens, transport.clone());

        let (projects, truncated) = service.list_projects().await.unwrap();

        assert!(truncated);
        assert!(projects.is_empty());
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
        let transport = RecordingTransport::with_responses(vec![
            response(
                200,
                &serde_json::to_string(
                    &serde_json::from_str::<serde_json::Value>(include_str!(
                        "fixtures/repository-page.json"
                    ))
                    .unwrap()["repositories"][0],
                )
                .unwrap(),
            ),
            response(200, r#"[{"name":"README.md"}]"#),
        ]);
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
        assert!(!detail.is_empty);
        assert!(!serde_json::to_string(&detail).unwrap().contains("token"));
    }

    #[tokio::test]
    async fn repository_detail_detects_an_empty_repository_even_with_a_default_branch_name() {
        let repository = r#"{
          "id":2001,
          "node_id":"R_kgDOExample",
          "name":"okhub-empty-test",
          "full_name":"Mockly-Company/okhub-empty-test",
          "owner":{"login":"Mockly-Company"},
          "clone_url":"https://github.com/Mockly-Company/okhub-empty-test.git",
          "default_branch":"main"
        }"#;
        let transport = RecordingTransport::with_responses(vec![
            response(200, repository),
            response(404, r#"{"message":"This repository is empty."}"#),
        ]);
        let service = client(SequenceTokenProvider::default(), transport);

        let detail = service
            .repository_detail("R_kgDOExample", "Mockly-Company/okhub-empty-test")
            .await
            .unwrap();

        assert!(detail.is_empty);
        assert_eq!(detail.default_branch.as_deref(), Some("main"));
    }

    #[tokio::test]
    async fn repository_detail_does_not_treat_a_generic_not_found_response_as_empty() {
        let repository = r#"{
          "id":2001,
          "node_id":"R_kgDOExample",
          "name":"mockly-knowledge",
          "full_name":"Mockly-Company/mockly-knowledge",
          "owner":{"login":"Mockly-Company"},
          "clone_url":"https://github.com/Mockly-Company/mockly-knowledge.git",
          "default_branch":"main"
        }"#;
        let transport = RecordingTransport::with_responses(vec![
            response(200, repository),
            response(404, r#"{"message":"Not Found"}"#),
        ]);
        let service = client(SequenceTokenProvider::default(), transport);

        let error = service
            .repository_detail("R_kgDOExample", "Mockly-Company/mockly-knowledge")
            .await
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GithubPermissionDenied);
        assert_eq!(error.recovery, Some(RecoveryAction::ReinstallGithubApp));
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
