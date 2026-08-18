use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode, RecoveryAction};

const MAX_FILE_STEM_BYTES: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocumentTemplateSource {
    BuiltIn,
    Team,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTemplateDefaults {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NewDocumentTemplate {
    pub id: String,
    pub source: DocumentTemplateSource,
    pub label: String,
    pub description: Option<String>,
    pub type_key: Option<String>,
    pub defaults: DocumentTemplateDefaults,
    #[serde(skip_serializing)]
    pub body: String,
    pub rich_editor_compatible: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDiagnostic {
    pub template_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTemplateCatalog {
    pub templates: Vec<NewDocumentTemplate>,
    pub diagnostics: Vec<TemplateDiagnostic>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTargetValidation {
    pub normalized_file_name: String,
    pub relative_path: String,
    pub has_collision: bool,
    pub suggested_file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TeamTemplateFrontmatter {
    label: Option<String>,
    description: Option<String>,
    #[serde(rename = "type")]
    type_key: Option<String>,
    #[serde(default)]
    defaults: DocumentTemplateDefaults,
}

#[derive(Serialize)]
struct GeneratedFrontmatter<'a> {
    okf_hub_id: Uuid,
    title: &'a str,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    type_key: Option<&'a str>,
    #[serde(skip_serializing_if = "slice_is_empty")]
    tags: &'a [String],
}

fn slice_is_empty(values: &&[String]) -> bool {
    values.is_empty()
}

pub fn normalize_document_file_name(input: &str) -> Result<String, AppError> {
    let normalized: String = input.trim().nfc().collect();
    if Path::new(&normalized)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| !extension.eq_ignore_ascii_case("md"))
    {
        return Err(invalid_document_path());
    }
    let without_extension = normalized
        .get(..normalized.len().saturating_sub(3))
        .filter(|_| {
            normalized
                .get(normalized.len().saturating_sub(3)..)
                .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".md"))
        })
        .unwrap_or(&normalized);
    let mut stem = String::new();
    let mut separator_pending = false;
    for character in without_extension.chars() {
        if character.is_alphanumeric() {
            if separator_pending && !stem.is_empty() {
                stem.push('-');
            }
            separator_pending = false;
            if character.is_ascii() {
                stem.extend(character.to_lowercase());
            } else {
                stem.push(character);
            }
        } else {
            separator_pending = true;
        }
    }
    let stem = stem.trim_matches('-');
    if stem.is_empty() || stem == "." || stem == ".." || is_windows_reserved_name(stem) {
        return Err(invalid_document_path());
    }
    if stem.len() > MAX_FILE_STEM_BYTES {
        return Err(invalid_document_path());
    }
    Ok(format!("{stem}.md"))
}

pub fn validate_document_target(
    repository_root: &Path,
    document_roots: &[String],
    folder: &str,
    file_name: &str,
) -> Result<DocumentTargetValidation, AppError> {
    let normalized_file_name = normalize_document_file_name(file_name)?;
    let folder_path = safe_relative_path(folder)?;
    let allowed = document_roots.iter().any(|root| {
        safe_relative_path(root)
            .ok()
            .is_some_and(|root| folder_path == root || folder_path.starts_with(&root))
    });
    if !allowed {
        return Err(invalid_document_path());
    }
    let repository_root = repository_root
        .canonicalize()
        .map_err(|_| invalid_document_path())?;
    let target_folder = repository_root.join(&folder_path);
    if target_folder.exists() {
        let canonical_folder = target_folder
            .canonicalize()
            .map_err(|_| invalid_document_path())?;
        if !canonical_folder.starts_with(&repository_root) {
            return Err(invalid_document_path());
        }
    } else {
        validate_existing_ancestor(&repository_root, &target_folder)?;
    }

    let comparison_name = comparison_key(&normalized_file_name);
    let existing_names = existing_file_names(&target_folder)?;
    let has_collision = existing_names
        .iter()
        .any(|name| comparison_key(name) == comparison_name);
    let suggested_file_name = has_collision.then(|| {
        let stem = normalized_file_name.trim_end_matches(".md");
        (2..)
            .map(|suffix| format!("{stem}-{suffix}.md"))
            .find(|candidate| {
                let key = comparison_key(candidate);
                !existing_names
                    .iter()
                    .any(|name| comparison_key(name) == key)
            })
            .expect("an unbounded numeric suffix always has a free value")
    });
    let relative_path = folder_path
        .join(&normalized_file_name)
        .to_string_lossy()
        .replace('\\', "/");
    Ok(DocumentTargetValidation {
        normalized_file_name,
        relative_path,
        has_collision,
        suggested_file_name,
    })
}

pub fn built_in_templates() -> Vec<NewDocumentTemplate> {
    vec![
        built_in("blank", "빈 문서", None, "# {{title}}\n"),
        built_in(
            "feature_design",
            "기능 설계",
            Some("feature_design"),
            "# {{title}}\n\n## 요약\n\n## 목표\n\n## 범위\n\n### 포함\n\n### 제외\n\n## 사용자 시나리오\n\n### 시나리오 이름\n\n#### 사용자 흐름\n\n#### 처리 케이스\n\n#### 시퀀스\n\n## 공통 동작 규칙\n\n## 제약 사항\n",
        ),
        built_in(
            "architecture",
            "시스템·아키텍처 설계",
            Some("architecture"),
            "# {{title}}\n\n## 요약\n\n## 목표와 품질 목표\n\n## 범위와 컨텍스트\n\n## 제약 사항\n\n## 현재 구조\n\n## 제안 구조와 해결 전략\n\n## 구성 요소와 책임\n\n## 주요 실행 흐름\n\n## 배포 구조\n\n## 공통 설계 원칙\n\n## 위험과 기술 부채\n",
        ),
        built_in(
            "api_contract",
            "API 계약",
            Some("api_contract"),
            "# {{title}}\n\n## 요약\n\n## 범위\n\n### 포함\n\n### 제외\n\n## 처리 흐름\n\n## 공통 계약\n\n## Endpoint\n\n### `METHOD /path`\n\n#### 목적\n\n#### 요청\n\n#### 성공 응답\n\n#### 오류 응답\n\n#### 처리 케이스\n\n## 공통 데이터 모델\n",
        ),
        built_in(
            "decision",
            "기술 결정",
            Some("decision"),
            "# {{title}}\n\n## 맥락과 문제\n\n## 결정 기준\n\n## 검토한 선택지\n\n## 결정 결과\n\n## 결과와 영향\n\n## 선택지 비교\n",
        ),
        built_in(
            "research",
            "기술 조사",
            Some("research"),
            "# {{title}}\n\n## 조사 질문\n\n## 배경\n\n## 범위\n\n## 평가 기준\n\n## 조사 결과\n\n### 대상 또는 선택지\n\n## 비교\n\n## 결론과 추천\n\n## 한계와 미확인 사항\n\n## 참고 자료\n",
        ),
        built_in(
            "analysis",
            "분석·실험",
            Some("analysis"),
            "# {{title}}\n\n## 목적과 가설\n\n## 대상과 범위\n\n## 환경과 전제 조건\n\n## 방법\n\n## 측정 지표와 성공 기준\n\n## 결과\n\n## 해석\n\n## 한계\n\n## 후속 작업\n\n## 실행 자료\n",
        ),
        built_in(
            "test",
            "테스트 계획·결과",
            Some("test"),
            "# {{title}}\n\n## 목적\n\n## 범위\n\n## 대상 버전과 환경\n\n## 시작 조건과 완료 기준\n\n## 테스트 케이스\n\n### 케이스 이름\n\n#### 사전 조건\n\n#### 단계와 예상 결과\n\n## 실행 결과\n\n### 실행 일시 또는 대상 버전\n\n#### 요약\n\n#### 케이스별 결과\n\n#### 실패와 차단 사항\n\n#### 증적\n\n## 결론\n",
        ),
        built_in(
            "incident_review",
            "장애 회고",
            Some("incident_review"),
            "# {{title}}\n\n## 요약\n\n## 영향\n\n## 탐지\n\n## 타임라인\n\n## 대응과 복구\n\n## 원인과 기여 요인\n\n## 배운 점\n\n### 잘된 점\n\n### 개선할 점\n\n## 재발 방지와 영향 완화 조치\n",
        ),
    ]
}

pub fn load_document_templates(
    repository_root: &Path,
) -> Result<DocumentTemplateCatalog, AppError> {
    let mut templates = built_in_templates();
    let mut diagnostics = Vec::new();
    let templates_root = repository_root.join(".okf/templates");
    if templates_root.exists() {
        let repository = repository_root
            .canonicalize()
            .map_err(|_| invalid_document_path())?;
        let canonical_templates = templates_root
            .canonicalize()
            .map_err(|_| invalid_document_path())?;
        if !canonical_templates.starts_with(repository) {
            return Err(invalid_document_path());
        }
        let mut paths = Vec::new();
        collect_markdown_files(&templates_root, &mut paths)?;
        paths.sort();
        for path in paths {
            let relative = path
                .strip_prefix(&templates_root)
                .map_err(|_| invalid_document_path())?
                .to_string_lossy()
                .replace('\\', "/");
            let template_id = format!("team:{relative}");
            match parse_team_template(&template_id, &path) {
                Ok(template) => templates.push(template),
                Err(message) => diagnostics.push(TemplateDiagnostic {
                    template_id,
                    message,
                }),
            }
        }
    }
    Ok(DocumentTemplateCatalog {
        templates,
        diagnostics,
    })
}

pub fn render_new_document(
    template: &NewDocumentTemplate,
    title: &str,
    document_id: Uuid,
) -> Result<String, AppError> {
    let title = title.trim();
    if title.is_empty() || document_id.get_version() != Some(uuid::Version::Random) {
        return Err(invalid_document_path());
    }
    let frontmatter = GeneratedFrontmatter {
        okf_hub_id: document_id,
        title,
        type_key: template.type_key.as_deref(),
        tags: &template.defaults.tags,
    };
    let yaml = serde_yaml_ng::to_string(&frontmatter).map_err(|_| invalid_document_path())?;
    let body = template.body.replace("{{title}}", title);
    Ok(format!("---\n{yaml}---\n{body}"))
}

fn built_in(key: &str, label: &str, type_key: Option<&str>, body: &str) -> NewDocumentTemplate {
    NewDocumentTemplate {
        id: format!("builtin:{key}"),
        source: DocumentTemplateSource::BuiltIn,
        label: label.to_owned(),
        description: None,
        type_key: type_key.map(str::to_owned),
        defaults: DocumentTemplateDefaults::default(),
        body: body.to_owned(),
        rich_editor_compatible: true,
    }
}

fn parse_team_template(template_id: &str, path: &Path) -> Result<NewDocumentTemplate, String> {
    let source = fs::read_to_string(path).map_err(|_| "템플릿을 읽을 수 없습니다.".to_owned())?;
    let (frontmatter, body) =
        split_frontmatter(&source).ok_or_else(|| "YAML frontmatter가 필요합니다.".to_owned())?;
    let parsed: TeamTemplateFrontmatter = serde_yaml_ng::from_str(frontmatter)
        .map_err(|_| "frontmatter 형식이 올바르지 않습니다.".to_owned())?;
    let label = parsed
        .label
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "label이 필요합니다.".to_owned())?;
    if !body.lines().any(|line| line.trim() == "# {{title}}") {
        return Err("본문에 '# {{title}}'이 필요합니다.".to_owned());
    }
    Ok(NewDocumentTemplate {
        id: template_id.to_owned(),
        source: DocumentTemplateSource::Team,
        label,
        description: parsed.description.filter(|value| !value.trim().is_empty()),
        type_key: parsed.type_key.filter(|value| !value.trim().is_empty()),
        defaults: parsed.defaults,
        rich_editor_compatible: rich_editor_compatible(body),
        body: body.to_owned(),
    })
}

fn split_frontmatter(source: &str) -> Option<(&str, &str)> {
    if let Some(source) = source.strip_prefix("---\n") {
        let split = source.find("\n---\n")?;
        return Some((&source[..split], &source[split + 5..]));
    }
    let source = source.strip_prefix("---\r\n")?;
    let split = source.find("\r\n---\r\n")?;
    Some((&source[..split], &source[split + 7..]))
}

fn rich_editor_compatible(body: &str) -> bool {
    !body.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with('<') || line.starts_with("import ") || line.starts_with("export ")
    })
}

