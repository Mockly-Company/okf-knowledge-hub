use std::path::{Path, PathBuf};

use tauri::{Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::settings::ai_runner::{self, AiTool};
use crate::settings::ai_terminal::{AiTerminalRegistry, TerminalEvent};
use crate::settings::model::DisplayDensity;
use crate::state::AppServices;

#[tauri::command]
pub fn get_display_density(state: State<'_, AppServices>) -> CommandResult<DisplayDensity> {
    get_display_density_inner(&state)
}

#[tauri::command]
pub fn set_display_density(
    state: State<'_, AppServices>,
    density: DisplayDensity,
) -> CommandResult<()> {
    set_display_density_inner(&state, density)
}

fn get_display_density_inner(services: &AppServices) -> CommandResult<DisplayDensity> {
    services.local_settings.load_display_density()
}

fn set_display_density_inner(services: &AppServices, density: DisplayDensity) -> CommandResult<()> {
    services.local_settings.set_display_density(density)
}

const AGENTS_MD_LIMIT_BYTES: usize = 200 * 1024;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiConfig {
    pub cli_command: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AgentsMdResolution {
    pub workspace_path: String,
    pub path: Option<String>,
    pub content: Option<String>,
    /// 화면에 보여 줄 문서 저장소 이름(`owner/name`). 경로는 보여 주지 않는다.
    pub repository_full_name: Option<String>,
}

#[tauri::command]
pub fn get_ai_config(state: State<'_, AppServices>) -> CommandResult<AiConfig> {
    get_ai_config_inner(&state)
}

fn get_ai_config_inner(services: &AppServices) -> CommandResult<AiConfig> {
    Ok(AiConfig {
        cli_command: services.local_settings.load_ai_cli_command()?,
    })
}

#[tauri::command]
pub fn set_ai_config(state: State<'_, AppServices>, cli_command: String) -> CommandResult<()> {
    set_ai_config_inner(&state, &cli_command)
}

fn set_ai_config_inner(services: &AppServices, cli_command: &str) -> CommandResult<()> {
    services
        .local_settings
        .set_ai_cli_command(cli_command.trim())?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiToolAvailability {
    pub claude: bool,
    pub codex: bool,
    pub antigravity: bool,
}

#[tauri::command]
pub async fn detect_ai_tools() -> CommandResult<AiToolAvailability> {
    tauri::async_runtime::spawn_blocking(|| AiToolAvailability {
        claude: ai_runner::is_on_path("claude"),
        codex: ai_runner::is_on_path("codex"),
        antigravity: ai_runner::is_on_path("agy"),
    })
    .await
    .map_err(|_| ai_blocking_error())
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiTerminalSession {
    pub session_id: String,
}

#[tauri::command]
pub async fn start_ai_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    terminals: State<'_, AiTerminalRegistry>,
    tool: AiTool,
    cols: u16,
    rows: u16,
    on_event: tauri::ipc::Channel<TerminalEvent>,
) -> CommandResult<AiTerminalSession> {
    let (command_line, workspace_dir) = prepare_ai_terminal(&state, tool, &app_data_dir(&app)?)?;
    // 로그인하지 않았거나 토큰을 받지 못해도 터미널은 연다. 푸시만 안 될 뿐이다.
    let access_token = match state.auth.clone() {
        Some(auth) => auth.valid_access_token().await.ok(),
        None => None,
    };
    let env = ai_runner::terminal_env(
        access_token
            .as_ref()
            .map(crate::auth::model::AccessToken::expose_secret),
    );
    let session_id = terminals
        .start(
            &command_line,
            &workspace_dir,
            cols,
            rows,
            &env,
            move |event| {
                let _ = on_event.send(event);
            },
        )
        .map_err(|reason| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "AI 터미널을 시작할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", reason)
        })?;
    Ok(AiTerminalSession { session_id })
}

#[tauri::command]
pub fn write_ai_terminal(
    terminals: State<'_, AiTerminalRegistry>,
    session_id: String,
    data: String,
) -> bool {
    terminals.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn resize_ai_terminal(
    terminals: State<'_, AiTerminalRegistry>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> bool {
    terminals.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn stop_ai_terminal(terminals: State<'_, AiTerminalRegistry>, session_id: String) -> bool {
    terminals.stop(&session_id)
}

/// 터미널에서 실행할 명령과 폴더를 정한다. 규칙 파일도 이때 새로 쓴다.
fn prepare_ai_terminal(
    services: &AppServices,
    tool: AiTool,
    app_data_dir: &Path,
) -> CommandResult<(String, PathBuf)> {
    let custom_command = services.local_settings.load_ai_cli_command()?;
    if tool == AiTool::Custom && custom_command.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI CLI가 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요.",
        ));
    }
    let workspace_dir = connected_workspace_dir(&services.local_settings)?;
    let worktrees_dir = worktrees_dir_for(services, app_data_dir, &workspace_dir)?;
    let active_context = resolve_active_ai_context(services, &workspace_dir);
    let rules_file = write_rules_file_with_context(
        app_data_dir,
        &workspace_dir,
        &worktrees_dir,
        Some(&active_context),
    )?;
    Ok((
        tool.terminal_command(&custom_command, &rules_file),
        workspace_dir,
    ))
}

