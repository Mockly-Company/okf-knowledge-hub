//! 프로젝트별 문서 저장소를 앱 데이터 폴더에 연결하고 전환한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::project_board::ResolvedGithubProject;
use crate::repository::managed::managed_clone_dir;
use crate::repository::model::PullOutcome;
use crate::settings::model::CurrentWorkspaceStatus;
use crate::settings::model::{DocsRepository, HubWorkspace, KnowledgeRepository, LinkedProject};
use crate::settings::service::LocalSettingsService;
use crate::state::AppServices;
use crate::workspace::service::{WorkspaceInspection, WorkspaceService};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDocsRepository {
    /// clone 명령에 넘길 부모 폴더. 화면에 보여 주지 않는다.
    pub parent_directory: PathBuf,
    pub already_cloned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDocsRepository {
    pub full_name: String,
    pub okf: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubWorkspaceList {
    pub workspaces: Vec<HubWorkspace>,
    pub active_workspace_id: Option<String>,
    pub active_docs_connected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivatedHubWorkspace {
    pub workspace: HubWorkspace,
    pub docs_connected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedHubWorkspace {
    pub workspace: HubWorkspace,
    pub docs_connected: bool,
    pub okf: Option<bool>,
}

pub(crate) fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path().app_data_dir().map_err(|_| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "로컬 설정을 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
    })
}

/// 앱 폴더의 clone 위치를 알려 준다. 같은 원격을 가리키는 clone이 있으면 다시 받지 않는다.
#[tauri::command]
pub async fn prepare_docs_repository(
    app: AppHandle,
    full_name: String,
) -> CommandResult<PreparedDocsRepository> {
    let app_data = app_data_dir(&app)?;
    run_blocking(move || prepare_docs_repository_inner(&app_data, &full_name)).await
}

/// git·파일 작업은 화면을 그리는 스레드가 아니라 작업 스레드에서 한다.
pub(crate) async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "문서 저장소 작업을 완료하지 못했습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
        })?
}

pub(crate) fn prepare_docs_repository_inner(
    app_data: &Path,
    full_name: &str,
) -> CommandResult<PreparedDocsRepository> {
    let target = managed_clone_dir(app_data, full_name)?;
    let parent_directory = target
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| app_data.to_path_buf());
    // clone은 부모 폴더 안에 임시 폴더를 만들므로, 처음 받는 owner면 미리 만들어 둔다.
    std::fs::create_dir_all(&parent_directory).map_err(|error| {
        AppError::new(
            ErrorCode::CloneFailed,
            "문서 저장소를 받을 폴더를 만들지 못했습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    Ok(PreparedDocsRepository {
        parent_directory,
        already_cloned: clone_matches(&target, full_name),
    })
}

/// `origin`이 같은 GitHub 저장소를 가리키는 clone인지 확인한다.
pub(crate) fn clone_matches(directory: &Path, full_name: &str) -> bool {
    let Ok(repository) = git2::Repository::open(directory) else {
        return false;
    };
    let Ok(origin) = repository.find_remote("origin") else {
        return false;
    };
    origin.url().is_some_and(|url| {
        let normalized = url.trim_end_matches('/').trim_end_matches(".git");
        normalized.eq_ignore_ascii_case(&format!("https://github.com/{full_name}"))
    })
}

/// clone이 끝난 저장소를 프로젝트의 문서 저장소로 기억한다. 활성 프로젝트면 바로 전환한다.
#[tauri::command]
pub async fn connect_project_docs_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
    project_id: String,
    repository_id: String,
    full_name: String,
) -> CommandResult<ConnectedDocsRepository> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        connect_project_docs_repository_inner(
            &settings,
            &app_data,
            &project_id,
            &repository_id,
            &full_name,
        )
    })
    .await
}

