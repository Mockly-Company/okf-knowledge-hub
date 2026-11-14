use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::github::model::{GithubProjectItem, GithubSubIssue};
use crate::project_board::model::{BoardLayer, BoardStatus};
use crate::settings::ai_runner::{active_context_rules, ActiveWorkspaceAiContext};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyBoardItem {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub repository_full_name: Option<String>,
    pub layer: BoardLayer,
    pub status: BoardStatus,
    pub kind: Option<String>,
    pub depends_on: Option<u64>,
    pub sub_issue_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDocExcerpt {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueContextPack {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub repository_full_name: Option<String>,
    pub layer: BoardLayer,
    pub status: Option<BoardStatus>,
    pub kind: Option<String>,
    pub body: String,
    pub depends_on: Option<u64>,
    pub predecessor_done: bool,
    pub ready_to_start: bool,
    pub sub_issues: Vec<GithubSubIssue>,
    pub linked_documents: Vec<LinkedDocExcerpt>,
    pub recommended_working_dir: Option<String>,
    pub markdown_summary: String,
}

pub fn map_item_status(raw: Option<&str>) -> Option<BoardStatus> {
    match raw?.trim().to_ascii_lowercase().as_str() {
        "backlog" | "todo" | "백로그" => Some(BoardStatus::Backlog),
        "ready" | "준비됨" => Some(BoardStatus::Ready),
        "in progress" | "진행 중" => Some(BoardStatus::InProgress),
        "in review" | "검토 중" => Some(BoardStatus::InReview),
        "done" | "완료" => Some(BoardStatus::Done),
        _ => None,
    }
}

pub fn map_item_layer(area: Option<&str>, labels: &[String]) -> BoardLayer {
    if let Some(area_str) = area.map(str::trim) {
        match area_str {
            "기획" | "Planning" | "planning" => return BoardLayer::Planning,
            "디자인" | "Design" | "design" => return BoardLayer::Design,
            "프론트엔드" | "프론트" | "Frontend" | "frontend" => {
                return BoardLayer::Frontend;
            }
            "백엔드" | "Backend" | "backend" => return BoardLayer::Backend,
            _ => {}
        }
    }
    labels
        .iter()
        .find_map(|label| BoardLayer::from_label(label))
        .unwrap_or(BoardLayer::Unassigned)
}

pub fn parse_board_layer_arg(raw: &str) -> Option<BoardLayer> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "planning" | "기획" | "layer:planning" => Some(BoardLayer::Planning),
        "design" | "디자인" | "layer:design" => Some(BoardLayer::Design),
        "frontend" | "front" | "프론트엔드" | "프론트" | "layer:frontend" => {
            Some(BoardLayer::Frontend)
        }
        "backend" | "back" | "백엔드" | "layer:backend" => Some(BoardLayer::Backend),
        "unassigned" | "미지정" => Some(BoardLayer::Unassigned),
        _ => None,
    }
}

pub fn parse_board_status_arg(raw: &str) -> Option<BoardStatus> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "backlog" | "todo" | "백로그" => Some(BoardStatus::Backlog),
        "ready" | "준비됨" => Some(BoardStatus::Ready),
        "in_progress" | "in-progress" | "in progress" | "진행 중" => {
            Some(BoardStatus::InProgress)
        }
        "in_review" | "in-review" | "in review" | "검토 중" => Some(BoardStatus::InReview),
        "done" | "완료" => Some(BoardStatus::Done),
        _ => None,
    }
}

pub fn compute_ready_board_items(
    items: &[GithubProjectItem],
    layer_filter: Option<BoardLayer>,
) -> Vec<ReadyBoardItem> {
    let status_by_number: HashMap<u64, BoardStatus> = items
        .iter()
        .filter_map(|item| map_item_status(item.status.as_deref()).map(|st| (item.number, st)))
        .collect();

    let mut ready = Vec::new();
    for item in items {
        let Some(status) = map_item_status(item.status.as_deref()) else {
            continue;
        };
        if !matches!(status, BoardStatus::Backlog | BoardStatus::Ready) {
            continue;
        }
        let predecessor_ready = match item.depends_on {
            None => true,
            Some(dep) => status_by_number.get(&dep) == Some(&BoardStatus::Done),
        };
        if !predecessor_ready {
            continue;
        }
        let layer = map_item_layer(item.area.as_deref(), &item.labels);
        if let Some(wanted) = layer_filter {
            if layer != wanted {
                continue;
            }
        }
        ready.push(ReadyBoardItem {
            number: item.number,
            title: item.title.clone(),
            url: item.url.clone(),
            repository_full_name: item.repository_full_name.clone(),
            layer,
            status,
            kind: item.kind.clone(),
            depends_on: item.depends_on,
            sub_issue_count: item.sub_issues.len(),
        });
    }
    ready.sort_by_key(|item| item.number);
    ready
}

