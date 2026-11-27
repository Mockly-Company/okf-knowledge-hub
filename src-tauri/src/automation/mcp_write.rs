use super::AutomationRuntime;
use super::{mcp_board, mcp_sdk::error, mcp_sources};
use crate::error::AppError;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

fn validate_action(action: &str, args: &Value) -> Result<(), AppError> {
    let fields: &[&str] = match action {
        "create" => &[
            "action",
            "requestId",
            "repository",
            "title",
            "body",
            "layer",
            "status",
            "kind",
            "priority",
            "assignees",
            "dueDate",
            "parentIssueNumber",
            "dependsOn",
        ],
        "update" => &[
            "action",
            "requestId",
            "repository",
            "number",
            "title",
            "body",
            "assignees",
            "dueDate",
        ],
        "change_status" => &[
            "action",
            "requestId",
            "repository",
            "number",
            "status",
            "layer",
            "kind",
            "priority",
        ],
        "legacy_update_fields" => &[
            "action",
            "requestId",
            "repository",
            "number",
            "layer",
            "kind",
            "priority",
        ],
        "complete" => &["action", "requestId", "repository", "number"],
        _ => return Err(error("알 수 없는 변경 action입니다.")),
    };
    let object = args
        .as_object()
        .ok_or_else(|| error("변경 입력은 object여야 합니다."))?;
    if object.keys().any(|k| !fields.contains(&k.as_str())) {
        return Err(error("해당 action에서 허용하지 않는 변경 필드입니다."));
    }
    if action == "create" && args["title"].as_str().is_none_or(|s| s.trim().is_empty()) {
        return Err(error("생성할 Issue 제목이 필요합니다."));
    }
    if action != "create" && args["number"].as_u64().is_none_or(|n| n == 0) {
        return Err(error("대상 Issue 번호가 필요합니다."));
    }
    if action == "change_status" && args["status"].as_str().is_none() {
        return Err(error("변경할 상태가 필요합니다."));
    }
    if let Some(status) = args["status"].as_str() {
        let parsed = super::context_pack::parse_board_status_arg(status)
            .ok_or_else(|| error("지원하지 않는 상태입니다."))?;
        if parsed == crate::project_board::model::BoardStatus::Done {
            return Err(error("완료는 complete action으로만 처리할 수 있습니다."));
        }
    }
    if let Some(layer) = args["layer"].as_str() {
        if super::context_pack::parse_board_layer_arg(layer).is_none() {
            return Err(error("지원하지 않는 영역입니다."));
        }
    }
    if let Some(date) = args["dueDate"].as_str() {
        mcp_board::validate_date(date)?;
    }
    if args.get("assignees").is_some()
        && args["assignees"].as_array().is_none_or(|a| {
            a.iter().any(|v| {
                v.as_str()
                    .is_none_or(|s| s.is_empty() || s.contains('/') || s.contains(' '))
            })
        })
    {
        return Err(error("담당자는 GitHub 로그인 목록이어야 합니다."));
    }
    Ok(())
}

fn incomplete_checklist(body: &str) -> bool {
    pulldown_cmark::Parser::new_ext(body, pulldown_cmark::Options::ENABLE_TASKLISTS)
        .any(|event| matches!(event, pulldown_cmark::Event::TaskListMarker(false)))
}

fn fingerprint(value: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).expect("JSON serialization"))
    )
}

fn normalized(name: &str, args: &Value) -> Result<Value, AppError> {
    let mut value = args.clone();
    let action = match name {
        "okhub_board_manage" => args["action"]
            .as_str()
            .ok_or_else(|| error("action 누락"))?,
        "okhub_board_create_issue" => "create",
        "okhub_board_update_status" => {
            if args.get("status").is_none() {
                "legacy_update_fields"
            } else if args["status"]
                .as_str()
                .and_then(super::context_pack::parse_board_status_arg)
                == Some(crate::project_board::model::BoardStatus::Done)
            {
                "complete"
            } else {
                "change_status"
            }
        }
        _ => return Err(error("변경 도구를 정규화할 수 없습니다.")),
    };
    value["action"] = json!(action);
    if value.get("requestId").is_none() {
        value["requestId"] = json!(format!("legacy-{}", fingerprint(args)));
    }
    if action == "complete" {
        value.as_object_mut().unwrap().remove("status");
    }
    validate_action(action, &value)?;
    Ok(value)
}

async fn issue(
    github: &crate::github::GithubService,
    repo: &str,
    number: u64,
) -> Result<Value, AppError> {
    let p: Vec<_> = repo.split('/').collect();
    github
        .automation_get(&["repos", p[0], p[1], "issues", &number.to_string()], &[])
        .await
}

fn issue_baseline(issue: &Value) -> Value {
    json!({"nodeId":issue["node_id"],"updatedAt":issue["updated_at"],"title":issue["title"],"body":issue["body"],"state":issue["state"],"assignees":issue["assignees"]})
}

pub(super) async fn prepare(
    runtime: &AutomationRuntime,
    name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    let mut preview = prepare_domain(runtime, name, args).await?;
    preview["workspaceIdentity"] = json!({"workspaceId":runtime.mcp_workspace_id,"targetFingerprint":runtime.mcp_target_fingerprint});
    Ok(preview)
}

