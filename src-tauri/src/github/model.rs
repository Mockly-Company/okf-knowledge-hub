use serde::Serialize;

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
