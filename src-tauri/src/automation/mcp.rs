#[cfg(test)]
use serde::Serialize;
use serde_json::{json, Value};

use crate::automation::context_pack::{parse_board_layer_arg, parse_board_status_arg};
use crate::automation::{AutomationOverrides, AutomationRuntime, BacklogTreeItemInput};
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
    let mut effective_overrides = overrides.clone();
    if let Some(ws_id) = args.get("workspaceId").and_then(Value::as_str) {
        if !ws_id.trim().is_empty() {
            effective_overrides.workspace_id = Some(ws_id.trim().to_owned());
        }
    }
    // Workspace selection is explicit; hidden filesystem overrides remain forbidden.
    let runtime = AutomationRuntime::load(&effective_overrides)?;
    dispatch_runtime_tool_call(&runtime, tool_name, args).await
}

pub(super) async fn dispatch_runtime_tool_call(
    runtime: &AutomationRuntime,
    tool_name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    if matches!(
        tool_name,
        "okhub_update_doc_impl_status"
            | "okhub_board_create_backlog_tree"
            | "okhub_board_update_issue"
    ) {
        return Err(super::mcp_sdk::error("이 쓰기 도구는 사용자 확인·완료 검사 경로로 통합되기 전까지 MCP에서 실행할 수 없습니다."));
    }
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
        "okhub_update_doc_impl_status" => {
            let path = required_str(args, "path")?;
            let impl_status = required_str(args, "implStatus")?;
            let impl_note = args.get("implNote").and_then(Value::as_str);
            let checked_at = args.get("checkedAt").and_then(Value::as_str);
            let updated =
                runtime.update_doc_impl_status(path, impl_status, impl_note, checked_at)?;
            Ok(serde_json::to_value(updated).unwrap_or(Value::Null))
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
            let parent_repo = args
                .get("parentIssueRepository")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let depends_on = optional_u64_arg(args, "dependsOn")?;
            let assignees = optional_string_array(args, "assignees")?;
            let created = runtime
                .create_board_issue(
                    repo,
                    title,
                    body,
                    layer,
                    status,
                    kind,
                    priority,
                    parent,
                    parent_repo,
                    depends_on,
                    assignees,
                )
                .await?;
            Ok(serde_json::to_value(created).unwrap_or(Value::Null))
        }
        "okhub_board_get_schema" => {
            let schema = runtime.inspect_board_schema().await?;
            Ok(serde_json::to_value(schema).unwrap_or(Value::Null))
        }
        "okhub_board_create_backlog_tree" => {
            let items = parse_backlog_tree_items(args)?;
            let created = runtime.create_backlog_tree(items).await?;
            Ok(serde_json::to_value(created).unwrap_or(Value::Null))
        }
        "okhub_board_update_issue" => {
            let issue_number = required_u64(args, "issueNumber")?;
            let repo = args
                .get("repo")
                .or_else(|| args.get("repository"))
                .and_then(Value::as_str);
            let title = args.get("title").and_then(Value::as_str);
            let body = args.get("body").and_then(Value::as_str);
            let state = args.get("state").and_then(Value::as_str);
            let comment = args.get("comment").and_then(Value::as_str);
            let assignees = optional_string_array(args, "assignees")?;
            let updated = runtime
                .update_board_issue(issue_number, repo, title, body, state, comment, assignees)
                .await?;
            Ok(serde_json::to_value(updated).unwrap_or(Value::Null))
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

fn optional_usize_arg(args: &Value, key: &str) -> Result<Option<usize>, AppError> {
    let Some(val) = args.get(key) else {
        return Ok(None);
    };
    if val.is_null() {
        return Ok(None);
    }
    let raw = val.as_u64().ok_or_else(|| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("`{key}` 인자에는 0 이상의 정수를 지정해 주세요."),
        )
    })?;
    let parsed = usize::try_from(raw).map_err(|_| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("`{key}` 값이 허용 범위를 벗어났습니다."),
        )
    })?;
    Ok(Some(parsed))
}

fn optional_string_array(args: &Value, key: &str) -> Result<Option<Vec<String>>, AppError> {
    let Some(val) = args.get(key) else {
        return Ok(None);
    };
    if val.is_null() {
        return Ok(None);
    }
    let arr = val.as_array().ok_or_else(|| {
        AppError::new(
            crate::error::ErrorCode::WorkspaceInvalid,
            format!("`{key}` 인자는 문자열 배열이어야 합니다."),
        )
    })?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let s = entry.as_str().ok_or_else(|| {
            AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!("`{key}` 배열의 모든 요소는 문자열이어야 합니다."),
            )
        })?;
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            out.push(trimmed.to_owned());
        }
    }
    Ok(Some(out))
}