async fn prepare_domain(
    runtime: &AutomationRuntime,
    name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    let (rules, _, warnings) = super::mcp_rules::read_rules(runtime);
    if !warnings.is_empty() {
        return Err(error(format!(
            "작업 규칙을 완전히 읽지 못해 쓰기를 중단했습니다: {}",
            warnings.join("; ")
        )));
    }
    if name == "okhub_pr_manage" {
        let mut preview = super::mcp_pr::prepare(runtime, args).await?;
        preview["rulesFingerprint"] = json!(fingerprint(&json!(rules)));
        return Ok(preview);
    }
    if matches!(name, "okhub_pr_create" | "okhub_pr_approve_merge") {
        let mut preview = prepare_pr(runtime, name, args).await?;
        preview["rulesFingerprint"] = json!(fingerprint(&json!(rules)));
        return Ok(preview);
    }
    if name == "okhub_board_derive_backlog" {
        let mut preview = prepare_derived(runtime, args).await?;
        preview["rulesFingerprint"] = json!(fingerprint(&json!(rules)));
        return Ok(preview);
    }
    let mut changes = normalized(name, args)?;
    let requested_repo = if changes["repository"].is_string() {
        changes["repository"].as_str().unwrap().to_owned()
    } else if let Some(number) = changes["number"].as_u64() {
        mcp_board::resolve_issue_repository(runtime, number).await?
    } else {
        runtime.resolve_issue_target_repository(
            None,
            changes["layer"]
                .as_str()
                .and_then(super::context_pack::parse_board_layer_arg),
        )?
    };
    let repo = mcp_sources::allowed_repo(runtime, Some(&requested_repo), false)?;
    changes["repository"] = json!(repo);
    let project = runtime.require_project()?;
    let github = runtime.build_github_service()?;
    let (repository_id, can_write) = github.automation_repository_write_identity(&repo).await?;
    if !can_write {
        return Err(error("대상 저장소 쓰기 권한이 없습니다."));
    }
    let schema = mcp_board::schema(runtime, &github).await?;
    if changes["action"] == "create"
        && changes.get("status").is_none()
        && schema
            .find_status_option(crate::project_board::model::BoardStatus::Backlog)
            .is_some()
    {
        changes["status"] = json!("backlog");
    }
    let status = changes["status"]
        .as_str()
        .and_then(super::context_pack::parse_board_status_arg);
    if status.is_some_and(|s| schema.find_status_option(s).is_none()) {
        return Err(error("연결 Project에 해당 상태가 없습니다."));
    }
    if changes["action"] == "complete"
        && schema
            .find_status_option(crate::project_board::model::BoardStatus::Done)
            .is_none()
    {
        return Err(error("연결 Project에 완료 상태가 없습니다."));
    }
    if let Some(kind) = changes["kind"].as_str() {
        if schema.find_kind_option(kind).is_none() {
            return Err(error("Project에 해당 타입이 없습니다."));
        }
    }
    if let Some(priority) = changes["priority"].as_str() {
        if schema.find_priority_option(priority).is_none() {
            return Err(error("Project에 해당 우선순위가 없습니다."));
        }
    }
    if let Some(layer) = changes["layer"]
        .as_str()
        .and_then(super::context_pack::parse_board_layer_arg)
    {
        if layer != crate::project_board::model::BoardLayer::Unassigned
            && schema.find_layer_option(layer).is_none()
        {
            return Err(error("Project에 해당 영역이 없습니다."));
        }
    }
    let date_field = if changes.get("dueDate").is_some() {
        Some(
            mcp_board::date_field(&github, &schema.project_id)
                .await?
                .ok_or_else(|| error("Project에 마감일 필드가 없습니다."))?,
        )
    } else {
        None
    };
    let mut before = Value::Null;
    let mut item = Value::Null;
    let mut linked = Value::Null;
    if let Some(number) = changes["number"].as_u64() {
        let current = issue(&github, &repo, number).await?;
        if current.get("pull_request").is_some() {
            return Err(error("백로그 대상은 Pull Request가 아닌 Issue여야 합니다."));
        }
        before = issue_baseline(&current);
        item = mcp_board::target_item(&github, &repo, number, &schema.project_id).await?;
        if item["scheduleAvailable"] != true || item["fieldsTruncated"] == true {
            return Err(error("Project 항목 상태를 완전히 조회하지 못했습니다."));
        }
        if changes["action"] == "complete" {
            if incomplete_checklist(current["body"].as_str().unwrap_or_default()) {
                return Err(error("미완료 체크리스트가 있어 완료 처리할 수 없습니다."));
            }
            linked = mcp_sources::linked_prs(&github, &repo, number).await?;
            let prs = linked["items"]
                .as_array()
                .ok_or_else(|| error("연결 PR 조회 실패"))?;
            if linked["truncated"] == true
                || prs.is_empty()
                || prs
                    .iter()
                    .any(|p| p["merged"] != true || p["mergedAt"].is_null())
            {
                return Err(error("연결 PR이 없거나 병합되지 않았습니다."));
            }
        }
    }
    let parent = if let Some(number) = changes["parentIssueNumber"].as_u64() {
        let parent = issue(&github, &repo, number).await?;
        if parent.get("pull_request").is_some() {
            return Err(error("상위 항목은 Issue여야 합니다."));
        }
        json!({"number":number,"nodeId":parent["node_id"],"updatedAt":parent["updated_at"]})
    } else {
        Value::Null
    };
    if changes["action"] == "create" {
        changes["body"] = json!(super::inject_depends_on_line(
            changes["body"].as_str().unwrap_or_default(),
            changes["dependsOn"].as_u64()
        ));
    }
    Ok(
        json!({"tool":name,"changes":changes,"rulesFingerprint":fingerprint(&json!(rules)),"repositoryNodeId":repository_id,"project":{"id":schema.project_id,"owner":project.owner,"number":project.number,"scope":schema.scope},"schema":schema,"dateField":date_field,"before":before,"item":item,"linkedPullRequests":linked,"parent":parent,"semanticCompletion":"사용자는 자료와 구현의 의미적 완료를 별도로 확인합니다. MCP는 자동 합격을 보증하지 않습니다."}),
    )
}

struct Journal {
    path: PathBuf,
    id: String,
    payload: String,
    data: Value,
    cancel: CancellationToken,
}

fn request_identity(runtime: &AutomationRuntime, name: &str, args: &Value) -> (String, String) {
    let request_id = args["requestId"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("legacy-{}", fingerprint(args)));
    (
        fingerprint(
            &json!({"workspaceId":runtime.mcp_workspace_id,"tool":name,"requestId":request_id}),
        ),
        fingerprint(
            &json!({"workspaceId":runtime.mcp_workspace_id,"targetFingerprint":runtime.mcp_target_fingerprint,"projectId":runtime.active_project.as_ref().map(|p|&p.id),"tool":name,"arguments":args}),
        ),
    )
}

