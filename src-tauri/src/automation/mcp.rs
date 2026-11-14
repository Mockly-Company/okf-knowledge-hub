use std::io::{BufRead, Write};

use serde::Serialize;
use serde_json::{json, Value};

use crate::automation::context_pack::{parse_board_layer_arg, parse_board_status_arg};
use crate::automation::{AutomationOverrides, AutomationRuntime};
use crate::error::AppError;

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

pub async fn serve_stdio(overrides: AutomationOverrides) -> Result<(), AppError> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = std::io::BufReader::new(stdin.lock());

    while let Some(raw_message) = read_next_rpc_message(&mut reader) {
        if raw_message.trim().is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(&raw_message) {
            Ok(val) => val,
            Err(err) => {
                let err_resp = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": {
                        "code": -32700,
                        "message": format!("Parse error: {err}"),
                    }
                });
                write_rpc_line(&stdout, &err_resp);
                continue;
            }
        };

        if let Some(response) = handle_mcp_request(&overrides, parsed).await {
            write_rpc_line(&stdout, &response);
        }
    }
    Ok(())
}

fn read_next_rpc_message<R: BufRead>(reader: &mut R) -> Option<String> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).ok()?;
        if bytes == 0 {
            return None;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed
            .strip_prefix("Content-Length:")
            .or_else(|| trimmed.strip_prefix("content-length:"))
        {
            let length: usize = rest.trim().parse().ok()?;
            loop {
                line.clear();
                let header_bytes = reader.read_line(&mut line).ok()?;
                if header_bytes == 0 || line.trim().is_empty() {
                    break;
                }
            }
            let mut buf = vec![0u8; length];
            reader.read_exact(&mut buf).ok()?;
            return String::from_utf8(buf).ok();
        }
        return Some(trimmed.to_owned());
    }
}

fn write_rpc_line(stdout: &std::io::Stdout, value: &Value) {
    if let Ok(serialized) = serde_json::to_string(value) {
        let mut handle = stdout.lock();
        let _ = writeln!(handle, "{serialized}");
        let _ = handle.flush();
    }
}

pub async fn handle_mcp_request(overrides: &AutomationOverrides, request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    // Notifications (no `id`) do not expect a JSON-RPC response.
    if id.is_none() || method.starts_with("notifications/") {
        return None;
    }
    let id = id.unwrap_or(Value::Null);

    match method {
        "initialize" => Some(rpc_ok(
            id,
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {
                        "listChanged": false
                    }
                },
                "serverInfo": {
                    "name": "okhub-mcp",
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }),
        )),
        "ping" => Some(rpc_ok(id, json!({}))),
        "tools/list" => Some(rpc_ok(id, json!({ "tools": mcp_tool_definitions() }))),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            let tool_name = params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));

            match dispatch_tool_call(overrides, tool_name, &args).await {
                Ok(payload) => Some(rpc_ok(id, tool_success_result(&payload))),
                Err(error) => Some(rpc_ok(id, tool_error_result(&error))),
            }
        }
        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {method}"),
            }
        })),
    }
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

fn tool_success_result<T: Serialize>(payload: &T) -> Value {
    let text = serde_json::to_string_pretty(payload).unwrap_or_else(|_| "{}".to_owned());
    json!({
        "content": [
            {
                "type": "text",
                "text": text,
            }
        ],
        "isError": false,
    })
}

fn tool_error_result(error: &AppError) -> Value {
    let text = serde_json::to_string_pretty(error)
        .unwrap_or_else(|_| format!("{{\"message\":\"{}\"}}", error.message));
    json!({
        "content": [
            {
                "type": "text",
                "text": text,
            }
        ],
        "isError": true,
    })
}