pub fn extract_referenced_doc_paths(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for token in text.split(|ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '`' | '"' | '\'' | '(' | ')' | '[' | ']' | '<' | '>' | ',' | ';'
            )
    }) {
        let clean = token
            .trim_matches(|ch: char| ch == '.' || ch == ':')
            .split('#')
            .next()
            .unwrap_or_default();
        if clean.ends_with(".md")
            && !clean.contains("..")
            && !clean.starts_with("http://")
            && !clean.starts_with("https://")
            && (clean.starts_with("docs/") || clean.starts_with(".okf/"))
            && !found.iter().any(|existing| existing == clean)
        {
            found.push(clean.to_owned());
        }
    }
    found
}

pub fn select_working_directory_for_issue(
    layer: BoardLayer,
    issue_repository_full_name: Option<&str>,
    docs_workspace_root: Option<&Path>,
    active_context: &ActiveWorkspaceAiContext,
) -> Option<String> {
    if matches!(
        layer,
        BoardLayer::Frontend | BoardLayer::Backend | BoardLayer::Design
    ) {
        if let Some(repo_full_name) = issue_repository_full_name {
            if let Some(matched) = active_context.code_repositories.iter().find(|repo| {
                repo.full_name.eq_ignore_ascii_case(repo_full_name) && repo.local_path.is_some()
            }) {
                return matched.local_path.clone();
            }
        }
        if let Some(first_connected) = active_context
            .code_repositories
            .iter()
            .find_map(|repo| repo.local_path.clone())
        {
            return Some(first_connected);
        }
    }
    docs_workspace_root.map(|p| p.display().to_string())
}

