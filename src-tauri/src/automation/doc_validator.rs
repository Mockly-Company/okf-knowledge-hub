use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::documents::frontmatter::parse_document;
use crate::documents::reader::{extract_local_stylesheet_hrefs, is_reserved_markdown_path};
use crate::error::{AppError, ErrorCode, RecoveryAction};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDocEntry {
    pub path: String,
    pub title: String,
    pub html_companion_path: String,
    pub html_sync_status: String,
    pub has_change_markers: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDocDetail {
    pub path: String,
    pub title: String,
    pub markdown: String,
    pub html_companion_path: String,
    pub html_sync_status: String,
    pub md_markers: Vec<String>,
    pub html_markers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocValidationIssue {
    pub severity: String,
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocValidationReport {
    pub valid: bool,
    pub checked_documents: usize,
    pub highlighted_markdown_files: Vec<String>,
    pub highlighted_html_files: Vec<String>,
    pub issues: Vec<DocValidationIssue>,
}

pub fn list_workspace_docs(
    workspace_root: &Path,
    docs_root_rel: &str,
) -> Result<Vec<AutomationDocEntry>, AppError> {
    let md_files = collect_markdown_files(workspace_root, docs_root_rel)?;
    let mut entries = Vec::with_capacity(md_files.len());
    for rel_path in md_files {
        let full_md = workspace_root.join(&rel_path);
        let markdown = fs::read_to_string(&full_md).map_err(|err| {
            AppError::new(
                ErrorCode::DocumentPathInvalid,
                format!("문서를 읽지 못했습니다: {rel_path}"),
            )
            .with_detail("reason", err.to_string())
        })?;
        let title = extract_doc_title(&markdown, &rel_path);
        let html_rel = companion_html_rel_path(&rel_path);
        let full_html = workspace_root.join(&html_rel);
        let html_sync_status = compute_html_sync_status(&full_md, &full_html);
        let md_markers = detect_markdown_change_markers(&markdown);
        let html_markers = fs::read_to_string(&full_html)
            .ok()
            .map(|html| detect_html_change_markers(&html))
            .unwrap_or_default();
        entries.push(AutomationDocEntry {
            path: rel_path,
            title,
            html_companion_path: html_rel,
            html_sync_status,
            has_change_markers: !md_markers.is_empty() || !html_markers.is_empty(),
        });
    }
    Ok(entries)
}

pub fn read_workspace_doc(
    workspace_root: &Path,
    doc_path: &str,
) -> Result<AutomationDocDetail, AppError> {
    let normalized = normalize_workspace_rel_path(doc_path)?;
    let canonical_root = workspace_root.canonicalize().map_err(|_| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            "워크스페이스 폴더를 찾을 수 없습니다.",
        )
    })?;
    let full_md = workspace_root.join(&normalized);
    let canonical_md = full_md.canonicalize().map_err(|_| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            format!("문서 파일을 찾을 수 없습니다: {normalized}"),
        )
    })?;
    if !canonical_md.starts_with(&canonical_root) {
        return Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "워크스페이스 바깥 경로는 읽을 수 없습니다.",
        ));
    }
    let markdown = fs::read_to_string(&canonical_md).map_err(|err| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            format!("문서를 읽지 못했습니다: {normalized}"),
        )
        .with_detail("reason", err.to_string())
    })?;
    let title = extract_doc_title(&markdown, &normalized);
    let html_rel = companion_html_rel_path(&normalized);
    let full_html = workspace_root.join(&html_rel);
    let html_sync_status = compute_html_sync_status(&canonical_md, &full_html);
    let md_markers = detect_markdown_change_markers(&markdown);
    let html_markers = fs::read_to_string(&full_html)
        .ok()
        .map(|html| detect_html_change_markers(&html))
        .unwrap_or_default();

    Ok(AutomationDocDetail {
        path: normalized,
        title,
        markdown,
        html_companion_path: html_rel,
        html_sync_status,
        md_markers,
        html_markers,
    })
}