fn app_data_dir(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    app.path().app_data_dir().map_err(|_| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "로컬 설정을 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
    })
}

fn connected_workspace_dir(
    settings: &crate::settings::service::LocalSettingsService,
) -> CommandResult<PathBuf> {
    let workspace = settings
        .load_current()?
        .filter(|current| {
            current.status == crate::settings::model::CurrentWorkspaceStatus::Connected
        })
        .ok_or_else(workspace_missing_error)?;
    Ok(ai_runner::shell_path(Path::new(&workspace.path)))
}

/// AI 작업용 worktree를 둘 폴더. 문서 저장소 이름이 없으면 폴더 이름으로 나눈다.
fn worktrees_dir_for(
    services: &AppServices,
    app_data_dir: &Path,
    workspace_dir: &Path,
) -> CommandResult<PathBuf> {
    let full_name = services
        .local_settings
        .load_current()?
        .and_then(|current| current.repository)
        .map(|repository| repository.full_name);
    match full_name {
        Some(full_name) => Ok(ai_runner::shell_path(
            &crate::repository::managed::managed_worktrees_dir(app_data_dir, &full_name)?,
        )),
        None => Ok(app_data_dir.join("worktrees").join(
            workspace_dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "workspace".to_owned()),
        )),
    }
}

/// 허브 공통 규칙, 고정 작업 규칙, 선택된 프로젝트·저장소 컨텍스트, 프로젝트 AGENTS.md를 합친 내용.
fn load_ai_rules(
    app_data_dir: &Path,
    workspace_dir: &Path,
    worktrees_dir: &Path,
    active_context: Option<&ai_runner::ActiveWorkspaceAiContext>,
) -> CommandResult<String> {
    let app_rules = resolve_app_agents_md_inner(app_data_dir)?.content;
    let (_, project_rules) = read_agents_md(workspace_dir)?;
    let fixed = match active_context {
        Some(ctx) => format!(
            "{}\n\n---\n\n{}",
            ai_runner::active_context_rules(ctx).trim(),
            ai_runner::worktree_rules(workspace_dir, worktrees_dir).trim()
        ),
        None => ai_runner::worktree_rules(workspace_dir, worktrees_dir),
    };
    Ok(ai_runner::compose_rules(
        &app_rules,
        &fixed,
        project_rules.as_deref(),
    ))
}

