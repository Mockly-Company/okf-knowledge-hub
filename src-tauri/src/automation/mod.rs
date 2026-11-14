pub mod cli;
pub mod context_pack;
pub mod doc_validator;
pub mod mcp;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{Arc, Mutex};

use secrecy::SecretString;
use serde::Serialize;

use crate::auth::keyring_store::KeyringCredentialStore;
use crate::auth::ports::{NoopAuthEvents, SystemClock, TokioDelay};
use crate::auth::reqwest_api::ReqwestDeviceFlowApi;
use crate::auth::service::AuthService;
use crate::automation::context_pack::{
    assemble_issue_context_pack, compute_ready_board_items, map_item_layer, map_item_status,
    IssueContextPack, ReadyBoardItem,
};
use crate::automation::doc_validator::{
    list_workspace_docs, read_workspace_doc, validate_workspace_docs, AutomationDocDetail,
    AutomationDocEntry, DocValidationReport,
};
use crate::commands::code_repositories::resolve_code_repositories_for_workspace;
use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::github::model::{
    CreateProjectIssueInput, CreatePullRequestInput, CreatedProjectIssue, DocsPullRequestSummary,
    GithubProjectItem, UpdateProjectItemInput, UpdatedProjectItem,
};
use crate::github::GithubService;
use crate::project_board::model::{parse_project_url, BoardLayer, BoardStatus, ProjectOwnerScope};
use crate::repository::managed::managed_clone_dir;
use crate::settings::ai_runner::{
    ActiveProjectRuleInfo, ActiveWorkspaceAiContext, LinkedCodeRepoRuleInfo,
};
use crate::settings::service::{LocalSettingsService, LocalSettingsStore, DISPLAY_DENSITY_KEY};
use crate::settings::store_adapter::SETTINGS_FILE_NAME;
use crate::workspace::model::WorkspaceConfigV1;

const APP_IDENTIFIER: &str = "com.okhub.desktop";

#[derive(Debug, Clone, Default)]
pub struct AutomationOverrides {
    pub app_data_dir: Option<PathBuf>,
    pub workspace_dir: Option<PathBuf>,
    pub docs_repo: Option<String>,
    pub project_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAutomationContextSummary {
    pub app_data_dir: String,
    pub workspace_dir: Option<String>,
    pub docs_root: String,
    pub workspace_title: Option<String>,
    pub docs_repository_full_name: Option<String>,
    pub project: Option<AutomationProjectSummary>,
    pub code_repositories: Vec<AutomationCodeRepoSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationProjectSummary {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub scope: ProjectOwnerScope,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationCodeRepoSummary {
    pub key: String,
    pub label: String,
    pub full_name: String,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveMergeOutcome {
    pub number: u64,
    pub repository_full_name: String,
    pub approved: bool,
    pub merged: bool,
    pub merge_commit_sha: Option<String>,
}

pub struct JsonFileSettingsStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl JsonFileSettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    fn read_map(&self) -> Result<BTreeMap<String, serde_json::Value>, AppError> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = fs::read_to_string(&self.path).map_err(|err| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "OkHub 로컬 설정 파일을 읽을 수 없습니다.",
            )
            .with_detail("reason", err.to_string())
        })?;
        if raw.trim().is_empty() {
            return Ok(BTreeMap::new());
        }
        serde_json::from_str(&raw).map_err(|err| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "OkHub 로컬 설정 JSON 형식이 올바르지 않습니다.",
            )
            .with_detail("reason", err.to_string())
        })
    }

    fn write_map(&self, map: &BTreeMap<String, serde_json::Value>) -> Result<(), AppError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "로컬 설정 폴더를 생성할 수 없습니다.",
                )
                .with_detail("reason", err.to_string())
            })?;
        }
        let encoded = serde_json::to_string_pretty(map).map_err(|err| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "로컬 설정을 직렬화할 수 없습니다.",
            )
            .with_detail("reason", err.to_string())
        })?;
        fs::write(&self.path, encoded).map_err(|err| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "로컬 설정 파일을 저장할 수 없습니다.",
            )
            .with_detail("reason", err.to_string())
        })
    }
}

