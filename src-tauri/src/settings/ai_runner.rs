//! AI CLI(Claude Code, Codex, Antigravity, 사용자 지정) 실행의 순수 로직과 프로세스 제어.
//! Tauri 명령 계층은 `settings::commands`에 둔다. Windows와 macOS를 지원한다.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// 한 번의 AI 실행이 넘을 수 없는 시간. 멈춘 CLI가 영원히 "실행 중"으로 남지 않게 한다.
pub const AI_TASK_TIMEOUT: Duration = Duration::from_secs(30 * 60);

const OUTPUT_LIMIT_BYTES: usize = 500 * 1024;
const TRUNCATED_NOTICE: &str = "\n…(출력이 500KB를 넘어 뒷부분을 생략했습니다)";
/// CLI가 끝난 뒤 남은 백그라운드 프로세스가 파이프를 쥐고 있어도 결과를 돌려주기 위한 대기 한도.
const OUTPUT_DRAIN_GRACE: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTool {
    Claude,
    Codex,
    Antigravity,
    Custom,
}

impl AiTool {
    /// 터미널에서 대화형으로 띄울 명령. Codex와 Antigravity는 첫 대화형 프롬프트로 규칙 파일을 전달한다.
    pub fn terminal_command(self, custom_command: &str, rules_file: &Path) -> String {
        let rules = rules_file.display();
        match self {
            AiTool::Claude => format!(
                "claude --append-system-prompt-file {}",
                shell_quote(&rules.to_string())
            ),
            AiTool::Codex => format!(
                "codex {}",
                shell_quote(&format!(
                    "Read the workspace rules in {rules} and follow them during this session. Then wait for my request."
                ))
            ),
            AiTool::Antigravity => format!(
                "agy --prompt-interactive {}",
                shell_quote(&format!(
                    "Read the workspace rules in {rules} and follow them during this session. Then wait for my request."
                ))
            ),
            AiTool::Custom => custom_command.trim().to_owned(),
        }
    }
}