async fn dispatch_tool_call(
    overrides: &AutomationOverrides,
    tool_name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    let mut effective_overrides = overrides.clone();
    if let Some(ws) = args.get("workspaceDir").and_then(Value::as_str) {
        if !ws.trim().is_empty() {
            effective_overrides.workspace_dir = Some(ws.trim().into());
        }
    }
    if let Some(project_url) = args.get("projectUrl").and_then(Value::as_str) {
        if !project_url.trim().is_empty() {
            effective_overrides.project_url = Some(project_url.trim().to_owned());
        }
    }
    let runtime = AutomationRuntime::load(&effective_overrides)?;

    match tool_name {
        "okhub_get_active_context" => {
            Ok(serde_json::to_value(runtime.active_context_summary()).unwrap_or(Value::Null))
        }
        "okhub_doc_list" => {
            let docs = runtime.list_docs()?;
            Ok(serde_json::to_value(docs).unwrap_or(Value::Null))
        }
        "okhub_doc_read" => {
            let path = required_str(args, "path")?;
            let detail = runtime.read_doc(path)?;
            Ok(serde_json::to_value(detail).unwrap_or(Value::Null))
        }
        "okhub_doc_validate" => {
            let report = runtime.validate_docs()?;
            Ok(serde_json::to_value(report).unwrap_or(Value::Null))
        }
        "okhub_pr_list" => {
            let repo = args.get("repository").and_then(Value::as_str);
            let prs = runtime.list_pull_requests(repo).await?;
            Ok(serde_json::to_value(prs).unwrap_or(Value::Null))
        }
        "okhub_pr_create" => {
            let repo = args.get("repository").and_then(Value::as_str);
            let head = required_str(args, "head")?;
            let base = args.get("base").and_then(Value::as_str);
            let title = required_str(args, "title")?;
            let body = args.get("body").and_then(Value::as_str).unwrap_or_default();
            let draft = args.get("draft").and_then(Value::as_bool).unwrap_or(false);
            let pr = runtime
                .create_pull_request(repo, head, base, title, body, draft)
                .await?;
            Ok(serde_json::to_value(pr).unwrap_or(Value::Null))
        }
        "okhub_pr_approve_merge" => {
            let repo = args.get("repository").and_then(Value::as_str);
            let number = required_u64(args, "number")?;
            let comment = args.get("comment").and_then(Value::as_str);
            let outcome = runtime
                .approve_and_merge_pull_request(repo, number, comment)
                .await?;
            Ok(serde_json::to_value(outcome).unwrap_or(Value::Null))
        }
        "okhub_board_list" => {
            let layer = optional_layer_arg(args, "layer")?;
            let status = optional_status_arg(args, "status")?;
            let items = runtime.list_board_items(layer, status).await?;
            Ok(serde_json::to_value(items).unwrap_or(Value::Null))
        }
        "okhub_board_ready" => {
            let layer = optional_layer_arg(args, "layer")?;
            let ready = runtime.list_ready_items(layer).await?;
            Ok(serde_json::to_value(ready).unwrap_or(Value::Null))
        }
        "okhub_board_create_issue" => {
            let repo = args.get("repository").and_then(Value::as_str);
            let title = required_str(args, "title")?;
            let body = args.get("body").and_then(Value::as_str).unwrap_or_default();
            let layer = optional_layer_arg(args, "layer")?;
            let status = optional_status_arg(args, "status")?;
            let kind = args.get("kind").and_then(Value::as_str).map(str::to_owned);
            let priority = args
                .get("priority")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let parent = optional_u64_arg(args, "parentIssueNumber")?;
            let depends_on = optional_u64_arg(args, "dependsOn")?;
            let created = runtime
                .create_board_issue(
                    repo, title, body, layer, status, kind, priority, parent, depends_on,
                )
                .await?;
            Ok(serde_json::to_value(created).unwrap_or(Value::Null))
        }
        "okhub_board_derive_backlog" => {
            let number = required_u64(args, "number")?;
            let repo = args.get("repository").and_then(Value::as_str);
            let doc_path = args.get("documentPath").and_then(Value::as_str);
            let created = runtime
                .derive_backlog_from_issue(number, repo, doc_path)
                .await?;
            Ok(serde_json::to_value(created).unwrap_or(Value::Null))
        }
        "okhub_board_update_status" => {
            let number = required_u64(args, "number")?;
            let status = optional_status_arg(args, "status")?;
            let layer = optional_layer_arg(args, "layer")?;
            let kind = args.get("kind").and_then(Value::as_str).map(str::to_owned);
            let priority = args
                .get("priority")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let repo = args.get("repository").and_then(Value::as_str);
            let updated = runtime
                .update_board_item_status(number, status, layer, kind, priority, repo)
                .await?;
            Ok(serde_json::to_value(updated).unwrap_or(Value::Null))
        }
        "okhub_context_issue" => {
            let number = required_u64(args, "number")?;
            let pack = runtime.build_issue_context(number).await?;
            Ok(serde_json::to_value(pack).unwrap_or(Value::Null))
        }
        _ => Err(AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("알 수 없는 MCP 도구입니다: {tool_name}"),
        )),
    }
}