fn collect_markdown_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), AppError> {
    for entry in fs::read_dir(directory).map_err(|_| invalid_document_path())? {
        let entry = entry.map_err(|_| invalid_document_path())?;
        let file_type = entry.file_type().map_err(|_| invalid_document_path())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_markdown_files(&path, output)?;
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("md"))
        {
            output.push(path);
        }
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, AppError> {
    if value.contains('\\') || value.trim().is_empty() {
        return Err(invalid_document_path());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            !matches!(component, Component::Normal(_) | Component::CurDir)
                || matches!(
                    component,
                    Component::Normal(part)
                        if part.to_str().is_some_and(|value| value.eq_ignore_ascii_case(".git"))
                )
        })
    {
        return Err(invalid_document_path());
    }
    Ok(path.to_path_buf())
}

fn validate_existing_ancestor(repository_root: &Path, target: &Path) -> Result<(), AppError> {
    let mut ancestor = target;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(invalid_document_path)?;
    }
    let canonical = ancestor
        .canonicalize()
        .map_err(|_| invalid_document_path())?;
    if canonical.starts_with(repository_root) {
        Ok(())
    } else {
        Err(invalid_document_path())
    }
}

fn existing_file_names(folder: &Path) -> Result<Vec<String>, AppError> {
    if !folder.exists() {
        return Ok(Vec::new());
    }
    fs::read_dir(folder)
        .map_err(|_| invalid_document_path())?
        .map(|entry| {
            entry
                .map_err(|_| invalid_document_path())?
                .file_name()
                .into_string()
                .map_err(|_| invalid_document_path())
        })
        .collect()
}

