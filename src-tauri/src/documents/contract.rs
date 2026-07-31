use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterError {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
