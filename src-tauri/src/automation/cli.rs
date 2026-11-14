use std::path::PathBuf;
use std::process::ExitCode;

use serde::Serialize;

use crate::automation::context_pack::{parse_board_layer_arg, parse_board_status_arg};
use crate::automation::{mcp, AutomationOverrides, AutomationRuntime};
use crate::error::{AppError, ErrorCode};

pub fn run_from_args(raw_args: Vec<String>) -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(err) => {
            eprintln!("error: failed to initialize async runtime: {err}");
            return ExitCode::from(1);
        }
    };
    runtime.block_on(execute_args(raw_args))
}

async fn execute_args(raw_args: Vec<String>) -> ExitCode {
    let mut json_output = false;
    let mut overrides = AutomationOverrides::default();
    let mut positionals = Vec::new();

    let mut idx = 0usize;
    while idx < raw_args.len() {
        let arg = raw_args[idx].as_str();
        match arg {
            "--json" => {
                json_output = true;
                idx += 1;
            }
            "--app-data-dir" if idx + 1 < raw_args.len() => {
                overrides.app_data_dir = Some(PathBuf::from(&raw_args[idx + 1]));
                idx += 2;
            }
            "--workspace-dir" if idx + 1 < raw_args.len() => {
                overrides.workspace_dir = Some(PathBuf::from(&raw_args[idx + 1]));
                idx += 2;
            }
            "--docs-repo" if idx + 1 < raw_args.len() => {
                overrides.docs_repo = Some(raw_args[idx + 1].clone());
                idx += 2;
            }
            "--project" if idx + 1 < raw_args.len() => {
                overrides.project_url = Some(raw_args[idx + 1].clone());
                idx += 2;
            }
            "-h" | "--help" if positionals.is_empty() => {
                print_help();
                return ExitCode::SUCCESS;
            }
            "-V" | "--version" if positionals.is_empty() => {
                println!("okhub-cli {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            _ => {
                positionals.push(raw_args[idx].clone());
                idx += 1;
            }
        }
    }

    if positionals.is_empty() {
        print_help();
        return ExitCode::SUCCESS;
    }

    if positionals[0] == "mcp" {
        if let Err(err) = mcp::serve_stdio(overrides).await {
            emit_error(&err, json_output);
            return ExitCode::from(1);
        }
        return ExitCode::SUCCESS;
    }

    match run_command(&overrides, &positionals, json_output).await {
        Ok(code) => code,
        Err(err) => {
            emit_error(&err, json_output);
            ExitCode::from(1)
        }
    }
}

async fn run_command(
    overrides: &AutomationOverrides,
    args: &[String],
    json_output: bool,
) -> Result<ExitCode, AppError> {
    let runtime = AutomationRuntime::load(overrides)?;
    let group = args[0].as_str();
    let sub = args.get(1).map(String::as_str).unwrap_or_default();

    match (group, sub) {
        ("context", "active" | "") => {
            let summary = runtime.active_context_summary();
            if json_output {
                emit_json(&summary);
            } else {
                println!(
                    "워크스페이스: {}",
                    summary.workspace_title.as_deref().unwrap_or("(미연결)")
                );
                println!(
                    "문서 저장소: {} ({})",
                    summary
                        .docs_repository_full_name
                        .as_deref()
                        .unwrap_or("(미연결)"),
                    summary.workspace_dir.as_deref().unwrap_or("-")
                );
                match &summary.project {
                    Some(proj) => println!(
                        "활성 GitHub Project: {} (#{} · {})",
                        if proj.title.is_empty() {
                            &proj.owner
                        } else {
                            &proj.title
                        },
                        proj.number,
                        proj.owner
                    ),
                    None => println!("활성 GitHub Project: (없음)"),
                }
                for repo in &summary.code_repositories {
                    println!(
                        "코드 저장소 [{}]: {} -> {}",
                        repo.key,
                        repo.full_name,
                        repo.local_path.as_deref().unwrap_or("(로컬 미연결)")
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        ("context", "issue") => {
            let number = parse_u64_arg(args.get(2), "이슈 번호")?;
            let pack = runtime.build_issue_context(number).await?;
            if json_output {
                emit_json(&pack);
            } else {
                println!("{}", pack.markdown_summary);
            }
            Ok(ExitCode::SUCCESS)
        }
        ("doc", "list") => {
            let docs = runtime.list_docs()?;
            if json_output {
                emit_json(&docs);
            } else {
                for doc in docs {
                    let marker = if doc.has_change_markers {
                        " [CHANGED/NEW]"
                    } else {
                        ""
                    };
                    println!(
                        "{}  (html: {}){} — {}",
                        doc.path, doc.html_sync_status, marker, doc.title
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        ("doc", "read") => {
            let path = args.get(2).ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "읽을 문서 경로를 지정해 주세요.",
                )
            })?;
            let detail = runtime.read_doc(path)?;
            if json_output {
                emit_json(&detail);
            } else {
                println!("{}", detail.markdown);
            }
            Ok(ExitCode::SUCCESS)
        }
        ("doc", "validate") => {
            let report = runtime.validate_docs()?;
            if json_output {
                emit_json(&report);
            } else {
                println!(
                    "검증 문서 수: {} · 결과: {}",
                    report.checked_documents,
                    if report.valid {
                        "통과"
                    } else {
                        "오류 있음"
                    }
                );
                if !report.highlighted_markdown_files.is_empty() {
                    println!(
                        "변경 마커(.md): {}",
                        report.highlighted_markdown_files.join(", ")
                    );
                }
                for issue in &report.issues {
                    println!(
                        "[{}] {} ({}): {}",
                        issue.severity.to_ascii_uppercase(),
                        issue.path,
                        issue.code,
                        issue.message
                    );
                }
            }
            Ok(if report.valid {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(2)
            })
        }
        ("pr", "list") => {
            let repo = find_flag_value(&args[2..], "--repo");
            let prs = runtime.list_pull_requests(repo.as_deref()).await?;
            if json_output {
                emit_json(&prs);
            } else {
                for pr in prs {
                    println!(
                        "#{} [{}] {} ({}) -> {}",
                        pr.number, pr.author_login, pr.title, pr.head_ref, pr.html_url
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        ("pr", "create") => {
            let rest = &args[2..];
            let repo = find_flag_value(rest, "--repo");
            let head = find_flag_value(rest, "--head").ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "`--head <브랜치>` 인자가 필요합니다.",
                )
            })?;
            let base = find_flag_value(rest, "--base");
            let title = find_flag_value(rest, "--title").ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "`--title <제목>` 인자가 필요합니다.",
                )
            })?;
            let body = find_flag_value(rest, "--body").unwrap_or_default();
            let draft = rest.iter().any(|item| item == "--draft");
            let pr = runtime
                .create_pull_request(
                    repo.as_deref(),
                    &head,
                    base.as_deref(),
                    &title,
                    &body,
                    draft,
                )
                .await?;
            if json_output {
                emit_json(&pr);
            } else {
                println!("PR #{} 생성됨: {}", pr.number, pr.html_url);
            }
            Ok(ExitCode::SUCCESS)
        }
        ("pr", "approve-merge") => {
            let number = parse_u64_arg(args.get(2), "PR 번호")?;
            let rest = if args.len() > 3 { &args[3..] } else { &[] };
            let repo = find_flag_value(rest, "--repo");
            let comment = find_flag_value(rest, "--comment");
            let outcome = runtime
                .approve_and_merge_pull_request(repo.as_deref(), number, comment.as_deref())
                .await?;
            if json_output {
                emit_json(&outcome);
            } else {
                println!(
                    "PR #{} 머지 완료 ({} · sha: {})",
                    outcome.number,
                    outcome.repository_full_name,
                    outcome.merge_commit_sha.as_deref().unwrap_or("-")
                );
            }
            Ok(ExitCode::SUCCESS)
        }
        ("board", "list") => {
            let rest = &args[2..];
            let layer = find_flag_value(rest, "--layer").and_then(|s| parse_board_layer_arg(&s));
            let status = find_flag_value(rest, "--status").and_then(|s| parse_board_status_arg(&s));
            let items = runtime.list_board_items(layer, status).await?;
            if json_output {
                emit_json(&items);
            } else {
                for item in items {
                    println!(
                        "#{} [{} / {}] {}",
                        item.number,
                        item.area.as_deref().unwrap_or("-"),
                        item.status.as_deref().unwrap_or("-"),
                        item.title
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        ("board", "ready") => {
            let rest = &args[2..];
            let layer = find_flag_value(rest, "--layer").and_then(|s| parse_board_layer_arg(&s));
            let ready = runtime.list_ready_items(layer).await?;
            if json_output {
                emit_json(&ready);
            } else {
                for item in ready {
                    println!(
                        "#{} [{}] {} ({})",
                        item.number,
                        item.layer.display_name(),
                        item.title,
                        item.url
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        ("board", "create-issue") => {
            let rest = &args[2..];
            let repo = find_flag_value(rest, "--repo");
            let title = find_flag_value(rest, "--title").ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "`--title <이슈 제목>` 인자가 필요합니다.",
                )
            })?;
            let body = find_flag_value(rest, "--body").unwrap_or_default();
            let layer = find_flag_value(rest, "--layer").and_then(|s| parse_board_layer_arg(&s));
            let status = find_flag_value(rest, "--status").and_then(|s| parse_board_status_arg(&s));
            let kind = find_flag_value(rest, "--kind");
            let parent = find_flag_value(rest, "--parent").and_then(|s| s.parse::<u64>().ok());
            let depends_on =
                find_flag_value(rest, "--depends-on").and_then(|s| s.parse::<u64>().ok());
            let created = runtime
                .create_board_issue(
                    repo.as_deref(),
                    &title,
                    &body,
                    layer,
                    status,
                    kind,
                    parent,
                    depends_on,
                )
                .await?;
            if json_output {
                emit_json(&created);
            } else {
                println!(
                    "이슈 #{} 생성 및 프로젝트 등록 완료: {}",
                    created.number, created.url
                );
            }
            Ok(ExitCode::SUCCESS)
        }
        ("board", "update-status") => {
            let number = parse_u64_arg(args.get(2), "이슈 번호")?;
            let status_raw = args.get(3).ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "변경할 상태(backlog | ready | in_progress | in_review | done)를 지정해 주세요.",
                )
            })?;
            let status = parse_board_status_arg(status_raw).ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    format!("지원하지 않는 상태 값입니다: {status_raw}"),
                )
            })?;
            let rest = if args.len() > 4 { &args[4..] } else { &[] };
            let layer = find_flag_value(rest, "--layer").and_then(|s| parse_board_layer_arg(&s));
            let kind = find_flag_value(rest, "--kind");
            let repo = find_flag_value(rest, "--repo");
            let updated = runtime
                .update_board_item_status(number, Some(status), layer, kind, repo.as_deref())
                .await?;
            if json_output {
                emit_json(&updated);
            } else {
                println!(
                    "이슈 #{} 상태 갱신 완료: {}",
                    updated.number,
                    updated.status.as_deref().unwrap_or("-")
                );
            }
            Ok(ExitCode::SUCCESS)
        }
        _ => {
            print_help();
            Err(AppError::new(
                ErrorCode::WorkspaceInvalid,
                format!("알 수 없는 명령입니다: {}", args.join(" ")),
            ))
        }
    }
}

fn find_flag_value(args: &[String], flag: &str) -> Option<String> {
    let mut iter = args.iter();
    while let Some(item) = iter.next() {
        if item == flag {
            return iter.next().cloned();
        }
    }
    None
}

fn parse_u64_arg(raw: Option<&String>, label: &str) -> Result<u64, AppError> {
    raw.and_then(|s| s.trim().trim_start_matches('#').parse::<u64>().ok())
        .filter(|n| *n > 0)
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::WorkspaceInvalid,
                format!("유효한 {label} 숫자를 입력해 주세요."),
            )
        })
}