fn parse_backlog_tree_items(args: &Value) -> Result<Vec<BacklogTreeItemInput>, AppError> {
    let arr = args
        .get("items")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                "필수 배열 인자 `items`에 1개 이상의 백로그 항목을 지정해 주세요.",
            )
        })?;

    let mut parsed = Vec::with_capacity(arr.len());
    for (idx, item) in arr.iter().enumerate() {
        if !item.is_object() {
            return Err(AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!("items[{idx}]는 JSON 객체여야 합니다."),
            ));
        }
        let title = required_str(item, "title")?.to_owned();
        let body = item
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let repository_full_name = item
            .get("repository")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let layer = optional_layer_arg(item, "layer")?;
        let status = optional_status_arg(item, "status")?;
        let kind = item
            .get("kind")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let priority = item
            .get("priority")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let parent_issue_number = optional_u64_arg(item, "parentIssueNumber")?;
        let parent_issue_repository = item
            .get("parentIssueRepository")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let parent_batch_index = optional_usize_arg(item, "parentBatchIndex")?;
        if parent_issue_number.is_some() && parent_batch_index.is_some() {
            return Err(AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!(
                    "items[{idx}]에는 `parentIssueNumber`와 `parentBatchIndex` 중 하나만 지정해 주세요."
                ),
            ));
        }
        let depends_on = optional_u64_arg(item, "dependsOn")?;
        let depends_on_batch_index = optional_usize_arg(item, "dependsOnBatchIndex")?;
        if depends_on.is_some() && depends_on_batch_index.is_some() {
            return Err(AppError::new(
                crate::error::ErrorCode::WorkspaceInvalid,
                format!(
                    "items[{idx}]에는 `dependsOn`과 `dependsOnBatchIndex` 중 하나만 지정해 주세요."
                ),
            ));
        }
        let assignees = optional_string_array(item, "assignees")?;

        parsed.push(BacklogTreeItemInput {
            repository_full_name,
            title,
            body,
            layer,
            status,
            kind,
            priority,
            parent_issue_number,
            parent_issue_repository,
            parent_batch_index,
            depends_on,
            depends_on_batch_index,
            assignees,
        });
    }
    Ok(parsed)
}

pub fn mcp_tool_definitions() -> Vec<Value> {
    super::mcp_sdk::tool_definitions(false)
}

