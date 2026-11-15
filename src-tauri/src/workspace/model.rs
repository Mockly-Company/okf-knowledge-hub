use std::collections::HashSet;

use indexmap::IndexMap;
use serde::de::{self, SeqAccess, Visitor};
use serde::ser::SerializeSeq;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_yaml_ng::Value;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};
use crate::project_board::ProjectOwnerScope;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConfigV1 {
    pub schema_version: u32,
    pub workspace: WorkspaceIdentity,
    pub documents: DocumentsConfig,
    #[serde(default)]
    pub repositories: Vec<LinkedRepository>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<GithubWorkspaceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignees: Option<WorkspaceAssignees>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

/// 역할별 담당자 목록(기획·디자인·프론트엔드·백엔드).
/// 각 역할 값은 단일 문자열 또는 문자열 목록을 모두 읽으며, 저장 시 1명이면 단일 문자열, 2명 이상이면 목록으로 쓴다.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceAssignees {
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_assignee_logins",
        serialize_with = "serialize_assignee_logins"
    )]
    pub planning: Vec<String>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_assignee_logins",
        serialize_with = "serialize_assignee_logins"
    )]
    pub design: Vec<String>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_assignee_logins",
        serialize_with = "serialize_assignee_logins"
    )]
    pub frontend: Vec<String>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_assignee_logins",
        serialize_with = "serialize_assignee_logins"
    )]
    pub backend: Vec<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

impl WorkspaceAssignees {
    pub fn normalized(&self) -> Self {
        Self {
            planning: normalize_assignee_logins(&self.planning),
            design: normalize_assignee_logins(&self.design),
            frontend: normalize_assignee_logins(&self.frontend),
            backend: normalize_assignee_logins(&self.backend),
            extra: self.extra.clone(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.planning.is_empty()
            && self.design.is_empty()
            && self.frontend.is_empty()
            && self.backend.is_empty()
            && self.extra.is_empty()
    }
}

pub fn normalize_assignee_logins<S: AsRef<str>>(raw: &[S]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for entry in raw {
        let trimmed = entry.as_ref().trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            normalized.push(trimmed.to_owned());
        }
    }
    normalized
}

fn deserialize_assignee_logins<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct AssigneeLoginsVisitor;

    impl<'de> Visitor<'de> for AssigneeLoginsVisitor {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a GitHub username string, list of usernames, or null")
        }

        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
            Ok(normalize_assignee_logins(&[value]))
        }

        fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
            Ok(normalize_assignee_logins(&[value]))
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut raw = Vec::new();
            while let Some(elem) = seq.next_element::<Option<String>>()? {
                if let Some(value) = elem {
                    raw.push(value);
                }
            }
            Ok(normalize_assignee_logins(&raw))
        }
    }

    deserializer.deserialize_any(AssigneeLoginsVisitor)
}

fn serialize_assignee_logins<S: Serializer>(
    logins: &[String],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let clean = normalize_assignee_logins(logins);
    if clean.len() == 1 {
        return serializer.serialize_str(&clean[0]);
    }
    let mut seq = serializer.serialize_seq(Some(clean.len()))?;
    for login in &clean {
        seq.serialize_element(login)?;
    }
    seq.end()
}