pub fn assemble_issue_context_pack(
    target: &GithubProjectItem,
    all_items: &[GithubProjectItem],
    docs_workspace_root: Option<&Path>,
    active_context: &ActiveWorkspaceAiContext,
) -> IssueContextPack {
    let status = map_item_status(target.status.as_deref());
    let layer = map_item_layer(target.area.as_deref(), &target.labels);
    let predecessor_done = match target.depends_on {
        None => true,
        Some(dep) => all_items
            .iter()
            .find(|item| item.number == dep)
            .and_then(|item| map_item_status(item.status.as_deref()))
            .is_some_and(|st| st == BoardStatus::Done),
    };
    let ready_to_start =
        matches!(status, Some(BoardStatus::Backlog | BoardStatus::Ready)) && predecessor_done;
    let body = target.body.clone().unwrap_or_default();

    let mut linked_documents = Vec::new();
    if let Some(root) = docs_workspace_root {
        if let Ok(canonical_root) = root.canonicalize() {
            for rel_path in extract_referenced_doc_paths(&body) {
                let candidate = root.join(&rel_path);
                if let Ok(canonical_file) = candidate.canonicalize() {
                    if canonical_file.starts_with(&canonical_root) {
                        if let Ok(content) = fs::read_to_string(&canonical_file) {
                            linked_documents.push(LinkedDocExcerpt {
                                path: rel_path,
                                content,
                            });
                        }
                    }
                }
            }
        }
    }

    let recommended_working_dir = select_working_directory_for_issue(
        layer,
        target.repository_full_name.as_deref(),
        docs_workspace_root,
        active_context,
    );

    let mut md = Vec::new();
    md.push(format!(
        "# 작업 컨텍스트 팩 — #{} {}",
        target.number, target.title
    ));
    md.push(String::new());
    md.push(format!("- 이슈 URL: {}", target.url));
    if let Some(repo) = target.repository_full_name.as_deref() {
        md.push(format!("- 대상 저장소: `{repo}`"));
    }
    md.push(format!("- 레이어(영역): `{}`", layer.display_name()));
    md.push(format!(
        "- 현재 상태: `{}`",
        status.map(|s| s.display_name()).unwrap_or("미지정")
    ));
    if let Some(dep) = target.depends_on {
        md.push(format!(
            "- 선행 이슈(`이전 단계`): `#{dep}` ({})",
            if predecessor_done {
                "완료됨 — 시작 가능"
            } else {
                "미완료 — 선행 이슈 완료 필요"
            }
        ));
    } else {
        md.push("- 선행 이슈(`이전 단계`): 없음 (즉시 시작 가능)".to_owned());
    }
    if let Some(cwd) = recommended_working_dir.as_deref() {
        md.push(format!("- 권장 작업 폴더: `{cwd}`"));
    }
    md.push(String::new());
    md.push("## 이슈 본문".to_owned());
    md.push(String::new());
    if body.trim().is_empty() {
        md.push("_(본문 없음)_".to_owned());
    } else {
        md.push(body.clone());
    }

    if !target.sub_issues.is_empty() {
        md.push(String::new());
        md.push("## 연결된 하위 이슈 (Sub-issues)".to_owned());
        md.push(String::new());
        for sub in &target.sub_issues {
            md.push(format!("- #{} {} ({})", sub.number, sub.title, sub.url));
        }
    }

    if !linked_documents.is_empty() {
        md.push(String::new());
        md.push("## 연결된 기획·설계 문서 원문 (`.md`)".to_owned());
        for doc in &linked_documents {
            md.push(String::new());
            md.push(format!("### `{}`", doc.path));
            md.push(String::new());
            md.push(doc.content.clone());
        }
    }

    md.push(String::new());
    md.push(active_context_rules(active_context));

    IssueContextPack {
        number: target.number,
        title: target.title.clone(),
        url: target.url.clone(),
        repository_full_name: target.repository_full_name.clone(),
        layer,
        status,
        kind: target.kind.clone(),
        body,
        depends_on: target.depends_on,
        predecessor_done,
        ready_to_start,
        sub_issues: target.sub_issues.clone(),
        linked_documents,
        recommended_working_dir,
        markdown_summary: md.join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use crate::github::model::GithubProjectItem;
    use crate::project_board::model::BoardLayer;
    use crate::settings::ai_runner::{ActiveWorkspaceAiContext, LinkedCodeRepoRuleInfo};

    use super::{assemble_issue_context_pack, compute_ready_board_items};

    fn make_item(
        number: u64,
        title: &str,
        status: &str,
        area: &str,
        depends_on: Option<u64>,
        body: &str,
    ) -> GithubProjectItem {
        GithubProjectItem {
            item_id: Some(format!("PVTI_{number}")),
            content_id: Some(format!("I_{number}")),
            number,
            title: title.to_owned(),
            url: format!("https://github.com/Acme-Org/acme-web/issues/{number}"),
            body: Some(body.to_owned()),
            repository_full_name: Some("Acme-Org/acme-web".to_owned()),
            labels: Vec::new(),
            status: Some(status.to_owned()),
            area: Some(area.to_owned()),
            kind: Some("작업".to_owned()),
            depends_on,
            sub_issues: Vec::new(),
        }
    }

    #[test]
    fn ready_detection_and_context_pack_assembly_follow_dependencies_and_mapped_repos() {
        let temp = TempDir::new().unwrap();
        let docs_dir = temp.path().join("docs").join("product");
        std::fs::create_dir_all(&docs_dir).unwrap();
        std::fs::write(
            docs_dir.join("checkout.md"),
            "# 결제 기획안\n\n요구사항 A\n",
        )
        .unwrap();

        let items = vec![
            make_item(10, "[기획] 결제 개편", "Done", "기획", None, ""),
            make_item(
                11,
                "[백엔드] 결제 API",
                "Backlog",
                "백엔드",
                Some(10),
                "참고 문서: `docs/product/checkout.md`\n이전 단계: #10",
            ),
            make_item(
                12,
                "[프론트] 결제 UI",
                "Backlog",
                "프론트엔드",
                Some(11),
                "이전 단계: #11",
            ),
        ];

        let ready = compute_ready_board_items(&items, None);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].number, 11);
        assert_eq!(ready[0].layer, BoardLayer::Backend);

        let ctx = ActiveWorkspaceAiContext {
            workspace_title: Some("Acme Docs".to_owned()),
            docs_repository_full_name: Some("Acme-Org/acme-docs".to_owned()),
            project: None,
            code_repositories: vec![LinkedCodeRepoRuleInfo {
                key: "web".to_owned(),
                label: "Acme Web".to_owned(),
                full_name: "Acme-Org/acme-web".to_owned(),
                local_path: Some("/work/acme-web".to_owned()),
            }],
        };

        let pack = assemble_issue_context_pack(&items[1], &items, Some(temp.path()), &ctx);
        assert!(pack.ready_to_start);
        assert!(pack.predecessor_done);
        assert_eq!(
            pack.recommended_working_dir.as_deref(),
            Some("/work/acme-web")
        );
        assert_eq!(pack.linked_documents.len(), 1);
        assert_eq!(pack.linked_documents[0].path, "docs/product/checkout.md");
        assert!(pack.markdown_summary.contains("요구사항 A"));
    }
}