fn required_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, AppError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!("필수 문자열 인자 `{key}`가 비어 있습니다."),
            )
        })
}

fn required_u64(args: &Value, key: &str) -> Result<u64, AppError> {
    args.get(key)
        .and_then(Value::as_u64)
        .filter(|n| *n > 0)
        .ok_or_else(|| {
            AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!("필수 양의 정수 인자 `{key}`가 필요합니다."),
            )
        })
}

fn optional_u64_arg(args: &Value, key: &str) -> Result<Option<u64>, AppError> {
    let Some(val) = args.get(key) else {
        return Ok(None);
    };
    if val.is_null() {
        return Ok(None);
    }
    let parsed = val.as_u64().filter(|n| *n > 0).ok_or_else(|| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("`{key}` 인자에는 양의 정수를 지정해 주세요."),
        )
    })?;
    Ok(Some(parsed))
}

fn optional_layer_arg(
    args: &Value,
    key: &str,
) -> Result<Option<crate::project_board::model::BoardLayer>, AppError> {
    let Some(raw) = args.get(key).and_then(Value::as_str) else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    parse_board_layer_arg(raw).map(Some).ok_or_else(|| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("지원하지 않는 `{key}` 값입니다: {raw}"),
        )
    })
}

fn optional_status_arg(
    args: &Value,
    key: &str,
) -> Result<Option<crate::project_board::model::BoardStatus>, AppError> {
    let Some(raw) = args.get(key).and_then(Value::as_str) else {
        return Ok(None);
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    parse_board_status_arg(raw).map(Some).ok_or_else(|| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("지원하지 않는 `{key}` 값입니다: {raw}"),
        )
    })
}