fn resolve_active_ai_context(
    services: &AppServices,
    workspace_dir: &Path,
) -> ai_runner::ActiveWorkspaceAiContext {
    let current = services.local_settings.load_current().ok().flatten();
    let active_hub = services
        .local_settings
        .load_active_hub_workspace()
        .ok()
        .flatten();
    let active_project = services.local_settings.load_active_project().ok().flatten();

    let manifest = std::fs::read_to_string(workspace_dir.join(".okf/workspace.yml"))
        .ok()
        .and_then(|raw| {
            serde_yaml_ng::from_str::<crate::workspace::model::WorkspaceConfigV1>(&raw).ok()
        });

    let project = active_project
        .map(|p| ai_runner::ActiveProjectRuleInfo {
            id: p.id,
            owner: p.owner,
            number: p.number,
            title: p.title,
            scope: match p.scope {
                crate::project_board::model::ProjectOwnerScope::Organization => "organization",
                crate::project_board::model::ProjectOwnerScope::User => "user",
            }
            .to_owned(),
        })
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|m| m.github.as_ref())
                .and_then(|gh| gh.active_project())
                .map(|p| {
                    let fallback_title = manifest
                        .as_ref()
                        .map(|m| m.workspace.name.clone())
                        .unwrap_or_else(|| format!("{}/#{}", p.owner, p.number));
                    ai_runner::ActiveProjectRuleInfo {
                        id: p.id,
                        owner: p.owner,
                        number: p.number,
                        title: fallback_title,
                        scope: match p.scope {
                            Some(crate::project_board::model::ProjectOwnerScope::Organization)
                            | None => "organization",
                            Some(crate::project_board::model::ProjectOwnerScope::User) => "user",
                        }
                        .to_owned(),
                    }
                })
        });

    let docs_repository_full_name = current
        .as_ref()
        .and_then(|c| c.repository.as_ref().map(|r| r.full_name.clone()))
        .or_else(|| {
            active_hub
                .as_ref()
                .and_then(|w| w.docs_repository.as_ref().map(|d| d.full_name.clone()))
        });

    let workspace_title = active_hub
        .as_ref()
        .map(|w| w.title.clone())
        .or_else(|| manifest.as_ref().map(|m| m.workspace.name.clone()));

    let mapped_paths = services
        .local_settings
        .load_code_repository_paths()
        .unwrap_or_default();
    let parent_dir = workspace_dir.parent();
    let code_repositories = manifest
        .as_ref()
        .map(|m| {
            m.repositories
                .iter()
                .map(|repo| {
                    let key_lower = repo.github.full_name.trim().to_ascii_lowercase();
                    let manual = mapped_paths
                        .get(&key_lower)
                        .filter(|candidate| candidate.join(".git").exists())
                        .map(|candidate| ai_runner::shell_path(candidate).display().to_string());
                    let repo_short = repo
                        .github
                        .full_name
                        .split('/')
                        .next_back()
                        .unwrap_or(&repo.key);
                    let sibling = parent_dir
                        .map(|parent| parent.join(repo_short))
                        .filter(|candidate| candidate.join(".git").exists())
                        .map(|candidate| ai_runner::shell_path(&candidate).display().to_string());
                    ai_runner::LinkedCodeRepoRuleInfo {
                        key: repo.key.clone(),
                        label: repo.label.clone(),
                        full_name: repo.github.full_name.clone(),
                        local_path: manual.or(sibling),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    ai_runner::ActiveWorkspaceAiContext {
        workspace_title,
        docs_repository_full_name,
        project,
        code_repositories,
    }
}

/// 다른 워크스페이스의 터미널이 서로의 규칙을 덮어쓰지 않도록 파일을 나눈다.
fn rules_file_name(workspace_dir: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    workspace_dir.hash(&mut hasher);
    format!("AI_SESSION_RULES-{:016x}.md", hasher.finish())
}

#[cfg(test)]
fn write_rules_file(
    app_data_dir: &Path,
    workspace_dir: &Path,
    worktrees_dir: &Path,
) -> CommandResult<PathBuf> {
    write_rules_file_with_context(app_data_dir, workspace_dir, worktrees_dir, None)
}

/// 터미널 CLI가 읽을 규칙 파일. 창이 언제 닫힐지 모르므로 고정 경로에 덮어쓴다.
fn write_rules_file_with_context(
    app_data_dir: &Path,
    workspace_dir: &Path,
    worktrees_dir: &Path,
    active_context: Option<&ai_runner::ActiveWorkspaceAiContext>,
) -> CommandResult<PathBuf> {
    let rules = load_ai_rules(app_data_dir, workspace_dir, worktrees_dir, active_context)?;
    let okhub_dir = app_data_dir.join("okhub");
    std::fs::create_dir_all(&okhub_dir).map_err(|error| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI 규칙 파일을 만들 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    let target = okhub_dir.join(rules_file_name(workspace_dir));
    std::fs::write(&target, rules).map_err(|error| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI 규칙 파일을 만들 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    Ok(ai_runner::shell_path(&target))
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AppAgentsMdResolution {
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn resolve_app_agents_md(app: tauri::AppHandle) -> CommandResult<AppAgentsMdResolution> {
    resolve_app_agents_md_inner(&app_data_dir(&app)?)
}

fn resolve_app_agents_md_inner(app_data_dir: &Path) -> CommandResult<AppAgentsMdResolution> {
    let target = app_data_dir.join("okhub").join("AGENTS.md");
    if target.is_file() {
        let bytes = std::fs::read(&target).map_err(|error| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                "AGENTS.md를 읽을 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", error.to_string())
        })?;
        return Ok(AppAgentsMdResolution {
            path: target.display().to_string(),
            content: truncate_bytes_to_string(bytes, AGENTS_MD_LIMIT_BYTES),
        });
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                "AGENTS.md를 만들 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", error.to_string())
        })?;
    }
    std::fs::write(&target, AGENTS_MD_TEMPLATE).map_err(|error| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "AGENTS.md를 만들 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    Ok(AppAgentsMdResolution {
        path: target.display().to_string(),
        content: AGENTS_MD_TEMPLATE.to_owned(),
    })
}

#[tauri::command]
pub fn resolve_agents_md(state: State<'_, AppServices>) -> CommandResult<AgentsMdResolution> {
    resolve_agents_md_inner(&state)
}

fn resolve_agents_md_inner(services: &AppServices) -> CommandResult<AgentsMdResolution> {
    let current = services
        .local_settings
        .load_current()?
        .ok_or_else(workspace_missing_error)?;
    let workspace_path = current.path;
    let (path, content) = read_agents_md(&workspace_path)?;
    Ok(AgentsMdResolution {
        workspace_path: workspace_path.display().to_string(),
        path,
        content,
        repository_full_name: current.repository.map(|repository| repository.full_name),
    })
}

fn read_agents_md(workspace_root: &Path) -> CommandResult<(Option<String>, Option<String>)> {
    for candidate in [
        workspace_root.join(".okf/AGENTS.md"),
        workspace_root.join("AGENTS.md"),
    ] {
        if !candidate.is_file() {
            continue;
        }
        let bytes = std::fs::read(&candidate).map_err(|error| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                "AGENTS.md를 읽을 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", error.to_string())
        })?;
        return Ok((
            Some(candidate.display().to_string()),
            Some(truncate_bytes_to_string(bytes, AGENTS_MD_LIMIT_BYTES)),
        ));
    }
    Ok((None, None))
}

