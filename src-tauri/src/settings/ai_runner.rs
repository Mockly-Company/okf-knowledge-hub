//! AI CLI(Claude Code, Codex, 사용자 지정) 실행의 순수 로직과 프로세스 제어.
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
    Custom,
}

impl AiTool {
    /// 프롬프트를 표준 입력으로 받는 비대화형 명령. 사용자 지정은 템플릿을 쓴다.
    pub fn headless_command(self) -> Option<&'static str> {
        match self {
            AiTool::Claude => Some("claude -p --permission-mode acceptEdits"),
            AiTool::Codex => Some("codex exec --sandbox workspace-write --skip-git-repo-check"),
            AiTool::Custom => None,
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

pub fn compose_rules(app_rules: &str, project_rules: Option<&str>) -> String {
    let app_rules = app_rules.trim();
    match project_rules.map(str::trim) {
        Some(project) if !project.is_empty() && project != app_rules => {
            format!("{app_rules}\n\n---\n\n{project}\n")
        }
        _ => format!("{app_rules}\n"),
    }
}

pub fn compose_task_prompt(rules: &str, request: &str) -> String {
    format!("{}\n\n---\n\n{request}\n", rules.trim())
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

/// Claude Code 단독 설치와 npm 전역 설치 폴더. 레지스트리 PATH에 없을 수 있다.
#[cfg(windows)]
fn windows_cli_folders(home: Option<&OsStr>, app_data: Option<&OsStr>) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(home) = home {
        folders.push(Path::new(home).join(".local").join("bin"));
    }
    if let Some(app_data) = app_data {
        folders.push(Path::new(app_data).join("npm"));
    }
    folders
}

/// AI CLI를 찾을 PATH. 탐색기로 실행한 앱에도 같은 CLI가 보이도록 설치 폴더를 더한다.
#[cfg(windows)]
pub fn cli_search_path() -> OsString {
    let home = std::env::var_os("USERPROFILE");
    let app_data = std::env::var_os("APPDATA");
    extend_search_path(
        std::env::var_os("PATH").as_deref(),
        &windows_cli_folders(home.as_deref(), app_data.as_deref()),
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

/// 동시에 하나의 AI 작업만 돌린다. 앱 전역 관리 상태로 등록한다.
#[derive(Default)]
pub struct AiTaskRegistry {
    running: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

pub struct AiTaskGuard {
    pub cancel: Arc<AtomicBool>,
    running: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

impl AiTaskRegistry {
    pub fn begin(&self) -> Option<AiTaskGuard> {
        let mut running = self.running.lock().ok()?;
        if running.is_some() {
            return None;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *running = Some(cancel.clone());
        Some(AiTaskGuard {
            cancel,
            running: self.running.clone(),
        })
    }

    /// 실행 중인 작업이 있으면 취소를 요청하고 true를 돌려준다.
    pub fn cancel(&self) -> bool {
        let Ok(running) = self.running.lock() else {
            return false;
        };
        match running.as_ref() {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }
}

impl Drop for AiTaskGuard {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            *running = None;
        }
    }
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
    fn presets_have_headless_commands_and_custom_uses_the_template() {
        assert_eq!(
            AiTool::Claude.headless_command(),
            Some("claude -p --permission-mode acceptEdits")
        );
        assert_eq!(
            AiTool::Codex.headless_command(),
            Some("codex exec --sandbox workspace-write --skip-git-repo-check")
        );
        assert_eq!(AiTool::Custom.headless_command(), None);
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
        let both = compose_rules("허브 규칙\n", Some("프로젝트 규칙\n"));
        assert!(both.contains("허브 규칙"));
        assert!(both.contains("프로젝트 규칙"));

        let duplicate = compose_rules("같은 규칙\n", Some("같은 규칙"));
        assert_eq!(duplicate.matches("같은 규칙").count(), 1);

        let hub_only = compose_rules("허브 규칙", None);
        assert!(hub_only.contains("허브 규칙"));
    }

    #[test]
    fn task_prompt_places_rules_before_the_request() {
        let prompt = compose_task_prompt("규칙", "이슈 정리해줘");
        let rules_at = prompt.find("규칙").unwrap();
        let request_at = prompt.find("이슈 정리해줘").unwrap();
        assert!(rules_at < request_at);
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
    fn windows_cli_folders_cover_the_standalone_and_npm_installs() {
        assert_eq!(
            windows_cli_folders(
                Some(std::ffi::OsStr::new(r"C:\Users\me")),
                Some(std::ffi::OsStr::new(r"C:\Users\me\AppData\Roaming")),
            ),
            [
                PathBuf::from(r"C:\Users\me\.local\bin"),
                PathBuf::from(r"C:\Users\me\AppData\Roaming\npm"),
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

    #[test]
    fn registry_allows_one_task_and_frees_the_slot_afterwards() {
        let registry = AiTaskRegistry::default();
        assert!(!registry.cancel());

        let guard = registry.begin().unwrap();
        assert!(registry.begin().is_none());
        assert!(registry.cancel());
        assert!(guard.cancel.load(Ordering::SeqCst));

        drop(guard);
        assert!(registry.begin().is_some());
    }
}
