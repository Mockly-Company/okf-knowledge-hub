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

#[tauri::command]
pub fn get_dashboard_last_seen_at(state: State<'_, AppServices>) -> CommandResult<Option<String>> {
    state.local_settings.load_dashboard_last_seen_at()
}

#[tauri::command]
pub fn mark_dashboard_seen(
    state: State<'_, AppServices>,
    timestamp: Option<String>,
) -> CommandResult<String> {
    mark_dashboard_seen_inner(&state, timestamp)
}

pub(crate) fn mark_dashboard_seen_inner(
    services: &AppServices,
    timestamp: Option<String>,
) -> CommandResult<String> {
    let ts = match timestamp
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(value) => {
            if crate::commands::dashboard::parse_rfc3339_unix(Some(value)).is_none() {
                return Err(AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "잘못된 확인 시각 형식입니다.",
                )
                .with_recovery(RecoveryAction::Retry));
            }
            value.to_owned()
        }
        None => time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| {
                AppError::new(
                    ErrorCode::LocalSettingsUnavailable,
                    "현재 시각을 기록하지 못했습니다.",
                )
            })?,
    };
    services
        .local_settings
        .set_dashboard_last_seen_at(Some(&ts))?;
    Ok(ts)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_dashboard_notification_checked(
    state: State<'_, AppServices>,
    notification_id: String,
    checked: bool,
    item_timestamp: Option<String>,
) -> CommandResult<()> {
    set_dashboard_notification_checked_inner(&state, &notification_id, checked, item_timestamp)
}

