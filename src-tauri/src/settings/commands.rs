use std::path::{Path, PathBuf};

use tauri::{Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::settings::ai_runner::{self, AiTaskRegistry, AiTaskStatus, AiTool};
use crate::settings::model::DisplayDensity;
use crate::state::AppServices;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct WorkspaceForProject {
    pub path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedWorkspaceItem {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct RememberedWorkspaceList {
    pub items: Vec<RememberedWorkspaceItem>,
}

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

#[tauri::command]
pub fn get_workspace_for_project(
    state: State<'_, AppServices>,
    project_id: String,
) -> CommandResult<WorkspaceForProject> {
    if project_id.trim().is_empty() {
        return Ok(WorkspaceForProject { path: None });
    }
    let path = state
        .local_settings
        .get_workspace_for_project(project_id.trim())?
        .and_then(|path| path.to_str().map(str::to_owned));
    Ok(WorkspaceForProject { path })
}

#[tauri::command]
pub fn set_workspace_for_project(
    state: State<'_, AppServices>,
    project_id: String,
    path: String,
) -> CommandResult<()> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "프로젝트를 지정해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "선택한 폴더가 존재하지 않습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory));
    }
    // 디렉터리 존재 여부까지만 검사한다. workspace.yml 유무는 검사하지 않는다.
    let candidate = Path::new(path);
    if !candidate.is_dir() && candidate.canonicalize().is_err() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "선택한 폴더가 존재하지 않습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory)
        .with_detail("path", path.to_owned()));
    }
    state
        .local_settings
        .set_workspace_for_project(project_id, candidate)?;
    Ok(())
}

#[tauri::command]
pub fn list_remembered_workspaces(
    state: State<'_, AppServices>,
) -> CommandResult<RememberedWorkspaceList> {
    let mut items: Vec<RememberedWorkspaceItem> = state
        .local_settings
        .list_remembered_workspaces()?
        .into_iter()
        .map(|(project_id, path)| RememberedWorkspaceItem {
            project_id,
            path: path.display().to_string(),
        })
        .collect();
    items.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    Ok(RememberedWorkspaceList { items })
}

const AGENTS_MD_LIMIT_BYTES: usize = 200 * 1024;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiConfig {
    pub command_template: String,
    pub cli_command: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AgentsMdResolution {
    pub workspace_path: String,
    pub path: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiTaskResult {
    pub status: AiTaskStatus,
    pub exit_code: i32,
    pub output: String,
}

#[tauri::command]
pub fn get_ai_config(state: State<'_, AppServices>) -> CommandResult<AiConfig> {
    get_ai_config_inner(&state)
}

fn get_ai_config_inner(services: &AppServices) -> CommandResult<AiConfig> {
    Ok(AiConfig {
        command_template: services.local_settings.load_ai_command_template()?,
        cli_command: services.local_settings.load_ai_cli_command()?,
    })
}

#[tauri::command]
pub fn set_ai_config(
    state: State<'_, AppServices>,
    command_template: String,
    cli_command: String,
) -> CommandResult<()> {
    set_ai_config_inner(&state, &command_template, &cli_command)
}

fn set_ai_config_inner(
    services: &AppServices,
    command_template: &str,
    cli_command: &str,
) -> CommandResult<()> {
    services
        .local_settings
        .set_ai_command_template(command_template.trim())?;
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
}

#[tauri::command]
pub async fn detect_ai_tools() -> CommandResult<AiToolAvailability> {
    tauri::async_runtime::spawn_blocking(|| AiToolAvailability {
        claude: ai_runner::is_on_path("claude"),
        codex: ai_runner::is_on_path("codex"),
    })
    .await
    .map_err(|_| ai_blocking_error())
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

/// 허브 공통 규칙과 프로젝트 AGENTS.md를 합친 내용. AI CLI에 전달하는 단일 원본이다.
fn load_ai_rules(app_data_dir: &Path, workspace_dir: &Path) -> CommandResult<String> {
    let app_rules = resolve_app_agents_md_inner(app_data_dir)?.content;
    let (_, project_rules) = read_agents_md(workspace_dir)?;
    Ok(ai_runner::compose_rules(
        &app_rules,
        project_rules.as_deref(),
    ))
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

#[tauri::command]
pub async fn run_ai_task(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    tasks: State<'_, AiTaskRegistry>,
    prompt: String,
    tool: AiTool,
) -> CommandResult<AiTaskResult> {
    let guard = tasks.begin().ok_or_else(|| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "이미 실행 중인 AI 작업이 있습니다.",
        )
    })?;
    let settings = state.local_settings.clone();
    let data_dir = app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_ai_task_blocking(
            &settings,
            &data_dir,
            &prompt,
            tool,
            ai_runner::AI_TASK_TIMEOUT,
            guard.cancel.clone(),
        )
    })
    .await
    .map_err(|_| ai_blocking_error())?
}