const AGENTS_MD_TEMPLATE: &str = include_str!("agents_md_template.md");
const AGENTS_MD_RELATIVE_PATH: &str = ".okf/AGENTS.md";

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct CreateAgentsMdResult {
    pub path: String,
}

#[tauri::command]
pub fn create_agents_md(state: State<'_, AppServices>) -> CommandResult<CreateAgentsMdResult> {
    create_agents_md_inner(&state)
}

fn create_agents_md_inner(services: &AppServices) -> CommandResult<CreateAgentsMdResult> {
    let workspace_root = services
        .local_settings
        .load_current()?
        .ok_or_else(workspace_missing_error)?
        .path;
    let target = workspace_root.join(".okf").join("AGENTS.md");
    if target.is_file() {
        return Err(
            AppError::new(ErrorCode::DocumentPathInvalid, "AGENTS.md가 이미 있습니다.")
                .with_recovery(RecoveryAction::OpenWorkspaceFile)
                .with_detail("path", AGENTS_MD_RELATIVE_PATH),
        );
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                "AGENTS.md를 만들 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", error.to_string())
        })?;
    }
    std::fs::write(&target, AGENTS_MD_TEMPLATE).map_err(|error| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "AGENTS.md를 만들 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    Ok(CreateAgentsMdResult {
        path: AGENTS_MD_RELATIVE_PATH.to_owned(),
    })
}