/// `canonicalize`가 만든 `\\?\` 경로는 cmd가 현재 폴더로 쓰지 못하므로 일반 경로로 되돌린다.
pub fn shell_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActiveProjectRuleInfo {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub scope: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinkedCodeRepoRuleInfo {
    pub key: String,
    pub label: String,
    pub full_name: String,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActiveWorkspaceAiContext {
    pub workspace_title: Option<String>,
    pub docs_repository_full_name: Option<String>,
    pub project: Option<ActiveProjectRuleInfo>,
    pub code_repositories: Vec<LinkedCodeRepoRuleInfo>,
}

pub fn active_context_rules(context: &ActiveWorkspaceAiContext) -> String {
    let mut lines = vec![
        "# 현재 선택된 프로젝트 · 저장소 컨텍스트 (앱 자동 반영)".to_owned(),
        String::new(),
        "모든 문서 작성, 기획 PR, 백로그 등록, 코드 구현 PR은 아래 **현재 선택된 대상**에만 반영한다."
            .to_owned(),
        String::new(),
    ];
    if let Some(title) = context.workspace_title.as_deref() {
        lines.push(format!("- 활성 워크스페이스: `{title}`"));
    }
    match &context.project {
        Some(project) => {
            lines.push(format!(
                "- 선택된 GitHub Project: `{}` (`{}` #{} · id: `{}` · scope: `{}`)",
                project.title, project.owner, project.number, project.id, project.scope
            ));
        }
        None => {
            lines.push(
                "- 선택된 GitHub Project: 없음 (문서 저장소 단독 모드 — 보드 작업 전 프로젝트 연결 필요)"
                    .to_owned(),
            );
        }
    }
    match context.docs_repository_full_name.as_deref() {
        Some(full_name) => {
            lines.push(format!(
                "- 연결된 문서 저장소 (기획 PR 대상): `{full_name}`"
            ));
        }
        None => {
            lines.push("- 연결된 문서 저장소: 로컬 폴더 워크스페이스".to_owned());
        }
    }
    if context.code_repositories.is_empty() {
        lines.push(
            "- 연결된 코드 저장소 (`.okf/workspace.yml`): 선언된 코드 저장소 없음".to_owned(),
        );
    } else {
        lines.push("- 연결된 코드 저장소 (구현 PR · 코드 Worktree 대상):".to_owned());
        for repo in &context.code_repositories {
            match repo.local_path.as_deref() {
                Some(path) => lines.push(format!(
                    "  - `{}` ({}): `{}` — 로컬 경로: `{}`",
                    repo.key, repo.label, repo.full_name, path
                )),
                None => lines.push(format!(
                    "  - `{}` ({}): `{}`",
                    repo.key, repo.label, repo.full_name
                )),
            }
        }
    }
    lines.push(
        "- 로컬 자동화 도구: `okhub-cli` (`doc validate`, `pr list|create|approve-merge`, `board list|ready|create-issue|update-status`, `context issue <번호>`, STDIO MCP `okhub-cli mcp`)"
            .to_owned(),
    );
    lines.push(String::new());
    lines.join("\n")
}

pub fn compose_rules(app_rules: &str, fixed_rules: &str, project_rules: Option<&str>) -> String {
    let app_rules = app_rules.trim();
    let fixed_rules = fixed_rules.trim();
    match project_rules.map(str::trim) {
        Some(project) if !project.is_empty() && project != app_rules => {
            format!("{app_rules}\n\n---\n\n{fixed_rules}\n\n---\n\n{project}\n")
        }
        _ => format!("{app_rules}\n\n---\n\n{fixed_rules}\n"),
    }
}

/// 앱이 항상 붙이는 작업 규칙. 앱이 받아 둔 원본 clone은 최신 받기에 쓰므로
/// AI는 worktree에서만 작업한다. 사용자가 고칠 수 있는 AGENTS.md에는 넣지 않는다.
pub fn worktree_rules(repository_root: &Path, worktrees_root: &Path) -> String {
    let root = repository_root.display();
    let worktrees = worktrees_root.display();
    format!(
        "# OkHub 작업 규칙 (앱이 항상 적용)\n\n\
1. 원본 저장소 `{root}`에서는 파일을 고치거나 커밋하지 않는다. 앱이 이 폴더를 GitHub 최신으로 계속 받는다.\n\
2. 작업마다 `git -C \"{root}\" worktree add \"{worktrees}/<branch>\" -b <branch>`로 worktree를 만들고, 그 안에서 작업한다. \
브랜치 이름은 영문 소문자·숫자·`-`·`/`만 쓰고, 만들기 전에 `git check-ref-format --branch <branch>`로 확인한다.\n\
3. 원본 저장소에 있는 git이 추적하지 않는 큰 폴더(`node_modules` 등)는 worktree에 복사하거나 새로 설치하지 말고 링크한다. \
Windows: `cmd /c mklink /J \"<worktree>\\<dir>\" \"{root}\\<dir>\"`, macOS: `ln -s \"{root}/<dir>\" \"<worktree>/<dir>\"`.\n\
4. 사용자가 요청하면 worktree에서 커밋하고 푸시한 뒤 `gh pr create`로 PR을 연다.\n\
5. 세션을 시작하면 `git -C \"{root}\" worktree list`를 확인하고, PR이 머지된 브랜치의 worktree는 `git worktree remove`로 지운 뒤 `git -C \"{root}\" worktree prune`을 실행한다. 머지 전 worktree는 남긴다.\n\
6. GitHub 권한은 앱 로그인 토큰을 쓴다. 터미널을 8시간 넘게 열어 두면 푸시가 실패할 수 있으니, 그때는 사용자에게 새 터미널을 열어 달라고 말한다.\n"
    )
}

/// 앱 로그인 토큰으로 `git push`와 `gh`가 동작하게 하는 환경 변수. 로그인 전이면 비운다.
pub fn terminal_env(access_token: Option<&str>) -> Vec<(String, String)> {
    // 빈 토큰을 넘기면 git이 묻지도 못하고 조용히 실패하므로 로그인하지 않은 것으로 본다.
    let Some(token) = access_token.filter(|token| !token.trim().is_empty()) else {
        return Vec::new();
    };
    let helper_key = "credential.https://github.com.helper";
    [
        ("GH_TOKEN", token),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GIT_CONFIG_COUNT", "2"),
        // 빈 값으로 기존 helper 목록을 비운 뒤 토큰을 돌려주는 helper만 둔다.
        ("GIT_CONFIG_KEY_0", helper_key),
        ("GIT_CONFIG_VALUE_0", ""),
        ("GIT_CONFIG_KEY_1", helper_key),
        (
            "GIT_CONFIG_VALUE_1",
            "!f() { echo username=x-access-token; echo \"password=$GH_TOKEN\"; }; f",
        ),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTaskStatus {
    Completed,
    Cancelled,
    TimedOut,
}

#[derive(Debug)]
pub struct ProcessOutcome {
    pub status: AiTaskStatus,
    pub exit_code: i32,
    pub output: String,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn extend_search_path(current: Option<&OsStr>, extras: &[PathBuf]) -> OsString {
    let mut folders: Vec<PathBuf> =
        current.map_or_else(Vec::new, |path| std::env::split_paths(path).collect());
    for extra in extras {
        if !folders.contains(extra) {
            folders.push(extra.clone());
        }
    }
    std::env::join_paths(&folders)
        .unwrap_or_else(|_| current.map(OsStr::to_os_string).unwrap_or_default())
}

/// Claude Code·Antigravity 단독 설치와 npm 전역 설치 폴더. 레지스트리 PATH에 없을 수 있다.
#[cfg(windows)]
fn windows_cli_folders(
    home: Option<&OsStr>,
    app_data: Option<&OsStr>,
    local_app_data: Option<&OsStr>,
) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(home) = home {
        folders.push(Path::new(home).join(".local").join("bin"));
    }
    if let Some(app_data) = app_data {
        folders.push(Path::new(app_data).join("npm"));
    }
    if let Some(local_app_data) = local_app_data {
        folders.push(Path::new(local_app_data).join("agy").join("bin"));
    }
    folders
}

/// AI CLI를 찾을 PATH. 탐색기로 실행한 앱에도 같은 CLI가 보이도록 설치 폴더를 더한다.
#[cfg(windows)]
pub fn cli_search_path() -> OsString {
    let home = std::env::var_os("USERPROFILE");
    let app_data = std::env::var_os("APPDATA");
    let local_app_data = std::env::var_os("LOCALAPPDATA");
    extend_search_path(
        std::env::var_os("PATH").as_deref(),
        &windows_cli_folders(
            home.as_deref(),
            app_data.as_deref(),
            local_app_data.as_deref(),
        ),
    )
}

/// 창 없이 셸로 한 줄 명령을 실행하는 Command. 표준 입력은 기본으로 비운다.
#[cfg(windows)]
pub fn shell_command(command_line: &str) -> Command {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new("cmd");
    command
        .raw_arg(format!("/S /C \"{command_line}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .env("PATH", cli_search_path())
        .stdin(Stdio::null());
    command
}

/// GUI로 실행된 macOS 앱의 PATH에는 사용자 CLI 경로가 없으므로 로그인 셸을 거친다.
/// 취소할 때 자식까지 함께 끝낼 수 있도록 독립된 프로세스 그룹으로 실행한다.
#[cfg(not(windows))]
pub fn shell_command(command_line: &str) -> Command {
    use std::os::unix::process::CommandExt;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned());
    let mut command = Command::new(shell);
    command
        .args(["-ilc", command_line])
        .process_group(0)
        .stdin(Stdio::null());
    command
}

/// 값을 셸 인자 하나로 인용한다. Windows 경로에는 큰따옴표가 들어갈 수 없다.
#[cfg(windows)]
pub fn shell_quote(value: &str) -> String {
    format!("\"{value}\"")
}

/// 값을 셸 인자 하나로 인용한다. 작은따옴표 안에서는 어떤 문자도 해석되지 않는다.
#[cfg(not(windows))]
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// 경로를 인용한다. cmd는 따옴표 안의 `%`도 펼치므로 그런 경로는 실행하지 않는다.
pub fn shell_quote_path(path: &Path) -> std::io::Result<String> {
    let text = path.display().to_string();
    if cfg!(windows) && text.contains(['%', '"']) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("명령에 넣을 수 없는 문자가 경로에 있습니다: {text}"),
        ));
    }
    Ok(shell_quote(&text))
}

/// 사용자 PATH에서 CLI를 찾을 수 있는지 확인한다.
pub fn is_on_path(program: &str) -> bool {
    let probe = if cfg!(windows) {
        format!("where {program}")
    } else {
        format!("command -v {program}")
    };
    run_process(
        shell_command(&probe),
        Duration::from_secs(10),
        Arc::new(AtomicBool::new(false)),
    )
    .is_ok_and(|outcome| outcome.status == AiTaskStatus::Completed && outcome.exit_code == 0)
}

fn spawn_reader(
    source: Option<impl Read + Send + 'static>,
) -> (Arc<Mutex<Vec<u8>>>, Option<JoinHandle<()>>) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let handle = source.map(|mut source| {
        let buffer = buffer.clone();
        std::thread::spawn(move || {
            let mut chunk = [0_u8; 8192];
            // 한도를 넘어도 끝까지 읽어야 자식이 파이프에 막히지 않는다.
            while let Ok(count) = source.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                if let Ok(mut collected) = buffer.lock() {
                    let room = OUTPUT_LIMIT_BYTES.saturating_sub(collected.len());
                    collected.extend_from_slice(&chunk[..count.min(room)]);
                }
            }
        })
    });
    (buffer, handle)
}