#[tauri::command]
pub fn cancel_ai_task(tasks: State<'_, AiTaskRegistry>) -> bool {
    tasks.cancel()
}

fn run_ai_task_blocking(
    settings: &crate::settings::service::LocalSettingsService,
    app_data_dir: &Path,
    prompt: &str,
    tool: AiTool,
    timeout: std::time::Duration,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> CommandResult<AiTaskResult> {
    let template = settings.load_ai_command_template()?;
    if tool == AiTool::Custom && template.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI CLI 명령이 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요.",
        ));
    }
    let workspace_dir = connected_workspace_dir(settings)?;
    let rules = load_ai_rules(app_data_dir, &workspace_dir)?;
    let prompt_file =
        std::env::temp_dir().join(format!("okhub-ai-prompt-{}.md", uuid::Uuid::new_v4()));
    std::fs::write(&prompt_file, ai_runner::compose_task_prompt(&rules, prompt)).map_err(
        |error| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "AI 작업 프롬프트를 임시 파일에 쓸 수 없습니다.",
            )
            .with_recovery(RecoveryAction::Retry)
            .with_detail("reason", error.to_string())
        },
    )?;
    let outcome = build_ai_task_command(tool, &template, &prompt_file, &workspace_dir)
        .and_then(|command| ai_runner::run_process(command, timeout, cancel));
    let _ = std::fs::remove_file(&prompt_file);
    let outcome = outcome.map_err(|error| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI CLI 명령을 실행할 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    Ok(AiTaskResult {
        status: outcome.status,
        exit_code: outcome.exit_code,
        output: outcome.output,
    })
}

fn build_ai_task_command(
    tool: AiTool,
    template: &str,
    prompt_file: &Path,
    workspace_dir: &Path,
) -> std::io::Result<std::process::Command> {
    let mut command = match tool.headless_command() {
        Some(line) => {
            let mut command = ai_runner::shell_command(line);
            command.stdin(std::fs::File::open(prompt_file)?);
            command
        }
        None => {
            let mut command = ai_runner::shell_command(&render_command_template(
                template,
                prompt_file,
                workspace_dir,
            )?);
            // 자리표시가 없으면 요청이 조용히 사라지지 않도록 표준 입력으로 넘긴다.
            if !template.contains("{prompt_file}") {
                command.stdin(std::fs::File::open(prompt_file)?);
            }
            command
        }
    };
    command.current_dir(workspace_dir);
    Ok(command)
}

