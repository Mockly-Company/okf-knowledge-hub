//! Shared, explicit coverage and continuation metadata for MCP reads.
use crate::error::AppError;
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn normalized(tool: &str, args: &Value) -> Result<Value, AppError> {
    if tool == "okhub_doc_list" {
        super::mcp_sources::doc_list_options(args)
    } else {
        Ok(args.clone())
    }
}

fn fingerprint(tool: &str, args: &Value) -> String {
    let mut query = args.clone();
    if let Some(object) = query.as_object_mut() {
        object.remove("queryFingerprint");
        object.remove("offset");
    }
    if let Some(object) = query.get_mut("code").and_then(Value::as_object_mut) {
        object.remove("offset");
    }
    format!(
        "{:x}",
        Sha256::digest(
            json!({"tool":tool,"arguments":query})
                .to_string()
                .as_bytes()
        )
    )
}

pub(super) fn validate(tool: &str, args: &Value) -> Result<(), AppError> {
    if let Some(expected) = args["queryFingerprint"].as_str() {
        if expected != fingerprint(tool, &normalized(tool, args)?) {
            return Err(super::mcp_sdk::error(
                "후속 조회의 workspace·버전·필터·정렬이 달라졌습니다. 새 조회로 시작하세요.",
            ));
        }
    }
    Ok(())
}

fn omissions(value: &Value, out: &mut Vec<Value>) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if [
                    "truncated",
                    "fieldsTruncated",
                    "diffMayBeIncomplete",
                    "matchesMayBeTruncated",
                    "patchMayBeIncomplete",
                    "textTruncated",
                    "reviewersTruncated",
                ]
                .contains(&key.as_str())
                    && value == true
                {
                    out.push(json!({"reason":key}));
                } else if key == "errors"
                    && value.as_array().is_some_and(|errors| !errors.is_empty())
                {
                    out.push(json!({"reason":"read_errors","details":value}));
                } else if key == "droppedItems" && value.as_u64().is_some_and(|n| n > 0) {
                    out.push(json!({"reason":"dropped_items","count":value}));
                } else if key == "error" && !value.is_null() && value != &json!("") {
                    out.push(json!({"reason":"read_error","details":value}));
                } else if !["coverage", "continuation"].contains(&key.as_str()) {
                    omissions(value, out)
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                omissions(item, out)
            }
        }
        _ => {}
    }
}

pub(super) fn decorate(tool: &str, args: &Value, result: &mut Value) -> Result<(), AppError> {
    if tool == "okhub_context_issue" {
        if let Some(code) = result.get_mut("code").filter(|code| code.is_object()) {
            decorate_page(tool, args, code, true)?;
        }
        let mut missing = Vec::new();
        omissions(result, &mut missing);
        let code_more = result["code"]["coverage"]["hasMore"] == true;
        let code_incomplete = result["code"]["coverage"]["complete"] == false;
        let warnings = result["warnings"]
            .as_array()
            .is_some_and(|items| !items.is_empty());
        result["coverage"] = json!({"unit":"items","scanned":null,"total":null,"hasMore":code_more,"complete":!code_more && !code_incomplete && !warnings && missing.is_empty(),"omissions":missing,"warnings":result["warnings"]});
    } else if matches!(
        tool,
        "okhub_doc_list" | "okhub_board_list" | "okhub_board_ready" | "okhub_pr_list"
    ) && result.is_object()
    {
        decorate_page(tool, args, result, false)?;
    }
    Ok(())
}