fn kill_process_tree(child: &mut Child) {
    let pid = child.id().to_string();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("/bin/sh")
            .args(["-c", &format!("kill -9 -{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn collected_text(buffer: &Mutex<Vec<u8>>) -> String {
    buffer
        .lock()
        .map(|bytes| {
            let mut text = String::from_utf8_lossy(&bytes).into_owned();
            if bytes.len() >= OUTPUT_LIMIT_BYTES {
                text.push_str(TRUNCATED_NOTICE);
            }
            text
        })
        .unwrap_or_default()
}

/// 프로세스를 끝까지 또는 취소·시간 초과까지 실행하고 출력을 모은다.
pub fn run_process(
    mut command: Command,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
) -> std::io::Result<ProcessOutcome> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let (stdout, stdout_reader) = spawn_reader(child.stdout.take());
    let (stderr, stderr_reader) = spawn_reader(child.stderr.take());

    let started = Instant::now();
    let (status, exit_code) = loop {
        if let Some(exit) = child.try_wait()? {
            break (AiTaskStatus::Completed, exit.code().unwrap_or(-1));
        }
        let stop = if cancel.load(Ordering::SeqCst) {
            Some(AiTaskStatus::Cancelled)
        } else if started.elapsed() >= timeout {
            Some(AiTaskStatus::TimedOut)
        } else {
            None
        };
        if let Some(status) = stop {
            kill_process_tree(&mut child);
            let _ = child.wait();
            break (status, -1);
        }
        std::thread::sleep(POLL_INTERVAL);
    };

    let drain_deadline = Instant::now() + OUTPUT_DRAIN_GRACE;
    for reader in [stdout_reader, stderr_reader].into_iter().flatten() {
        while !reader.is_finished() && Instant::now() < drain_deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    let mut output = collected_text(&stdout);
    let errors = collected_text(&stderr);
    if !errors.is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&errors);
    }
    Ok(ProcessOutcome {
        status,
        exit_code,
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collected_text_marks_output_that_reached_the_limit() {
        let full = Mutex::new(vec![b'a'; OUTPUT_LIMIT_BYTES]);
        let short = Mutex::new(b"short".to_vec());

        assert!(collected_text(&full).ends_with(TRUNCATED_NOTICE));
        assert_eq!(collected_text(&short), "short");
    }

    fn never_cancelled() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    /// 오래 도는 셸 명령. 플랫폼별로 표현만 다르다.
    fn sleep_line() -> &'static str {
        if cfg!(windows) {
            "ping -n 30 127.0.0.1 > nul"
        } else {
            "sleep 30"
        }
    }

    #[test]
    fn claude_terminal_loads_rules_through_the_system_prompt_file() {
        assert_eq!(
            AiTool::Claude.terminal_command("", Path::new("C:\\app data\\rules.md")),
            format!(
                "claude --append-system-prompt-file {}",
                shell_quote("C:\\app data\\rules.md")
            )
        );
    }

    #[test]
    fn codex_terminal_asks_to_read_rules_in_its_first_prompt() {
        let command = AiTool::Codex.terminal_command("", Path::new("C:\\app data\\rules.md"));
        let quote = if cfg!(windows) { '"' } else { '\'' };
        assert!(command.starts_with(&format!("codex {quote}")), "{command}");
        assert!(command.contains("C:\\app data\\rules.md"), "{command}");
        assert!(command.ends_with(quote), "{command}");
    }

    #[test]
    fn antigravity_terminal_asks_to_read_rules_via_prompt_interactive() {
        let command = AiTool::Antigravity.terminal_command("", Path::new("C:\\app data\\rules.md"));
        let quote = if cfg!(windows) { '"' } else { '\'' };
        assert!(
            command.starts_with(&format!("agy --prompt-interactive {quote}")),
            "{command}"
        );
        assert!(command.contains("C:\\app data\\rules.md"), "{command}");
        assert!(command.ends_with(quote), "{command}");
    }

    #[test]
    fn ai_tool_deserializes_antigravity_in_lowercase() {
        let parsed: AiTool = serde_json::from_str("\"antigravity\"").unwrap();
        assert_eq!(parsed, AiTool::Antigravity);
    }

    #[test]
    fn custom_terminal_keeps_the_arguments_the_user_typed() {
        assert_eq!(
            AiTool::Custom.terminal_command("  opencode --model x ", Path::new("rules.md")),
            "opencode --model x"
        );
    }

    #[test]
    fn verbatim_windows_paths_become_paths_cmd_can_enter() {
        assert_eq!(
            shell_path(Path::new(r"\\?\D:\mockly knowledge")),
            PathBuf::from(r"D:\mockly knowledge")
        );
        assert_eq!(
            shell_path(Path::new(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\server\share")
        );
        assert_eq!(
            shell_path(Path::new("/work/repo")),
            PathBuf::from("/work/repo")
        );
    }

    #[test]
    fn rules_combine_hub_and_project_rules_without_repeating_identical_text() {
        let both = compose_rules("허브 규칙\n", "작업 규칙", Some("프로젝트 규칙\n"));
        assert!(both.contains("허브 규칙"));
        assert!(both.contains("프로젝트 규칙"));

        let duplicate = compose_rules("같은 규칙\n", "작업 규칙", Some("같은 규칙"));
        assert_eq!(duplicate.matches("같은 규칙").count(), 1);

        let hub_only = compose_rules("허브 규칙", "작업 규칙", None);
        assert!(hub_only.contains("허브 규칙"));
    }

    #[test]
    fn fixed_rules_sit_between_app_and_project_rules() {
        let rules = compose_rules("앱 규칙", "고정 작업 규칙", Some("저장소 규칙"));

        let app = rules.find("앱 규칙").unwrap();
        let fixed = rules.find("고정 작업 규칙").unwrap();
        let project = rules.find("저장소 규칙").unwrap();
        assert!(app < fixed && fixed < project, "{rules}");
    }

    #[test]
    fn worktree_rules_name_the_real_paths() {
        let rules = worktree_rules(
            Path::new("/data/repos/o/docs"),
            Path::new("/data/worktrees/o/docs"),
        );

        assert!(rules.contains("/data/repos/o/docs"), "{rules}");
        assert!(rules.contains("/data/worktrees/o/docs"), "{rules}");
        assert!(rules.contains("git worktree"), "{rules}");
        assert!(rules.contains("gh pr create"), "{rules}");
        assert!(rules.contains("node_modules"), "{rules}");
        assert!(rules.contains("git check-ref-format --branch"), "{rules}");
    }

    #[test]
    fn terminal_env_omits_credentials_when_signed_out() {
        assert!(terminal_env(None).is_empty());
        assert!(terminal_env(Some("  ")).is_empty());
    }

    #[test]
    fn terminal_env_routes_git_credentials_to_the_token() {
        let env = terminal_env(Some("t"));

        assert!(env.contains(&("GH_TOKEN".to_owned(), "t".to_owned())));
        assert!(env.contains(&("GIT_TERMINAL_PROMPT".to_owned(), "0".to_owned())));
        assert!(env.contains(&("GIT_CONFIG_COUNT".to_owned(), "2".to_owned())));
        assert!(env
            .iter()
            .any(|(key, value)| key == "GIT_CONFIG_VALUE_1" && value.contains("$GH_TOKEN")));
    }

    #[test]
    fn search_path_appends_cli_install_folders_once() {
        let joined =
            std::env::join_paths([PathBuf::from("first"), PathBuf::from("second")]).unwrap();

        let extended = extend_search_path(
            Some(joined.as_os_str()),
            &[PathBuf::from("second"), PathBuf::from("extra")],
        );

        let folders: Vec<PathBuf> = std::env::split_paths(&extended).collect();
        assert_eq!(
            folders,
            [
                PathBuf::from("first"),
                PathBuf::from("second"),
                PathBuf::from("extra"),
            ]
        );
    }

    #[test]
    fn search_path_works_without_an_existing_path() {
        let extended = extend_search_path(None, &[PathBuf::from("extra")]);

        let folders: Vec<PathBuf> = std::env::split_paths(&extended).collect();
        assert_eq!(folders, [PathBuf::from("extra")]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_cli_folders_cover_the_standalone_npm_and_agy_installs() {
        assert_eq!(
            windows_cli_folders(
                Some(std::ffi::OsStr::new(r"C:\Users\me")),
                Some(std::ffi::OsStr::new(r"C:\Users\me\AppData\Roaming")),
                Some(std::ffi::OsStr::new(r"C:\Users\me\AppData\Local")),
            ),
            [
                PathBuf::from(r"C:\Users\me\.local\bin"),
                PathBuf::from(r"C:\Users\me\AppData\Roaming\npm"),
                PathBuf::from(r"C:\Users\me\AppData\Local\agy\bin"),
            ]
        );
    }

    #[test]
    fn run_process_collects_output_and_exit_code() {
        let outcome = run_process(
            shell_command("echo hello"),
            Duration::from_secs(30),
            never_cancelled(),
        )
        .unwrap();

        assert_eq!(outcome.status, AiTaskStatus::Completed);
        assert_eq!(outcome.exit_code, 0);
        assert!(outcome.output.contains("hello"), "{}", outcome.output);
    }

    #[test]
    fn shell_command_keeps_inner_quotes_intact() {
        let outcome = run_process(
            shell_command("echo \"a  b\""),
            Duration::from_secs(30),
            never_cancelled(),
        )
        .unwrap();

        assert!(outcome.output.contains("a  b"), "{}", outcome.output);
    }

    #[test]
    fn run_process_stops_at_the_timeout() {
        let started = Instant::now();
        let outcome = run_process(
            shell_command(sleep_line()),
            Duration::from_millis(300),
            never_cancelled(),
        )
        .unwrap();

        assert_eq!(outcome.status, AiTaskStatus::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn run_process_stops_when_cancelled() {
        let cancel = never_cancelled();
        let trigger = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            trigger.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();

        let outcome =
            run_process(shell_command(sleep_line()), Duration::from_secs(60), cancel).unwrap();

        assert_eq!(outcome.status, AiTaskStatus::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(15));
    }
}