pub(crate) fn connect_project_docs_repository_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    project_id: &str,
    repository_id: &str,
    full_name: &str,
) -> CommandResult<ConnectedDocsRepository> {
    let directory = managed_clone_dir(app_data, full_name)?;
    if !clone_matches(&directory, full_name) {
        return Err(AppError::new(
            ErrorCode::CloneFailed,
            "문서 저장소를 아직 받지 못했습니다. 다시 시도해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    settings.set_docs_repository(
        project_id,
        DocsRepository {
            repository_id: repository_id.to_owned(),
            full_name: full_name.to_owned(),
        },
    )?;
    let okf = matches!(
        WorkspaceService::inspect(&directory),
        Ok(WorkspaceInspection::Ready { .. })
    );
    let is_active = settings
        .load_active_project()?
        .is_some_and(|project| project.id == project_id);
    if is_active {
        settings.set_current_for_repository(
            &directory,
            KnowledgeRepository {
                id: repository_id.to_owned(),
                full_name: full_name.to_owned(),
            },
        )?;
    }
    Ok(ConnectedDocsRepository {
        full_name: full_name.to_owned(),
        okf,
    })
}

/// 현재 문서 저장소를 GitHub 최신으로 맞춘다. 앱 폴더의 clone에만 적용한다.
#[tauri::command]
pub async fn pull_docs_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<PullOutcome> {
    let Some((directory, full_name)) = managed_current_clone(&state, &app_data_dir(&app)?)? else {
        return Ok(PullOutcome::UpToDate);
    };
    let _access = state.acquire_authenticated_command().await?;
    let auth = state.auth.clone().ok_or_else(pull_unavailable)?;
    let access_token = auth.valid_access_token().await?;
    let git = state.repository_git.clone();
    let remote_url = format!("https://github.com/{full_name}.git");
    tauri::async_runtime::spawn_blocking(move || {
        git.fast_forward_default_branch(&directory, &remote_url, access_token)
    })
    .await
    .map_err(|_| pull_unavailable())?
}

fn pull_unavailable() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "문서 저장소를 최신으로 받을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

/// 현재 워크스페이스가 앱 폴더에 받은 문서 저장소일 때만 그 경로와 이름을 돌려준다.
/// 사용자가 직접 고른 폴더는 앱이 건드리지 않는다.
pub(crate) fn managed_current_clone(
    services: &AppServices,
    app_data: &Path,
) -> CommandResult<Option<(PathBuf, String)>> {
    let Some(current) = services.local_settings.load_current()? else {
        return Ok(None);
    };
    let Some(repository) = current.repository else {
        return Ok(None);
    };
    if current.status != CurrentWorkspaceStatus::Connected {
        return Ok(None);
    }
    let expected = managed_clone_dir(app_data, &repository.full_name)?;
    let is_managed = expected
        .canonicalize()
        .is_ok_and(|expected| expected == current.path);
    Ok(is_managed.then_some((current.path, repository.full_name)))
}

/// 활성 프로젝트의 문서 저장소로 현재 워크스페이스를 맞춘다. clone이 없으면 연결을 끊는다.
pub(crate) fn switch_current_to_project(
    settings: &LocalSettingsService,
    app_data: &Path,
    project_id: &str,
) -> CommandResult<Option<DocsRepository>> {
    let Some(repository) = settings.docs_repository_for(project_id)? else {
        settings.clear_current()?;
        return Ok(None);
    };
    let directory = managed_clone_dir(app_data, &repository.full_name)?;
    if !clone_matches(&directory, &repository.full_name) {
        settings.clear_current()?;
        return Ok(None);
    }
    // 연결할 수 없는 저장소(지원하지 않는 OKF 버전 등)는 없는 것처럼 다뤄 다시 고를 수 있게 한다.
    let connected = settings.set_current_for_repository(
        &directory,
        KnowledgeRepository {
            id: repository.repository_id.clone(),
            full_name: repository.full_name.clone(),
        },
    );
    if connected.is_err() {
        settings.clear_current()?;
        return Ok(None);
    }
    Ok(Some(repository))
}

fn ensure_managed_clone(app_data: &Path, full_name: &str) -> CommandResult<(PathBuf, bool)> {
    let directory = managed_clone_dir(app_data, full_name)?;
    if !clone_matches(&directory, full_name) {
        return Err(AppError::new(
            ErrorCode::CloneFailed,
            "문서 저장소를 아직 받지 못했습니다. 다시 시도해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    let okf = matches!(
        WorkspaceService::inspect(&directory),
        Ok(WorkspaceInspection::Ready { .. })
    );
    Ok((directory, okf))
}

pub(crate) fn switch_current_to_hub_workspace(
    settings: &LocalSettingsService,
    app_data: &Path,
    workspace: &HubWorkspace,
) -> CommandResult<bool> {
    let Some(ref repository) = workspace.docs_repository else {
        settings.clear_current()?;
        return Ok(false);
    };
    let directory = managed_clone_dir(app_data, &repository.full_name)?;
    if clone_matches(&directory, &repository.full_name) {
        let connected = settings.set_current_for_repository(
            &directory,
            KnowledgeRepository {
                id: repository.repository_id.clone(),
                full_name: repository.full_name.clone(),
            },
        );
        if connected.is_err() {
            settings.clear_current()?;
            return Ok(false);
        }
        return Ok(true);
    }
    if let Some(current) = settings.load_current()? {
        if current.status == CurrentWorkspaceStatus::Connected
            && current.repository.as_ref().is_some_and(|current_repo| {
                current_repo
                    .full_name
                    .eq_ignore_ascii_case(&repository.full_name)
            })
            && clone_matches(&current.path, &repository.full_name)
        {
            return Ok(true);
        }
    }
    settings.clear_current()?;
    Ok(false)
}

#[tauri::command]
pub async fn list_hub_workspaces(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> CommandResult<HubWorkspaceList> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || list_hub_workspaces_inner(&settings, &app_data)).await
}

pub(crate) fn list_hub_workspaces_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
) -> CommandResult<HubWorkspaceList> {
    let workspaces = settings.load_hub_workspaces()?;
    if workspaces.is_empty() {
        return Ok(HubWorkspaceList {
            workspaces: Vec::new(),
            active_workspace_id: None,
            active_docs_connected: false,
        });
    }
    let active_workspace = match settings.load_active_hub_workspace()? {
        Some(active) => active,
        None => settings.set_active_hub_workspace(&workspaces[0].id)?,
    };
    let active_docs_connected =
        switch_current_to_hub_workspace(settings, app_data, &active_workspace)?;
    Ok(HubWorkspaceList {
        workspaces,
        active_workspace_id: Some(active_workspace.id),
        active_docs_connected,
    })
}

#[tauri::command]
pub async fn set_active_hub_workspace(
    app: AppHandle,
    state: State<'_, AppServices>,
    workspace_id: String,
) -> CommandResult<ActivatedHubWorkspace> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || set_active_hub_workspace_inner(&settings, &app_data, workspace_id.trim()))
        .await
}