pub fn validate_workspace_docs(
    workspace_root: &Path,
    docs_root_rel: &str,
) -> Result<DocValidationReport, AppError> {
    let canonical_root = workspace_root.canonicalize().map_err(|err| {
        AppError::new(
            ErrorCode::WorkspaceInvalid,
            format!(
                "문서 워크스페이스 루트 경로를 확인할 수 없습니다: {}",
                workspace_root.display()
            ),
        )
        .with_detail("reason", err.to_string())
    })?;
    let md_files = collect_markdown_files(workspace_root, docs_root_rel)?;
    let mut issues = Vec::new();
    let mut highlighted_markdown_files = Vec::new();
    let mut highlighted_html_files = Vec::new();

    for rel_path in &md_files {
        let full_md = workspace_root.join(rel_path);
        let markdown = match fs::read_to_string(&full_md) {
            Ok(text) => text,
            Err(err) => {
                issues.push(DocValidationIssue {
                    severity: "error".to_owned(),
                    path: rel_path.clone(),
                    code: "markdown_unreadable".to_owned(),
                    message: format!("Markdown 문서를 읽지 못했습니다 ({err})."),
                });
                continue;
            }
        };

        if let Err(reason) = validate_frontmatter_if_present(&markdown) {
            issues.push(DocValidationIssue {
                severity: "error".to_owned(),
                path: rel_path.clone(),
                code: "invalid_frontmatter".to_owned(),
                message: reason,
            });
        }

        let md_markers = detect_markdown_change_markers(&markdown);
        if !md_markers.is_empty() {
            highlighted_markdown_files.push(rel_path.clone());
        }

        let file_name = Path::new(rel_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(rel_path);
        let is_reserved = is_reserved_markdown_path(rel_path, file_name);

        let parsed_doc = parse_document(&markdown, file_name);
        if is_screen_spec_document(rel_path, file_name, parsed_doc.doc_type.as_deref())
            && parsed_doc.wireframes.is_empty()
        {
            issues.push(DocValidationIssue {
                severity: "error".to_owned(),
                path: rel_path.clone(),
                code: "screen_spec_wireframe_missing".to_owned(),
                message: format!(
                    "화면명세서 `{rel_path}`에 `wireframes` frontmatter(화면별 SVG 와이어프레임)가 없습니다."
                ),
            });
        }

        let doc_parent = full_md.parent().unwrap_or(workspace_root);
        for wf in &parsed_doc.wireframes {
            if !local_asset_exists(&canonical_root, doc_parent, &wf.image) {
                issues.push(DocValidationIssue {
                    severity: "error".to_owned(),
                    path: rel_path.clone(),
                    code: "asset_file_missing".to_owned(),
                    message: format!(
                        "`{rel_path}`의 와이어프레임 에셋 `{}` 파일을 찾을 수 없습니다.",
                        wf.image
                    ),
                });
            }
        }
        for design in &parsed_doc.designs {
            if let Some(image) = design.image.as_deref() {
                if !local_asset_exists(&canonical_root, doc_parent, image) {
                    issues.push(DocValidationIssue {
                        severity: "error".to_owned(),
                        path: rel_path.clone(),
                        code: "asset_file_missing".to_owned(),
                        message: format!(
                            "`{rel_path}`의 디자인 시안 에셋 `{image}` 파일을 찾을 수 없습니다."
                        ),
                    });
                }
            }
            if let Some(ref_wf) = design.wireframe.as_deref() {
                let target = ref_wf.trim();
                if !target.is_empty()
                    && !parsed_doc
                        .wireframes
                        .iter()
                        .any(|w| w.title.trim().eq_ignore_ascii_case(target))
                {
                    issues.push(DocValidationIssue {
                        severity: "warning".to_owned(),
                        path: rel_path.clone(),
                        code: "design_wireframe_unknown".to_owned(),
                        message: format!(
                            "`{rel_path}`의 디자인 시안 `{}`이(가) 참조하는 와이어프레임 `{target}`을 `wireframes`에서 찾을 수 없습니다.",
                            design.title
                        ),
                    });
                }
            }
        }

        let html_rel = companion_html_rel_path(rel_path);
        let full_html = workspace_root.join(&html_rel);
        let sync_status = compute_html_sync_status(&full_md, &full_html);
        match sync_status.as_str() {
            "missing" if !is_reserved => {
                issues.push(DocValidationIssue {
                    severity: "warning".to_owned(),
                    path: html_rel.clone(),
                    code: "companion_html_missing".to_owned(),
                    message: format!(
                        "`{rel_path}`의 사람용 `.html` 동반 파일(`{html_rel}`)이 없습니다."
                    ),
                });
            }
            "outdated" => {
                issues.push(DocValidationIssue {
                    severity: "error".to_owned(),
                    path: html_rel.clone(),
                    code: "companion_html_outdated".to_owned(),
                    message: format!(
                        "`{html_rel}`의 수정 시각이 원본 `{rel_path}`보다 오래되었습니다. `.html`을 재생성해 주세요."
                    ),
                });
            }
            _ => {}
        }

        if let Ok(html) = fs::read_to_string(&full_html) {
            let lower = html.to_ascii_lowercase();
            if lower.contains("<script") {
                issues.push(DocValidationIssue {
                    severity: "error".to_owned(),
                    path: html_rel.clone(),
                    code: "html_forbidden_script".to_owned(),
                    message: "사람용 `.html` 문서에는 `<script>` 태그를 포함할 수 없습니다."
                        .to_owned(),
                });
            }
            if contains_external_stylesheet(&lower) {
                issues.push(DocValidationIssue {
                    severity: "error".to_owned(),
                    path: html_rel.clone(),
                    code: "html_external_stylesheet".to_owned(),
                    message: "사람용 `.html` 문서에는 외부 URL 스타일시트 대신 저장소 내부 CSS만 참조해야 합니다."
                        .to_owned(),
                });
            }
            for href in extract_local_stylesheet_hrefs(&html) {
                if let Some(resolved) = full_html.parent().map(|dir| dir.join(&href)) {
                    if !resolved.is_file() {
                        issues.push(DocValidationIssue {
                            severity: "warning".to_owned(),
                            path: html_rel.clone(),
                            code: "html_missing_stylesheet".to_owned(),
                            message: format!(
                                "`{html_rel}`에서 참조한 로컬 스타일시트 `{href}` 파일을 찾을 수 없습니다."
                            ),
                        });
                    }
                }
            }
            let html_markers = detect_html_change_markers(&html);
            if !html_markers.is_empty() {
                highlighted_html_files.push(html_rel.clone());
            }
            if md_markers.is_empty() != html_markers.is_empty() {
                issues.push(DocValidationIssue {
                    severity: "warning".to_owned(),
                    path: rel_path.clone(),
                    code: "change_marker_mismatch".to_owned(),
                    message: format!(
                        "`{rel_path}`와 `{html_rel}` 간 변경 하이라이트 표기(`[NEW]`/`[CHANGED]` ↔ `.is-new`/`.is-changed`)가 일치하지 않습니다."
                    ),
                });
            }
        }
    }

    let valid = !issues.iter().any(|issue| issue.severity == "error");
    Ok(DocValidationReport {
        valid,
        checked_documents: md_files.len(),
        highlighted_markdown_files,
        highlighted_html_files,
        issues,
    })
}

fn collect_markdown_files(
    workspace_root: &Path,
    docs_root_rel: &str,
) -> Result<Vec<String>, AppError> {
    let trimmed = docs_root_rel.trim().trim_matches('/');
    let root = if trimmed.is_empty() || trimmed == "." {
        workspace_root.to_path_buf()
    } else {
        workspace_root.join(trimmed)
    };
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    walk_markdown_dir(workspace_root, &root, &mut files)?;
    files.sort();
    Ok(files)
}

fn walk_markdown_dir(
    workspace_root: &Path,
    dir: &Path,
    out: &mut Vec<String>,
) -> Result<(), AppError> {
    let entries = fs::read_dir(dir).map_err(|err| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            format!("문서 폴더를 읽지 못했습니다: {}", dir.display()),
        )
        .with_detail("reason", err.to_string())
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') || name == "_assets" || name == "node_modules" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            walk_markdown_dir(workspace_root, &path, out)?;
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            if let Ok(rel) = path.strip_prefix(workspace_root) {
                let normalized = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(normalized);
            }
        }
    }
    Ok(())
}