pub(super) fn legacy_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "okhub_get_active_context",
            "description": "현재 실행 중인 OkHub 앱에 연결된 모든 프로젝트·워크스페이스 목록(`connectedWorkspaces`)과 현재 활성 GitHub Project, 문서 저장소, 연결된 코드 저장소 로컬 경로 컨텍스트를 반환합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspaceId": { "type": "string", "description": "특정 연결 워크스페이스 ID 컨텍스트로 조회할 때 선택 지정" }
                }
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
            "name": "okhub_update_doc_impl_status",
            "description": "연결된 코드 저장소와 대조해 확인한 문서별 코드 반영 상태(`impl_status`: synced|partial|unimplemented|clear)와 사유(`impl_note`)를 대상 .md frontmatter에 기록합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["path", "implStatus"],
                "properties": {
                    "path": { "type": "string", "description": "대상 .md 문서 상대 경로 (예: docs/domains/documents/prd.md)" },
                    "implStatus": {
                        "type": "string",
                        "enum": ["synced", "partial", "unimplemented", "clear"],
                        "description": "synced(코드 반영 완료/파랑), partial(일부 수정 필요/주황), unimplemented(미반영/빨강), clear(상태 제거)"
                    },
                    "implNote": { "type": "string", "description": "대조 점검 사유 또는 누락 사항 1줄 요약" },
                    "checkedAt": { "type": "string", "description": "점검 일자 (예: 2026-11-20)" },
                    "workspaceId": { "type": "string", "description": "특정 연결 워크스페이스 ID로 실행할 때 선택 지정" }
                }
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
                    "parentIssueRepository": { "type": "string", "description": "상위 Epic 이슈가 다른 저장소에 있을 때 owner/repo 지정" },
                    "dependsOn": { "type": "integer" },
                    "assignees": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "GitHub 로그인 목록. 생략 시 .okf/workspace.yml의 역할별 assignees를 자동 지정하고, 빈 배열([])을 넘기면 담당자 없이 생성합니다."
                    }
                }
            }
        }),
        json!({
            "name": "okhub_board_get_schema",
            "description": "현재 선택된 GitHub Project의 Status·영역·타입·Priority 필드 ID 및 선택 가능한 옵션 이름 목록을 조회합니다.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "okhub_board_create_backlog_tree",
            "description": "Epic([Epic])과 [기획]/[디자인]/[백엔드]/[프론트엔드] 하위 Sub-issues 및 `이전 단계: #N` 의존성 체인을 순서대로 생성합니다. 순차 API 호출이므로 멱등하지 않으며, 중간 실패 시 이미 생성된 이슈 번호를 오류 상세에 반환합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["items"],
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "생성할 이슈 목록. parentBatchIndex / dependsOnBatchIndex는 같은 배치에서 앞서 만든 항목의 0-based 인덱스입니다.",
                        "items": {
                            "type": "object",
                            "required": ["title"],
                            "properties": {
                                "repository": { "type": "string" },
                                "title": { "type": "string" },
                                "body": { "type": "string" },
                                "layer": { "type": "string", "description": "planning | design | frontend | backend" },
                                "status": { "type": "string", "description": "backlog | ready | in_progress | in_review | done" },
                                "kind": { "type": "string", "description": "예: 기능, 작업, 스토리, 버그" },
                                "priority": { "type": "string", "description": "예: P0, P1, P2" },
                                "parentIssueNumber": { "type": "integer" },
                                "parentIssueRepository": { "type": "string" },
                                "parentBatchIndex": { "type": "integer", "description": "배치 내 상위 이슈의 0-based 인덱스 (< 현재 인덱스)" },
                                "dependsOn": { "type": "integer" },
                                "dependsOnBatchIndex": { "type": "integer", "description": "배치 내 선행 이슈의 0-based 인덱스 (< 현재 인덱스)" },
                                "assignees": { "type": "array", "items": { "type": "string" }, "description": "생략 시 역할별 기본 assignees 자동 지정, [] 지정 시 담당자 없음" }
                            }
                        }
                    }
                }
            }
        }),
        json!({
            "name": "okhub_board_update_issue",
            "description": "GitHub 이슈의 제목·본문·열림/닫힘 상태·코멘트·담당자(assignees)를 갱신합니다.",
            "inputSchema": {
                "type": "object",
                "required": ["issueNumber"],
                "properties": {
                    "issueNumber": { "type": "integer" },
                    "repo": { "type": "string", "description": "owner/repo. 생략 시 활성 Project 항목에서 추론합니다." },
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "state": { "type": "string", "enum": ["open", "closed"] },
                    "comment": { "type": "string" },
                    "assignees": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "GitHub 로그인 목록으로 담당자를 교체합니다. 빈 배열([])을 지정하면 기존 담당자를 모두 해제합니다."
                    }
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
            workspace_id: None,
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
        assert!(!tool_names.contains(&"okhub_update_doc_impl_status"));
        assert!(!tool_names.contains(&"okhub_board_create_backlog_tree"));
        assert!(!tool_names.contains(&"okhub_board_update_issue"));
        assert!(tool_names.contains(&"okhub_context_issue"));

        let advanced = super::super::mcp_sdk::tool_definitions(true);
        let create_issue_tool = advanced
            .iter()
            .find(|t| t["name"] == "okhub_board_manage")
            .unwrap();
        assert!(create_issue_tool["inputSchema"]["properties"]
            .get("assignees")
            .is_some());
        assert!(create_issue_tool["inputSchema"]["properties"]
            .get("parentIssueNumber")
            .is_some());

        let bad_tree_call = handle_mcp_request(
            &overrides,
            json!({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "tools/call",
                "params": {
                    "name": "okhub_board_create_backlog_tree",
                    "arguments": {
                        "items": [
                            { "title": "[기획] 선행", "parentBatchIndex": 0 }
                        ]
                    }
                }
            }),
        )
        .await
        .unwrap();
        assert_eq!(bad_tree_call["result"]["isError"], true);

        let conflict_tree_call = handle_mcp_request(
            &overrides,
            json!({
                "jsonrpc": "2.0",
                "id": 100,
                "method": "tools/call",
                "params": {
                    "name": "okhub_board_create_backlog_tree",
                    "arguments": {
                        "items": [
                            { "title": "[Epic] 기능" },
                            {
                                "title": "[기획] 문서",
                                "parentIssueNumber": 10,
                                "parentBatchIndex": 0
                            }
                        ]
                    }
                }
            }),
        )
        .await
        .unwrap();
        assert_eq!(conflict_tree_call["result"]["isError"], true);

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

        let root = overrides.workspace_dir.as_ref().unwrap();
        let before_impl = std::fs::read_to_string(root.join("docs/overview.md")).unwrap();
        let impl_call = handle_mcp_request(
            &overrides,
            json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "okhub_update_doc_impl_status",
                    "arguments": {
                        "path": "docs/overview.md",
                        "implStatus": "synced",
                        "implNote": "코드 반영 확인됨",
                        "checkedAt": "2026-11-20"
                    }
                }
            }),
        )
        .await
        .unwrap();
        assert_eq!(impl_call["result"]["isError"], true);
        assert_eq!(
            std::fs::read_to_string(root.join("docs/overview.md")).unwrap(),
            before_impl
        );
    }
}
