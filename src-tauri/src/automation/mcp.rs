#[cfg(test)]
use serde::Serialize;
use serde_json::{json, Value};

use crate::automation::context_pack::{parse_board_layer_arg, parse_board_status_arg};
use crate::automation::{AutomationOverrides, AutomationRuntime};
use crate::error::AppError;

#[cfg(test)]
const MCP_PROTOCOL_VERSION: &str = "2025-11-25";

pub async fn serve_stdio(overrides: AutomationOverrides) -> Result<(), AppError> {
    super::mcp_sdk::serve_stdio(overrides).await
}

#[cfg(test)]
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

#[cfg(test)]
fn rpc_ok(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

#[cfg(test)]
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

#[cfg(test)]
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

#[cfg(test)]
async fn dispatch_tool_call(
    overrides: &AutomationOverrides,
    tool_name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    super::mcp_sdk::validate_tool_args(tool_name, args, true)?;
    if super::mcp_sdk::is_write_tool(tool_name) {
        return Err(super::mcp_sdk::error(
            "SDK 사용자 확인 경로로 호출해야 합니다.",
        ));
    }
    let runtime = AutomationRuntime::load(overrides)?;
    dispatch_runtime_tool_call(&runtime, tool_name, args).await
}

pub(super) async fn dispatch_runtime_tool_call(
    runtime: &AutomationRuntime,
    tool_name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    match tool_name {
        "okhub_get_active_context" => {
            Ok(serde_json::to_value(runtime.active_context_summary()).unwrap_or(Value::Null))
        }
        "okhub_doc_list" => super::mcp_sources::list_docs(runtime, args).await,
        "okhub_doc_read" => super::mcp_sources::read_doc(runtime, args).await,
        "okhub_doc_validate" => {
            let report = runtime.validate_docs()?;
            Ok(serde_json::to_value(report).unwrap_or(Value::Null))
        }
        "okhub_pr_list" => super::mcp_pr::list(runtime, args).await,
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
        "okhub_board_list" => super::mcp_board::list(runtime, args).await,
        "okhub_board_ready" => {
            let mut args = args.clone();
            args["readyOnly"] = json!(true);
            super::mcp_board::list(runtime, &args).await
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
        "okhub_context_issue" => super::mcp_sources::context(runtime, args).await,
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
    super::mcp_sdk::tool_definitions(false)
}

pub(super) fn legacy_tool_definitions() -> Vec<Value> {
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
        assert_eq!(tool_names.len(), 7);
        assert!(!tool_names.contains(&"okhub_doc_validate"));
        assert!(!tool_names.contains(&"okhub_board_ready"));
        assert!(tool_names.contains(&"okhub_board_manage"));
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