fn decorate_page(tool: &str, args: &Value, page: &mut Value, code: bool) -> Result<(), AppError> {
    let scope = page["scope"].as_str().unwrap_or("");
    let unit = match scope {
        "file_excerpt" => "lines",
        "file_text_search" => "matches",
        "file_list" | "paged_text_search" => "files",
        "pull_request_diff" => "diff_files",
        _ => "items",
    };
    let scanned = page["scannedFiles"].as_u64().or_else(|| {
        if unit == "lines" {
            Some(page["content"].as_str().unwrap_or("").lines().count() as u64)
        } else {
            page[if unit == "matches" {
                "matches"
            } else {
                "items"
            }]
            .as_array()
            .map(|items| items.len() as u64)
        }
    });
    let total = page["totalFiles"]
        .as_u64()
        .or(page["totalLines"].as_u64())
        .or(page["total"].as_u64());
    let next = page["nextOffset"].as_u64();
    let more = next.is_some();
    let mut missing = Vec::new();
    omissions(page, &mut missing);
    let warnings = page["warnings"].clone();
    let warnings_present = warnings.as_array().is_some_and(|items| !items.is_empty());
    page["coverage"] = json!({"unit":unit,"scanned":scanned,"total":total,"hasMore":more,"complete":!more&&missing.is_empty()&&!warnings_present,"omissions":missing,"warnings":warnings});
    if let Some(offset) = next {
        let mut next_args = normalized(tool, args)?;
        next_args
            .as_object_mut()
            .unwrap()
            .remove("queryFingerprint");
        if code {
            next_args["code"]["offset"] = json!(offset);
            if let Some(commit) = page["commit"].as_str() {
                next_args["code"]["commit"] = json!(commit);
            }
            if let Some(repository) = page["repository"].as_str() {
                next_args["code"]["repository"] = json!(repository);
            }
        } else {
            next_args["offset"] = json!(offset);
            if page["published"] == true {
                if page["repositoryCommits"].is_object() {
                    next_args["repositoryCommits"] = page["repositoryCommits"].clone();
                    next_args["documentScopeFingerprint"] =
                        page["documentScopeFingerprint"].clone();
                    next_args.as_object_mut().unwrap().remove("commit");
                } else {
                    next_args["commit"] = page["commit"].clone();
                }
            }
        }
        let hash = fingerprint(tool, &next_args);
        next_args["queryFingerprint"] = json!(hash);
        page["continuation"] = json!({"tool":tool,"arguments":next_args,"queryFingerprint":hash});
    } else {
        page["continuation"] = Value::Null;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nested_warnings_and_excerpt_omissions_never_claim_complete() {
        for detail in [
            json!({"warnings":["access denied"]}),
            json!({"textTruncated":true}),
            json!({"patchMayBeIncomplete":true}),
            json!({"reviewersTruncated":true}),
            json!({"error":"file unavailable"}),
        ] {
            let mut result =
                json!({"code":{"scope":"file_excerpt","content":"a","nextOffset":null}});
            result["code"]
                .as_object_mut()
                .unwrap()
                .extend(detail.as_object().unwrap().clone());
            decorate("okhub_context_issue", &json!({}), &mut result).unwrap();
            assert_eq!(result["code"]["coverage"]["complete"], false, "{detail}");
            assert_eq!(result["coverage"]["complete"], false, "{detail}");
        }
    }

    #[test]
    fn zero_matches_with_unscanned_files_requires_a_continuation() {
        let args = json!({"workspaceId":"B","document":{"path":"docs/api.md","commit":"a".repeat(40)},"code":{"repository":"acme/api","query":"password","limit":20}});
        let mut result = json!({"code":{"repository":"acme/api","commit":"b".repeat(40),"items":[],"errors":[],"scannedFiles":20,"totalFiles":100,"nextOffset":20,"scope":"paged_text_search"}});
        decorate("okhub_context_issue", &args, &mut result).unwrap();
        assert_eq!(result["code"]["coverage"]["unit"], "files");
        assert_eq!(result["code"]["coverage"]["hasMore"], true);
        assert_eq!(result["code"]["coverage"]["complete"], false);
        let next = &result["code"]["continuation"]["arguments"];
        assert_eq!(next["workspaceId"], "B");
        assert_eq!(next["code"]["offset"], 20);
        assert_eq!(next["code"]["commit"], "b".repeat(40));
        assert!(validate("okhub_context_issue", next).is_ok());
        let mut changed = next.clone();
        changed["workspaceId"] = json!("A");
        assert!(validate("okhub_context_issue", &changed).is_err());
    }

    #[test]
    fn no_more_pages_is_not_complete_when_a_file_failed_or_diff_was_omitted() {
        let mut result = json!({"code":{"scope":"pull_request_diff","items":[],"nextOffset":null,"diffMayBeIncomplete":true}});
        decorate(
            "okhub_context_issue",
            &json!({"code":{"repository":"acme/api","pullRequest":42}}),
            &mut result,
        )
        .unwrap();
        assert_eq!(result["code"]["coverage"]["hasMore"], false);
        assert_eq!(result["code"]["coverage"]["complete"], false);
        assert!(!result["code"]["coverage"]["omissions"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn published_page_continuation_pins_commit_filter_and_order() {
        let mut result = json!({"items":[{"path":"docs/a.md"}],"total":2,"nextOffset":1,"commit":"a".repeat(40),"published":true});
        decorate(
            "okhub_doc_list",
            &json!({"workspaceId":"A","published":true,"query":"login","limit":1}),
            &mut result,
        )
        .unwrap();
        let next = &result["continuation"]["arguments"];
        assert_eq!(next["commit"], "a".repeat(40));
        assert_eq!(next["sort"], "updated_desc");
        assert_eq!(next["type"], "Product Spec");
        assert!(validate("okhub_doc_list", next).is_ok());
        let mut changed = next.clone();
        changed["query"] = json!("another");
        assert!(validate("okhub_doc_list", &changed).is_err());
    }
}