pub(crate) fn set_active_hub_workspace_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    workspace_id: &str,
) -> CommandResult<ActivatedHubWorkspace> {
    let workspace = settings.set_active_hub_workspace(workspace_id)?;
    let docs_connected = switch_current_to_hub_workspace(settings, app_data, &workspace)?;
    Ok(ActivatedHubWorkspace {
        workspace,
        docs_connected,
    })
}

#[tauri::command]
pub async fn create_standalone_docs_workspace(
    app: AppHandle,
    state: State<'_, AppServices>,
    repository_id: String,
    full_name: String,
) -> CommandResult<ConnectedHubWorkspace> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        create_standalone_docs_workspace_inner(&settings, &app_data, &repository_id, &full_name)
    })
    .await
}

pub(crate) fn create_standalone_docs_workspace_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    repository_id: &str,
    full_name: &str,
) -> CommandResult<ConnectedHubWorkspace> {
    let repository_id = repository_id.trim();
    let full_name = full_name.trim();
    let docs_repo = DocsRepository {
        repository_id: repository_id.to_owned(),
        full_name: full_name.to_owned(),
    };
    crate::settings::service::validate_docs_repository(&docs_repo)?;
    let (directory, okf) = ensure_managed_clone(app_data, full_name)?;
    let workspace = settings.upsert_standalone_docs_workspace(docs_repo)?;
    settings.set_current_for_repository(
        &directory,
        KnowledgeRepository {
            id: repository_id.to_owned(),
            full_name: full_name.to_owned(),
        },
    )?;
    Ok(ConnectedHubWorkspace {
        workspace,
        docs_connected: true,
        okf: Some(okf),
    })
}