fn normalize_workspace_rel_path(raw: &str) -> Result<String, AppError> {
    let replaced = raw.trim().replace('\\', "/");
    let parts: Vec<&str> = replaced
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| *part == ".." || part.eq_ignore_ascii_case(".git"))
    {
        return Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "유효한 워크스페이스 상대 문서 경로를 입력해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    Ok(parts.join("/"))
}

fn companion_html_rel_path(md_rel_path: &str) -> String {
    if let Some(stem) = md_rel_path
        .strip_suffix(".md")
        .or_else(|| md_rel_path.strip_suffix(".MD"))
    {
        format!("{stem}.html")
    } else {
        format!("{md_rel_path}.html")
    }
}

fn compute_html_sync_status(md_path: &Path, html_path: &Path) -> String {
    let Ok(html_meta) = fs::metadata(html_path) else {
        return "missing".to_owned();
    };
    if !html_meta.is_file() {
        return "missing".to_owned();
    }
    let (Ok(md_mtime), Ok(html_mtime)) = (
        fs::metadata(md_path).and_then(|m| m.modified()),
        html_meta.modified(),
    ) else {
        return "synced".to_owned();
    };
    if html_mtime
        .checked_add(Duration::from_secs(2))
        .unwrap_or(html_mtime)
        < md_mtime
    {
        "outdated".to_owned()
    } else {
        "synced".to_owned()
    }
}