pub(crate) fn set_dashboard_notification_checked_inner(
    services: &AppServices,
    notification_id: &str,
    checked: bool,
    item_timestamp: Option<String>,
) -> CommandResult<()> {
    services.local_settings.set_dashboard_notification_checked(
        notification_id,
        checked,
        item_timestamp.as_deref(),
    )
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

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskLaunchRequest {
    pub issue_number: Option<u64>,
    pub repository_full_name: Option<String>,
    pub document_path: Option<String>,
    #[serde(default)]
    pub task_mode: Option<String>,
    #[serde(default)]
    pub domain_label: Option<String>,
    #[serde(default)]
    pub document_paths: Option<Vec<String>>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_ai_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    terminals: State<'_, AiTerminalRegistry>,
    tool: AiTool,
    cols: u16,
    rows: u16,
    task_context: Option<AiTaskLaunchRequest>,
    on_event: tauri::ipc::Channel<TerminalEvent>,
) -> CommandResult<AiTerminalSession> {
    let app_data = app_data_dir(&app)?;
    let (command_line, launch_dir) =
        prepare_ai_terminal_async(&state, tool, &app_data, task_context.as_ref()).await?;
    // 로그인하지 않았거나 토큰을 받지 못해도 터미널은 연다. 푸시만 안 될 뿐이다.
    let access_token = match state.auth.clone() {
        Some(auth) => auth.valid_access_token().await.ok(),
        None => None,
    };
    let okhub_cli = ai_runner::resolve_okhub_cli_binary();
    let workspace_dir =
        connected_workspace_dir(&state.local_settings).unwrap_or_else(|_| launch_dir.clone());
    let active_context = resolve_active_ai_context(&state, &workspace_dir);
    let env = ai_runner::terminal_env_with_context(
        access_token
            .as_ref()
            .map(crate::auth::model::AccessToken::expose_secret),
        &app_data,
        &launch_dir,
        &active_context,
        okhub_cli.as_deref(),
    );
    let session_id = terminals
        .start(&command_line, &launch_dir, cols, rows, &env, move |event| {
            let _ = on_event.send(event);
        })
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
    prepare_ai_terminal_with_task_pack(services, tool, app_data_dir, None, None, None)
}

struct PreparedTaskPack {
    slug: String,
    branch_name: String,
    target_repo_dir: PathBuf,
    markdown: String,
}

fn sanitize_doc_slug(raw: &str, prefix: &str, fallback: &str) -> String {
    let safe_slug: String = raw
        .trim_end_matches(".md")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(36)
        .collect();
    if safe_slug.is_empty() {
        fallback.to_owned()
    } else {
        format!("{prefix}-{safe_slug}")
    }
}

fn normalize_workspace_markdown_rel_path(
    workspace_dir: &Path,
    canon_root: &Path,
    raw: &str,
) -> Option<(String, PathBuf)> {
    let mut norm = raw.trim().replace('\\', "/");
    while let Some(stripped) = norm.strip_prefix("./").or_else(|| norm.strip_prefix('/')) {
        norm = stripped.to_owned();
    }
    if norm.is_empty()
        || norm.contains("..")
        || norm.contains('`')
        || norm.chars().any(char::is_control)
        || !norm.to_ascii_lowercase().ends_with(".md")
    {
        return None;
    }
    let canon = workspace_dir.join(&norm).canonicalize().ok()?;
    if !canon.starts_with(canon_root) || !canon.is_file() {
        return None;
    }
    Some((norm, canon))
}

fn build_document_task_pack(
    workspace_dir: &Path,
    req: &AiTaskLaunchRequest,
) -> Option<PreparedTaskPack> {
    let is_audit_mode = req.task_mode.as_deref() == Some("audit_code_sync");
    let canon_root = workspace_dir.canonicalize().ok()?;
    let primary_doc = req
        .document_path
        .as_deref()
        .and_then(|raw| normalize_workspace_markdown_rel_path(workspace_dir, &canon_root, raw))
        .and_then(|(doc_rel, canon_doc)| {
            let doc_content = std::fs::read_to_string(&canon_doc).ok()?;
            Some((doc_rel, doc_content))
        });

    if is_audit_mode {
        let mut target_paths: Vec<String> = Vec::new();
        for raw_path in req.document_paths.as_deref().unwrap_or(&[]) {
            let Some((norm, _canon)) =
                normalize_workspace_markdown_rel_path(workspace_dir, &canon_root, raw_path)
            else {
                continue;
            };
            if !target_paths.iter().any(|existing| existing == &norm) {
                target_paths.push(norm);
            }
        }
        if let Some((ref primary_path, _)) = primary_doc {
            if !target_paths.iter().any(|p| p == primary_path) {
                target_paths.insert(0, primary_path.clone());
            }
        }
        if target_paths.is_empty() && primary_doc.is_none() {
            return None;
        }

        let sanitized_domain = req
            .domain_label
            .as_deref()
            .map(|raw| {
                raw.chars()
                    .map(|ch| {
                        if ch.is_control() || ch == '`' {
                            ' '
                        } else {
                            ch
                        }
                    })
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(80)
                    .collect::<String>()
            })
            .filter(|s| !s.is_empty());
        let domain_label = sanitized_domain.as_deref().unwrap_or("선택된 도메인");
        let slug_seed = primary_doc
            .as_ref()
            .map(|(p, _)| p.as_str())
            .or_else(|| target_paths.first().map(String::as_str))
            .unwrap_or("domain");
        let slug = sanitize_doc_slug(slug_seed, "audit", "audit-code-sync");
        let listed_docs = target_paths
            .iter()
            .map(|p| format!("- `{p}`"))
            .collect::<Vec<_>>()
            .join("\n");
        let primary_context = primary_doc
            .as_ref()
            .map(|(p, body)| format!("\n\n## 기준 문서 원문 (`.md`) — `{p}`\n\n{body}"))
            .unwrap_or_default();

        return Some(PreparedTaskPack {
            branch_name: format!("docs/{slug}"),
            slug,
            target_repo_dir: workspace_dir.to_owned(),
            markdown: format!(
                "# 도메인 코드 반영 점검 (Code Sync Audit) — {domain_label}\n\n\
                 연결된 코드 저장소(`.okf/workspace.yml`의 `repositories`)를 읽기 전용으로 점검하고, 아래 문서들의 실제 코드 반영 여부를 대조한 뒤 각 문서 frontmatter의 `impl_status`를 갱신하세요.\n\n\
                 ## 점검 대상 문서 목록\n{listed_docs}\n\n\
                 ## 반영 기준 및 기록 방법\n\
                 - 각 `.md` 문서마다 MCP 도구 `okhub_update_doc_impl_status`(또는 CLI `okhub-cli doc set-impl-status --path <경로> --status <synced|partial|unimplemented> --note \"<한 줄 사유>\" --checked-at <YYYY-MM-DD>`)를 호출합니다.\n\
                 - `synced` (파란 카드): PRD·화면명세 요구사항이 코드에 완전히 반영됨\n\
                 - `partial` (주황 카드): 일부 구현되었으나 누락·수정 필요 (`note`에 미비점 한 줄 요약)\n\
                 - `unimplemented` (빨강 카드): 아직 코드에 반영되지 않음\n\
                 - 코드 저장소 파일은 직접 수정하지 마세요(읽기 전용 대조 후 문서 frontmatter만 갱신).{primary_context}"
            ),
        });
    }

    let (doc_rel, doc_content) = primary_doc?;
    let slug = sanitize_doc_slug(&doc_rel, "doc", "doc-task");
    Some(PreparedTaskPack {
        branch_name: format!("docs/{slug}"),
        slug,
        target_repo_dir: workspace_dir.to_owned(),
        markdown: format!(
            "# 문서 기반 AI 작업 컨텍스트 — `{doc_rel}`\n\n- 대상 문서 경로: `{doc_rel}`\n- 작업 지침: `.okf/AGENTS.md` 규칙(2벌 `.md`+`.html` 동기화 및 `[NEW]`/`[CHANGED]` 변경 마커 포함)을 준수하세요.\n\n## 기준 문서 원문 (`.md`)\n\n{doc_content}"
        ),
    })
}

async fn prepare_ai_terminal_async(
    services: &AppServices,
    tool: AiTool,
    app_data_dir: &Path,
    task_context: Option<&AiTaskLaunchRequest>,
) -> CommandResult<(String, PathBuf)> {
    let Some(req) = task_context else {
        return prepare_ai_terminal(services, tool, app_data_dir);
    };
    let workspace_dir = connected_workspace_dir(&services.local_settings)?;
    let mut active_context = resolve_active_ai_context(services, &workspace_dir);
    if active_context.current_user_login.is_none() {
        if let Some(auth) = services.auth.as_ref() {
            if let Ok(principal) = auth.authenticated_principal().await {
                active_context.current_user_login = Some(principal.login);
            }
        }
    }

    if let Some(issue_number) = req.issue_number.filter(|n| *n > 0) {
        if let (Some(github), Ok(Some(project))) = (
            services.github.clone(),
            services.local_settings.load_active_project(),
        ) {
            if let Ok((items, _, _, resolved_scope)) = github
                .list_project_items_with_fallback(project.scope, &project.owner, project.number)
                .await
            {
                let wanted_repo = req
                    .repository_full_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                if let Some(target_item) = items.iter().find(|item| {
                    item.number == issue_number
                        && match wanted_repo {
                            Some(want) => item
                                .infer_repository_full_name()
                                .as_deref()
                                .is_some_and(|actual| actual.eq_ignore_ascii_case(want)),
                            None => true,
                        }
                }) {
                    let pack = crate::automation::context_pack::assemble_issue_context_pack(
                        target_item,
                        &items,
                        Some(&workspace_dir),
                        &active_context,
                    );
                    if matches!(
                        pack.layer,
                        crate::project_board::model::BoardLayer::Backend
                            | crate::project_board::model::BoardLayer::Frontend
                    ) {
                        return Err(AppError::new(
                            ErrorCode::WorkspaceInvalid,
                            "OkHub는 기획서·PRD·화면명세서 작성 및 [기획]·[디자인] 백로그 처리 전용입니다. [백엔드]·[프론트엔드] 개발 백로그는 코드 구현 환경에서 진행해 주세요.",
                        )
                        .with_recovery(RecoveryAction::Retry));
                    }
                    if matches!(
                        pack.status,
                        Some(
                            crate::project_board::model::BoardStatus::Backlog
                                | crate::project_board::model::BoardStatus::Ready
                        )
                    ) {
                        let _ = github
                            .update_project_item_fields(
                                &crate::github::model::UpdateProjectItemInput {
                                    project_scope: resolved_scope,
                                    project_owner: project.owner.clone(),
                                    project_number: project.number,
                                    issue_number,
                                    repository_full_name: target_item.infer_repository_full_name(),
                                    status: Some(
                                        crate::project_board::model::BoardStatus::InProgress,
                                    ),
                                    layer: None,
                                    kind: None,
                                    priority: None,
                                },
                            )
                            .await;
                    }
                    let prepared = PreparedTaskPack {
                        slug: format!("issue-{issue_number}"),
                        branch_name: format!("docs/issue-{issue_number}"),
                        target_repo_dir: workspace_dir.clone(),
                        markdown: pack.markdown_summary,
                    };
                    return prepare_ai_terminal_with_task_pack(
                        services,
                        tool,
                        app_data_dir,
                        Some(&workspace_dir),
                        Some(&active_context),
                        Some(&prepared),
                    );
                }
            }
        }
    }

    if let Some(prepared) = build_document_task_pack(&workspace_dir, req) {
        return prepare_ai_terminal_with_task_pack(
            services,
            tool,
            app_data_dir,
            Some(&workspace_dir),
            Some(&active_context),
            Some(&prepared),
        );
    }

    prepare_ai_terminal(services, tool, app_data_dir)
}

fn prepare_ai_terminal_with_task_pack(
    services: &AppServices,
    tool: AiTool,
    app_data_dir: &Path,
    preloaded_workspace_dir: Option<&Path>,
    preloaded_context: Option<&ai_runner::ActiveWorkspaceAiContext>,
    task_pack: Option<&PreparedTaskPack>,
) -> CommandResult<(String, PathBuf)> {
    let custom_command = services.local_settings.load_ai_cli_command()?;
    if tool == AiTool::Custom && custom_command.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI CLI가 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요.",
        ));
    }
    let workspace_dir = match preloaded_workspace_dir {
        Some(dir) => dir.to_path_buf(),
        None => connected_workspace_dir(&services.local_settings)?,
    };
    let worktrees_dir = worktrees_dir_for(services, app_data_dir, &workspace_dir)?;
    let owned_context;
    let active_context = match preloaded_context {
        Some(ctx) => ctx,
        None => {
            owned_context = resolve_active_ai_context(services, &workspace_dir);
            &owned_context
        }
    };

    let launch_dir = match task_pack {
        Some(pack) => ensure_isolated_worktree(
            &pack.target_repo_dir,
            &worktrees_dir,
            &pack.slug,
            &pack.branch_name,
        ),
        None => workspace_dir.clone(),
    };

    let rules_file = write_rules_file_with_context_and_task(
        app_data_dir,
        &workspace_dir,
        &launch_dir,
        &worktrees_dir,
        Some(active_context),
        task_pack,
    )?;
    let okhub_cli = ai_runner::resolve_okhub_cli_binary();
    let mcp_config_path = okhub_cli.as_deref().and_then(|cli_path| {
        let ctx_env = ai_runner::context_env_vars(app_data_dir, &launch_dir, active_context);
        ai_runner::write_mcp_config_file(app_data_dir, &launch_dir, cli_path, &ctx_env).ok()
    });
    Ok((
        tool.terminal_command_with_mcp(
            &custom_command,
            &rules_file,
            mcp_config_path.as_deref(),
            okhub_cli.as_deref(),
        ),
        launch_dir,
    ))
}