#[tauri::command]
pub async fn create_project_workspace(
    app: AppHandle,
    state: State<'_, AppServices>,
    project: ResolvedGithubProject,
    repository_id: Option<String>,
    full_name: Option<String>,
) -> CommandResult<ConnectedHubWorkspace> {
    let _access = state.acquire_authenticated_command().await?;
    let verified_project =
        crate::commands::project_board::verify_github_project(&state, &project).await?;
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        create_project_workspace_inner(
            &settings,
            &app_data,
            verified_project,
            repository_id.as_deref(),
            full_name.as_deref(),
        )
    })
    .await
}

pub(crate) fn create_project_workspace_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    project: LinkedProject,
    repository_id: Option<&str>,
    full_name: Option<&str>,
) -> CommandResult<ConnectedHubWorkspace> {
    let normalized_id = repository_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_name = full_name.map(str::trim).filter(|value| !value.is_empty());
    match (normalized_id, normalized_name) {
        (Some(repo_id), Some(name)) => {
            let docs_repo = DocsRepository {
                repository_id: repo_id.to_owned(),
                full_name: name.to_owned(),
            };
            crate::settings::service::validate_docs_repository(&docs_repo)?;
            let (directory, okf) = ensure_managed_clone(app_data, name)?;
            let workspace = settings.upsert_project_workspace(project, Some(docs_repo))?;
            settings.set_current_for_repository(
                &directory,
                KnowledgeRepository {
                    id: repo_id.to_owned(),
                    full_name: name.to_owned(),
                },
            )?;
            Ok(ConnectedHubWorkspace {
                workspace,
                docs_connected: true,
                okf: Some(okf),
            })
        }
        (None, None) => {
            let workspace = settings.upsert_project_workspace(project, None)?;
            let docs_connected = switch_current_to_hub_workspace(settings, app_data, &workspace)?;
            Ok(ConnectedHubWorkspace {
                workspace,
                docs_connected,
                okf: None,
            })
        }
        _ => Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "문서 저장소 정보가 불완전합니다.",
        )),
    }
}

#[tauri::command]
pub async fn connect_workspace_docs_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
    workspace_id: String,
    repository_id: String,
    full_name: String,
) -> CommandResult<ConnectedHubWorkspace> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        connect_workspace_docs_repository_inner(
            &settings,
            &app_data,
            workspace_id.trim(),
            &repository_id,
            &full_name,
        )
    })
    .await
}

pub(crate) fn connect_workspace_docs_repository_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    workspace_id: &str,
    repository_id: &str,
    full_name: &str,
) -> CommandResult<ConnectedHubWorkspace> {
    let repository_id = repository_id.trim();
    let full_name = full_name.trim();
    let docs_repo = DocsRepository {
        repository_id: repository_id.to_owned(),
        full_name: full_name.to_owned(),
    };
    crate::settings::service::validate_docs_repository(&docs_repo)?;
    let (directory, okf) = ensure_managed_clone(app_data, full_name)?;
    let workspace = settings.set_hub_workspace_docs_repository(workspace_id, docs_repo)?;
    if settings.load_active_hub_workspace_id()?.as_deref() == Some(workspace.id.as_str()) {
        settings.set_current_for_repository(
            &directory,
            KnowledgeRepository {
                id: repository_id.to_owned(),
                full_name: full_name.to_owned(),
            },
        )?;
    }
    Ok(ConnectedHubWorkspace {
        workspace,
        docs_connected: true,
        okf: Some(okf),
    })
}

