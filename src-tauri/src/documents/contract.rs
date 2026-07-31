use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub document_id: Option<Uuid>,
    pub frontmatter_status: FrontmatterStatus,
    pub modified_at_unix_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterError {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum FrontmatterStatus {
    Valid,
    Missing,
    Invalid { error: FrontmatterError },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DocumentTreeEntry {
    Folder {
        name: String,
        path: String,
        children: Vec<DocumentTreeEntry>,
    },
    Document {
        summary: DocumentSummary,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDocumentMetadata {
    pub title: String,
    pub document_id: Option<Uuid>,
    pub frontmatter_status: FrontmatterStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCatalog {
    pub documents: Vec<DocumentSummary>,
    pub roots: Vec<DocumentTreeEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileDelta {
    pub to_index: Vec<String>,
    pub deleted: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchMatchField {
    Title,
    Path,
    Body,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub match_field: SearchMatchField,
    pub match_text: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub items: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum IndexStatus {
    Preparing { indexed: usize, total: usize },
    Ready,
    Degraded { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DocumentEvent {
    TreeChanged {
        session_id: Uuid,
        catalog: DocumentCatalog,
    },
    IndexStatusChanged {
        session_id: Uuid,
        status: IndexStatus,
    },
    OpenDocumentChanged {
        session_id: Uuid,
        path: String,
    },
    Failed {
        session_id: Uuid,
        error: crate::error::AppError,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSessionSnapshot {
    pub session_id: Uuid,
    pub catalog: DocumentCatalog,
    pub index_status: IndexStatus,
    pub last_opened_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::{DocumentEvent, IndexStatus};

    #[test]
    fn document_events_use_the_approved_tagged_camel_case_wire_shape() {
        let session_id = Uuid::parse_str("9f9e8ac7-cf5a-4f83-b716-0b52e69fb9d6").unwrap();

        let event = serde_json::to_value(DocumentEvent::IndexStatusChanged {
            session_id,
            status: IndexStatus::Preparing {
                indexed: 2,
                total: 5,
            },
        })
        .unwrap();

        assert_eq!(event["type"], "index_status_changed");
        assert_eq!(event["sessionId"], session_id.to_string());
        assert_eq!(event["status"]["status"], "preparing");
        assert_eq!(event["status"]["indexed"], 2);
        assert_eq!(event["status"]["total"], 5);
    }
}