/// Read-only replay of a previously confirmed, fully completed operation. Missing
/// or partial operations must still pass preparation and user confirmation.
pub(super) fn completed_request(
    runtime: &AutomationRuntime,
    name: &str,
    args: &Value,
) -> Result<Option<Value>, AppError> {
    let path = runtime.app_data_dir.join("mcp-operations.sqlite3");
    if !path.exists() {
        return Ok(None);
    }
    let db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| error(e.to_string()))?;
    use rusqlite::OptionalExtension;
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='mcp_request_bindings')", [], |r| r.get(0)).map_err(|e|error(e.to_string()))?;
    if !exists {
        return Ok(None);
    }
    let (key, payload) = request_identity(runtime, name, args);
    let saved: Option<(String, String, Option<String>, Option<String>)> = db.query_row(
        "SELECT b.payload,b.operation_payload,o.payload,o.data FROM mcp_request_bindings b LEFT JOIN mcp_operations o ON o.id=b.operation_id WHERE b.id=?1",
        [&key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
    ).optional().map_err(|e|error(e.to_string()))?;
    let Some((saved_payload, operation_payload, saved_operation_payload, data)) = saved else {
        return Ok(None);
    };
    if saved_payload != payload {
        return Err(error(
            "같은 requestId의 입력 또는 workspace 연결이 달라졌습니다.",
        ));
    }
    if saved_operation_payload
        .as_ref()
        .is_some_and(|saved| saved != &operation_payload)
    {
        return Err(error(
            "같은 requestId의 실행 기록이 다른 변경에 연결되어 있습니다.",
        ));
    }
    let data: Value = data
        .map(|data| serde_json::from_str(&data))
        .transpose()
        .map_err(|e| error(e.to_string()))?
        .unwrap_or(Value::Null);
    Ok(data.get("result").cloned())
}

impl Journal {
    fn open(runtime: &AutomationRuntime, preview: &Value) -> Result<Self, AppError> {
        std::fs::create_dir_all(&runtime.app_data_dir).map_err(|e| error(e.to_string()))?;
        let path = runtime.app_data_dir.join("mcp-operations.sqlite3");
        let db = rusqlite::Connection::open(&path).map_err(|e| error(e.to_string()))?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS mcp_operations(id TEXT PRIMARY KEY,payload TEXT NOT NULL,data TEXT NOT NULL,busy INTEGER NOT NULL DEFAULT 0)").map_err(|e|error(e.to_string()))?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS mcp_request_bindings(id TEXT PRIMARY KEY,payload TEXT NOT NULL,operation_id TEXT NOT NULL,operation_payload TEXT NOT NULL)").map_err(|e|error(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| error(e.to_string()))?;
        }
        let id = fingerprint(
            &json!({"project":preview["project"].get("id").unwrap_or(&Value::Null),"repository":preview.get("repositoryNodeId").cloned().unwrap_or_else(||json!(preview["changes"]["repository"].as_str().unwrap_or_default().to_ascii_lowercase())),"requestId":preview["changes"]["requestId"]}),
        );
        let payload = fingerprint(
            &json!({"workspaceIdentity":preview["workspaceIdentity"],"changes":preview["changes"],"tool":preview["tool"],"targetIssue":preview["before"]["nodeId"],"prHead":preview["before"]["headSha"],"completionPrs":preview["linkedPullRequests"]["items"],"derivedChanges":preview["children"].as_array().map(|children|children.iter().map(|c|c["changes"].clone()).collect::<Vec<_>>())}),
        );
        Ok(Self {
            path,
            id,
            payload,
            data: json!({"steps":{}}),
            cancel: CancellationToken::new(),
        })
    }
    fn bind_request(
        &self,
        runtime: &AutomationRuntime,
        name: &str,
        args: &Value,
    ) -> Result<(), AppError> {
        let (key, payload) = request_identity(runtime, name, args);
        let db = rusqlite::Connection::open(&self.path).map_err(|e| error(e.to_string()))?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| error(e.to_string()))?;
        db.execute("INSERT INTO mcp_request_bindings(id,payload,operation_id,operation_payload) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO NOTHING",rusqlite::params![key,payload,self.id,self.payload]).map_err(|e|error(e.to_string()))?;
        let saved: (String, String, String) = db
            .query_row(
                "SELECT payload,operation_id,operation_payload FROM mcp_request_bindings WHERE id=?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| error(e.to_string()))?;
        if saved != (payload, self.id.clone(), self.payload.clone()) {
            return Err(error(
                "같은 requestId를 다른 입력 또는 대상으로 사용할 수 없습니다.",
            ));
        }
        Ok(())
    }
    fn claim(&mut self) -> Result<Option<Value>, AppError> {
        let mut db = rusqlite::Connection::open(&self.path).map_err(|e| error(e.to_string()))?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| error(e.to_string()))?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| error(e.to_string()))?;
        use rusqlite::OptionalExtension;
        let existing: Option<(String, String, bool)> = tx
            .query_row(
                "SELECT payload,data,busy FROM mcp_operations WHERE id=?1",
                [&self.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| error(e.to_string()))?;
        if let Some((payload, data, busy)) = existing {
            if payload != self.payload {
                return Err(error("같은 requestId를 다른 변경에 사용할 수 없습니다."));
            }
            self.data = serde_json::from_str(&data).map_err(|e| error(e.to_string()))?;
            if let Some(result) = self.data.get("result") {
                return Ok(Some(result.clone()));
            }
            if busy || self.data.get("inFlight").is_some_and(|v| !v.is_null()) {
                return Err(error("이전 실행 결과가 불명확하거나 진행 중입니다. 중복 생성을 방지하기 위해 수동 확인 전에는 재실행하지 않습니다."));
            }
        }
        tx.execute("INSERT INTO mcp_operations(id,payload,data,busy) VALUES(?1,?2,?3,1) ON CONFLICT(id) DO UPDATE SET busy=1",rusqlite::params![self.id,self.payload,self.data.to_string()]).map_err(|e|error(e.to_string()))?;
        tx.commit().map_err(|e| error(e.to_string()))?;
        Ok(None)
    }
    fn save(&self, busy: bool) -> Result<(), AppError> {
        let db = rusqlite::Connection::open(&self.path).map_err(|e| error(e.to_string()))?;
        db.execute(
            "UPDATE mcp_operations SET data=?1,busy=?2 WHERE id=?3",
            rusqlite::params![self.data.to_string(), busy, self.id],
        )
        .map_err(|e| error(e.to_string()))?;
        Ok(())
    }
    async fn step<F>(&mut self, name: &str, operation: F) -> Result<Value, AppError>
    where
        F: std::future::Future<Output = Result<Value, AppError>>,
    {
        if let Some(value) = self.data["steps"].get(name) {
            return Ok(value.clone());
        }
        if self.cancel.is_cancelled() {
            return Err(error("요청이 취소되어 후속 변경을 중단했습니다."));
        }
        self.data["inFlight"] = json!(name);
        self.save(true)?;
        let result = tokio::select! {
            biased;
            _=self.cancel.cancelled()=>Err(error("변경 중 요청이 취소되었습니다. 적용 여부를 확인해야 합니다.")),
            result=operation=>result,
        };
        match result {
            Ok(value) => {
                self.data["steps"][name] = value.clone();
                self.data["inFlight"] = Value::Null;
                self.save(true)?;
                Ok(value)
            }
            Err(e) => {
                self.data["lastError"] = json!({"step":name,"message":e.message});
                if matches!(
                    e.code,
                    crate::error::ErrorCode::GithubPermissionDenied
                        | crate::error::ErrorCode::AuthenticationDenied
                        | crate::error::ErrorCode::AuthenticationExpired
                        | crate::error::ErrorCode::ReauthenticationRequired
                ) {
                    self.data["inFlight"] = Value::Null;
                }
                self.save(false)?;
                Err(e.with_detail("partialResult", self.data.to_string()))
            }
        }
    }
}