/// `.okf/workspace.yml` 원문에서 최상위 `assignees:` 블록만 교체/삽입/제거한다.
/// 나머지 최상위 키의 순서, 들여쓰기, 그리고 모든 `#` 주석을 원문 그대로 보존한다.
pub fn update_workspace_assignees_yaml(
    source: &str,
    assignees: &WorkspaceAssignees,
) -> Result<String, AppError> {
    let original = WorkspaceDocument::parse(source)?;
    let mut normalized = assignees.normalized();
    if normalized.extra.is_empty() {
        if let Some(existing) = original.config.assignees.as_ref() {
            normalized.extra = existing.extra.clone();
        }
    }

    let nl = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };

    let mut block_lines: Vec<String> = Vec::new();
    for (role, list) in [
        ("planning", &normalized.planning),
        ("design", &normalized.design),
        ("frontend", &normalized.frontend),
        ("backend", &normalized.backend),
    ] {
        if list.len() == 1 {
            let encoded = serde_json::to_string(&list[0])
                .map_err(|error| invalid_workspace_error(error.to_string()))?;
            block_lines.push(format!("  {role}: {encoded}"));
        } else if list.len() > 1 {
            let encoded_items = list
                .iter()
                .map(|login| {
                    serde_json::to_string(login)
                        .map_err(|error| invalid_workspace_error(error.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?;
            block_lines.push(format!("  {role}: [{}]", encoded_items.join(", ")));
        }
    }
    for (key, value) in &normalized.extra {
        let mut map = IndexMap::new();
        map.insert(key.clone(), value.clone());
        let rendered = serde_yaml_ng::to_string(&map)
            .map_err(|error| invalid_workspace_error(error.to_string()))?;
        for line in rendered.lines() {
            if !line.trim().is_empty() {
                block_lines.push(format!("  {line}"));
            }
        }
    }

    let span = find_top_level_assignees_span(source);
    let updated = match span {
        Some((start, end)) => {
            if block_lines.is_empty() {
                let prefix = &source[..start];
                let mut suffix = &source[end..];
                if prefix.trim_end_matches(['\r', '\n']) != prefix {
                    // 앞뒤 빈 줄이 겹쳐 보이지 않도록 뒤쪽 여분 빈 줄만 정리한다.
                    while let Some(next_nl) = suffix.find('\n') {
                        let line = suffix[..next_nl].trim_end_matches('\r');
                        if line.trim().is_empty() {
                            suffix = &suffix[next_nl + 1..];
                        } else {
                            break;
                        }
                    }
                }
                format!("{prefix}{suffix}")
            } else {
                let block = format!("assignees:{nl}{}{nl}", block_lines.join(nl));
                format!("{}{block}{}", &source[..start], &source[end..])
            }
        }
        None => {
            if block_lines.is_empty() {
                return Ok(source.to_owned());
            }
            let block = format!("assignees:{nl}{}{nl}", block_lines.join(nl));
            let mut out = source.to_owned();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push_str(nl);
            }
            out.push_str(&block);
            out
        }
    };

    let reparsed = WorkspaceDocument::parse(&updated)?;
    let same_other_fields = reparsed.config.schema_version == original.config.schema_version
        && reparsed.config.workspace == original.config.workspace
        && reparsed.config.documents == original.config.documents
        && reparsed.config.repositories == original.config.repositories
        && reparsed.config.github == original.config.github
        && reparsed.config.extra == original.config.extra;
    if !same_other_fields {
        return Err(invalid_workspace_error(
            "담당자 설정 반영 중 기존 워크스페이스 설정이 손상되었습니다.",
        ));
    }

    Ok(updated)
}

fn find_top_level_assignees_span(source: &str) -> Option<(usize, usize)> {
    let mut lines: Vec<(usize, usize, &str)> = Vec::new();
    let mut pos = 0usize;
    let bytes = source.as_bytes();
    while pos < bytes.len() {
        let start = pos;
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'\n' {
            end += 1;
        }
        let line_no_nl = source[start..end].trim_end_matches('\r');
        let line_end_with_nl = if end < bytes.len() { end + 1 } else { end };
        lines.push((start, line_end_with_nl, line_no_nl));
        pos = line_end_with_nl;
    }

    let mut idx = 0usize;
    while idx < lines.len() {
        let (start, mut end_with_nl, content) = lines[idx];
        if !content.starts_with(char::is_whitespace) {
            if let Some(rest) = content.strip_prefix("assignees:") {
                let valid_header = rest.is_empty()
                    || rest.starts_with(char::is_whitespace)
                    || rest.starts_with('#')
                    || rest.starts_with('{')
                    || rest.starts_with('[');
                if valid_header {
                    let mut scan = idx + 1;
                    while scan < lines.len() {
                        let (_, next_end, next_content) = lines[scan];
                        if next_content.trim().is_empty() {
                            scan += 1;
                            continue;
                        }
                        if next_content.starts_with(' ')
                            || next_content.starts_with('\t')
                            || next_content.starts_with('-')
                        {
                            end_with_nl = next_end;
                            scan += 1;
                            continue;
                        }
                        // 0열 주석 또는 다음 최상위 키를 만나면 assignees 블록을 마친다.
                        break;
                    }
                    return Some((start, end_with_nl));
                }
            }
        }
        idx += 1;
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceIdentity {
    pub id: Uuid,
    pub name: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentsConfig {
    pub roots: Vec<DocumentRoot>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentRoot {
    pub path: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkedRepository {
    pub key: String,
    pub label: String,
    pub github: GithubRepositoryRef,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubRepositoryRef {
    pub id: String,
    pub full_name: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubWorkspaceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<GithubProjectRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub projects: Vec<GithubProjectRef>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "activeProjectId"
    )]
    pub active_project_id: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

impl GithubWorkspaceConfig {
    /// 모든 연결 프로젝트. 구버전 문서(`project` 단일 필드)도 포함한다.
    pub fn all_projects(&self) -> Vec<GithubProjectRef> {
        if self.projects.is_empty() {
            return self.project.clone().into_iter().collect();
        }
        let mut seen = std::collections::HashSet::new();
        let mut merged = Vec::new();
        for project in self.projects.iter().cloned() {
            seen.insert(project.id.clone());
            merged.push(project);
        }
        // 구버전 단일 필드가 목록에 없으면 하위호환용으로 합친다.
        if let Some(legacy) = self.project.clone() {
            if seen.insert(legacy.id.clone()) {
                merged.push(legacy);
            }
        }
        merged
    }

    /// 보드 조회·동기화 기준이 되는 활성 프로젝트.
    /// `active_project_id`가 목록에 없거나 비어 있으면 레거시 단일 프로젝트,
    /// 없으면 목록 첫 항목 순으로 폴백한다.
    pub fn active_project(&self) -> Option<GithubProjectRef> {
        let all = self.all_projects();
        if all.is_empty() {
            return None;
        }
        if let Some(active_id) = self.active_project_id.as_deref() {
            if let Some(found) = all.iter().find(|project| project.id == active_id).cloned() {
                return Some(found);
            }
        }
        if let Some(legacy) = self.project.clone() {
            return Some(legacy);
        }
        all.into_iter().next()
    }

    /// projects에 upsert하고 active로 지정한다. 레거시 `project`도 동기화한다.
    pub fn upsert_active(&mut self, project: GithubProjectRef) {
        if let Some(existing) = self.projects.iter_mut().find(|item| item.id == project.id) {
            *existing = project.clone();
        } else {
            self.projects.push(project.clone());
        }
        self.active_project_id = Some(project.id.clone());
        self.project = Some(project);
    }

    /// 지정 id를 제거한다. active였으면 첫 후보로 폴백하고 레거시도 동기화한다.
    pub fn remove_project(&mut self, project_id: &str) -> bool {
        let before = self.projects.len() + usize::from(self.project.is_some());
        self.projects.retain(|item| item.id != project_id);
        if self
            .project
            .as_ref()
            .is_some_and(|item| item.id == project_id)
        {
            self.project = None;
        }
        if self
            .active_project_id
            .as_deref()
            .is_some_and(|id| id == project_id)
        {
            self.active_project_id = None;
        }
        let removed = before != self.projects.len() + usize::from(self.project.is_some());
        // active가 비었으면 남은 첫 후보를 승격해 레거시 리더와 일치시킨다.
        if self.active_project_id.is_none() {
            if let Some(next) = self.projects.first().cloned() {
                self.active_project_id = Some(next.id.clone());
                self.project = Some(next);
            } else if self.project.is_some() {
                self.active_project_id = self.project.as_ref().map(|item| item.id.clone());
            }
        }
        removed
    }

    /// 지정 id를 active로 승격한다. 레거시 `project`도 동기화한다.
    pub fn set_active(&mut self, project_id: &str) -> bool {
        let found = self.all_projects();
        if let Some(next) = found.into_iter().find(|item| item.id == project_id) {
            self.active_project_id = Some(next.id.clone());
            self.project = Some(next);
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GithubProjectRef {
    pub id: String,
    pub owner: String,
    pub number: u64,
    /// 연결 시 확인된 조직/사용자 구분. 없으면 조직 우선으로 재시도한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<ProjectOwnerScope>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceDocument {
    pub config: WorkspaceConfigV1,
}

impl WorkspaceDocument {
    pub fn parse(source: &str) -> Result<Self, AppError> {
        let probe: Value = serde_yaml_ng::from_str(source)
            .map_err(|error| invalid_workspace_error(error.to_string()))?;
        let schema_version = probe
            .get("schema_version")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid_workspace_error("schema_version은 정수여야 합니다."))?;

        if schema_version > 1 {
            return Err(AppError::new(
                ErrorCode::WorkspaceVersionUnsupported,
                "이 OkHub 버전은 이 워크스페이스 스키마를 지원하지 않습니다.",
            )
            .with_detail("foundVersion", schema_version.to_string()));
        }

        if schema_version != 1 {
            return Err(invalid_workspace_error(format!(
                "지원하지 않는 워크스페이스 스키마 버전입니다: {}",
                schema_version
            )));
        }

        let config = serde_yaml_ng::from_str(source)
            .map_err(|error| invalid_workspace_error(error.to_string()))?;
        Ok(Self { config })
    }

    pub fn to_yaml(&self) -> Result<String, AppError> {
        serde_yaml_ng::to_string(&self.config)
            .map_err(|error| invalid_workspace_error(error.to_string()))
    }
}

fn invalid_workspace_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::WorkspaceInvalid, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn parses_v1_and_preserves_unknown_fields_on_every_rewritable_object() {
        let source = include_str!("fixtures/unknown-fields.yml");
        let document = WorkspaceDocument::parse(source).unwrap();

        assert_eq!(document.config.workspace.name, "Mockly");
        assert_eq!(document.config.repositories[0].key, "backend");
        assert!(document.config.extra.contains_key("extensions"));
        assert!(document
            .config
            .workspace
            .extra
            .contains_key("workspace_extension"));
        assert!(document
            .config
            .documents
            .extra
            .contains_key("documents_extension"));
        assert!(document.config.documents.roots[0]
            .extra
            .contains_key("root_extension"));
        assert!(document.config.repositories[0]
            .extra
            .contains_key("repository_extension"));
        assert!(document.config.repositories[0]
            .github
            .extra
            .contains_key("repository_github_extension"));
        assert!(document
            .config
            .github
            .as_ref()
            .unwrap()
            .extra
            .contains_key("github_extension"));
        assert!(document
            .config
            .github
            .as_ref()
            .unwrap()
            .project
            .as_ref()
            .unwrap()
            .extra
            .contains_key("project_extension"));

        let serialized = document.to_yaml().unwrap();
        let reparsed = WorkspaceDocument::parse(&serialized).unwrap();
        assert!(reparsed.config.extra.contains_key("extensions"));
        assert!(reparsed
            .config
            .workspace
            .extra
            .contains_key("workspace_extension"));
        assert!(reparsed
            .config
            .documents
            .extra
            .contains_key("documents_extension"));
        assert!(reparsed.config.documents.roots[0]
            .extra
            .contains_key("root_extension"));
        assert!(reparsed.config.repositories[0]
            .extra
            .contains_key("repository_extension"));
        assert!(reparsed.config.repositories[0]
            .github
            .extra
            .contains_key("repository_github_extension"));
        assert!(reparsed
            .config
            .github
            .as_ref()
            .unwrap()
            .extra
            .contains_key("github_extension"));
        assert!(reparsed
            .config
            .github
            .as_ref()
            .unwrap()
            .project
            .as_ref()
            .unwrap()
            .extra
            .contains_key("project_extension"));
    }

    #[test]
    fn reports_a_newer_schema_without_deserializing_it_as_v1() {
        let error = WorkspaceDocument::parse("schema_version: 2\n").unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceVersionUnsupported);
        assert_eq!(error.details["foundVersion"], "2");
    }

    #[test]
    fn reports_an_oversized_newer_schema_without_deserializing_it_as_v1() {
        let error = WorkspaceDocument::parse("schema_version: 4294967296\n").unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceVersionUnsupported);
        assert_eq!(error.details["foundVersion"], "4294967296");
    }

    #[test]
    fn assignees_deserialize_scalar_list_and_deduplicate_case_insensitively() {
        let source = r#"schema_version: 1
workspace:
  id: 11111111-1111-1111-1111-111111111111
  name: OkHub
documents:
  roots:
    - path: docs
repositories: []
assignees:
  planning: "YoonCarrot"
  design:
    - "hyeeun"
    - "Hyeeun"
    - "  "
  frontend: ["Alice", "bob"]
  backend: null
"#;
        let doc = WorkspaceDocument::parse(source).unwrap();
        let assignees = doc.config.assignees.expect("assignees must parse");
        assert_eq!(assignees.planning, vec!["YoonCarrot"]);
        assert_eq!(assignees.design, vec!["hyeeun"]);
        assert_eq!(assignees.frontend, vec!["Alice", "bob"]);
        assert!(assignees.backend.is_empty());
    }

    #[test]
    fn update_workspace_assignees_yaml_preserves_comments_key_order_and_formats_single_vs_multiple()
    {
        let source = concat!(
            "# Top workspace comment\n",
            "schema_version: 1\n",
            "workspace:\n",
            "  id: 11111111-1111-1111-1111-111111111111\n",
            "  name: OkHub # inline comment\n",
            "custom_top_key: keep-order\n",
            "documents:\n",
            "  roots:\n",
            "    - path: docs\n",
            "repositories: []\n",
            "\n",
            "# Section comment before assignees\n",
            "assignees:\n",
            "  planning: \"old-planner\"\n",
            "  frontend: [\"old-fe\"]\n",
            "\n",
            "# Trailing section comment\n",
            "extensions:\n",
            "  keep: true\n",
        );

        let updated = update_workspace_assignees_yaml(
            source,
            &WorkspaceAssignees {
                planning: vec!["YoonCarrot".into()],
                design: vec![],
                frontend: vec!["alice".into(), "bob".into(), "Alice".into()],
                backend: vec!["123".into()],
                extra: Default::default(),
            },
        )
        .unwrap();

        assert!(updated.contains("# Top workspace comment\n"));
        assert!(updated.contains("  name: OkHub # inline comment\n"));
        assert!(updated.contains("# Section comment before assignees\n"));
        assert!(updated.contains("# Trailing section comment\n"));
        assert!(updated.contains("  planning: \"YoonCarrot\"\n"));
        assert!(!updated.contains("design:"));
        assert!(updated.contains("  frontend: [\"alice\", \"bob\"]\n"));
        assert!(updated.contains("  backend: \"123\"\n"));

        let custom_idx = updated.find("custom_top_key").unwrap();
        let docs_idx = updated.find("documents:").unwrap();
        let assignees_idx = updated.find("assignees:").unwrap();
        let ext_idx = updated.find("extensions:").unwrap();
        assert!(custom_idx < docs_idx && docs_idx < assignees_idx && assignees_idx < ext_idx);

        let reparsed = WorkspaceDocument::parse(&updated).unwrap();
        let assignees = reparsed.config.assignees.unwrap();
        assert_eq!(assignees.planning, vec!["YoonCarrot"]);
        assert_eq!(assignees.frontend, vec!["alice", "bob"]);
        assert_eq!(assignees.backend, vec!["123"]);
    }

    #[test]
    fn update_workspace_assignees_yaml_inserts_when_missing_and_removes_when_empty() {
        let base = concat!(
            "# Header\n",
            "schema_version: 1\n",
            "workspace:\n",
            "  id: 11111111-1111-1111-1111-111111111111\n",
            "  name: OkHub\n",
            "documents:\n",
            "  roots:\n",
            "    - path: docs\n",
            "repositories: []\n",
        );

        let added = update_workspace_assignees_yaml(
            base,
            &WorkspaceAssignees {
                planning: vec!["hyeeun".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert!(added.contains("assignees:\n  planning: \"hyeeun\"\n"));
        assert!(WorkspaceDocument::parse(&added)
            .unwrap()
            .config
            .assignees
            .is_some());

        let removed =
            update_workspace_assignees_yaml(&added, &WorkspaceAssignees::default()).unwrap();
        assert!(!removed.contains("assignees:"));
        assert!(WorkspaceDocument::parse(&removed)
            .unwrap()
            .config
            .assignees
            .is_none());
        assert!(removed.contains("# Header\n"));
    }
}