pub fn mcp_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "okhub_get_active_context",
            "description": "현재 OkHub에 선택된 GitHub Project, 문서 저장소, 연결된 코드 저장소 로컬 경로 컨텍스트를 반환합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "okhub_doc_list",
            "description": "현재 문서 저장소의 Markdown(.md) 기획·설계 문서 목록과 .html 동기화 상태 및 변경 하이라이트 유무를 조회합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "okhub_doc_read",
            "description": "지정한 상대 경로의 .md 원본 문서와 동반 .html 동기화/마커 상태를 읽습니다.",
            "inputSchema": {
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "예: docs/product/spec.md" }
                }
            }
        }),
        json!({
            "name": "okhub_doc_validate",
            "description": "문서 저장소의 frontmatter, .md/.html 2벌 동기화, <script> 금지 규칙, [NEW]/[CHANGED] 마커 일관성을 검증합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "okhub_pr_list",
            "description": "현재 선택된 문서 저장소(또는 지정한 저장소)의 열린 Pull Request 목록을 조회합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "repository": { "type": "string", "description": "생략 시 현재 선택된 문서 저장소 사용" }
                }
            }
        }),
        json!({
            "name": "okhub_pr_create",
            "description": "현재 선택된 문서 저장소(또는 지정한 저장소)에 Pull Request를 생성합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["head", "title"],
                "properties": {
                    "repository": { "type": "string" },
                    "head": { "type": "string" },
                    "base": { "type": "string" },
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "draft": { "type": "boolean" }
                }
            }
        }),
        json!({
            "name": "okhub_pr_approve_merge",
            "description": "열린 Pull Request를 승인(작성자와 다를 때)하고 Squash Merge 합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["number"],
                "properties": {
                    "repository": { "type": "string" },
                    "number": { "type": "integer" },
                    "comment": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "okhub_board_list",
            "description": "현재 선택된 GitHub Project 보드의 이슈/항목 목록을 조회합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "layer": { "type": "string", "description": "planning | design | frontend | backend" },
                    "status": { "type": "string", "description": "backlog | ready | in_progress | in_review | done" }
                }
            }
        }),
        json!({
            "name": "okhub_board_ready",
            "description": "선행 단계(`이전 단계: #N`)가 모두 완료되어 지금 바로 시작 가능한 Ready 백로그 항목만 조회합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "layer": { "type": "string", "description": "planning | design | frontend | backend" }
                }
            }
        }),
        json!({
            "name": "okhub_board_create_issue",
            "description": "현재 선택된 GitHub Project와 연결 저장소에 이슈(또는 Sub-issue)를 생성하고 Status/영역/타입 필드를 동적으로 설정합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["title"],
                "properties": {
                    "repository": { "type": "string" },
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "layer": { "type": "string", "description": "planning | design | frontend | backend" },
                    "status": { "type": "string", "description": "backlog | ready | in_progress | in_review | done" },
                    "kind": { "type": "string", "description": "예: 작업, 스토리, 기능, 에픽" },
                    "priority": { "type": "string", "description": "예: P0, P1, P2, High, Medium, Low" },
                    "parentIssueNumber": { "type": "integer" },
                    "dependsOn": { "type": "integer" }
                }
            }
        }),
        json!({
            "name": "okhub_board_derive_backlog",
            "description": "완료된 [기획] 또는 [디자인] 상위 이슈에서 [백엔드]/[프론트엔드] 하위 백로그(Sub-issues + 이전 단계 체인)를 일괄 파생·등록합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["number"],
                "properties": {
                    "number": { "type": "integer" },
                    "repository": { "type": "string" },
                    "documentPath": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "okhub_board_update_status",
            "description": "현재 선택된 GitHub Project에서 지정한 이슈의 Status/영역/타입/Priority 필드를 갱신합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["number"],
                "properties": {
                    "number": { "type": "integer" },
                    "repository": { "type": "string" },
                    "status": { "type": "string" },
                    "layer": { "type": "string" },
                    "kind": { "type": "string" },
                    "priority": { "type": "string" }
                }
            }
        }),
        json!({
            "name": "okhub_context_issue",
            "description": "지정한 이슈 번호의 본문, 선행 이슈 완료 여부, 연결된 .md 문서 원문, 코드 저장소 로컬 경로를 묶은 Context Pack을 반환합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["number"],
                "properties": {
                    "number": { "type": "integer" }
                }
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;

    use crate::automation::AutomationOverrides;

    use super::handle_mcp_request;

    #[tokio::test]
    async fn mcp_server_handles_initialize_tools_list_and_offline_doc_validation() {
        let temp = TempDir::new().unwrap();
        let app_data = temp.path().join("app-data");
        let ws = temp.path().join("acme-docs");
        std::fs::create_dir_all(ws.join(".okf")).unwrap();
        std::fs::create_dir_all(ws.join("docs")).unwrap();
        std::fs::write(
            ws.join(".okf").join("workspace.yml"),
            "schema_version: 1\nworkspace:\n  id: 00000000-0000-0000-0000-000000000001\n  name: Acme Docs\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: web\n    label: Acme Web\n    github:\n      id: R_web\n      full_name: Acme-Org/acme-web\n",
        )
        .unwrap();
        std::fs::write(ws.join("docs").join("overview.md"), "# 개요\n").unwrap();
        std::fs::write(
            ws.join("docs").join("overview.html"),
            "<!doctype html><html><body><h1>개요</h1></body></html>",
        )
        .unwrap();

        let overrides = AutomationOverrides {
            app_data_dir: Some(app_data),
            workspace_dir: Some(ws),
            docs_repo: Some("Acme-Org/acme-docs".to_owned()),
            project_url: Some("https://github.com/orgs/Acme-Org/projects/7".to_owned()),
        };

        let init = handle_mcp_request(
            &overrides,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
        )
        .await
        .unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], "okhub-mcp");

        // Notification returns None
        let notif = handle_mcp_request(
            &overrides,
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        )
        .await;
        assert!(notif.is_none());

        let tools = handle_mcp_request(
            &overrides,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        )
        .await
        .unwrap();
        let tool_names: Vec<&str> = tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["name"].as_str())
            .collect();
        assert!(tool_names.contains(&"okhub_doc_validate"));
        assert!(tool_names.contains(&"okhub_board_ready"));
        assert!(tool_names.contains(&"okhub_context_issue"));

        let ctx_call = handle_mcp_request(
            &overrides,
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": { "name": "okhub_get_active_context", "arguments": {} }
            }),
        )
        .await
        .unwrap();
        assert_eq!(ctx_call["result"]["isError"], false);
        let ctx_text = ctx_call["result"]["content"][0]["text"].as_str().unwrap();
        assert!(ctx_text.contains("Acme-Org/acme-docs"));
        assert!(ctx_text.contains("\"number\": 7"));

        let validate_call = handle_mcp_request(
            &overrides,
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": { "name": "okhub_doc_validate", "arguments": {} }
            }),
        )
        .await
        .unwrap();
        assert_eq!(validate_call["result"]["isError"], false);
        let validate_text = validate_call["result"]["content"][0]["text"]
            .as_str()
            .unwrap();
        assert!(validate_text.contains("\"valid\": true"));
    }
}