fn ensure_isolated_worktree(
    base_repo_dir: &Path,
    worktrees_base_dir: &Path,
    slug: &str,
    branch_name: &str,
) -> PathBuf {
    let wt_dir = worktrees_base_dir.join(slug);
    if wt_dir.join(".git").exists() {
        return ai_runner::shell_path(&wt_dir);
    }
    if base_repo_dir.join(".git").exists() && std::fs::create_dir_all(worktrees_base_dir).is_ok() {
        let base_str = base_repo_dir.display().to_string();
        let wt_str = wt_dir.display().to_string();
        if let Ok(output) = std::process::Command::new("git")
            .args([
                "-C",
                &base_str,
                "worktree",
                "add",
                "-B",
                branch_name,
                &wt_str,
                "HEAD",
            ])
            .output()
        {
            if output.status.success() && wt_dir.exists() {
                return ai_runner::shell_path(&wt_dir);
            }
        }
    }
    ai_runner::shell_path(base_repo_dir)
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

/// 허브 공통 규칙, 고정 작업 규칙, 선택된 프로젝트·저장소 컨텍스트, 작업 Context Pack, 프로젝트 AGENTS.md를 합친 내용.
fn load_ai_rules(
    app_data_dir: &Path,
    workspace_dir: &Path,
    launch_dir: &Path,
    worktrees_dir: &Path,
    active_context: Option<&ai_runner::ActiveWorkspaceAiContext>,
    task_pack: Option<&PreparedTaskPack>,
) -> CommandResult<String> {
    let app_rules = resolve_app_agents_md_inner(app_data_dir)?.content;
    let (_, project_rules) = read_agents_md(workspace_dir)?;
    let mut sections = Vec::new();
    if let Some(ctx) = active_context {
        sections.push(ai_runner::active_context_rules(ctx).trim().to_owned());
    }
    if let Some(pack) = task_pack {
        sections.push(pack.markdown.trim().to_owned());
    }
    match task_pack {
        Some(pack) if launch_dir != workspace_dir => {
            sections.push(
                ai_runner::active_worktree_rules(
                    launch_dir,
                    &pack.target_repo_dir,
                    &pack.branch_name,
                )
                .trim()
                .to_owned(),
            );
        }
        _ => {
            sections.push(
                ai_runner::worktree_rules(launch_dir, worktrees_dir)
                    .trim()
                    .to_owned(),
            );
        }
    }
    let fixed = sections.join("\n\n---\n\n");
    Ok(ai_runner::compose_rules(
        &app_rules,
        &fixed,
        project_rules.as_deref(),
    ))
}

pub(crate) fn resolve_active_ai_context(
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

    let assignees = manifest
        .as_ref()
        .and_then(|m| m.assignees.as_ref())
        .map(crate::workspace::model::WorkspaceAssignees::normalized)
        .filter(|a| !a.is_empty());

    let current_user_login = services
        .auth
        .as_ref()
        .and_then(|auth| auth.cached_principal_login());

    ai_runner::ActiveWorkspaceAiContext {
        workspace_title,
        docs_repository_full_name,
        project,
        code_repositories,
        assignees,
        current_user_login,
    }
}

fn rules_file_name_for_task(workspace_dir: &Path, slug: Option<&str>) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    workspace_dir.hash(&mut hasher);
    if let Some(slug) = slug {
        slug.hash(&mut hasher);
    }
    format!("AI_SESSION_RULES-{:016x}.md", hasher.finish())
}

