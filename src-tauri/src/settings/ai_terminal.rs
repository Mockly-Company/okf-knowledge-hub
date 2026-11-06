//! 앱 안에 띄우는 AI CLI 터미널. Windows는 ConPTY, macOS는 POSIX PTY를 쓴다.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::settings::ai_runner::shell_path;

/// 자식이 끝난 뒤 남은 출력을 전달할 때까지 기다리는 한도.
const OUTPUT_DRAIN_GRACE: Duration = Duration::from_secs(2);
#[cfg(windows)]
const COMMAND_LINE_ENV: &str = "OKHUB_AI_COMMAND";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { exit_code: i32 },
}

/// 청크 경계에서 잘린 UTF-8 문자를 다음 청크까지 보관하는 디코더.
#[derive(Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut decoded = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    decoded.push_str(text);
                    self.pending.clear();
                    return decoded;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    decoded.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                    match error.error_len() {
                        // 문자가 아직 끝나지 않았다. 나머지는 다음 청크에서 잇는다.
                        None => {
                            self.pending.drain(..valid);
                            return decoded;
                        }
                        Some(invalid) => {
                            decoded.push('\u{FFFD}');
                            self.pending.drain(..valid + invalid);
                        }
                    }
                }
            }
        }
    }
}

/// 명령이 끝나도 셸이 남도록 실행한다. 사용자는 이어서 일반 터미널처럼 쓸 수 있다.
/// Windows는 인자 인용 규칙이 cmd와 달라 환경 변수로 넘겨 cmd가 한 번만 해석하게 한다.
#[cfg(windows)]
fn shell_command_builder(command_line: &str) -> CommandBuilder {
    let mut command = CommandBuilder::new("cmd");
    command.args(["/K", &format!("%{COMMAND_LINE_ENV}%")]);
    command.env(COMMAND_LINE_ENV, command_line);
    // CommandBuilder는 PATH를 레지스트리에서 다시 읽으므로 감지와 같은 PATH로 맞춘다.
    command.env("PATH", crate::settings::ai_runner::cli_search_path());
    command
}

#[cfg(not(windows))]
fn shell_command_builder(command_line: &str) -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_owned());
    let mut command = CommandBuilder::new(&shell);
    command.args([
        "-il",
        "-c",
        &format!("{command_line}\nexec \"${{SHELL:-/bin/zsh}}\" -il"),
    ]);
    command
}

struct Session {
    input: Sender<Vec<u8>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

type Sessions = Arc<Mutex<HashMap<String, Arc<Session>>>>;

/// 실행 중인 터미널 세션 목록. 앱 전역 관리 상태로 등록한다.
#[derive(Default)]
pub struct AiTerminalRegistry {
    sessions: Sessions,
}

fn take_session(sessions: &Sessions, session_id: &str) -> Option<Arc<Session>> {
    sessions.lock().ok()?.remove(session_id)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl AiTerminalRegistry {
    pub fn start(
        &self,
        command_line: &str,
        workspace_dir: &Path,
        cols: u16,
        rows: u16,
        sink: impl Fn(TerminalEvent) + Send + Sync + 'static,
    ) -> Result<String, String> {
        let pair = native_pty_system()
            .openpty(pty_size(cols, rows))
            .map_err(|error| error.to_string())?;
        let mut command = shell_command_builder(command_line);
        command.cwd(shell_path(workspace_dir).as_os_str());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        // 프로세스를 띄운 뒤 실패하면 정리할 수 없으므로 입출력을 먼저 준비한다.
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| error.to_string())?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        // 슬레이브를 닫아야 자식이 끝날 때 마스터 쪽 읽기가 끝난다.
        drop(pair.slave);

        let sink = Arc::new(sink);
        let reader_sink = sink.clone();
        let reader_thread = std::thread::spawn(move || {
            let mut decoder = Utf8Decoder::default();
            let mut chunk = [0_u8; 8192];
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                let data = decoder.push(&chunk[..count]);
                if !data.is_empty() {
                    reader_sink(TerminalEvent::Output { data });
                }
            }
        });

        // 입력은 전용 스레드가 순서대로 쓴다. 자식이 읽지 않아도 호출자가 막히지 않는다.
        let (input, input_queue) = channel::<Vec<u8>>();
        std::thread::spawn(move || {
            for data in input_queue {
                if writer
                    .write_all(&data)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    break;
                }
            }
        });

        let session_id = uuid::Uuid::new_v4().to_string();
        let session = Arc::new(Session {
            input,
            master: Mutex::new(pair.master),
            killer: Mutex::new(child.clone_killer()),
        });
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .insert(session_id.clone(), session);

        let sessions = self.sessions.clone();
        let waited_session = session_id.clone();
        std::thread::spawn(move || {
            let exit_code = child
                .wait()
                .map(|status| status.exit_code() as i32)
                .unwrap_or(-1);
            // ConPTY는 마스터를 닫아야 읽기가 끝난다.
            drop(take_session(&sessions, &waited_session));
            let deadline = Instant::now() + OUTPUT_DRAIN_GRACE;
            while !reader_thread.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            sink(TerminalEvent::Exit { exit_code });
        });