fn truncate_bytes_to_string(bytes: Vec<u8>, limit: usize) -> String {
    let mut bytes = bytes;
    if bytes.len() > limit {
        bytes.truncate(limit);
        while std::str::from_utf8(&bytes).is_err() {
            bytes.pop();
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn workspace_missing_error() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceMissing,
        "연결된 워크스페이스가 없습니다.",
    )
    .with_recovery(RecoveryAction::OpenWorkspaceFile)
}

fn ai_blocking_error() -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "AI 작업을 완료하지 못했습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::error::AppError;
    use crate::settings::model::DisplayDensity;
    use crate::settings::service::{
        LocalSettingsService, LocalSettingsStore, CURRENT_WORKSPACE_PATH_KEY,
    };
    use crate::state::AppServices;

    #[derive(Clone, Default)]
    struct MemoryStore(Arc<Mutex<HashMap<String, String>>>);

    impl MemoryStore {
        fn with_workspace(path: &str) -> Self {
            Self(Arc::new(Mutex::new(HashMap::from([(
                CURRENT_WORKSPACE_PATH_KEY.into(),
                path.into(),
            )]))))
        }

        fn value(&self, key: &str) -> Option<String> {
            self.0.lock().unwrap().get(key).cloned()
        }
    }

    impl LocalSettingsStore for MemoryStore {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.value(key))
        }

        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn density_commands_round_trip_through_the_managed_settings_service() {
        let store = MemoryStore::with_workspace("/workspace/current");
        let services = AppServices::new(LocalSettingsService::new(store.clone()));

        set_display_density_inner(&services, DisplayDensity::Compact).unwrap();

        assert_eq!(
            get_display_density_inner(&services).unwrap(),
            DisplayDensity::Compact
        );
        assert_eq!(
            store.value(CURRENT_WORKSPACE_PATH_KEY).as_deref(),
            Some("/workspace/current")
        );
    }

    #[test]
    fn agents_md_resolution_prefers_dot_okf_and_falls_back_to_nulls() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Mockly\ndocuments:\n  roots:\n    - path: docs\nrepositories: []\n",
                uuid::Uuid::new_v4()
            ),
        )
        .unwrap();
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::with_workspace(
            &directory.path().display().to_string(),
        )));

        let resolved = resolve_agents_md_inner(&services).unwrap();
        assert_eq!(
            resolved.workspace_path,
            directory
                .path()
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );
        assert_eq!(resolved.path, None);
        assert_eq!(resolved.content, None);

        std::fs::write(directory.path().join("AGENTS.md"), "# rules\n").unwrap();
        let resolved = resolve_agents_md_inner(&services).unwrap();
        assert!(resolved.path.as_deref().unwrap().ends_with("AGENTS.md"));
        assert_eq!(resolved.content.as_deref(), Some("# rules\n"));

        std::fs::write(directory.path().join(".okf/AGENTS.md"), "# okf rules\n").unwrap();
        let resolved = resolve_agents_md_inner(&services).unwrap();
        assert!(resolved.path.as_deref().unwrap().contains(".okf"));
        assert_eq!(resolved.content.as_deref(), Some("# okf rules\n"));
    }

    #[test]
    fn create_agents_md_writes_template_once_then_reports_conflict() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
        std::fs::write(
            directory.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Mockly\ndocuments:\n  roots:\n    - path: docs\nrepositories: []\n",
                uuid::Uuid::new_v4()
            ),
        )
        .unwrap();
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::with_workspace(
            &directory.path().display().to_string(),
        )));

        let created = create_agents_md_inner(&services).unwrap();
        assert_eq!(created.path, ".okf/AGENTS.md");
        assert_eq!(
            std::fs::read_to_string(directory.path().join(".okf/AGENTS.md")).unwrap(),
            AGENTS_MD_TEMPLATE
        );

        let error = create_agents_md_inner(&services).unwrap_err();
        assert_eq!(error.message, "AGENTS.md가 이미 있습니다.");
        assert_eq!(error.code, crate::error::ErrorCode::DocumentPathInvalid);
        assert_eq!(
            error.recovery,
            Some(crate::error::RecoveryAction::OpenWorkspaceFile)
        );
    }

    #[test]
    fn ai_config_round_trip_trims_cli_command() {
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));

        set_ai_config_inner(&services, "  codex  ").unwrap();

        assert_eq!(
            get_ai_config_inner(&services).unwrap(),
            AiConfig {
                cli_command: "codex".into(),
            }
        );
    }

    #[test]
    fn custom_terminal_rejects_an_unset_cli_before_checking_the_workspace() {
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));

        let app_data = tempfile::tempdir().unwrap();

        let error = prepare_ai_terminal(&services, AiTool::Custom, app_data.path()).unwrap_err();

        assert_eq!(
            error.message,
            "AI CLI가 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요."
        );
        assert_eq!(
            error.code,
            crate::error::ErrorCode::LocalSettingsUnavailable
        );
    }

    #[test]
    fn presets_open_without_any_saved_command_but_need_a_connected_workspace() {
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));
        let app_data = tempfile::tempdir().unwrap();

        for preset in [AiTool::Claude, AiTool::Codex, AiTool::Antigravity] {
            let error = prepare_ai_terminal(&services, preset, app_data.path()).unwrap_err();
            assert_eq!(error.code, crate::error::ErrorCode::WorkspaceMissing);
        }
    }

    #[test]
    fn tool_availability_serializes_claude_codex_and_antigravity() {
        let value = serde_json::to_value(AiToolAvailability {
            claude: true,
            codex: false,
            antigravity: true,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "claude": true,
                "codex": false,
                "antigravity": true,
            })
        );
    }

    #[test]
    fn each_workspace_gets_its_own_rules_file() {
        assert_ne!(
            rules_file_name(Path::new("workspace-a")),
            rules_file_name(Path::new("workspace-b"))
        );
    }

    #[test]
    fn terminal_rules_file_contains_hub_and_project_rules() {
        let workspace = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        resolve_app_agents_md_inner(app_data.path()).unwrap();
        std::fs::write(workspace.path().join("AGENTS.md"), "# 프로젝트 규칙 표식\n").unwrap();

        let worktrees = app_data.path().join("worktrees").join("o").join("docs");
        let rules_file = write_rules_file(app_data.path(), workspace.path(), &worktrees).unwrap();

        let rules = std::fs::read_to_string(rules_file).unwrap();
        assert!(rules.contains("프로젝트 규칙 표식"), "{rules}");
        assert!(rules.contains("git worktree"), "{rules}");
        assert!(rules.contains(&worktrees.display().to_string()), "{rules}");
        assert!(rules.contains("OkHub 워크스페이스 작업 규칙"), "{rules}");
    }

    #[test]
    fn app_agents_md_is_seeded_once_then_read_back() {
        let app_data_dir = tempfile::tempdir().unwrap();

        let resolved = resolve_app_agents_md_inner(app_data_dir.path()).unwrap();
        assert!(resolved.path.ends_with("AGENTS.md"));
        assert_eq!(resolved.content, AGENTS_MD_TEMPLATE);
        assert_eq!(
            std::fs::read_to_string(app_data_dir.path().join("okhub").join("AGENTS.md")).unwrap(),
            AGENTS_MD_TEMPLATE
        );

        std::fs::write(
            app_data_dir.path().join("okhub").join("AGENTS.md"),
            "# custom\n",
        )
        .unwrap();
        let resolved = resolve_app_agents_md_inner(app_data_dir.path()).unwrap();
        assert_eq!(resolved.content, "# custom\n");
    }

    #[test]
    fn agents_md_template_codifies_dual_format_reset_mark_and_cascading_layers() {
        assert!(AGENTS_MD_TEMPLATE.contains(".md"));
        assert!(AGENTS_MD_TEMPLATE.contains(".html"));
        assert!(AGENTS_MD_TEMPLATE.contains("Reset → Mark"));
        assert!(AGENTS_MD_TEMPLATE.contains("[기획]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[디자인]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[백엔드]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[프론트엔드]"));
        assert!(!AGENTS_MD_TEMPLATE.contains("Mockly-Company"));
    }

    #[test]
    fn terminal_rules_reflect_selected_project_and_linked_repositories_dynamically() {
        use crate::project_board::model::ProjectOwnerScope;
        use crate::settings::model::{DocsRepository, KnowledgeRepository, LinkedProject};

        let docs_a = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(docs_a.path().join(".okf")).unwrap();
        std::fs::create_dir_all(docs_a.path().join("docs")).unwrap();
        std::fs::write(
            docs_a.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Alpha Hub\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: web\n    label: Alpha Web\n    github:\n      id: R_web\n      full_name: acme/alpha-web\n",
                uuid::Uuid::new_v4()
            ),
        )
        .unwrap();

        let docs_b = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(docs_b.path().join(".okf")).unwrap();
        std::fs::create_dir_all(docs_b.path().join("docs")).unwrap();
        std::fs::write(
            docs_b.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Beta Hub\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: api\n    label: Beta API\n    github:\n      id: R_api\n      full_name: globex/beta-api\n",
                uuid::Uuid::new_v4()
            ),
        )
        .unwrap();

        let app_data = tempfile::tempdir().unwrap();
        let settings = LocalSettingsService::new(MemoryStore::default());
        settings
            .link_project(LinkedProject {
                id: "PVT_alpha".into(),
                owner: "acme".into(),
                number: 12,
                title: "Alpha Roadmap".into(),
                scope: ProjectOwnerScope::Organization,
            })
            .unwrap();
        settings
            .set_docs_repository(
                "PVT_alpha",
                DocsRepository {
                    repository_id: "R_docs_a".into(),
                    full_name: "acme/alpha-docs".into(),
                },
            )
            .unwrap();
        settings
            .set_current_for_repository(
                docs_a.path(),
                KnowledgeRepository {
                    id: "R_docs_a".into(),
                    full_name: "acme/alpha-docs".into(),
                },
            )
            .unwrap();

        let services = AppServices::new(settings.clone());
        let (_, dir_a) = prepare_ai_terminal(&services, AiTool::Claude, app_data.path()).unwrap();
        let rules_a =
            std::fs::read_to_string(app_data.path().join("okhub").join(rules_file_name(&dir_a)))
                .unwrap();
        assert!(rules_a.contains("Alpha Roadmap"), "{rules_a}");
        assert!(rules_a.contains("acme"), "{rules_a}");
        assert!(rules_a.contains("#12"), "{rules_a}");
        assert!(rules_a.contains("acme/alpha-docs"), "{rules_a}");
        assert!(rules_a.contains("acme/alpha-web"), "{rules_a}");

        // Now switch active project & repository to Beta -> generated rules must dynamically follow Beta!
        settings
            .link_project(LinkedProject {
                id: "PVT_beta".into(),
                owner: "globex".into(),
                number: 77,
                title: "Beta Board".into(),
                scope: ProjectOwnerScope::Organization,
            })
            .unwrap();
        settings.set_active_project("PVT_beta").unwrap();
        settings
            .set_docs_repository(
                "PVT_beta",
                DocsRepository {
                    repository_id: "R_docs_b".into(),
                    full_name: "globex/beta-docs".into(),
                },
            )
            .unwrap();
        settings
            .set_current_for_repository(
                docs_b.path(),
                KnowledgeRepository {
                    id: "R_docs_b".into(),
                    full_name: "globex/beta-docs".into(),
                },
            )
            .unwrap();

        let (_, dir_b) = prepare_ai_terminal(&services, AiTool::Claude, app_data.path()).unwrap();
        let rules_b =
            std::fs::read_to_string(app_data.path().join("okhub").join(rules_file_name(&dir_b)))
                .unwrap();
        assert!(rules_b.contains("Beta Board"), "{rules_b}");
        assert!(rules_b.contains("#77"), "{rules_b}");
        assert!(rules_b.contains("globex/beta-docs"), "{rules_b}");
        assert!(rules_b.contains("globex/beta-api"), "{rules_b}");
        assert!(!rules_b.contains("acme/alpha-web"), "{rules_b}");
    }
}