fn validate_frontmatter_if_present(markdown: &str) -> Result<(), String> {
    let normalized = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    let Some(rest) = normalized
        .strip_prefix("---\n")
        .or_else(|| normalized.strip_prefix("---\r\n"))
    else {
        return Ok(());
    };
    let end = rest
        .find("\n---\n")
        .map(|idx| (idx, idx + 5))
        .or_else(|| rest.find("\r\n---\r\n").map(|idx| (idx, idx + 7)))
        .or_else(|| {
            rest.strip_suffix("\n---")
                .map(|stripped| (stripped.len(), rest.len()))
        });
    let Some((yaml_end, _)) = end else {
        return Err("YAML frontmatter 닫힘 구분선(`---`)이 누락되었습니다.".to_owned());
    };
    let yaml_text = &rest[..yaml_end];
    let parsed: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_text)
        .map_err(|err| format!("YAML frontmatter 문법 오류: {err}"))?;
    if !parsed.is_mapping() && !parsed.is_null() {
        return Err("YAML frontmatter 최상위 값은 매핑(key-value)이어야 합니다.".to_owned());
    }
    Ok(())
}

fn extract_doc_title(markdown: &str, fallback_path: &str) -> String {
    let normalized = markdown.strip_prefix('\u{feff}').unwrap_or(markdown);
    if let Some(rest) = normalized
        .strip_prefix("---\n")
        .or_else(|| normalized.strip_prefix("---\r\n"))
    {
        if let Some(end) = rest.find("\n---") {
            if let Ok(serde_yaml_ng::Value::Mapping(map)) =
                serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&rest[..end])
            {
                if let Some(title) = map
                    .get(serde_yaml_ng::Value::String("title".to_owned()))
                    .and_then(serde_yaml_ng::Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    return title.to_owned();
                }
            }
        }
    }
    for line in normalized.lines() {
        if let Some(heading) = line.trim().strip_prefix("# ") {
            let trimmed = heading.trim();
            if !trimmed.is_empty() {
                return trimmed.to_owned();
            }
        }
    }
    fallback_path.to_owned()
}

fn detect_markdown_change_markers(markdown: &str) -> Vec<String> {
    let mut markers = Vec::new();
    if markdown.contains("[NEW]") {
        markers.push("[NEW]".to_owned());
    }
    if markdown.contains("[CHANGED]") {
        markers.push("[CHANGED]".to_owned());
    }
    markers
}

fn is_screen_spec_document(rel_path: &str, file_name: &str, doc_type: Option<&str>) -> bool {
    if let Some(raw_type) = doc_type {
        let norm = raw_type.trim().to_ascii_lowercase();
        if matches!(
            norm.as_str(),
            "screen spec" | "screen-spec" | "screen_spec" | "화면명세" | "화면명세서"
        ) {
            return true;
        }
    }
    let lower_name = file_name.to_ascii_lowercase();
    let lower_path = rel_path.to_ascii_lowercase();
    lower_name == "screen-spec.md"
        || lower_name.ends_with("-screen-spec.md")
        || lower_path.ends_with("/screen-spec.md")
}