#[tauri::command]
pub async fn attach_project_to_workspace(
    state: State<'_, AppServices>,
    workspace_id: String,
    project: ResolvedGithubProject,
) -> CommandResult<HubWorkspace> {
    let _access = state.acquire_authenticated_command().await?;
    let verified = crate::commands::project_board::verify_github_project(&state, &project).await?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        attach_project_to_workspace_inner(&settings, workspace_id.trim(), verified)
    })
    .await
}

pub(crate) fn attach_project_to_workspace_inner(
    settings: &LocalSettingsService,
    workspace_id: &str,
    project: LinkedProject,
) -> CommandResult<HubWorkspace> {
    settings.attach_project_to_hub_workspace(workspace_id, project)
}

#[tauri::command]
pub async fn detach_project_from_workspace(
    app: AppHandle,
    state: State<'_, AppServices>,
    workspace_id: String,
) -> CommandResult<HubWorkspaceList> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || {
        detach_project_from_workspace_inner(&settings, &app_data, workspace_id.trim())
    })
    .await
}

pub(crate) fn detach_project_from_workspace_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    workspace_id: &str,
) -> CommandResult<HubWorkspaceList> {
    settings.detach_project_from_hub_workspace(workspace_id)?;
    if settings.load_hub_workspaces()?.is_empty() {
        settings.clear_current()?;
    }
    list_hub_workspaces_inner(settings, app_data)
}

#[tauri::command]
pub async fn remove_hub_workspace(
    app: AppHandle,
    state: State<'_, AppServices>,
    workspace_id: String,
) -> CommandResult<HubWorkspaceList> {
    let app_data = app_data_dir(&app)?;
    let settings = state.local_settings.clone();
    run_blocking(move || remove_hub_workspace_inner(&settings, &app_data, workspace_id.trim()))
        .await
}