#[cfg(test)]
fn rules_file_name(workspace_dir: &Path) -> String {
    rules_file_name_for_task(workspace_dir, None)
}

#[cfg(test)]
fn write_rules_file(
    app_data_dir: &Path,
    workspace_dir: &Path,
    worktrees_dir: &Path,
) -> CommandResult<PathBuf> {
    write_rules_file_with_context_and_task(
        app_data_dir,
        workspace_dir,
        workspace_dir,
        worktrees_dir,
        None,
        None,
    )
}

/// 터미널 CLI가 읽을 규칙 파일. 창이 언제 닫힐지 모르므로 고정 경로에 덮어쓴다.
fn write_rules_file_with_context_and_task(
    app_data_dir: &Path,
    workspace_dir: &Path,
    launch_dir: &Path,
    worktrees_dir: &Path,
    active_context: Option<&ai_runner::ActiveWorkspaceAiContext>,
    task_pack: Option<&PreparedTaskPack>,
) -> CommandResult<PathBuf> {
    let rules = load_ai_rules(
        app_data_dir,
        workspace_dir,
        launch_dir,
        worktrees_dir,
        active_context,
        task_pack,
    )?;
    let okhub_dir = app_data_dir.join("okhub");
    std::fs::create_dir_all(&okhub_dir).map_err(|error| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "AI 규칙 파일을 만들 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
        .with_detail("reason", error.to_string())
    })?;
    let target = okhub_dir.join(rules_file_name_for_task(
        workspace_dir,
        task_pack.map(|p| p.slug.as_str()),
    ));
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
    fn agents_md_template_codifies_dual_format_reset_mark_and_non_implementation_boundary() {
        assert!(AGENTS_MD_TEMPLATE.contains(".md"));
        assert!(AGENTS_MD_TEMPLATE.contains(".html"));
        assert!(AGENTS_MD_TEMPLATE.contains("Reset → Mark"));
        assert!(AGENTS_MD_TEMPLATE.contains("PRD"));
        assert!(AGENTS_MD_TEMPLATE.contains("화면명세서"));
        assert!(AGENTS_MD_TEMPLATE.contains("[기획]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[디자인]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[백엔드]"));
        assert!(AGENTS_MD_TEMPLATE.contains("[프론트엔드]"));
        assert!(AGENTS_MD_TEMPLATE.contains("코드 구현을 하지 않는다"));
        assert!(AGENTS_MD_TEMPLATE.contains("wireframes: [{ title, image }]"));
        assert!(AGENTS_MD_TEMPLATE.contains("와이어프레임을 최소 1개"));
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

    #[test]
    fn task_pack_launches_isolated_git_worktree_for_docs_or_code_repo_and_injects_context() {
        use crate::settings::model::KnowledgeRepository;

        let temp = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let docs_repo = temp.path().join("acme-docs");
        let code_repo = temp.path().join("acme-web");
        std::fs::create_dir_all(docs_repo.join(".okf")).unwrap();
        std::fs::create_dir_all(&code_repo).unwrap();
        std::fs::write(
            docs_repo.join(".okf").join("AGENTS.md"),
            "# 팀 문서 규칙: 2벌(.md+.html) 유지\n",
        )
        .unwrap();
        std::fs::write(code_repo.join("README.md"), "# Acme Web\n").unwrap();

        for repo_dir in [&docs_repo, &code_repo] {
            let dir_str = repo_dir.display().to_string();
            assert!(std::process::Command::new("git")
                .args(["-C", &dir_str, "init"])
                .status()
                .unwrap()
                .success());
            assert!(std::process::Command::new("git")
                .args(["-C", &dir_str, "config", "user.email", "dev@example.com"])
                .status()
                .unwrap()
                .success());
            assert!(std::process::Command::new("git")
                .args(["-C", &dir_str, "config", "user.name", "Dev"])
                .status()
                .unwrap()
                .success());
            assert!(std::process::Command::new("git")
                .args(["-C", &dir_str, "add", "-A"])
                .status()
                .unwrap()
                .success());
            assert!(std::process::Command::new("git")
                .args(["-C", &dir_str, "commit", "-m", "init"])
                .status()
                .unwrap()
                .success());
        }

        let settings = LocalSettingsService::new(MemoryStore::default());
        settings
            .set_current_for_repository(
                &docs_repo,
                KnowledgeRepository {
                    id: "R_docs".into(),
                    full_name: "acme/acme-docs".into(),
                },
            )
            .unwrap();
        let services = AppServices::new(settings);

        let docs_pack = super::PreparedTaskPack {
            slug: "issue-63".to_owned(),
            branch_name: "docs/issue-63".to_owned(),
            target_repo_dir: docs_repo.clone(),
            markdown: "# 작업 컨텍스트 팩 — #63 [디자인] 화면명세서 작성\n\n- 완료 조건: 2벌(.md+.html) 화면명세서 확정".to_owned(),
        };
        let (_, launch_dir) = super::prepare_ai_terminal_with_task_pack(
            &services,
            AiTool::Claude,
            app_data.path(),
            None,
            None,
            Some(&docs_pack),
        )
        .unwrap();

        assert!(
            launch_dir.ends_with("issue-63"),
            "launch_dir={launch_dir:?}"
        );
        assert!(launch_dir.join(".okf").join("AGENTS.md").is_file());
        let okhub_dir = app_data.path().join("okhub");
        let rules_path = std::fs::read_dir(&okhub_dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("AI_SESSION_RULES-"))
            })
            .expect("expected generated AI_SESSION_RULES file");
        let rules = std::fs::read_to_string(rules_path).unwrap();
        assert!(rules.contains("# 작업 컨텍스트 팩 — #63 [디자인] 화면명세서 작성"));
        assert!(rules.contains("팀 문서 규칙: 2벌(.md+.html) 유지"));
        assert!(rules.contains("절대 원칙 (코드 구현 금지)"));
        assert!(rules.contains("OkHub 활성 작업 워크트리 규칙"));
    }

    #[test]
    fn mark_dashboard_seen_rejects_invalid_rfc3339_and_preserves_previous_value() {
        let settings = LocalSettingsService::new(MemoryStore::default());
        let services = AppServices::new(settings);

        let saved =
            super::mark_dashboard_seen_inner(&services, Some(" 2026-11-14T08:00:00Z ".to_owned()))
                .unwrap();
        assert_eq!(saved, "2026-11-14T08:00:00Z");

        let err =
            super::mark_dashboard_seen_inner(&services, Some("not-a-valid-timestamp".to_owned()))
                .unwrap_err();
        assert_eq!(err.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            services
                .local_settings
                .load_dashboard_last_seen_at()
                .unwrap()
                .as_deref(),
            Some("2026-11-14T08:00:00Z")
        );
    }

    #[test]
    fn ai_task_launch_request_and_audit_code_sync_pack_deserialize_and_build() {
        let legacy: super::AiTaskLaunchRequest = serde_json::from_str(
            r#"{"documentPath":"docs/domains/board/prd.md","repositoryFullName":"Acme/docs"}"#,
        )
        .unwrap();
        assert_eq!(legacy.task_mode, None);
        assert_eq!(legacy.domain_label, None);
        assert_eq!(legacy.document_paths, None);

        let audit_req: super::AiTaskLaunchRequest = serde_json::from_str(
            r#"{"documentPath":"/docs\\domains\\board\\prd.md","taskMode":"audit_code_sync","domainLabel":"Board `보드`\n# INJECT","documentPaths":["./docs/domains/board/prd.md","docs/domains/board/screen-spec.md","../secret.md","docs/domains/board/evil.md\n## INJECT","docs/domains/board/image.png","docs/domains/board/nonexistent.md"]}"#,
        )
        .unwrap();
        assert_eq!(audit_req.task_mode.as_deref(), Some("audit_code_sync"));

        let temp = tempfile::TempDir::new().unwrap();
        let docs_dir = temp.path().join("docs").join("domains").join("board");
        std::fs::create_dir_all(&docs_dir).unwrap();
        std::fs::write(docs_dir.join("prd.md"), "# 보드 PRD\n\n내용").unwrap();
        std::fs::write(docs_dir.join("screen-spec.md"), "# 보드 화면명세\n\n내용").unwrap();
        std::fs::write(docs_dir.join("image.png"), "png").unwrap();

        let pack = super::build_document_task_pack(temp.path(), &audit_req)
            .expect("audit pack should build");
        assert!(pack.slug.starts_with("audit-"));
        assert!(pack.branch_name.starts_with("docs/audit-"));
        assert!(pack.markdown.contains("Board 보드 # INJECT"));
        assert!(!pack.markdown.contains("## INJECT"));
        assert!(pack.markdown.contains("okhub_update_doc_impl_status"));
        assert!(pack
            .markdown
            .contains("기준 문서 원문 (`.md`) — `docs/domains/board/prd.md`"));
        assert_eq!(
            pack.markdown
                .matches("- `docs/domains/board/prd.md`")
                .count(),
            1
        );
        assert!(pack.markdown.contains("docs/domains/board/screen-spec.md"));
        assert!(!pack.markdown.contains("../secret.md"));
        assert!(!pack.markdown.contains("evil.md"));
        assert!(!pack.markdown.contains("image.png"));
        assert!(!pack.markdown.contains("nonexistent.md"));
    }
}