fn local_asset_exists(canonical_root: &Path, doc_parent: &Path, raw_asset: &str) -> bool {
    let clean = raw_asset
        .split(['?', '#'])
        .next()
        .unwrap_or(raw_asset)
        .trim()
        .replace('\\', "/");
    if clean.is_empty() {
        return false;
    }
    let candidate = doc_parent.join(&clean);
    if !candidate.is_file() {
        return false;
    }
    candidate
        .canonicalize()
        .is_ok_and(|canon| canon.starts_with(canonical_root))
}

fn strip_style_blocks(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(rel_start) = lower[cursor..].find("<style") {
        let abs_start = cursor + rel_start;
        out.push_str(&html[cursor..abs_start]);
        if let Some(rel_end) = lower[abs_start..].find("</style>") {
            cursor = abs_start + rel_end + "</style>".len();
        } else {
            cursor = html.len();
            break;
        }
    }
    if cursor < html.len() {
        out.push_str(&html[cursor..]);
    }
    out
}

fn detect_html_change_markers(html: &str) -> Vec<String> {
    let stripped = strip_style_blocks(html);
    let mut markers = Vec::new();
    if stripped.contains("is-new") {
        markers.push("is-new".to_owned());
    }
    if stripped.contains("is-changed") {
        markers.push("is-changed".to_owned());
    }
    markers
}