/// 자리표시를 셸 인자 하나로 인용된 경로로 바꾼다. 경로의 특수문자가 명령으로 해석되지 않는다.
/// 템플릿에 이미 쓴 따옴표는 함께 대체해 이중 인용을 막는다.
fn render_command_template(
    template: &str,
    prompt_file: &Path,
    workspace_dir: &Path,
) -> std::io::Result<String> {
    let mut rendered = template.to_owned();
    for (placeholder, path) in [
        ("{prompt_file}", prompt_file),
        ("{workspace_dir}", workspace_dir),
    ] {
        if !rendered.contains(placeholder) {
            continue;
        }
        let quoted = ai_runner::shell_quote_path(path)?;
        rendered = rendered
            .replace(&format!("\"{placeholder}\""), &quoted)
            .replace(&format!("'{placeholder}'"), &quoted)
            .replace(placeholder, &quoted);
    }
    Ok(rendered)
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
    fn ai_config_round_trip_trims_both_fields() {
        let services = AppServices::new(LocalSettingsService::new(MemoryStore::default()));

        set_ai_config_inner(&services, "  echo hi  ", "  codex  ").unwrap();

        assert_eq!(
            get_ai_config_inner(&services).unwrap(),
            AiConfig {
                command_template: "echo hi".into(),
                cli_command: "codex".into(),
            }
        );
    }

    /// 준비된 워크스페이스와 프로젝트 규칙을 가진 설정 서비스.
    fn settings_with_workspace(directory: &Path) -> LocalSettingsService {
        std::fs::create_dir_all(directory.join(".okf")).unwrap();
        std::fs::write(directory.join(".okf/AGENTS.md"), "# 프로젝트 규칙 표식\n").unwrap();
        std::fs::write(
            directory.join(".okf/workspace.yml"),
            include_str!("../workspace/fixtures/valid-workspace.yml"),
        )
        .unwrap();
        std::fs::create_dir_all(directory.join("docs")).unwrap();
        let settings = LocalSettingsService::new(MemoryStore::default());
        settings.set_current(directory).unwrap();
        settings
    }

    #[test]
    fn custom_task_treats_special_characters_in_paths_as_plain_text() {
        let parent = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "a & echo INJECTED"
        } else {
            "a$(echo INJECTED); echo 'INJECTED"
        };
        let workspace = parent.path().join(name);
        std::fs::create_dir(&workspace).unwrap();
        let printer = if cfg!(windows) { "echo" } else { "printf %s" };
        let prompt_file = parent.path().join("prompt.md");
        std::fs::write(&prompt_file, "").unwrap();

        let command = build_ai_task_command(
            AiTool::Custom,
            &format!("{printer} \"{{workspace_dir}}\""),
            &prompt_file,
            &workspace,
        )
        .unwrap();
        let outcome = ai_runner::run_process(
            command,
            std::time::Duration::from_secs(30),
            Default::default(),
        )
        .unwrap();

        assert_eq!(outcome.exit_code, 0, "{}", outcome.output);
        assert_eq!(
            outcome.output.matches("INJECTED").count(),
            name.matches("INJECTED").count(),
            "{}",
            outcome.output
        );
    }

    #[cfg(windows)]
    #[test]
    fn custom_task_refuses_paths_that_cmd_would_expand() {
        let result = render_command_template(
            "tool {workspace_dir}",
            Path::new("prompt.md"),
            Path::new(r"C:\work\%PATH%"),
        );

        assert!(result.is_err());
    }

    #[test]
    fn custom_task_without_a_placeholder_receives_the_request_on_stdin() {
        let workspace = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let settings = settings_with_workspace(workspace.path());
        let reader = if cfg!(windows) { "more" } else { "cat" };
        settings.set_ai_command_template(reader).unwrap();

        let result = run_ai_task_blocking(
            &settings,
            app_data.path(),
            "STDIN-REQUEST-MARK",
            AiTool::Custom,
            std::time::Duration::from_secs(30),
            Default::default(),
        )
        .unwrap();

        assert_eq!(result.exit_code, 0, "{}", result.output);
        assert!(
            result.output.contains("STDIN-REQUEST-MARK"),
            "{}",
            result.output
        );
    }

    #[test]
    fn custom_task_receives_the_rules_and_request_through_the_prompt_file() {
        let workspace = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let settings = settings_with_workspace(workspace.path());
        let reader = if cfg!(windows) { "type" } else { "cat" };
        settings
            .set_ai_command_template(&format!("{reader} \"{{prompt_file}}\""))
            .unwrap();

        let result = run_ai_task_blocking(
            &settings,
            app_data.path(),
            "한글 요청 표식",
            AiTool::Custom,
            std::time::Duration::from_secs(30),
            Default::default(),
        )
        .unwrap();

        assert_eq!(result.status, AiTaskStatus::Completed);
        assert_eq!(result.exit_code, 0, "{}", result.output);
        assert!(
            result.output.contains("프로젝트 규칙 표식"),
            "{}",
            result.output
        );
        assert!(
            result.output.contains("한글 요청 표식"),
            "{}",
            result.output
        );
    }

    #[test]
    fn custom_task_without_a_template_explains_what_to_set() {
        let app_data = tempfile::tempdir().unwrap();
        let settings = LocalSettingsService::new(MemoryStore::default());

        let error = run_ai_task_blocking(
            &settings,
            app_data.path(),
            "요청",
            AiTool::Custom,
            std::time::Duration::from_secs(30),
            Default::default(),
        )
        .unwrap_err();

        assert!(error.message.contains("AI CLI 명령이 설정되지 않았습니다"));
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
}