pub(crate) fn remove_hub_workspace_inner(
    settings: &LocalSettingsService,
    app_data: &Path,
    workspace_id: &str,
) -> CommandResult<HubWorkspaceList> {
    settings.remove_hub_workspace(workspace_id)?;
    if settings.load_hub_workspaces()?.is_empty() {
        settings.clear_current()?;
    }
    list_hub_workspaces_inner(settings, app_data)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use crate::error::AppError;
    use crate::project_board::ProjectOwnerScope;
    use crate::repository::managed::managed_clone_dir;
    use crate::settings::model::LinkedProject;
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};
    use crate::state::AppServices;

    use super::{
        attach_project_to_workspace_inner, connect_project_docs_repository_inner,
        connect_workspace_docs_repository_inner, create_project_workspace_inner,
        create_standalone_docs_workspace_inner, detach_project_from_workspace_inner,
        list_hub_workspaces_inner, managed_current_clone, prepare_docs_repository_inner,
        remove_hub_workspace_inner, set_active_hub_workspace_inner,
    };
    use crate::commands::project_board::set_active_project_inner;

    #[derive(Clone, Default)]
    struct MemoryStore(Arc<Mutex<HashMap<String, String>>>);

    impl LocalSettingsStore for MemoryStore {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn services_with_projects(ids: &[&str]) -> AppServices {
        let settings = LocalSettingsService::new(MemoryStore::default());
        for (index, id) in ids.iter().enumerate() {
            settings
                .link_project(LinkedProject {
                    id: (*id).to_owned(),
                    owner: "Mockly-Company".to_owned(),
                    number: index as u64 + 1,
                    title: format!("보드 {id}"),
                    scope: ProjectOwnerScope::Organization,
                })
                .unwrap();
        }
        AppServices::new(settings)
    }

    /// 앱 폴더에 clone이 끝난 것처럼 git 저장소를 만든다.
    fn fake_clone(app_data: &Path, full_name: &str) {
        let directory = managed_clone_dir(app_data, full_name).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        let repository = git2::Repository::init(&directory).unwrap();
        repository
            .remote("origin", &format!("https://github.com/{full_name}.git"))
            .unwrap();
        std::fs::write(directory.join("README.md"), "# 문서\n").unwrap();
    }

    #[test]
    fn connect_saves_mapping_for_the_given_project_not_the_active_one() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        fake_clone(app_data.path(), "o/b-docs");

        let connected = connect_project_docs_repository_inner(
            &services.local_settings,
            app_data.path(),
            "b",
            "R_b",
            "o/b-docs",
        )
        .unwrap();

        assert_eq!(connected.full_name, "o/b-docs");
        assert!(!connected.okf);
        let settings = &services.local_settings;
        assert!(settings.docs_repository_for("b").unwrap().is_some());
        assert_eq!(settings.docs_repository_for("a").unwrap(), None);
        assert_eq!(settings.load_current().unwrap(), None);
    }

    #[test]
    fn connecting_the_active_project_switches_the_current_workspace() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a"]);
        fake_clone(app_data.path(), "o/a-docs");

        connect_project_docs_repository_inner(
            &services.local_settings,
            app_data.path(),
            "a",
            "R_a",
            "o/a-docs",
        )
        .unwrap();

        let current = services.local_settings.load_current().unwrap().unwrap();
        assert_eq!(
            current.path,
            managed_clone_dir(app_data.path(), "o/a-docs")
                .unwrap()
                .canonicalize()
                .unwrap()
        );
    }

    #[test]
    fn activating_a_project_switches_the_current_workspace() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        for (id, name) in [("a", "o/a-docs"), ("b", "o/b-docs")] {
            fake_clone(app_data.path(), name);
            connect_project_docs_repository_inner(
                &services.local_settings,
                app_data.path(),
                id,
                "R",
                name,
            )
            .unwrap();
        }

        let result =
            set_active_project_inner(&services.local_settings, app_data.path(), "b").unwrap();

        assert_eq!(result.docs_repository.unwrap().full_name, "o/b-docs");
        let current = services.local_settings.load_current().unwrap().unwrap();
        assert!(current.path.ends_with("b-docs"));
    }

    #[test]
    fn activating_a_project_whose_clone_is_gone_reports_missing_docs() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        fake_clone(app_data.path(), "o/b-docs");
        connect_project_docs_repository_inner(
            &services.local_settings,
            app_data.path(),
            "b",
            "R_b",
            "o/b-docs",
        )
        .unwrap();
        std::fs::remove_dir_all(managed_clone_dir(app_data.path(), "o/b-docs").unwrap()).unwrap();

        let result =
            set_active_project_inner(&services.local_settings, app_data.path(), "b").unwrap();

        assert_eq!(result.docs_repository, None);
        assert_eq!(services.local_settings.load_current().unwrap(), None);
    }

    #[test]
    fn prepare_creates_the_parent_folder_for_a_first_clone() {
        let app_data = tempfile::tempdir().unwrap();

        let prepared = prepare_docs_repository_inner(app_data.path(), "o/docs").unwrap();

        assert!(prepared.parent_directory.is_dir());
        assert!(!prepared.already_cloned);
    }

    #[test]
    fn activating_a_project_whose_repository_cannot_be_opened_reports_missing_docs() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        fake_clone(app_data.path(), "o/b-docs");
        connect_project_docs_repository_inner(
            &services.local_settings,
            app_data.path(),
            "b",
            "R_b",
            "o/b-docs",
        )
        .unwrap();
        let clone = managed_clone_dir(app_data.path(), "o/b-docs").unwrap();
        std::fs::create_dir_all(clone.join(".okf")).unwrap();
        std::fs::write(clone.join(".okf/workspace.yml"), "schema_version: 99\n").unwrap();

        let result =
            set_active_project_inner(&services.local_settings, app_data.path(), "b").unwrap();

        assert_eq!(result.docs_repository, None);
        assert_eq!(services.local_settings.load_current().unwrap(), None);
    }

    #[test]
    fn pull_targets_only_clones_in_the_app_folder() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a"]);
        fake_clone(app_data.path(), "o/a-docs");
        connect_project_docs_repository_inner(
            &services.local_settings,
            app_data.path(),
            "a",
            "R_a",
            "o/a-docs",
        )
        .unwrap();
        let (path, full_name) = managed_current_clone(&services, app_data.path())
            .unwrap()
            .unwrap();
        assert_eq!(full_name, "o/a-docs");
        assert!(path.ends_with("a-docs"));

        let elsewhere = tempfile::tempdir().unwrap();
        git2::Repository::init(elsewhere.path()).unwrap();
        services
            .local_settings
            .set_current_for_repository(
                elsewhere.path(),
                crate::settings::model::KnowledgeRepository {
                    id: "R_a".to_owned(),
                    full_name: "o/a-docs".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(
            managed_current_clone(&services, app_data.path()).unwrap(),
            None
        );
    }

    #[test]
    fn prepare_reports_an_existing_clone_only_for_the_same_remote() {
        let app_data = tempfile::tempdir().unwrap();
        fake_clone(app_data.path(), "o/docs");

        let same = prepare_docs_repository_inner(app_data.path(), "o/docs").unwrap();
        assert!(same.already_cloned);
        assert_eq!(
            same.parent_directory,
            managed_clone_dir(app_data.path(), "o/docs")
                .unwrap()
                .parent()
                .unwrap()
        );

        let other = managed_clone_dir(app_data.path(), "o/other").unwrap();
        std::fs::create_dir_all(&other).unwrap();
        git2::Repository::init(&other)
            .unwrap()
            .remote("origin", "https://github.com/someone/else.git")
            .unwrap();
        assert!(
            !prepare_docs_repository_inner(app_data.path(), "o/other")
                .unwrap()
                .already_cloned
        );
        assert!(
            !prepare_docs_repository_inner(app_data.path(), "o/missing")
                .unwrap()
                .already_cloned
        );
    }

    #[test]
    fn hub_workspaces_support_standalone_and_project_switching_and_removal() {
        let app_data = tempfile::tempdir().unwrap();
        let settings = LocalSettingsService::new(MemoryStore::default());
        fake_clone(app_data.path(), "Mockly/tech-specs");
        fake_clone(app_data.path(), "Mockly/sprint-docs");

        let standalone = create_standalone_docs_workspace_inner(
            &settings,
            app_data.path(),
            "R_specs",
            "Mockly/tech-specs",
        )
        .unwrap();
        assert_eq!(standalone.workspace.title, "tech-specs");
        assert!(standalone.workspace.project.is_none());
        assert!(standalone.docs_connected);
        assert!(settings
            .load_current()
            .unwrap()
            .unwrap()
            .path
            .ends_with("tech-specs"));

        let project_ws = create_project_workspace_inner(
            &settings,
            app_data.path(),
            LinkedProject {
                id: "PVT_sprint".into(),
                owner: "Mockly".into(),
                number: 3,
                title: "Mockly Sprint".into(),
                scope: ProjectOwnerScope::Organization,
            },
            Some("R_sprint"),
            Some("Mockly/sprint-docs"),
        )
        .unwrap();
        assert_eq!(project_ws.workspace.title, "Mockly Sprint");
        assert!(project_ws.docs_connected);
        assert!(settings
            .load_current()
            .unwrap()
            .unwrap()
            .path
            .ends_with("sprint-docs"));

        // 다시 단독 문서 워크스페이스로 전환하면 현재 문서 저장소 경로도 함께 바뀐다.
        let switched =
            set_active_hub_workspace_inner(&settings, app_data.path(), &standalone.workspace.id)
                .unwrap();
        assert!(switched.docs_connected);
        assert!(settings
            .load_current()
            .unwrap()
            .unwrap()
            .path
            .ends_with("tech-specs"));

        // 활성 워크스페이스를 제거하면 남은 워크스페이스와 그 문서 저장소로 자동 전환된다.
        let after_remove =
            remove_hub_workspace_inner(&settings, app_data.path(), &standalone.workspace.id)
                .unwrap();
        assert_eq!(after_remove.workspaces.len(), 1);
        assert_eq!(
            after_remove.active_workspace_id.as_deref(),
            Some(project_ws.workspace.id.as_str())
        );
        assert!(after_remove.active_docs_connected);
        assert!(settings
            .load_current()
            .unwrap()
            .unwrap()
            .path
            .ends_with("sprint-docs"));
    }

    #[test]
    fn project_workspace_without_docs_can_connect_docs_later_and_detach_board() {
        let app_data = tempfile::tempdir().unwrap();
        let settings = LocalSettingsService::new(MemoryStore::default());
        fake_clone(app_data.path(), "Mockly/sprint-docs");

        let created = create_project_workspace_inner(
            &settings,
            app_data.path(),
            LinkedProject {
                id: "PVT_1".into(),
                owner: "Mockly".into(),
                number: 1,
                title: "보드 전용 시작".into(),
                scope: ProjectOwnerScope::Organization,
            },
            None,
            None,
        )
        .unwrap();
        assert!(!created.docs_connected);
        assert!(settings.load_current().unwrap().is_none());

        let connected = connect_workspace_docs_repository_inner(
            &settings,
            app_data.path(),
            &created.workspace.id,
            "R_sprint",
            "Mockly/sprint-docs",
        )
        .unwrap();
        assert!(connected.docs_connected);
        assert!(settings
            .load_current()
            .unwrap()
            .unwrap()
            .path
            .ends_with("sprint-docs"));

        let after_detach =
            detach_project_from_workspace_inner(&settings, app_data.path(), &created.workspace.id)
                .unwrap();
        assert_eq!(after_detach.workspaces.len(), 1);
        assert!(after_detach.workspaces[0].project.is_none());
        assert_eq!(after_detach.workspaces[0].title, "sprint-docs");
        assert!(after_detach.active_docs_connected);
        assert!(
            list_hub_workspaces_inner(&settings, app_data.path())
                .unwrap()
                .active_docs_connected
        );

        let reattached = attach_project_to_workspace_inner(
            &settings,
            &after_detach.workspaces[0].id,
            LinkedProject {
                id: "PVT_2".into(),
                owner: "Mockly".into(),
                number: 2,
                title: "재연결 보드".into(),
                scope: ProjectOwnerScope::Organization,
            },
        )
        .unwrap();
        assert_eq!(reattached.title, "재연결 보드");
        assert_eq!(
            reattached.project.as_ref().map(|p| p.id.as_str()),
            Some("PVT_2")
        );

        let invalid_repo = create_standalone_docs_workspace_inner(
            &settings,
            app_data.path(),
            "   ",
            "Mockly/sprint-docs",
        )
        .unwrap_err();
        assert_eq!(invalid_repo.code, crate::error::ErrorCode::WorkspaceInvalid);

        let trimmed_standalone = create_standalone_docs_workspace_inner(
            &settings,
            app_data.path(),
            "  R_sprint  ",
            "  Mockly/sprint-docs  ",
        )
        .unwrap();
        assert_eq!(
            trimmed_standalone
                .workspace
                .docs_repository
                .as_ref()
                .map(|repo| repo.full_name.as_str()),
            Some("Mockly/sprint-docs")
        );

        let clone_dir = managed_clone_dir(app_data.path(), "Mockly/sprint-docs").unwrap();
        std::fs::remove_dir_all(&clone_dir).unwrap();
        let after_missing_clone = list_hub_workspaces_inner(&settings, app_data.path()).unwrap();
        assert!(!after_missing_clone.active_docs_connected);
        assert!(settings.load_current().unwrap().is_none());
    }
}
