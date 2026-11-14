use serde::Serialize;

use crate::project_board::model::{BoardLayer, BoardStatus, ProjectOwnerScope};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectSummary {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectListItem {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub closed: bool,
    pub organization: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositorySummary {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: Option<String>,
    pub is_empty: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryDetail {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: Option<String>,
    pub is_empty: bool,
    pub https_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftPullRequestRequest {
    pub repository_full_name: String,
    pub head: String,
    pub base: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftPullRequest {
    pub number: u64,
    pub html_url: String,
    pub is_draft: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocsPullRequestSummary {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub html_url: String,
    pub author_login: String,
    pub head_ref: String,
    pub head_sha: String,
    pub base_ref: String,
    pub base_sha: String,
    pub is_draft: bool,
    pub mergeable: Option<bool>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChangedFile {
    pub filename: String,
    pub status: String,
    pub previous_filename: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePullRequestInput {
    pub repository_full_name: String,
    pub head: String,
    pub base: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectItem {
    pub item_id: Option<String>,
    pub content_id: Option<String>,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub body: Option<String>,
    pub repository_full_name: Option<String>,
    pub labels: Vec<String>,
    pub status: Option<String>,
    pub area: Option<String>,
    pub kind: Option<String>,
    pub priority: Option<String>,
    /// 본문 `이전 단계: #N`에서 읽은 선행 이슈 번호. 없으면 `None`.
    pub depends_on: Option<u64>,
    pub sub_issues: Vec<GithubSubIssue>,
}

impl GithubProjectItem {
    pub fn infer_repository_full_name(&self) -> Option<String> {
        if let Some(repo) = self
            .repository_full_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(repo.to_owned());
        }
        let after_scheme = self
            .url
            .strip_prefix("https://")
            .or_else(|| self.url.strip_prefix("http://"))?;
        let mut parts = after_scheme.split('/');
        let _host = parts.next()?;
        let owner = parts.next()?.trim();
        let repo = parts.next()?.trim();
        if owner.is_empty() || repo.is_empty() {
            return None;
        }
        Some(format!("{owner}/{repo}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSubIssue {
    pub number: u64,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectFieldOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectSingleSelectField {
    pub id: String,
    pub name: String,
    pub options: Vec<GithubProjectFieldOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubProjectSchema {
    pub project_id: String,
    pub title: String,
    pub scope: ProjectOwnerScope,
    pub single_select_fields: Vec<GithubProjectSingleSelectField>,
}

impl GithubProjectSchema {
    pub fn find_option(
        &self,
        field_names: &[&str],
        option_candidates: &[&str],
    ) -> Option<(&str, &str)> {
        let field = self.single_select_fields.iter().find(|field| {
            let trimmed = field.name.trim();
            field_names
                .iter()
                .any(|want| trimmed.eq_ignore_ascii_case(want) || trimmed == *want)
        })?;
        for candidate in option_candidates {
            if let Some(option) = field.options.iter().find(|opt| {
                let trimmed = opt.name.trim();
                trimmed.eq_ignore_ascii_case(candidate) || trimmed == *candidate
            }) {
                return Some((field.id.as_str(), option.id.as_str()));
            }
        }
        None
    }

    pub fn find_status_option(&self, status: BoardStatus) -> Option<(&str, &str)> {
        let candidates: &[&str] = match status {
            BoardStatus::Backlog => &["Backlog", "Todo", "백로그"],
            BoardStatus::Ready => &["Ready", "준비됨"],
            BoardStatus::InProgress => &["In progress", "In Progress", "진행 중"],
            BoardStatus::InReview => &["In review", "In Review", "검토 중"],
            BoardStatus::Done => &["Done", "완료"],
        };
        self.find_option(&["Status", "상태"], candidates)
    }

    pub fn find_layer_option(&self, layer: BoardLayer) -> Option<(&str, &str)> {
        let candidates: &[&str] = match layer {
            BoardLayer::Planning => &["기획", "Planning"],
            BoardLayer::Design => &["디자인", "Design"],
            BoardLayer::Frontend => &["프론트엔드", "프론트", "Frontend"],
            BoardLayer::Backend => &["백엔드", "Backend"],
            BoardLayer::Unassigned => return None,
        };
        self.find_option(&["영역", "Area", "Layer"], candidates)
    }

    pub fn find_kind_option(&self, kind: &str) -> Option<(&str, &str)> {
        let trimmed = kind.trim();
        if trimmed.is_empty() {
            return None;
        }
        self.find_option(&["타입", "Type", "Kind"], &[trimmed])
    }

    pub fn find_priority_option(&self, priority: &str) -> Option<(&str, &str)> {
        let trimmed = priority.trim();
        if trimmed.is_empty() {
            return None;
        }
        self.find_option(&["Priority", "우선순위", "중요도"], &[trimmed])
    }

    pub fn priority_options(&self) -> Vec<String> {
        self.single_select_fields
            .iter()
            .find(|field| {
                let trimmed = field.name.trim();
                ["Priority", "우선순위", "중요도"]
                    .iter()
                    .any(|want| trimmed.eq_ignore_ascii_case(want) || trimmed == *want)
            })
            .map(|field| field.options.iter().map(|opt| opt.name.clone()).collect())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateProjectIssueInput {
    pub project_scope: ProjectOwnerScope,
    pub project_owner: String,
    pub project_number: u64,
    pub repository_full_name: String,
    pub title: String,
    pub body: String,
    pub layer: Option<BoardLayer>,
    pub status: Option<BoardStatus>,
    pub kind: Option<String>,
    pub priority: Option<String>,
    pub parent_issue_number: Option<u64>,
    pub parent_issue_repository: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProjectIssue {
    pub id: String,
    pub item_id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub repository_full_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateProjectItemInput {
    pub project_scope: ProjectOwnerScope,
    pub project_owner: String,
    pub project_number: u64,
    pub issue_number: u64,
    pub repository_full_name: Option<String>,
    pub status: Option<BoardStatus>,
    pub layer: Option<BoardLayer>,
    pub kind: Option<String>,
    pub priority: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedProjectItem {
    pub item_id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub status: Option<String>,
    pub area: Option<String>,
    pub kind: Option<String>,
    pub priority: Option<String>,
}

/// 이슈 본문에서 순서 약속을 읽는다.
///
/// `이전 단계: #12` 또는 `Depends-On: #12` 한 줄이 있으면 선행 이슈 번호를
/// 돌려준다. 없거나 숫자가 아니면 `None`.
pub fn parse_depends_on(body: Option<&str>) -> Option<u64> {
    let body = body?;
    for line in body.lines() {
        let trimmed = line.trim();
        let rest = if let Some(rest) = trimmed.strip_prefix("이전 단계:") {
            Some(rest)
        } else if let Some(rest) = trimmed.strip_prefix("이전단계:") {
            Some(rest)
        } else {
            let lower = trimmed.to_ascii_lowercase();
            if lower.starts_with("depends-on:") {
                Some(&trimmed["depends-on:".len()..])
            } else if lower.starts_with("depends on:") {
                Some(&trimmed["depends on:".len()..])
            } else {
                None
            }
        };
        if let Some(rest) = rest {
            let after_hash = rest.trim().strip_prefix('#').unwrap_or(rest.trim());
            let digits: String = after_hash
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect();
            // Issue 번호는 1부터라 #0은 순서 약속으로 보지 않는다(프론트 normalizeDependsOn과 같은 기준).
            if let Ok(number @ 1..) = digits.parse::<u64>() {
                return Some(number);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_depends_on;

    #[test]
    fn reads_korean_predecessor_line() {
        let body = "데모용 예시입니다.\n\n이전 단계: #50\n";
        assert_eq!(parse_depends_on(Some(body)), Some(50));
    }

    #[test]
    fn reads_depends_on_line() {
        assert_eq!(parse_depends_on(Some("Depends-On: #12")), Some(12));
        assert_eq!(parse_depends_on(Some("depends on: 7")), Some(7));
    }

    #[test]
    fn ignores_missing_or_invalid_lines() {
        assert_eq!(parse_depends_on(None), None);
        assert_eq!(parse_depends_on(Some("순서 없음")), None);
        assert_eq!(parse_depends_on(Some("이전 단계: TBD")), None);
        assert_eq!(parse_depends_on(Some("이전 단계: #0")), None);
    }
}