fn contains_external_stylesheet(lower_html: &str) -> bool {
    let mut rest = lower_html;
    while let Some(idx) = rest.find("<link") {
        let after = &rest[idx..];
        let Some(end) = after.find('>') else {
            break;
        };
        let tag = &after[..=end];
        if tag.contains("stylesheet")
            && (tag.contains("href=\"http://")
                || tag.contains("href=\"https://")
                || tag.contains("href='http://")
                || tag.contains("href='https://")
                || tag.contains("href=\"//"))
        {
            return true;
        }
        rest = &after[end + 1..];
    }
    false
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::{list_workspace_docs, read_workspace_doc, validate_workspace_docs};
    use crate::error::ErrorCode;

    #[test]
    fn validates_dual_md_html_sync_frontmatter_and_rolling_markers() {
        let temp = TempDir::new().unwrap();
        let docs_dir = temp.path().join("docs").join("product");
        let assets_dir = temp.path().join("docs").join("_assets");
        std::fs::create_dir_all(&docs_dir).unwrap();
        std::fs::create_dir_all(&assets_dir).unwrap();
        std::fs::write(assets_dir.join("okf-doc.css"), "body { margin: 0; }").unwrap();

        std::fs::write(
            docs_dir.join("spec.md"),
            "---\ntitle: 결제 개편 기획안\n---\n\n# 결제 개편 기획안\n\n## [NEW] 정기 결제\n",
        )
        .unwrap();
        std::fs::write(
            docs_dir.join("spec.html"),
            "<!doctype html><html><head><link rel=\"stylesheet\" href=\"../_assets/okf-doc.css\" /></head><body><section class=\"is-new\">정기 결제</section></body></html>",
        )
        .unwrap();

        let listed = list_workspace_docs(temp.path(), "docs").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "docs/product/spec.md");
        assert_eq!(listed[0].title, "결제 개편 기획안");
        assert_eq!(listed[0].html_sync_status, "synced");
        assert!(listed[0].has_change_markers);

        let detail = read_workspace_doc(temp.path(), "docs/product/spec.md").unwrap();
        assert_eq!(detail.md_markers, vec!["[NEW]"]);
        assert_eq!(detail.html_markers, vec!["is-new"]);

        let report = validate_workspace_docs(temp.path(), "docs").unwrap();
        assert!(report.valid);
        assert_eq!(
            report.highlighted_markdown_files,
            vec!["docs/product/spec.md"]
        );
        assert_eq!(
            report.highlighted_html_files,
            vec!["docs/product/spec.html"]
        );

        // Forbidden <script> in .html is caught as validation error
        std::fs::write(
            docs_dir.join("unsafe.md"),
            "---\ntitle: 위험 문서\n---\n\n본문\n",
        )
        .unwrap();
        std::fs::write(
            docs_dir.join("unsafe.html"),
            "<html><body><script>alert(1)</script></body></html>",
        )
        .unwrap();
        let bad_report = validate_workspace_docs(temp.path(), "docs").unwrap();
        assert!(!bad_report.valid);
        assert!(bad_report
            .issues
            .iter()
            .any(|issue| issue.code == "html_forbidden_script"));
    }

    #[test]
    fn skips_reserved_markdown_and_validates_screen_spec_wireframes_and_style_blocks() {
        let temp = TempDir::new().unwrap();
        let domain_dir = temp.path().join("docs").join("domains").join("board");
        let assets_dir = domain_dir.join("assets");
        std::fs::create_dir_all(&assets_dir).unwrap();
        std::fs::write(temp.path().join("docs").join("index.md"), "# Index\n").unwrap();
        std::fs::write(temp.path().join("docs").join("log.md"), "# Log\n").unwrap();
        std::fs::write(
            assets_dir.join("board-wireframe.svg"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
        )
        .unwrap();

        // Missing wireframes on screen spec -> error
        std::fs::write(
            domain_dir.join("screen-spec.md"),
            "---\nokf_hub_id: 11111111-1111-4111-8111-111111111111\ntype: \"Screen Spec\"\ntitle: 보드 화면명세\n---\n# 보드 화면명세\n",
        )
        .unwrap();
        std::fs::write(
            domain_dir.join("screen-spec.html"),
            "<html><head><style>.is-new { color: green; }</style></head><body><h1>보드 화면명세</h1></body></html>",
        )
        .unwrap();

        let missing_report = validate_workspace_docs(temp.path(), "docs").unwrap();
        assert!(!missing_report.valid);
        assert!(missing_report
            .issues
            .iter()
            .any(|i| i.code == "screen_spec_wireframe_missing"));
        assert!(!missing_report
            .issues
            .iter()
            .any(|i| i.code == "companion_html_missing"));
        // CSS selector `.is-new` inside <style> must not trigger a false-positive marker mismatch.
        assert!(!missing_report
            .issues
            .iter()
            .any(|i| i.code == "change_marker_mismatch"));

        // Valid wireframe + linked design -> valid
        std::fs::write(
            domain_dir.join("screen-spec.md"),
            "---\nokf_hub_id: 11111111-1111-4111-8111-111111111111\ntype: \"Screen Spec\"\ntitle: 보드 화면명세\nwireframes:\n  - title: 보드 와이어프레임\n    image: assets/board-wireframe.svg\ndesigns:\n  - title: 보드 시안\n    image: assets/missing-mock.svg\n    wireframe: 없는 와이어프레임\n---\n# 보드 화면명세\n",
        )
        .unwrap();
        std::fs::write(
            domain_dir.join("screen-spec.html"),
            "<html><body><h1>보드 화면명세</h1></body></html>",
        )
        .unwrap();
        let asset_report = validate_workspace_docs(temp.path(), "docs").unwrap();
        assert!(!asset_report.valid);
        assert!(asset_report
            .issues
            .iter()
            .any(|i| i.code == "asset_file_missing"));
        assert!(asset_report
            .issues
            .iter()
            .any(|i| i.code == "design_wireframe_unknown"));
    }

    #[test]
    fn rejects_path_traversal_assets_outside_workspace_root() {
        let outer = TempDir::new().unwrap();
        let workspace = outer.path().join("ws");
        let domain_dir = workspace.join("docs").join("domains").join("board");
        std::fs::create_dir_all(&domain_dir).unwrap();
        std::fs::write(
            outer.path().join("outside.svg"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
        )
        .unwrap();
        std::fs::write(
            domain_dir.join("screen-spec.md"),
            "---\nokf_hub_id: 11111111-1111-4111-8111-111111111111\ntype: \"Screen Spec\"\ntitle: 탈출 테스트\nwireframes:\n  - title: 외부 탈출\n    image: ../../../../outside.svg\n---\n# 탈출 테스트\n",
        )
        .unwrap();
        std::fs::write(
            domain_dir.join("screen-spec.html"),
            "<html><body><h1>탈출 테스트</h1></body></html>",
        )
        .unwrap();

        let report = validate_workspace_docs(&workspace, "docs").unwrap();
        assert!(!report.valid);
        assert!(report.issues.iter().any(|i| i.code == "asset_file_missing"));
    }

    #[test]
    fn fails_fast_when_workspace_root_cannot_be_canonicalized() {
        let missing = TempDir::new().unwrap().path().join("nonexistent-workspace");
        let err = validate_workspace_docs(&missing, "docs").unwrap_err();
        assert_eq!(err.code, ErrorCode::WorkspaceInvalid);
    }
}