fn emit_json<T: Serialize>(value: &T) {
    if let Ok(text) = serde_json::to_string_pretty(value) {
        println!("{text}");
    }
}

fn emit_error(error: &AppError, json_output: bool) {
    if json_output {
        if let Ok(text) = serde_json::to_string_pretty(error) {
            eprintln!("{text}");
            return;
        }
    }
    eprintln!("오류 [{}]: {}", format_error_code(error), error.message);
}

fn format_error_code(error: &AppError) -> String {
    serde_json::to_value(error.code.clone())
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "error".to_owned())
}

fn print_help() {
    println!(
        "\
okhub-cli — OkHub 동적 프로젝트·저장소 자동화 CLI 및 STDIO MCP 서버

사용법:
  okhub-cli [--json] [--workspace-dir <경로>] [--project <GitHub Project URL>] <명령>

명령:
  context active                                 현재 선택된 Project·문서/코드 저장소 컨텍스트 출력
  context issue <번호>                            이슈 본문·선행 단계·연결 .md 문서 Context Pack 출력
  doc list                                       문서 저장소의 .md 목록 및 .html 동기화 상태 출력
  doc read <경로>                                지정한 .md 문서 읽기
  doc validate                                   frontmatter, .md+.html 2벌 동기화, 변경 마커 검증
  pr list [--repo <owner/name>]                  열린 PR 목록 조회
  pr create --head <브랜치> --title <제목> [...]   기획/코드 PR 생성
  pr approve-merge <번호> [--comment <메모>]      PR 승인 및 Squash Merge
  board list [--layer <...>] [--status <...>]    선택된 GitHub Project 보드 항목 조회
  board ready [--layer <...>]                    선행 단계가 완료된 시작 가능(Ready) 백로그 조회
  board create-issue --title <제목> [...]         선택된 GitHub Project에 이슈/하위 이슈 동적 생성
  board update-status <번호> <상태> [...]          선택된 GitHub Project 이슈 상태/영역/타입 변경
  mcp                                            STDIO 기반 MCP(Model Context Protocol) 서버 실행"
    );
}