pub(super) async fn apply(
    runtime: &AutomationRuntime,
    name: &str,
    args: &Value,
    preview: &Value,
    cancel: CancellationToken,
) -> Result<Value, AppError> {
    if cancel.is_cancelled() {
        return Err(error("요청이 취소되었습니다."));
    }
    if let Some(result) = completed_request(runtime, name, args)? {
        return Ok(result);
    }
    // This entry point is reached only after approval (or as a child of an
    // approved derived operation). Bind the original request before any write.
    let mut journal = Journal::open(runtime, preview)?;
    journal.bind_request(runtime, name, args)?;
    if name == "okhub_board_derive_backlog" {
        return apply_derived(runtime, args, preview, cancel).await;
    }
    let fresh = prepare(runtime, name, args).await?;
    journal.cancel = cancel;
    if let Some(result) = journal.claim()? {
        return Ok(result);
    }
    if fresh != *preview {
        journal.save(false)?;
        return Err(error(
            "확인 후 대상 또는 변경 조건이 달라졌습니다. 새 변경안을 확인하세요.",
        ));
    }
    let outcome = execute(runtime, name, preview, &mut journal).await;
    if let Ok(result) = &outcome {
        journal.data["result"] = result.clone();
    }
    journal.save(false)?;
    outcome
}

