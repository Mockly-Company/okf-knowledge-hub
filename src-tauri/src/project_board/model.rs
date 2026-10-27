use serde::{Deserialize, Serialize};

/// GitHub 라벨(`layer:*`)과 1:1로 대응하는 작업 레이어.
/// 보드는 이 레이어를 행(수영 레인)으로 나눠 보여준다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardLayer {
    Planning,
    Design,
    Frontend,
    Backend,
}

impl BoardLayer {
    pub fn all() -> [BoardLayer; 4] {
        [
            BoardLayer::Planning,
            BoardLayer::Design,
            BoardLayer::Frontend,
            BoardLayer::Backend,
        ]
    }

    pub fn label(self) -> &'static str {
        match self {
            BoardLayer::Planning => "layer:planning",
            BoardLayer::Design => "layer:design",
            BoardLayer::Frontend => "layer:frontend",
            BoardLayer::Backend => "layer:backend",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            BoardLayer::Planning => "기획",
            BoardLayer::Design => "디자인",
            BoardLayer::Frontend => "프론트엔드",
            BoardLayer::Backend => "백엔드",
        }
    }

    pub fn from_label(label: &str) -> Option<BoardLayer> {
        match label.trim().to_ascii_lowercase().as_str() {
            "layer:planning" => Some(BoardLayer::Planning),
            "layer:design" => Some(BoardLayer::Design),
            "layer:frontend" => Some(BoardLayer::Frontend),
            "layer:backend" => Some(BoardLayer::Backend),
            _ => None,
        }
    }
}

/// 보드 열. GitHub Project의 상태와 같은 순서다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardStatus {
    Backlog,
    Ready,
    InProgress,
    InReview,
    Done,
}

impl BoardStatus {
    pub fn all() -> [BoardStatus; 5] {
        [
            BoardStatus::Backlog,
            BoardStatus::Ready,
            BoardStatus::InProgress,
            BoardStatus::InReview,
            BoardStatus::Done,
        ]
    }