fn comparison_key(value: &str) -> String {
    value.nfc().flat_map(char::to_lowercase).collect()
}

fn is_windows_reserved_name(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn invalid_document_path() -> AppError {
    AppError::new(
        ErrorCode::DocumentPathInvalid,
        "문서 파일 경로가 올바르지 않습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{
        built_in_templates, load_document_templates, normalize_document_file_name,
        render_new_document, validate_document_target, DocumentTemplateDefaults,
        DocumentTemplateSource, NewDocumentTemplate,
    };

    #[test]
    fn filename_normalization_preserves_korean_and_normalizes_ascii_and_separators() {
        assert_eq!(
            normalize_document_file_name("지도 Search_API 계약!!.md").unwrap(),
            "지도-search-api-계약.md"
        );
        assert_eq!(
            normalize_document_file_name("Cafe\u{301} 설계").unwrap(),
            "café-설계.md"
        );
        assert_eq!(
            normalize_document_file_name("Architecture.Md").unwrap(),
            "architecture.md"
        );
    }

    #[test]
    fn filename_normalization_rejects_empty_reserved_and_oversized_stems() {
        assert!(normalize_document_file_name("...").is_err());
        assert!(normalize_document_file_name("CON.md").is_err());
        assert!(normalize_document_file_name("contract.txt").is_err());
        assert!(normalize_document_file_name(&format!("{}.md", "가".repeat(67))).is_err());
    }

    #[test]
    fn target_validation_suggests_a_confirmable_suffix_for_case_insensitive_nfc_collision() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("docs/api")).unwrap();
        fs::write(root.path().join("docs/api/CAFÉ.md"), "existing").unwrap();

        let result = validate_document_target(
            root.path(),
            &["docs".to_owned()],
            "docs/api",
            "Cafe\u{301}.md",
        )
        .unwrap();

        assert_eq!(result.relative_path, "docs/api/café.md");
        assert!(result.has_collision);
        assert_eq!(result.suggested_file_name.as_deref(), Some("café-2.md"));
    }

    #[test]
    fn target_validation_rejects_git_components_case_insensitively() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("docs")).unwrap();

        let error = validate_document_target(
            root.path(),
            &["docs".to_owned()],
            "docs/.GIT/objects",
            "note.md",
        )
        .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::DocumentPathInvalid);
    }

    #[test]
    fn built_in_catalog_contains_the_nine_approved_templates() {
        let templates = built_in_templates();
        assert_eq!(templates.len(), 9);
        assert_eq!(templates[0].id, "builtin:blank");
        assert!(templates
            .iter()
            .any(|item| item.id == "builtin:architecture"));
        assert!(templates
            .iter()
            .any(|item| item.id == "builtin:incident_review"));
        assert!(!templates.iter().any(|item| item.label == "Runbook"));
    }

    #[test]
    fn team_templates_are_loaded_by_relative_path_and_invalid_files_are_diagnostics() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".okf/templates/api")).unwrap();
        fs::write(
            root.path().join(".okf/templates/api/mockly.md"),
            "---\nlabel: Mockly API 계약\ndescription: 팀 API 계약\ntype: api_contract\ndefaults:\n  tags: [api]\n---\n# {{title}}\n\n## 요약\n",
        )
        .unwrap();
        fs::write(
            root.path().join(".okf/templates/broken.md"),
            "---\nlabel: 위험한 템플릿\nokf_hub_id: reserved\n---\n# {{title}}\n",
        )
        .unwrap();

        let catalog = load_document_templates(root.path()).unwrap();

        let team = catalog
            .templates
            .iter()
            .find(|item| item.id == "team:api/mockly.md")
            .unwrap();
        assert_eq!(team.source, DocumentTemplateSource::Team);
        assert_eq!(team.type_key.as_deref(), Some("api_contract"));
        assert_eq!(team.defaults.tags, vec!["api"]);
        assert_eq!(catalog.diagnostics.len(), 1);
        assert_eq!(catalog.diagnostics[0].template_id, "team:broken.md");
    }

    #[test]
    fn team_templates_accept_crlf_frontmatter_and_body() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".okf/templates")).unwrap();
        fs::write(
            root.path().join(".okf/templates/windows.md"),
            "---\r\nlabel: Windows template\r\n---\r\n# {{title}}\r\n\r\n## Summary\r\n",
        )
        .unwrap();

        let catalog = load_document_templates(root.path()).unwrap();

        assert!(catalog
            .templates
            .iter()
            .any(|template| template.id == "team:windows.md"));
        assert!(catalog.diagnostics.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn team_template_root_cannot_escape_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::create_dir_all(root.path().join(".okf")).unwrap();
        fs::write(
            outside.path().join("external.md"),
            "---\nlabel: External\n---\n# {{title}}\n",
        )
        .unwrap();
        symlink(outside.path(), root.path().join(".okf/templates")).unwrap();

        assert!(load_document_templates(root.path()).is_err());
    }

    #[test]
    fn rendering_generates_fresh_identity_title_type_and_actual_defaults_only() {
        let template = NewDocumentTemplate {
            id: "team:api/mockly.md".to_owned(),
            source: DocumentTemplateSource::Team,
            label: "Mockly API 계약".to_owned(),
            description: None,
            type_key: Some("api_contract".to_owned()),
            defaults: DocumentTemplateDefaults {
                tags: vec!["api".to_owned()],
            },
            body: "# {{title}}\n\n## 요약\n".to_owned(),
            rich_editor_compatible: true,
        };
        let id = Uuid::parse_str("80a44162-92c6-4f2c-9b77-ef5c42a52e5a").unwrap();

        let markdown = render_new_document(&template, "지도 검색 API", id).unwrap();

        assert_eq!(
            markdown,
            "---\nokf_hub_id: 80a44162-92c6-4f2c-9b77-ef5c42a52e5a\ntitle: 지도 검색 API\ntype: api_contract\ntags:\n- api\n---\n# 지도 검색 API\n\n## 요약\n"
        );
        assert!(!markdown.contains("summary:"));
    }
}
