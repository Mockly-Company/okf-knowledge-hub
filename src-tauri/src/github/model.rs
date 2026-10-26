use serde::Serialize;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubProjectItem {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub labels: Vec<String>,
    pub status: Option<String>,
    pub area: Option<String>,
    pub kind: Option<String>,
    /// 본문 `이전 단계: #N`에서 읽은 선행 이슈 번호. 없으면 `None`.
    pub depends_on: Option<u64>,
    pub sub_issues: Vec<GithubSubIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubSubIssue {
    pub number: u64,
    pub title: String,
    pub url: String,
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
            if let Ok(number) = digits.parse::<u64>() {
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
        assert_eq!(
            parse_depends_on(Some("Depends-On: #12")),
            Some(12)
        );
        assert_eq!(parse_depends_on(Some("depends on: 7")), Some(7));
    }

    #[test]
    fn ignores_missing_or_invalid_lines() {
        assert_eq!(parse_depends_on(None), None);
        assert_eq!(parse_depends_on(Some("순서 없음")), None);
        assert_eq!(parse_depends_on(Some("이전 단계: TBD")), None);
    }
}