async fn execute(
    runtime: &AutomationRuntime,
    name: &str,
    preview: &Value,
    journal: &mut Journal,
) -> Result<Value, AppError> {
    let args = &preview["changes"];
    if name == "okhub_pr_manage" {
        let step = format!("pr_{}", args["action"].as_str().unwrap_or("invalid"));
        return journal
            .step(&step, super::mcp_pr::execute(runtime, preview))
            .await;
    }
    if name == "okhub_pr_create" {
        return journal
            .step(
                "pull_request",
                super::mcp::dispatch_runtime_tool_call(runtime, name, args),
            )
            .await;
    }
    let github = runtime.build_github_service()?;
    let repo = args["repository"].as_str().unwrap();
    if name == "okhub_pr_approve_merge" {
        let number = args["number"].as_u64().unwrap();
        let sha = preview["before"]["headSha"]
            .as_str()
            .ok_or_else(|| error("확인한 PR head SHA 누락"))?;
        let viewer = github.current_user().await?;
        if !preview["before"]["authorLogin"]
            .as_str()
            .is_some_and(|author| author.eq_ignore_ascii_case(&viewer.login))
        {
            journal
                .step("approve_pr", async {
                    github
                        .automation_approve_pr_at_commit(
                            repo,
                            number,
                            sha,
                            args["comment"].as_str(),
                        )
                        .await?;
                    Ok(json!({"approvedCommit":sha}))
                })
                .await?;
        }
        return journal.step("merge_pr",async{
            let merged=github.squash_merge_pull_request(repo,number,None,Some(sha)).await?;
            Ok(json!({"repository":repo,"number":number,"merged":true,"headSha":sha,"mergeCommitSha":merged}))
        }).await;
    }
    let p: Vec<_> = repo.split('/').collect();
    let project_id = preview["project"]["id"].as_str().unwrap();
    let action = args["action"].as_str().unwrap();
    let mut live_item = preview["item"].clone();
    let mut live_issue = preview["before"].clone();
    if action == "create" {
        if let Some(created) = journal.data["steps"].get("create_issue").cloned() {
            let number = created["number"]
                .as_u64()
                .ok_or_else(|| error("기록된 Issue 번호 누락"))?;
            let current = issue(&github, repo, number).await?;
            if current["node_id"] != created["id"]
                || current["title"] != args["title"]
                || current["body"] != args["body"]
            {
                return Err(error(
                    "부분 생성된 Issue가 변경되었습니다. 자동 재시도 전에 확인하세요.",
                ));
            }
            live_issue = issue_baseline(&current);
            if journal.data["steps"].get("add_to_project").is_some() {
                live_item = mcp_board::target_item(&github, repo, number, project_id).await?;
                if live_item["itemId"]
                    != journal.data["steps"]["add_to_project"]["addProjectV2ItemById"]["item"]["id"]
                {
                    return Err(error("부분 생성된 Project 항목이 변경되었습니다."));
                }
            }
        }
    }
    invalidate_diverged_steps(journal, args, &live_item, &live_issue);
    journal.save(true)?;
    let mut number = args["number"].as_u64().unwrap_or(0);
    let node_id;
    let item_id;
    if action == "create" {
        let repository = github.automation_get(&["repos", p[0], p[1]], &[]).await?;
        let created=journal.step("create_issue",async {
            let data=github.graphql_value("mutation($input:CreateIssueInput!){createIssue(input:$input){issue{id number url}}}",json!({"input":{"repositoryId":repository["node_id"],"title":args["title"],"body":args["body"]}})).await?;
            Ok(data["createIssue"]["issue"].clone())
        }).await?;
        number = created["number"]
            .as_u64()
            .ok_or_else(|| error("생성 Issue 응답 오류"))?;
        node_id = created["id"]
            .as_str()
            .ok_or_else(|| error("생성 Issue ID 누락"))?
            .to_owned();
        let added=journal.step("add_to_project",async {
            github.graphql_value("mutation($input:AddProjectV2ItemByIdInput!){addProjectV2ItemById(input:$input){item{id}}}",json!({"input":{"projectId":project_id,"contentId":node_id}})).await
        }).await?;
        item_id = added["addProjectV2ItemById"]["item"]["id"]
            .as_str()
            .ok_or_else(|| error("Project 항목 ID 누락"))?
            .to_owned();
        if let Some(parent) = preview["parent"]["nodeId"].as_str() {
            journal.step("parent",async {github.graphql_value("mutation($input:AddSubIssueInput!){addSubIssue(input:$input){issue{id}}}",json!({"input":{"issueId":parent,"subIssueId":node_id}})).await}).await?;
        }
    } else {
        node_id = preview["before"]["nodeId"]
            .as_str()
            .ok_or_else(|| error("Issue ID 누락"))?
            .to_owned();
        item_id = preview["item"]["itemId"]
            .as_str()
            .ok_or_else(|| error("Project 항목 ID 누락"))?
            .to_owned();
    }
    let schema: crate::github::model::GithubProjectSchema =
        serde_json::from_value(preview["schema"].clone()).map_err(|e| error(e.to_string()))?;
    let mut fields = Vec::new();
    if let Some(status) = args["status"]
        .as_str()
        .and_then(super::context_pack::parse_board_status_arg)
        .or_else(|| {
            if action == "complete" {
                Some(crate::project_board::model::BoardStatus::Done)
            } else {
                None
            }
        })
    {
        if let Some((field, option)) = schema.find_status_option(status) {
            fields.push(("status", field.to_owned(), option.to_owned()));
        }
    }
    if let Some(layer) = args["layer"]
        .as_str()
        .and_then(super::context_pack::parse_board_layer_arg)
    {
        if let Some((field, option)) = schema.find_layer_option(layer) {
            fields.push(("layer", field.to_owned(), option.to_owned()));
        }
    }
    if let Some(kind) = args["kind"].as_str() {
        if let Some((field, option)) = schema.find_kind_option(kind) {
            fields.push(("kind", field.to_owned(), option.to_owned()));
        }
    }
    if let Some(priority) = args["priority"].as_str() {
        if let Some((field, option)) = schema.find_priority_option(priority) {
            fields.push(("priority", field.to_owned(), option.to_owned()));
        }
    }
    for (step, field, option) in fields {
        journal.step(step,async {github.graphql_value("mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}",json!({"input":{"projectId":project_id,"itemId":item_id,"fieldId":field,"value":{"singleSelectOptionId":option}}})).await}).await?;
    }
    if let Some(date) = args["dueDate"].as_str() {
        journal.step("due_date",async {github.graphql_value("mutation($input:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}}",json!({"input":{"projectId":project_id,"itemId":item_id,"fieldId":preview["dateField"],"value":{"date":date}}})).await}).await?;
    }
    let mut patch = json!({});
    for key in ["title", "body", "assignees"] {
        if action != "create" || key == "assignees" {
            if let Some(value) = args.get(key) {
                patch[key] = value.clone();
            }
        }
    }
    if action == "complete" {
        patch["state"] = json!("closed");
        patch["state_reason"] = json!("completed");
    }
    if !patch.as_object().unwrap().is_empty() {
        journal
            .step(
                "update_issue",
                github.automation_update_issue(repo, number, patch),
            )
            .await?;
    }
    Ok(
        json!({"repository":repo,"number":number,"issueNodeId":node_id,"itemId":item_id,"action":action,"url":format!("https://github.com/{repo}/issues/{number}"),"steps":journal.data["steps"]}),
    )
}

fn invalidate_diverged_steps(journal: &mut Journal, args: &Value, item: &Value, issue: &Value) {
    let mut invalidate = Vec::new();
    let wanted_status = args["status"]
        .as_str()
        .and_then(super::context_pack::parse_board_status_arg)
        .or_else(|| {
            if args["action"] == "complete" {
                Some(crate::project_board::model::BoardStatus::Done)
            } else {
                None
            }
        });
    if wanted_status.is_some()
        && wanted_status
            != item["status"]
                .as_str()
                .and_then(super::context_pack::parse_board_status_arg)
    {
        invalidate.push("status");
    }
    for (step, key, current) in [
        ("layer", "layer", "area"),
        ("kind", "kind", "kind"),
        ("priority", "priority", "priority"),
    ] {
        if let Some(wanted) = args[key].as_str() {
            let equal = if step == "layer" {
                super::context_pack::parse_board_layer_arg(wanted)
                    == item[current]
                        .as_str()
                        .and_then(super::context_pack::parse_board_layer_arg)
            } else {
                item[current]
                    .as_str()
                    .is_some_and(|v| v.eq_ignore_ascii_case(wanted))
            };
            if !equal {
                invalidate.push(step);
            }
        }
    }
    if args.get("dueDate").is_some() && args["dueDate"] != item["dueDate"] {
        invalidate.push("due_date");
    }
    let mut patch_diverged = false;
    for key in ["title", "body"] {
        if args.get(key).is_some() && args[key] != issue[key] {
            patch_diverged = true;
        }
    }
    if args["action"] == "complete" && issue["state"] != "closed" {
        patch_diverged = true;
    }
    if let Some(wanted) = args["assignees"].as_array() {
        let mut wanted: Vec<_> = wanted
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_ascii_lowercase)
            .collect();
        let mut actual: Vec<_> = issue["assignees"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| a["login"].as_str())
            .map(str::to_ascii_lowercase)
            .collect();
        wanted.sort();
        actual.sort();
        if wanted != actual {
            patch_diverged = true;
        }
    }
    if patch_diverged {
        invalidate.push("update_issue");
    }
    let steps = journal.data["steps"].as_object_mut().unwrap();
    for step in invalidate {
        steps.remove(step);
    }
}