    pub fn display_name(self) -> &'static str {
        match self {
            BoardStatus::Backlog => "Backlog",
            BoardStatus::Ready => "Ready",
            BoardStatus::InProgress => "In progress",
            BoardStatus::InReview => "In review",
            BoardStatus::Done => "Done",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardIssue {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub layer: BoardLayer,
    pub status: BoardStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBoard {
    pub issues: Vec<BoardIssue>,
    /// 마지막으로 GitHub에서 가져온 시각(RFC 3339). 아직 가져오지 않았으면 `None`.
    pub fetched_at: Option<String>,
    /// 레이어/상태를 판별할 수 없어 보드에서 제외한 항목 수.
    #[serde(default)]
    pub skipped: u32,
}

impl ProjectBoard {
    pub fn empty() -> Self {
        Self {
            issues: Vec::new(),
            fetched_at: None,
            skipped: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedGithubProject {
    pub id: String,
    pub owner: String,
    pub number: u64,
    pub title: String,
    pub scope: ProjectOwnerScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectOwnerScope {
    Organization,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProjectUrl {
    pub scope: ProjectOwnerScope,
    pub owner: String,
    pub number: u64,
}

/// `https://github.com/orgs/{owner}/projects/{number}`,
/// `https://github.com/users/{login}/projects/{number}` 형태를 읽는다.
/// (`/views/...` 같은 꼬리 경로는 무시한다.)
pub fn parse_project_url(raw: &str) -> Result<ParsedProjectUrl, String> {
    let trimmed = raw.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .ok_or_else(|| "GitHub Project URL은 https:// 로 시작해야 합니다.".to_owned())?;
    let mut segments = without_scheme.split('/').filter(|part| !part.is_empty());
    let host = segments
        .next()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| "GitHub Project URL 형식을 확인해 주세요.".to_owned())?;
    if host != "github.com" {
        return Err("GitHub Project URL 형식을 확인해 주세요.".to_owned());
    }
    let scope_segment = segments.next().unwrap_or_default();
    let scope = match scope_segment {
        "orgs" => ProjectOwnerScope::Organization,
        "users" => ProjectOwnerScope::User,
        _ => {
            return Err(
                "GitHub Project URL은 /orgs/{이름}/projects/{번호} 또는 /users/{이름}/projects/{번호} 형태여야 합니다."
                    .to_owned(),
            )
        }
    };
    let owner = segments.next().unwrap_or_default();
    if owner.is_empty() {
        return Err("GitHub Project URL 형식을 확인해 주세요.".to_owned());
    }
    if segments.next().unwrap_or_default() != "projects" {
        return Err(
            "GitHub Project URL은 /orgs/{이름}/projects/{번호} 또는 /users/{이름}/projects/{번호} 형태여야 합니다."
                .to_owned(),
        );
    }
    let number = segments
        .next()
        .and_then(|part| part.parse::<u64>().ok())
        .filter(|number| *number > 0)
        .ok_or_else(|| "GitHub Project 번호를 확인해 주세요.".to_owned())?;
    Ok(ParsedProjectUrl {
        scope,
        owner: owner.to_owned(),
        number,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_project_url, BoardLayer, BoardStatus, ProjectBoard, ProjectOwnerScope};

    #[test]
    fn layer_labels_match_the_github_convention() {
        assert_eq!(BoardLayer::Planning.label(), "layer:planning");
        assert_eq!(BoardLayer::Design.label(), "layer:design");
        assert_eq!(BoardLayer::Frontend.label(), "layer:frontend");
        assert_eq!(BoardLayer::Backend.label(), "layer:backend");
    }

    #[test]
    fn layer_lookup_ignores_case_and_whitespace() {
        assert_eq!(
            BoardLayer::from_label(" Layer:Planning "),
            Some(BoardLayer::Planning)
        );
        assert_eq!(
            BoardLayer::from_label("layer:backend"),
            Some(BoardLayer::Backend)
        );
        assert_eq!(BoardLayer::from_label("layer:unknown"), None);
    }

    #[test]
    fn project_url_parses_org_and_user_forms() {
        let parsed =
            parse_project_url("https://github.com/orgs/Mockly-Company/projects/1").unwrap();
        assert_eq!(parsed.scope, ProjectOwnerScope::Organization);
        assert_eq!(parsed.owner, "Mockly-Company");
        assert_eq!(parsed.number, 1);

        let parsed =
            parse_project_url("https://github.com/users/octocat/projects/42/views/1").unwrap();
        assert_eq!(parsed.scope, ProjectOwnerScope::User);
        assert_eq!(parsed.owner, "octocat");
        assert_eq!(parsed.number, 42);
    }

    #[test]
    fn project_url_rejects_non_project_paths() {
        assert!(parse_project_url("https://github.com/Mockly-Company/mockly-mobile").is_err());
        assert!(parse_project_url("not a url").is_err());
        assert!(parse_project_url("https://github.com/orgs/acme/projects/0").is_err());
        assert!(parse_project_url("http://github.com/orgs/acme/projects/1").is_err());
        assert!(parse_project_url("https://evil.com/orgs/acme/projects/1").is_err());
    }

    #[test]
    fn board_round_trips_through_camel_case_json() {
        let board = ProjectBoard {
            issues: vec![super::BoardIssue {
                number: 12,
                title: "기획서 초안".to_owned(),
                url: "https://example.test/issues/12".to_owned(),
                layer: BoardLayer::Planning,
                status: BoardStatus::InProgress,
            }],
            fetched_at: Some("2026-10-25T12:00:00+09:00".to_owned()),
            skipped: 0,
        };
        let json = serde_json::to_string(&board).expect("board serializes");
        assert!(json.contains("\"fetchedAt\""));
        let restored: ProjectBoard = serde_json::from_str(&json).expect("board parses");
        assert_eq!(restored, board);
    }
}
