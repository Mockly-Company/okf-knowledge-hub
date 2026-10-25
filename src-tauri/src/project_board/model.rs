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
}

impl ProjectBoard {
    pub fn empty() -> Self {
        Self {
            issues: Vec::new(),
            fetched_at: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{BoardLayer, BoardStatus, ProjectBoard};

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
        };
        let json = serde_json::to_string(&board).expect("board serializes");
        assert!(json.contains("\"fetchedAt\""));
        let restored: ProjectBoard = serde_json::from_str(&json).expect("board parses");
        assert_eq!(restored, board);
    }
}