impl LocalSettingsStore for JsonFileSettingsStore {
    fn read(&self, key: &str) -> Result<Option<String>, AppError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let map = self.read_map()?;
        match map.get(key) {
            None => Ok(None),
            Some(serde_json::Value::String(value)) => Ok(Some(value.clone())),
            Some(_) if key == DISPLAY_DENSITY_KEY => Ok(None),
            Some(_) => Ok(None),
        }
    }

    fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut map = self.read_map()?;
        map.insert(key.to_owned(), serde_json::Value::String(value.to_owned()));
        self.write_map(&map)
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut map = self.read_map()?;
        map.remove(key);
        self.write_map(&map)
    }
}

pub fn default_app_data_dir() -> PathBuf {
    if let Some(override_dir) = std::env::var_os("OKHUB_APP_DATA_DIR")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
    {
        return override_dir;
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return PathBuf::from(appdata).join(APP_IDENTIFIER);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_IDENTIFIER);
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(xdg).join(APP_IDENTIFIER);
        }
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join(APP_IDENTIFIER);
        }
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".okhub-data")
}

pub struct AutomationRuntime {
    app_data_dir: PathBuf,
    workspace_dir: Option<PathBuf>,
    docs_root_rel: String,
    active_project: Option<AutomationProjectSummary>,
    ai_context: ActiveWorkspaceAiContext,
}