async fn prepare_pr(
    runtime: &AutomationRuntime,
    name: &str,
    args: &Value,
) -> Result<Value, AppError> {
    let mut changes = args.clone();
    let context = runtime.active_context_summary();
    let repo = mcp_sources::allowed_repo(
        runtime,
        args["repository"]
            .as_str()
            .or(context.docs_repository_full_name.as_deref()),
        false,
    )?;
    changes["repository"] = json!(repo);
    let github = runtime.build_github_service()?;
    let (repository_id, can_write) = github.automation_repository_write_identity(&repo).await?;
    if !can_write {
        return Err(error("저장소 쓰기 권한이 없습니다."));
    }
    let before = if name == "okhub_pr_approve_merge" {
        serde_json::to_value(
            github
                .get_pull_request(
                    &repo,
                    args["number"]
                        .as_u64()
                        .ok_or_else(|| error("PR 번호 누락"))?,
                )
                .await?,
        )
        .map_err(|e| error(e.to_string()))?
    } else {
        let p: Vec<_> = repo.split('/').collect();
        let head = args["head"].as_str().ok_or_else(|| error("head 누락"))?;
        let detail = github.automation_get(&["repos", p[0], p[1]], &[]).await?;
        let base = args["base"]
            .as_str()
            .or_else(|| detail["default_branch"].as_str())
            .ok_or_else(|| error("base 누락"))?;
        changes["base"] = json!(base);
        let head_value = github
            .automation_get(&["repos", p[0], p[1], "commits", head], &[])
            .await?;
        let base_value = github
            .automation_get(&["repos", p[0], p[1], "commits", base], &[])
            .await?;
        json!({"headSha":head_value["sha"],"baseSha":base_value["sha"]})
    };
    changes["requestId"] = args.get("requestId").cloned().unwrap_or_else(|| {
        json!(format!(
            "advanced-{}",
            fingerprint(&json!({"args":args,"head":before["headSha"]}))
        ))
    });
    Ok(
        json!({"tool":name,"changes":changes,"repositoryNodeId":repository_id,"before":before,"project":runtime.active_context_summary().project}),
    )
}

async fn prepare_derived(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    let number = args["number"]
        .as_u64()
        .ok_or_else(|| error("상위 Issue 번호가 필요합니다."))?;
    let docs_repo = runtime
        .active_context_summary()
        .docs_repository_full_name
        .ok_or_else(|| error("문서 저장소가 필요합니다."))?;
    let docs_repo = mcp_sources::allowed_repo(runtime, Some(&docs_repo), false)?;
    let github = runtime.build_github_service()?;
    let schema = mcp_board::schema(runtime, &github).await?;
    let mut source =
        mcp_board::target_item(&github, &docs_repo, number, &schema.project_id).await?;
    let source_issue = issue(&github, &docs_repo, number).await?;
    source["title"] = source_issue["title"].clone();
    source["body"] = source_issue["body"].clone();
    source["nodeId"] = source_issue["node_id"].clone();
    if source["status"]
        .as_str()
        .and_then(super::context_pack::parse_board_status_arg)
        != Some(crate::project_board::model::BoardStatus::Done)
    {
        return Err(error("상위 기획·디자인 Issue가 먼저 완료되어야 합니다."));
    }
    let layer = source["area"]
        .as_str()
        .and_then(super::context_pack::parse_board_layer_arg)
        .ok_or_else(|| error("상위 Issue 영역을 확정할 수 없습니다."))?;
    if !matches!(
        layer,
        crate::project_board::model::BoardLayer::Planning
            | crate::project_board::model::BoardLayer::Design
    ) {
        return Err(error(
            "기획·디자인 Issue에서만 백로그를 파생할 수 있습니다.",
        ));
    }
    let roles: Vec<(&str, &str)> = if layer == crate::project_board::model::BoardLayer::Design {
        vec![("frontend", "프론트엔드")]
    } else {
        vec![("backend", "백엔드"), ("frontend", "프론트엔드")]
    };
    let context = runtime.active_context_summary();
    let request_id = format!("derive-{}", fingerprint(args));
    let title = super::strip_layer_prefix(source["title"].as_str().unwrap_or_default());
    let doc_note = if let Some(path) = args["documentPath"].as_str() {
        mcp_sources::safe_path(path)?;
        format!("\n\n관련 문서: `{path}`")
    } else {
        String::new()
    };
    let mut children = Vec::new();
    for (index, (role, label)) in roles.iter().enumerate() {
        let repo = if let Some(explicit) = args["repository"].as_str() {
            mcp_sources::allowed_repo(runtime, Some(explicit), true)?
        } else {
            let candidates: Vec<_> = context
                .code_repositories
                .iter()
                .filter(|r| {
                    let key = r.key.to_ascii_lowercase();
                    let aliases = if *role == "frontend" {
                        ["frontend", "front", "fe", "web"]
                    } else {
                        ["backend", "back", "be", "api"]
                    };
                    aliases.contains(&key.as_str()) || r.label.to_ascii_lowercase().contains(role)
                })
                .collect();
            if candidates.len() == 1 {
                candidates[0].full_name.clone()
            } else if context.code_repositories.len() == 1 {
                context.code_repositories[0].full_name.clone()
            } else {
                return Err(error(format!(
                    "{role} 저장소 연결이 모호합니다. 설정을 확인하거나 대상 저장소를 지정하세요."
                )));
            }
        };
        let body=format!("이전 단계: {docs_repo}#{number}\n\n상위 {} Issue의 산출물을 바탕으로 {label} 작업을 수행합니다.{doc_note}",if layer==crate::project_board::model::BoardLayer::Design{"디자인"}else{"기획"});
        let child_args = json!({"action":"create","requestId":format!("{request_id}-{index}"),"repository":repo,"title":format!("[{label}] {title} 구현"),"body":body,"layer":role,"status":"backlog"});
        let mut preview = Box::pin(prepare(runtime, "okhub_board_manage", &child_args)).await?;
        // The source may live in the docs repo while the child lives in FE/BE.
        preview["derivedParent"] = json!({"repository":docs_repo,"number":number});
        if index == 1 {
            preview["dependsOnCreatedChild"] = json!(0);
        }
        children.push(preview);
    }
    Ok(
        json!({"tool":"okhub_board_derive_backlog","changes":{"requestId":request_id,"repository":docs_repo},"project":children[0]["project"],"source":source,"children":children}),
    )
}