        Ok(session_id)
    }

    fn session(&self, session_id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().ok()?.get(session_id).cloned()
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> bool {
        self.session(session_id)
            .is_some_and(|session| session.input.send(data.to_vec()).is_ok())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> bool {
        self.session(session_id).is_some_and(|session| {
            session
                .master
                .lock()
                .is_ok_and(|master| master.resize(pty_size(cols, rows)).is_ok())
        })
    }

    pub fn stop(&self, session_id: &str) -> bool {
        let Some(session) = take_session(&self.sessions, session_id) else {
            return false;
        };
        if let Ok(mut killer) = session.killer.lock() {
            let _ = killer.kill();
        }
        // ConPTY 정리는 출력이 비워질 때까지 막힐 수 있어 호출 스레드에서 하지 않는다.
        std::thread::spawn(move || drop(session));
        true
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, Instant};

    use super::*;

    const WAIT: Duration = Duration::from_secs(20);

    fn collect(
        registry: &AiTerminalRegistry,
        command_line: &str,
        directory: &Path,
    ) -> (String, Receiver<TerminalEvent>) {
        let (sender, receiver) = channel();
        let session = registry
            .start(command_line, directory, 200, 40, move |event| {
                let _ = sender.send(event);
            })
            .unwrap();
        (session, receiver)
    }

    /// ConPTY는 시작할 때 커서 위치를 묻고 답을 기다린다. xterm.js처럼 답한다.
    fn answer_terminal_queries(registry: &AiTerminalRegistry, session: &str, data: &str) {
        if data.contains("\u{1b}[6n") {
            registry.write(session, b"\x1b[1;1R");
        }
    }

    /// 출력에 표식이 나타날 때까지 읽는다.
    fn read_until(
        registry: &AiTerminalRegistry,
        session: &str,
        receiver: &Receiver<TerminalEvent>,
        marker: &str,
    ) {
        let deadline = Instant::now() + WAIT;
        let mut output = String::new();
        while Instant::now() < deadline {
            if let Ok(TerminalEvent::Output { data }) =
                receiver.recv_timeout(Duration::from_millis(200))
            {
                answer_terminal_queries(registry, session, &data);
                output.push_str(&data);
                if output.contains(marker) {
                    return;
                }
            }
        }
        panic!("출력에 {marker:?}가 나타나지 않았습니다: {output:?}");
    }

    fn wait_for_exit(
        registry: &AiTerminalRegistry,
        session: &str,
        receiver: &Receiver<TerminalEvent>,
    ) -> i32 {
        let deadline = Instant::now() + WAIT;
        while Instant::now() < deadline {
            match receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(TerminalEvent::Exit { exit_code }) => return exit_code,
                Ok(TerminalEvent::Output { data }) => {
                    answer_terminal_queries(registry, session, &data);
                }
                Err(_) => {}
            }
        }
        panic!("종료 이벤트가 오지 않았습니다");
    }

    fn print_cwd_line() -> &'static str {
        if cfg!(windows) {
            "cd"
        } else {
            "pwd"
        }
    }

    #[test]
    fn decoder_keeps_a_character_split_across_chunks() {
        let bytes = "한글".as_bytes();
        let mut decoder = Utf8Decoder::default();

        let first = decoder.push(&bytes[..1]);
        let second = decoder.push(&bytes[1..4]);
        let third = decoder.push(&bytes[4..]);

        assert_eq!(first, "");
        assert_eq!(second, "한");
        assert_eq!(third, "글");
    }

    #[test]
    fn decoder_replaces_invalid_bytes_and_continues() {
        let mut decoder = Utf8Decoder::default();

        assert_eq!(decoder.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }

    #[test]
    fn command_line_runs_with_its_quotes_intact() {
        let directory = tempfile::tempdir().unwrap();
        let registry = AiTerminalRegistry::default();

        let (session, events) = collect(&registry, "echo \"okhub  marker\"", directory.path());

        read_until(&registry, &session, &events, "okhub  marker");
        registry.stop(&session);
    }

    #[test]
    fn terminal_starts_in_a_workspace_with_spaces_and_korean() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("내 작업 폴더");
        std::fs::create_dir(&workspace).unwrap();
        let registry = AiTerminalRegistry::default();

        let (session, events) = collect(&registry, print_cwd_line(), &workspace);

        read_until(&registry, &session, &events, "내 작업 폴더");
        registry.stop(&session);
    }

    #[test]
    fn keyboard_input_reaches_the_shell_after_the_command_ends() {
        let directory = tempfile::tempdir().unwrap();
        let registry = AiTerminalRegistry::default();
        let (session, events) = collect(&registry, "echo ready-marker", directory.path());
        read_until(&registry, &session, &events, "ready-marker");

        let sum: &[u8] = if cfg!(windows) {
            b"set /a 1234+4321\r"
        } else {
            b"echo $((1234+4321))\r"
        };
        assert!(registry.write(&session, sum));

        read_until(&registry, &session, &events, "5555");
        registry.stop(&session);
    }

    #[test]
    fn exit_reports_the_code_and_frees_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let registry = AiTerminalRegistry::default();

        let (session, events) = collect(&registry, "exit 3", directory.path());

        assert_eq!(wait_for_exit(&registry, &session, &events), 3);
        assert!(!registry.write(&session, b"x"));
    }

    #[test]
    fn stop_ends_the_session_and_reports_exit() {
        let directory = tempfile::tempdir().unwrap();
        let registry = AiTerminalRegistry::default();
        let (session, events) = collect(&registry, "echo ready-marker", directory.path());
        read_until(&registry, &session, &events, "ready-marker");

        assert!(registry.stop(&session));

        wait_for_exit(&registry, &session, &events);
        assert!(!registry.stop(&session));
    }

    #[test]
    fn resize_applies_only_to_a_live_session() {
        let directory = tempfile::tempdir().unwrap();
        let registry = AiTerminalRegistry::default();
        let (session, _events) = collect(&registry, "echo ready-marker", directory.path());

        assert!(registry.resize(&session, 100, 30));
        assert!(!registry.resize("unknown", 100, 30));

        registry.stop(&session);
    }
}