impl AutomationRuntime {
    pub fn load(overrides: &AutomationOverrides) -> Result<Self, AppError> {
        let app_data_dir = overrides
            .app_data_dir
            .clone()
            .unwrap_or_else(default_app_data_dir);
        let settings = LocalSettingsService::new(JsonFileSettingsStore::new(
            app_data_dir.join(SETTINGS_FILE_NAME),
        ));

        let env_workspace_dir = std::env::var("OKHUB_WORKSPACE_DIR")
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);
        let env_docs_repo = std::env::var("OKHUB_DOCS_REPO")
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());
        let env_project_url = std::env::var("OKHUB_PROJECT_URL")
            .ok()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());

        let active_hub_workspace = settings.load_active_hub_workspace().ok().flatten();
        let active_linked_project = settings.load_active_project().ok().flatten();
        let current_workspace = settings.load_current().ok().flatten();

        let workspace_dir = overrides
            .workspace_dir
            .clone()
            .or(env_workspace_dir)
            .or_else(|| {
                active_hub_workspace
                    .as_ref()
                    .and_then(|ws| ws.docs_repository.as_ref())
                    .and_then(|repo| managed_clone_dir(&app_data_dir, &repo.full_name).ok())
                    .filter(|dir| dir.exists())
            })
            .or_else(|| current_workspace.as_ref().map(|ws| ws.path.clone()))
            .or_else(|| {
                let cwd = std::env::current_dir().ok()?;
                cwd.join(".okf")
                    .join("workspace.yml")
                    .is_file()
                    .then_some(cwd)
            });

        let mut docs_root_rel = "docs".to_owned();
        let mut workspace_title = active_hub_workspace.as_ref().map(|ws| ws.title.clone());
        let docs_repository_full_name = overrides
            .docs_repo
            .clone()
            .or(env_docs_repo)
            .or_else(|| {
                active_hub_workspace
                    .as_ref()
                    .and_then(|ws| ws.docs_repository.as_ref())
                    .map(|repo| repo.full_name.clone())
            })
            .or_else(|| {
                current_workspace
                    .as_ref()
                    .and_then(|ws| ws.repository.as_ref())
                    .map(|repo| repo.full_name.clone())
            });

        let mut active_project = overrides
            .project_url
            .as_deref()
            .or(env_project_url.as_deref())
            .and_then(|url| parse_project_url(url).ok())
            .map(|parsed| AutomationProjectSummary {
                id: String::new(),
                owner: parsed.owner,
                number: parsed.number,
                title: String::new(),
                scope: parsed.scope,
            })
            .or_else(|| {
                active_hub_workspace
                    .as_ref()
                    .and_then(|ws| ws.project.as_ref())
                    .map(|proj| AutomationProjectSummary {
                        id: proj.id.clone(),
                        owner: proj.owner.clone(),
                        number: proj.number,
                        title: proj.title.clone(),
                        scope: proj.scope,
                    })
            })
            .or_else(|| {
                active_linked_project.map(|proj| AutomationProjectSummary {
                    id: proj.id,
                    owner: proj.owner,
                    number: proj.number,
                    title: proj.title,
                    scope: proj.scope,
                })
            });

        let mut code_repositories = Vec::new();

        if let Some(root) = workspace_dir.as_deref() {
            if let Ok(raw_cfg) = fs::read_to_string(root.join(".okf").join("workspace.yml")) {
                if let Ok(cfg) = serde_yaml_ng::from_str::<WorkspaceConfigV1>(&raw_cfg) {
                    if let Some(first_root) = cfg.documents.roots.first() {
                        if !first_root.path.trim().is_empty() {
                            docs_root_rel = first_root.path.trim().to_owned();
                        }
                    }
                    if workspace_title.is_none() {
                        workspace_title = Some(cfg.workspace.name.clone());
                    }
                    if active_project.is_none() {
                        if let Some(proj) = cfg.github.as_ref().and_then(|g| g.active_project()) {
                            active_project = Some(AutomationProjectSummary {
                                id: proj.id,
                                owner: proj.owner,
                                number: proj.number,
                                title: String::new(),
                                scope: proj.scope.unwrap_or(ProjectOwnerScope::Organization),
                            });
                        }
                    }
                }
            }
            if let Ok(resolved) = resolve_code_repositories_for_workspace(&settings, root) {
                for repo in resolved {
                    code_repositories.push(LinkedCodeRepoRuleInfo {
                        key: repo.key,
                        label: repo.label,
                        full_name: repo.full_name,
                        local_path: repo.local_path,
                    });
                }
            }
        }

        let ai_context = ActiveWorkspaceAiContext {
            workspace_title,
            docs_repository_full_name,
            project: active_project.as_ref().map(|proj| ActiveProjectRuleInfo {
                id: proj.id.clone(),
                owner: proj.owner.clone(),
                number: proj.number,
                title: proj.title.clone(),
                scope: match proj.scope {
                    ProjectOwnerScope::Organization => "organization".to_owned(),
                    ProjectOwnerScope::User => "user".to_owned(),
                },
            }),
            code_repositories,
        };

        Ok(Self {
            app_data_dir,
            workspace_dir,
            docs_root_rel,
            active_project,
            ai_context,
        })
    }

    pub fn active_context_summary(&self) -> ActiveAutomationContextSummary {
        ActiveAutomationContextSummary {
            app_data_dir: self.app_data_dir.display().to_string(),
            workspace_dir: self.workspace_dir.as_ref().map(|p| p.display().to_string()),
            docs_root: self.docs_root_rel.clone(),
            workspace_title: self.ai_context.workspace_title.clone(),
            docs_repository_full_name: self.ai_context.docs_repository_full_name.clone(),
            project: self.active_project.clone(),
            code_repositories: self
                .ai_context
                .code_repositories
                .iter()
                .map(|repo| AutomationCodeRepoSummary {
                    key: repo.key.clone(),
                    label: repo.label.clone(),
                    full_name: repo.full_name.clone(),
                    local_path: repo.local_path.clone(),
                })
                .collect(),
        }
    }

    pub fn require_workspace_dir(&self) -> Result<&Path, AppError> {
        self.workspace_dir.as_deref().ok_or_else(|| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "연결된 문서 워크스페이스 폴더를 찾을 수 없습니다. OkHub에서 워크스페이스를 선택하거나 `--workspace-dir`을 지정해 주세요.",
            )
            .with_recovery(RecoveryAction::Retry)
        })
    }

    pub fn require_project(&self) -> Result<&AutomationProjectSummary, AppError> {
        self.active_project.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                "선택된 GitHub Project가 없습니다. OkHub에서 프로젝트를 연결하거나 `--project` URL을 지정해 주세요.",
            )
            .with_recovery(RecoveryAction::Retry)
        })
    }

    pub fn resolve_target_repository(
        &self,
        explicit_repo: Option<&str>,
    ) -> Result<String, AppError> {
        if let Some(repo) = explicit_repo.map(str::trim).filter(|s| !s.is_empty()) {
            return Ok(repo.to_owned());
        }
        self.ai_context
            .docs_repository_full_name
            .clone()
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "대상 GitHub 저장소가 지정되지 않았습니다. OkHub에서 문서 저장소를 연결하거나 `--repo`를 지정해 주세요.",
                )
                .with_recovery(RecoveryAction::Retry)
            })
    }

    pub fn resolve_issue_target_repository(
        &self,
        explicit_repo: Option<&str>,
        layer: Option<BoardLayer>,
    ) -> Result<String, AppError> {
        if let Some(repo) = explicit_repo.map(str::trim).filter(|s| !s.is_empty()) {
            return Ok(repo.to_owned());
        }
        if matches!(
            layer,
            Some(BoardLayer::Frontend | BoardLayer::Backend | BoardLayer::Design)
        ) {
            if let Some(code_repo) = self.ai_context.code_repositories.first() {
                return Ok(code_repo.full_name.clone());
            }
        }
        self.resolve_target_repository(None)
    }

    pub fn build_github_service(&self) -> Result<GithubService, AppError> {
        let client_id = crate::github_client_id();
        let env_token = std::env::var("GH_TOKEN")
            .ok()
            .or_else(|| std::env::var("GITHUB_TOKEN").ok())
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty());

        let auth = if let Some(token) = env_token {
            Arc::new(AuthService::with_static_token(
                client_id,
                SecretString::from(token),
            ))
        } else {
            let credentials = KeyringCredentialStore::new().map_err(|_| {
                AppError::new(
                    ErrorCode::ReauthenticationRequired,
                    "GitHub 인증 토큰을 읽을 수 없습니다. OkHub에 로그인하거나 `GH_TOKEN` 환경 변수를 설정해 주세요.",
                )
                .with_recovery(RecoveryAction::RestartLogin)
            })?;
            Arc::new(AuthService::new(
                client_id,
                ReqwestDeviceFlowApi::new(),
                credentials,
                SystemClock,
                TokioDelay,
                NoopAuthEvents,
            ))
        };
        GithubService::production(auth)
    }

    pub fn list_docs(&self) -> Result<Vec<AutomationDocEntry>, AppError> {
        let root = self.require_workspace_dir()?;
        list_workspace_docs(root, &self.docs_root_rel)
    }

    pub fn read_doc(&self, doc_path: &str) -> Result<AutomationDocDetail, AppError> {
        let root = self.require_workspace_dir()?;
        read_workspace_doc(root, doc_path)
    }

    pub fn validate_docs(&self) -> Result<DocValidationReport, AppError> {
        let root = self.require_workspace_dir()?;
        validate_workspace_docs(root, &self.docs_root_rel)
    }

    pub async fn list_pull_requests(
        &self,
        explicit_repo: Option<&str>,
    ) -> Result<Vec<DocsPullRequestSummary>, AppError> {
        let repo = self.resolve_target_repository(explicit_repo)?;
        let github = self.build_github_service()?;
        github.list_open_pull_requests(&repo).await
    }

    pub async fn create_pull_request(
        &self,
        explicit_repo: Option<&str>,
        head: &str,
        base: Option<&str>,
        title: &str,
        body: &str,
        draft: bool,
    ) -> Result<DocsPullRequestSummary, AppError> {
        let repo = self.resolve_target_repository(explicit_repo)?;
        let github = self.build_github_service()?;
        github
            .create_pull_request(&CreatePullRequestInput {
                repository_full_name: repo,
                head: head.trim().to_owned(),
                base: base
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("main")
                    .to_owned(),
                title: title.trim().to_owned(),
                body: body.to_owned(),
                draft,
            })
            .await
    }

    pub async fn approve_and_merge_pull_request(
        &self,
        explicit_repo: Option<&str>,
        number: u64,
        comment: Option<&str>,
    ) -> Result<ApproveMergeOutcome, AppError> {
        let repo = self.resolve_target_repository(explicit_repo)?;
        let github = self.build_github_service()?;
        let viewer = github.current_user().await?;
        let pr = github.get_pull_request(&repo, number).await?;
        let mut approved = false;
        if !viewer.login.eq_ignore_ascii_case(&pr.author_login) {
            github.approve_pull_request(&repo, number, comment).await?;
            approved = true;
        }
        let merge_commit_sha = github
            .squash_merge_pull_request(
                &repo,
                number,
                Some(&format!("{} (#{})", pr.title, pr.number)),
                Some(&pr.head_sha),
            )
            .await?;
        Ok(ApproveMergeOutcome {
            number,
            repository_full_name: repo,
            approved,
            merged: true,
            merge_commit_sha,
        })
    }

    pub async fn list_board_items(
        &self,
        layer_filter: Option<BoardLayer>,
        status_filter: Option<BoardStatus>,
    ) -> Result<Vec<GithubProjectItem>, AppError> {
        let project = self.require_project()?;
        let github = self.build_github_service()?;
        let (items, _, _, _) = github
            .list_project_items_with_fallback(project.scope, &project.owner, project.number)
            .await?;
        Ok(items
            .into_iter()
            .filter(|item| match layer_filter {
                Some(want) => map_item_layer(item.area.as_deref(), &item.labels) == want,
                None => true,
            })
            .filter(|item| match status_filter {
                Some(want) => map_item_status(item.status.as_deref()) == Some(want),
                None => true,
            })
            .collect())
    }

    pub async fn list_ready_items(
        &self,
        layer_filter: Option<BoardLayer>,
    ) -> Result<Vec<ReadyBoardItem>, AppError> {
        let project = self.require_project()?;
        let github = self.build_github_service()?;
        let (items, _, _, _) = github
            .list_project_items_with_fallback(project.scope, &project.owner, project.number)
            .await?;
        Ok(compute_ready_board_items(&items, layer_filter))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_board_issue(
        &self,
        explicit_repo: Option<&str>,
        title: &str,
        body: &str,
        layer: Option<BoardLayer>,
        status: Option<BoardStatus>,
        kind: Option<String>,
        priority: Option<String>,
        parent_issue_number: Option<u64>,
        depends_on: Option<u64>,
    ) -> Result<CreatedProjectIssue, AppError> {
        let project = self.require_project()?;
        let repo = self.resolve_issue_target_repository(explicit_repo, layer)?;
        let final_body = inject_depends_on_line(body, depends_on);
        let github = self.build_github_service()?;
        github
            .create_project_issue(&CreateProjectIssueInput {
                project_scope: project.scope,
                project_owner: project.owner.clone(),
                project_number: project.number,
                repository_full_name: repo,
                title: title.to_owned(),
                body: final_body,
                layer,
                status,
                kind,
                priority,
                parent_issue_number,
                parent_issue_repository: None,
            })
            .await
    }

    pub async fn derive_backlog_from_issue(
        &self,
        source_issue_number: u64,
        explicit_repo: Option<&str>,
        doc_path: Option<&str>,
    ) -> Result<Vec<CreatedProjectIssue>, AppError> {
        let project = self.require_project()?;
        let github = self.build_github_service()?;
        let (items, _, _, _) = github
            .list_project_items_with_fallback(project.scope, &project.owner, project.number)
            .await?;
        let source = items
            .iter()
            .find(|item| item.number == source_issue_number)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    format!(
                        "선택된 GitHub Project에서 상위 이슈 #{source_issue_number}을(를) 찾을 수 없습니다."
                    ),
                )
                .with_recovery(RecoveryAction::Retry)
            })?;

        let source_layer = map_item_layer(source.area.as_deref(), &source.labels);
        let base_title = strip_layer_prefix(&source.title);
        let doc_note = doc_path
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|p| format!("\n\n## 관련 문서\n- `{p}`"))
            .unwrap_or_default();

        let mut created = Vec::new();
        match source_layer {
            BoardLayer::Design => {
                let fe_repo = self
                    .resolve_issue_target_repository(explicit_repo, Some(BoardLayer::Frontend))?;
                let fe = github
                    .create_project_issue(&CreateProjectIssueInput {
                        project_scope: project.scope,
                        project_owner: project.owner.clone(),
                        project_number: project.number,
                        repository_full_name: fe_repo,
                        title: format!("[프론트엔드] {base_title} 화면·컴포넌트 구현"),
                        body: format!(
                            "이전 단계: #{source_issue_number}\n\n상위 디자인 이슈(#{source_issue_number}) 산출물을 바탕으로 프론트엔드 UI 및 상호작용을 구현합니다.{doc_note}"
                        ),
                        layer: Some(BoardLayer::Frontend),
                        status: Some(BoardStatus::Backlog),
                        kind: Some("작업".to_owned()),
                        priority: source.priority.clone(),
                        parent_issue_number: Some(source_issue_number),
                        parent_issue_repository: source.infer_repository_full_name(),
                    })
                    .await?;
                created.push(fe);
            }
            _ => {
                let be_repo =
                    self.resolve_issue_target_repository(explicit_repo, Some(BoardLayer::Backend))?;
                let be = github
                    .create_project_issue(&CreateProjectIssueInput {
                        project_scope: project.scope,
                        project_owner: project.owner.clone(),
                        project_number: project.number,
                        repository_full_name: be_repo,
                        title: format!("[백엔드] {base_title} 도메인·API 구현"),
                        body: format!(
                            "이전 단계: #{source_issue_number}\n\n상위 기획 이슈(#{source_issue_number})의 확정 명세를 바탕으로 백엔드 로직과 계약을 구현합니다.{doc_note}"
                        ),
                        layer: Some(BoardLayer::Backend),
                        status: Some(BoardStatus::Backlog),
                        kind: Some("작업".to_owned()),
                        priority: source.priority.clone(),
                        parent_issue_number: Some(source_issue_number),
                        parent_issue_repository: source.infer_repository_full_name(),
                    })
                    .await?;
                let be_num = be.number;
                created.push(be);

                let fe_repo = self
                    .resolve_issue_target_repository(explicit_repo, Some(BoardLayer::Frontend))?;
                let fe = github
                    .create_project_issue(&CreateProjectIssueInput {
                        project_scope: project.scope,
                        project_owner: project.owner.clone(),
                        project_number: project.number,
                        repository_full_name: fe_repo,
                        title: format!("[프론트엔드] {base_title} UI·상태 연동 구현"),
                        body: format!(
                            "이전 단계: #{be_num}\n\n상위 기획 이슈(#{source_issue_number}) 및 선행 백엔드 이슈(#{be_num})를 바탕으로 프론트엔드 UI와 연동을 완성합니다.{doc_note}"
                        ),
                        layer: Some(BoardLayer::Frontend),
                        status: Some(BoardStatus::Backlog),
                        kind: Some("작업".to_owned()),
                        priority: source.priority.clone(),
                        parent_issue_number: Some(source_issue_number),
                        parent_issue_repository: source.infer_repository_full_name(),
                    })
                    .await?;
                created.push(fe);
            }
        }
        Ok(created)
    }

    pub async fn update_board_item_status(
        &self,
        issue_number: u64,
        status: Option<BoardStatus>,
        layer: Option<BoardLayer>,
        kind: Option<String>,
        priority: Option<String>,
        explicit_repo: Option<&str>,
    ) -> Result<UpdatedProjectItem, AppError> {
        let project = self.require_project()?;
        let github = self.build_github_service()?;
        github
            .update_project_item_fields(&UpdateProjectItemInput {
                project_scope: project.scope,
                project_owner: project.owner.clone(),
                project_number: project.number,
                issue_number,
                repository_full_name: explicit_repo.map(str::to_owned),
                status,
                layer,
                kind,
                priority,
            })
            .await
    }

    pub async fn build_issue_context(
        &self,
        issue_number: u64,
    ) -> Result<IssueContextPack, AppError> {
        let project = self.require_project()?;
        let github = self.build_github_service()?;
        let (items, _, _, _) = github
            .list_project_items_with_fallback(project.scope, &project.owner, project.number)
            .await?;
        let target = items
            .iter()
            .find(|item| item.number == issue_number)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    format!(
                        "선택된 GitHub Project에서 이슈 #{issue_number}을(를) 찾을 수 없습니다."
                    ),
                )
                .with_recovery(RecoveryAction::Retry)
            })?;
        Ok(assemble_issue_context_pack(
            target,
            &items,
            self.workspace_dir.as_deref(),
            &self.ai_context,
        ))
    }
}

pub fn inject_depends_on_line(body: &str, depends_on: Option<u64>) -> String {
    let mut final_body = body.to_owned();
    if let Some(dep) = depends_on.filter(|n| *n > 0) {
        let marker = format!("이전 단계: #{dep}");
        if !final_body.contains("이전 단계:")
            && !final_body.contains("이전단계:")
            && !final_body.to_ascii_lowercase().contains("depends-on:")
            && !final_body.to_ascii_lowercase().contains("depends on:")
        {
            if final_body.trim().is_empty() {
                final_body = marker;
            } else {
                final_body = format!("{marker}\n\n{final_body}");
            }
        }
    }
    final_body
}

pub fn strip_layer_prefix(title: &str) -> String {
    let trimmed = title.trim();
    for prefix in [
        "[기획]",
        "[디자인]",
        "[백엔드]",
        "[프론트엔드]",
        "[프론트]",
        "[Epic]",
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let clean = rest.trim();
            if !clean.is_empty() {
                return clean.to_owned();
            }
        }
    }
    trimmed.to_owned()
}

pub fn run_cli_from_env() -> ExitCode {
    cli::run_from_args(std::env::args().skip(1).collect())
}