async fn apply_derived(
    runtime: &AutomationRuntime,
    args: &Value,
    preview: &Value,
    cancel: CancellationToken,
) -> Result<Value, AppError> {
    let fresh = Box::pin(prepare(runtime, "okhub_board_derive_backlog", args)).await?;
    let mut journal = Journal::open(runtime, preview)?;
    journal.cancel = cancel.clone();
    if let Some(result) = journal.claim()? {
        return Ok(result);
    }
    if fresh != *preview {
        journal.save(false)?;
        return Err(error(
            "파생 등록 확인 이후 상위 Issue나 설정이 변경되었습니다.",
        ));
    }
    let outcome=async {
    let mut results = Vec::new();
    for (index, child) in preview["children"].as_array().unwrap().iter().enumerate() {
        let mut child_args = child["changes"].clone();
        if index == 1 {
            let predecessor = results
                .first()
                .and_then(|v: &Value| v["number"].as_u64())
                .ok_or_else(|| error("선행 백로그 생성 결과 누락"))?;
            let source_number = args["number"].as_u64().unwrap();
            let source_repo=preview["source"]["repositoryFullName"].as_str().unwrap();
            let predecessor_repo=results[0]["repository"].as_str().unwrap();
            child_args["body"] = json!(child_args["body"].as_str().unwrap_or_default().replacen(
                &format!("이전 단계: {source_repo}#{source_number}"),
                &format!("이전 단계: {predecessor_repo}#{predecessor}"),
                1
            ));
        }
        let child_preview = Box::pin(prepare(runtime, "okhub_board_manage", &child_args)).await?;
        if child_preview["schema"] != child["schema"]
            || child_preview["project"] != child["project"]
        {
            journal.save(false)?;
            return Err(error("파생 단계 실행 중 Project 설정이 변경되었습니다."));
        }
        let step=format!("child_{index}");
        let created=if let Some(cached)=journal.data["steps"].get(&step){cached.clone()}else{
            let created=Box::pin(apply(
                    runtime,
                    "okhub_board_manage",
                    &child_args,
                    &child_preview,
                    cancel.clone(),
                )).await?;
            journal.data["steps"][&step]=created.clone();journal.save(true)?;created
        };
        let github = runtime.build_github_service()?;
        let parent = issue(
            &github,
            preview["source"]["repositoryFullName"].as_str().unwrap(),
            args["number"].as_u64().unwrap(),
        )
        .await?;
        journal.step(&format!("parent_{index}"),async{
            github.graphql_value("mutation($input:AddSubIssueInput!){addSubIssue(input:$input){issue{id}}}",json!({"input":{"issueId":parent["node_id"],"subIssueId":created["issueNodeId"]}})).await
        }).await?;
        results.push(created);
    }
    Ok::<Value,AppError>(json!({"items":results,"steps":journal.data["steps"]}))
    }.await;
    if let Ok(result) = &outcome {
        journal.data["result"] = result.clone();
    }
    journal.save(false)?;
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn completed_replay_rejects_a_binding_to_another_tools_journal_payload() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            ..Default::default()
        })
        .unwrap();
        let args = json!({"requestId":"shared-id","repository":"acme/docs","number":7});
        let preview = json!({"tool":"first-tool","project":{"id":"P"},"changes":args});
        let mut first = Journal::open(&runtime, &preview).unwrap();
        first.bind_request(&runtime, "first-tool", &args).unwrap();
        first.claim().unwrap();
        first.data["result"] = json!({"created":true});
        first.save(false).unwrap();
        let mut different = preview;
        different["tool"] = json!("second-tool");
        let mut second = Journal::open(&runtime, &different).unwrap();
        second.bind_request(&runtime, "second-tool", &args).unwrap();
        assert!(second.claim().is_err());
        assert!(completed_request(&runtime, "second-tool", &args).is_err());
    }

    #[tokio::test]
    async fn completed_draft_change_replays_before_state_dependent_preparation() {
        let dir = tempfile::tempdir().unwrap();
        let repository =
            json!({"node_id":"R_docs","full_name":"acme/docs","permissions":{"push":true}});
        let pr = json!({"node_id":"PR1","state":"open","draft":true,"merged":false,"head":{"sha":"a".repeat(40)},"base":{"sha":"b".repeat(40),"ref":"main"}});
        let (github, _) = crate::github::automation_test_support::fixture(vec![
            ("/repos/acme/docs", repository.clone()),
            ("/repos/acme/docs/pulls/42", pr.clone()),
            ("/repos/acme/docs", repository),
            ("/repos/acme/docs/pulls/42", pr),
            (
                "/graphql",
                json!({"data":{"markPullRequestReadyForReview":{"pullRequest":{"id":"PR1","isDraft":false}}}}),
            ),
        ]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        let args = json!({"action":"mark_ready","requestId":"ready-once","repository":"acme/docs","number":42});
        let preview = prepare(&runtime, "okhub_pr_manage", &args).await.unwrap();
        let first = apply(
            &runtime,
            "okhub_pr_manage",
            &args,
            &preview,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let replay = apply(
            &runtime,
            "okhub_pr_manage",
            &args,
            &preview,
            CancellationToken::new(),
        )
        .await;
        assert_eq!(replay.unwrap(), first);
        let mut changed = args.clone();
        changed["number"] = json!(43);
        assert!(apply(
            &runtime,
            "okhub_pr_manage",
            &changed,
            &preview,
            CancellationToken::new()
        )
        .await
        .is_err());
        runtime.mcp_target_fingerprint = "different-target".into();
        assert!(apply(
            &runtime,
            "okhub_pr_manage",
            &args,
            &preview,
            CancellationToken::new()
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn create_defaults_to_existing_backlog_option_and_preserves_field_only_alias() {
        let dir = tempfile::tempdir().unwrap();
        let (github, _) = crate::github::automation_test_support::fixture(vec![
            (
                "/repos/acme/docs",
                json!({"node_id":"R","name":"docs","full_name":"acme/docs","owner":{"login":"acme"},"default_branch":"main","clone_url":"https://github.com/acme/docs.git","permissions":{"push":true}}),
            ),
            (
                "/graphql",
                json!({"data":{"organization":{"projectV2":{"id":"P","title":"Demo","fields":{"nodes":[{"__typename":"ProjectV2SingleSelectField","id":"STATUS","name":"Status","options":[{"id":"BACKLOG","name":"Backlog"}]}]}}}}}),
            ),
        ]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            project_url: Some("https://github.com/orgs/acme/projects/1".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        let preview=prepare(&runtime,"okhub_board_manage",&json!({"action":"create","requestId":"default-status","repository":"acme/docs","title":"A"})).await.unwrap();
        assert_eq!(preview["changes"]["status"], "backlog");
        let alias = normalized(
            "okhub_board_update_status",
            &json!({"number":1,"priority":"P1"}),
        )
        .unwrap();
        assert_eq!(alias["action"], "legacy_update_fields");
        assert!(alias.get("status").is_none());
    }
    #[test]
    fn completion_cannot_be_smuggled_through_create_update_or_status_change() {
        for (action, args) in [
            ("create", json!({"title":"A","status":"done"})),
            ("update", json!({"number":1,"status":"done"})),
            ("change_status", json!({"number":1,"status":"완료"})),
            ("update", json!({"number":1,"state":"closed"})),
        ] {
            assert!(validate_action(action, &args).is_err(), "{action}: {args}");
        }
        assert!(validate_action("create", &json!({"title":"A"})).is_ok());
        assert!(validate_action("complete", &json!({"number":1})).is_ok());
    }
    #[test]
    fn unfinished_checklist_blocks_completion() {
        assert!(incomplete_checklist(
            "## 완료 조건\n- [ ] 테스트 통과\n- [x] 구현"
        ));
        assert!(!incomplete_checklist("- [x] 구현\n- [X] 테스트"));
        assert!(incomplete_checklist("1. [ ] ordered\n   - [ ] nested"));
        assert!(!incomplete_checklist("```md\n- [ ] example\n```"));
    }

    #[test]
    fn retry_repairs_diverged_status_and_pins_pr_head() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            ..Default::default()
        })
        .unwrap();
        let mut preview = json!({"tool":"okhub_pr_approve_merge","project":{"id":"P"},"changes":{"requestId":"same","repository":"acme/web","number":7},"before":{"headSha":"a".repeat(40)}});
        let mut journal = Journal::open(&runtime, &preview).unwrap();
        journal.claim().unwrap();
        journal.data["steps"]["status"] = json!({"done":true});
        invalidate_diverged_steps(
            &mut journal,
            &json!({"action":"complete"}),
            &json!({"status":"In progress"}),
            &json!({"state":"open"}),
        );
        assert!(journal.data["steps"].get("status").is_none());
        journal.save(false).unwrap();
        preview["before"]["headSha"] = json!("b".repeat(40));
        assert!(Journal::open(&runtime, &preview).unwrap().claim().is_err());
    }
    #[tokio::test]
    async fn confirmed_failure_can_resume_without_repeating_completed_steps() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            ..Default::default()
        })
        .unwrap();
        let preview = json!({"tool":"okhub_board_manage","project":{"id":"P"},"changes":{"requestId":"retry","repository":"acme/web","action":"create","title":"A"}});
        let mut first = Journal::open(&runtime, &preview).unwrap();
        assert!(first.claim().unwrap().is_none());
        first
            .step("create_issue", async { Ok(json!({"number":7})) })
            .await
            .unwrap();
        assert!(first
            .step("add_to_project", async {
                Err(AppError::new(
                    crate::error::ErrorCode::GithubPermissionDenied,
                    "denied",
                ))
            })
            .await
            .is_err());
        first.save(false).unwrap();
        let mut retry = Journal::open(&runtime, &preview).unwrap();
        assert!(retry.claim().unwrap().is_none());
        let created = retry
            .step("create_issue", async {
                panic!("must not create a second Issue")
            })
            .await
            .unwrap();
        assert_eq!(created["number"], 7);
        retry
            .step("add_to_project", async { Ok(json!({"itemId":"I"})) })
            .await
            .unwrap();
        retry.save(false).unwrap();
    }

    #[tokio::test]
    async fn uncertain_failure_blocks_replay_and_request_id_cannot_change_payload() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().to_path_buf()),
            ..Default::default()
        })
        .unwrap();
        let mut preview = json!({"tool":"okhub_board_manage","project":{"id":"P"},"changes":{"requestId":"same","repository":"acme/web","action":"create","title":"A"}});
        let mut first = Journal::open(&runtime, &preview).unwrap();
        first.claim().unwrap();
        assert!(first
            .step("create_issue", async {
                Err(AppError::new(
                    crate::error::ErrorCode::GithubUnavailable,
                    "network unknown",
                ))
            })
            .await
            .is_err());
        first.save(false).unwrap();
        assert!(Journal::open(&runtime, &preview).unwrap().claim().is_err());
        preview["changes"]["title"] = json!("B");
        assert!(Journal::open(&runtime, &preview).unwrap().claim().is_err());
    }
}
