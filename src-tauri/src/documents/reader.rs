use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

use crate::error::{AppError, ErrorCode};

use super::contract::{
    CompanionHtml, DocumentAsset, DocumentContent, DocumentSummary, HtmlSyncStatus,
    TableOfContentsItem,
};
use super::frontmatter::parse_document;

const MAX_ASSET_BYTES: u64 = 10 * 1024 * 1024;

pub struct DocumentReader {
    repository_root: PathBuf,
    document_roots: Vec<PathBuf>,
}

impl DocumentReader {
    pub fn new(repository_root: &Path, document_roots: &[String]) -> Result<Self, AppError> {
        let repository_root = repository_root
            .canonicalize()
            .map_err(|error| path_error(repository_root, error.to_string()))?;
        if !fs::metadata(&repository_root)
            .map_err(|error| path_error(&repository_root, error.to_string()))?
            .is_dir()
        {
            return Err(path_error(
                &repository_root,
                "repository root is not a directory",
            ));
        }

        let mut canonical_roots = Vec::with_capacity(document_roots.len());
        for configured_root in document_roots {
            let relative = validate_relative_path(configured_root)?;
            let root = repository_root.join(relative);
            let canonical_root = root
                .canonicalize()
                .map_err(|error| path_error(&root, error.to_string()))?;
            let metadata = fs::metadata(&canonical_root)
                .map_err(|error| path_error(&canonical_root, error.to_string()))?;
            if !canonical_root.starts_with(&repository_root)
                || is_git_path(&repository_root, &canonical_root)
                || !metadata.is_dir()
            {
                return Err(path_error(
                    &root,
                    "document root must be a directory inside the repository",
                ));
            }
            canonical_roots.push(canonical_root);
        }

        Ok(Self {
            repository_root,
            document_roots: canonical_roots,
        })
    }

    pub fn read_document(
        &self,
        repository_relative_path: &str,
    ) -> Result<DocumentContent, AppError> {
        let path = self.resolve_existing_file(repository_relative_path)?;
        if !is_extension(&path, "md")
            || !self
                .document_roots
                .iter()
                .any(|root| path.starts_with(root))
        {
            return Err(path_error(
                &path,
                "document must be Markdown inside a configured document root",
            ));
        }

        let bytes = fs::read(&path).map_err(|error| path_error(&path, error.to_string()))?;
        let metadata = fs::metadata(&path).map_err(|error| path_error(&path, error.to_string()))?;
        let mut content = document_content_from_bytes(
            &portable_path(&self.repository_root, &path),
            bytes,
            modified_at_unix_ms(&metadata),
        )?;
        let (companion_html, html_sync_status) = self.load_companion_html(
            &path,
            &content.summary.file_name,
            content.summary.modified_at_unix_ms,
        );
        content.companion_html = companion_html;
        content.html_sync_status = html_sync_status;
        Ok(content)
    }

    pub fn read_asset(&self, repository_relative_path: &str) -> Result<DocumentAsset, AppError> {
        let path = self.resolve_existing_file(repository_relative_path)?;
        let extension = path
            .extension()
            .and_then(OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| path_error(&path, "asset type is not supported"))?;
        let mut file =
            fs::File::open(&path).map_err(|error| path_error(&path, error.to_string()))?;
        let metadata = file
            .metadata()
            .map_err(|error| path_error(&path, error.to_string()))?;
        if metadata.len() > MAX_ASSET_BYTES {
            return Err(asset_too_large_error(&self.repository_root, &path));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        (&mut file)
            .take(MAX_ASSET_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|error| path_error(&path, error.to_string()))?;
        let mut overflow = [0_u8; 1];
        if file
            .read(&mut overflow)
            .map_err(|error| path_error(&path, error.to_string()))?
            != 0
        {
            return Err(asset_too_large_error(&self.repository_root, &path));
        }

        match extension.as_str() {
            "svg" => {
                let source = String::from_utf8(bytes)
                    .map_err(|_| path_error(&path, "SVG asset is not valid UTF-8"))?;
                Ok(DocumentAsset::Svg { source })
            }
            "png" | "jpg" | "jpeg" | "gif" | "webp" => {
                let mime_type = match extension.as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    _ => unreachable!(),
                };
                Ok(DocumentAsset::Raster {
                    mime_type: mime_type.to_owned(),
                    base64: STANDARD.encode(bytes),
                })
            }
            _ => Err(path_error(&path, "asset type is not supported")),
        }
    }

    fn resolve_existing_file(&self, relative_path: &str) -> Result<PathBuf, AppError> {
        let relative = validate_relative_path(relative_path)?;
        let joined = self.repository_root.join(relative);
        let canonical = joined
            .canonicalize()
            .map_err(|error| path_error(&joined, error.to_string()))?;
        let metadata =
            fs::metadata(&canonical).map_err(|error| path_error(&canonical, error.to_string()))?;
        if !canonical.starts_with(&self.repository_root)
            || is_git_path(&self.repository_root, &canonical)
            || !metadata.is_file()
        {
            return Err(path_error(
                &joined,
                "target must be a file inside the repository",
            ));
        }
        Ok(canonical)
    }

    fn load_companion_html(
        &self,
        markdown_path: &Path,
        file_name: &str,
        markdown_modified_ms: i64,
    ) -> (Option<CompanionHtml>, HtmlSyncStatus) {
        if is_reserved_markdown_file(file_name) {
            return (None, HtmlSyncStatus::NotApplicable);
        }
        let candidate = markdown_path.with_extension("html");
        let Ok(canonical) = candidate.canonicalize() else {
            return (None, HtmlSyncStatus::Missing);
        };
        let Ok(metadata) = fs::metadata(&canonical) else {
            return (None, HtmlSyncStatus::Missing);
        };
        if !canonical.starts_with(&self.repository_root)
            || is_git_path(&self.repository_root, &canonical)
            || !metadata.is_file()
            || metadata.len() > MAX_ASSET_BYTES
        {
            return (None, HtmlSyncStatus::Missing);
        }
        let Ok(bytes) = fs::read(&canonical) else {
            return (None, HtmlSyncStatus::Missing);
        };
        let Ok(raw_html) = String::from_utf8(bytes) else {
            return (None, HtmlSyncStatus::Missing);
        };
        let html_modified_ms = modified_at_unix_ms(&metadata);
        let html = self.inline_local_stylesheets(&canonical, &raw_html);
        // Allow 5s tolerance for git checkout/fast-forward mtime jitter.
        let sync_status = if html_modified_ms.saturating_add(5_000) >= markdown_modified_ms {
            HtmlSyncStatus::InSync
        } else {
            HtmlSyncStatus::Outdated
        };
        (
            Some(CompanionHtml {
                path: portable_path(&self.repository_root, &canonical),
                html,
                modified_at_unix_ms: html_modified_ms,
            }),
            sync_status,
        )
    }

    fn inline_local_stylesheets(&self, html_path: &Path, raw_html: &str) -> String {
        let Some(parent_dir) = html_path.parent() else {
            return inject_csp_meta(raw_html);
        };
        sanitize_and_inline_html(raw_html, |clean_href| {
            let css_candidate = parent_dir.join(clean_href);
            let canonical_css = css_candidate.canonicalize().ok()?;
            let metadata = fs::metadata(&canonical_css).ok()?;
            if !canonical_css.starts_with(&self.repository_root)
                || is_git_path(&self.repository_root, &canonical_css)
                || !metadata.is_file()
                || !is_extension(&canonical_css, "css")
                || metadata.len() > MAX_ASSET_BYTES
            {
                return None;
            }
            fs::read_to_string(&canonical_css).ok()
        })
    }
}

const MAX_INLINED_STYLESHEETS: usize = 10;
const MAX_TOTAL_INLINED_CSS_BYTES: usize = 2 * 1024 * 1024;
const SANDBOX_CSP_META: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;\" />";

pub(crate) fn sanitize_and_inline_html<F>(raw_html: &str, mut load_css: F) -> String
where
    F: FnMut(&str) -> Option<String>,
{
    let lower_html = raw_html.to_ascii_lowercase();
    let mut output = String::with_capacity(raw_html.len() + SANDBOX_CSP_META.len());
    let mut cursor = 0;
    let mut inlined_count = 0usize;
    let mut inlined_bytes = 0usize;

    while let Some(rel_idx) = lower_html[cursor..].find("<link") {
        let tag_start = cursor + rel_idx;
        output.push_str(&raw_html[cursor..tag_start]);
        let Some(end_offset) = raw_html[tag_start..].find('>') else {
            output.push_str(&raw_html[tag_start..]);
            return inject_csp_meta(&output);
        };
        let tag_end = tag_start + end_offset + 1;
        let tag = &raw_html[tag_start..tag_end];
        let mut replaced = None;
        if inlined_count < MAX_INLINED_STYLESHEETS {
            if let Some(clean_href) = extract_local_stylesheet_href(tag) {
                if let Some(css) = load_css(clean_href) {
                    if inlined_bytes.saturating_add(css.len()) <= MAX_TOTAL_INLINED_CSS_BYTES {
                        inlined_count += 1;
                        inlined_bytes += css.len();
                        let safe_css = css.replace("</style", "<\\/style");
                        replaced = Some(format!("<style>{safe_css}</style>"));
                    }
                }
            }
        }
        if let Some(inlined) = replaced {
            output.push_str(&inlined);
        } else {
            output.push_str(tag);
        }
        cursor = tag_end;
    }
    output.push_str(&raw_html[cursor..]);
    inject_csp_meta(&output)
}

pub(crate) fn extract_local_stylesheet_hrefs(raw_html: &str) -> Vec<String> {
    let lower_html = raw_html.to_ascii_lowercase();
    let mut hrefs = Vec::new();
    let mut cursor = 0;
    while let Some(rel_idx) = lower_html[cursor..].find("<link") {
        let tag_start = cursor + rel_idx;
        let Some(end_offset) = raw_html[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + end_offset + 1;
        let tag = &raw_html[tag_start..tag_end];
        if let Some(clean_href) = extract_local_stylesheet_href(tag) {
            hrefs.push(clean_href.to_owned());
            if hrefs.len() >= MAX_INLINED_STYLESHEETS {
                break;
            }
        }
        cursor = tag_end;
    }
    hrefs
}

fn extract_local_stylesheet_href(tag: &str) -> Option<&str> {
    let rel = extract_html_attr(tag, "rel")?;
    if !rel
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case("stylesheet"))
    {
        return None;
    }
    let href = extract_html_attr(tag, "href")?;
    let trimmed = href.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("//")
        || trimmed.starts_with("data:")
    {
        return None;
    }
    Some(trimmed.split(['?', '#']).next().unwrap_or(trimmed))
}

fn inject_csp_meta(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if lower.contains("content-security-policy") {
        return html.to_owned();
    }
    if let Some(head_idx) = lower.find("<head") {
        if let Some(close_offset) = html[head_idx..].find('>') {
            let insert_at = head_idx + close_offset + 1;
            let mut out = String::with_capacity(html.len() + SANDBOX_CSP_META.len());
            out.push_str(&html[..insert_at]);
            out.push_str(SANDBOX_CSP_META);
            out.push_str(&html[insert_at..]);
            return out;
        }
    }
    format!("{SANDBOX_CSP_META}{html}")
}

fn is_reserved_markdown_file(file_name: &str) -> bool {
    file_name == "index.md" || file_name == "log.md" || file_name.eq_ignore_ascii_case("README.md")
}

fn extract_html_attr<'a>(tag: &'a str, attr_name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{attr_name}=");
    let pos = lower.find(&needle)?;
    let after = &tag[pos + needle.len()..].trim_start();
    let quote = after.chars().next()?;
    if quote == '"' || quote == '\'' {
        let rest = &after[quote.len_utf8()..];
        let end = rest.find(quote)?;
        Some(&rest[..end])
    } else {
        let end = after
            .find(|ch: char| ch.is_whitespace() || ch == '>' || ch == '/')
            .unwrap_or(after.len());
        Some(&after[..end])
    }
}

pub(crate) fn document_content_from_bytes(
    repository_relative_path: &str,
    bytes: Vec<u8>,
    modified_at_unix_ms: i64,
) -> Result<DocumentContent, AppError> {
    let size = bytes.len() as u64;
    let markdown = String::from_utf8(bytes).map_err(|_| {
        path_error(
            Path::new(repository_relative_path),
            "document is not valid UTF-8",
        )
    })?;
    let file_name = Path::new(repository_relative_path)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_owned();
    let parsed = parse_document(&markdown, &file_name);
    let summary = DocumentSummary {
        path: repository_relative_path.to_owned(),
        file_name,
        title: parsed.title,
        document_id: parsed.document_id,
        frontmatter_status: parsed.frontmatter_status,
        modified_at_unix_ms,
        size,
    };

    Ok(DocumentContent {
        summary,
        properties: frontmatter_properties(&markdown),
        table_of_contents: table_of_contents(&markdown),
        markdown,
        last_commit: None,
        companion_html: None,
        html_sync_status: HtmlSyncStatus::NotApplicable,
    })
}

fn asset_too_large_error(repository_root: &Path, path: &Path) -> AppError {
    AppError::new(
        ErrorCode::DocumentAssetTooLarge,
        "문서 자산이 허용된 크기를 초과했습니다.",
    )
    .with_detail("path", portable_path(repository_root, path))
    .with_detail("maxBytes", MAX_ASSET_BYTES.to_string())
}

fn validate_relative_path(path: &str) -> Result<PathBuf, AppError> {
    let normalized = path.replace('\\', "/");
    let relative = Path::new(&normalized);
    if normalized.trim().is_empty()
        || relative.is_absolute()
        || has_windows_drive_prefix(&normalized)
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            ) || component.as_os_str() == OsStr::new(".git")
        })
    {
        return Err(path_error(
            Path::new(path),
            "path is not repository-relative",
        ));
    }
    Ok(relative.to_owned())
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_git_path(repository_root: &Path, path: &Path) -> bool {
    path.strip_prefix(repository_root).is_ok_and(|relative| {
        relative
            .components()
            .any(|component| component.as_os_str() == OsStr::new(".git"))
    })
}

fn is_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

fn portable_path(repository_root: &Path, path: &Path) -> String {
    path.strip_prefix(repository_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn modified_at_unix_ms(metadata: &fs::Metadata) -> i64 {
    match metadata.modified() {
        Ok(modified) => match modified.duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis().min(i64::MAX as u128) as i64,
            Err(error) => -(error.duration().as_millis().min(i64::MAX as u128) as i64),
        },
        Err(_) => 0,
    }
}

fn frontmatter_properties(markdown: &str) -> serde_json::Value {
    let mut lines = markdown.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return serde_json::json!({});
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return serde_json::json!({});
    }

    let mut yaml = String::new();
    for line in lines {
        let marker = line.trim_end_matches(['\r', '\n']);
        if marker == "---" || marker == "..." {
            return serde_yaml_ng::from_str::<serde_json::Value>(&yaml)
                .ok()
                .filter(serde_json::Value::is_object)
                .unwrap_or_else(|| serde_json::json!({}));
        }
        yaml.push_str(line);
    }
    serde_json::json!({})
}

fn table_of_contents(markdown: &str) -> Vec<TableOfContentsItem> {
    let mut items = Vec::new();
    let mut heading = None::<(u8, String)>;
    let mut occurrences = HashMap::<String, usize>::new();
    let mut used_ids = HashSet::<String>::new();

    for event in Parser::new_ext(markdown, Options::ENABLE_YAML_STYLE_METADATA_BLOCKS) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((level as u8, String::new()))
            }
            Event::Text(text) | Event::Code(text) | Event::InlineMath(text) => {
                if let Some((_, title)) = &mut heading {
                    title.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, title)) = &mut heading {
                    title.push(' ');
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                let Some((level, title)) = heading.take() else {
                    continue;
                };
                let title = title.trim().to_owned();
                let slug = heading_slug(&title);
                let occurrence = occurrences.entry(slug.clone()).or_insert(0);
                let id = loop {
                    *occurrence += 1;
                    let candidate = if *occurrence == 1 {
                        slug.clone()
                    } else {
                        format!("{slug}-{occurrence}")
                    };
                    if used_ids.insert(candidate.clone()) {
                        break candidate;
                    }
                };
                items.push(TableOfContentsItem { level, title, id });
            }
            _ => {}
        }
    }
    items
}

fn heading_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut pending_separator = false;
    for character in title.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character);
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }
    if slug.is_empty() {
        "section".to_owned()
    } else {
        slug
    }
}

fn path_error(path: &Path, reason: impl Into<String>) -> AppError {
    AppError::new(
        ErrorCode::DocumentPathInvalid,
        "문서 경로를 읽을 수 없습니다.",
    )
    .with_detail("path", path.display().to_string())
    .with_detail("reason", reason)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;

    use tempfile::TempDir;

    use super::DocumentReader;
    use crate::documents::contract::DocumentAsset;
    use crate::error::ErrorCode;

    #[test]
    fn reader_rejects_paths_outside_the_repository_and_non_markdown_documents() {
        let repo = fixture_repo(&[("docs/guide.md", "# Guide"), ("docs/data.json", "{}")]);
        let reader = reader(&repo);

        for path in [
            "../secret.md",
            "/tmp/secret.md",
            "docs/data.json",
            ".git/config",
        ] {
            assert_eq!(
                reader.read_document(path).unwrap_err().code,
                ErrorCode::DocumentPathInvalid,
                "path: {path}"
            );
        }
    }

    #[test]
    fn document_reader_requires_the_canonical_target_to_stay_in_a_configured_root() {
        let repo = fixture_repo(&[
            ("docs/guide.md", "# Guide"),
            ("outside/secret.md", "# Secret"),
        ]);
        let reader = reader(&repo);

        assert_eq!(
            reader.read_document("outside/secret.md").unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
    }

    #[cfg(unix)]
    #[test]
    fn reader_rejects_document_and_asset_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let repo = fixture_repo(&[("docs/guide.md", "# Guide")]);
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.md"), "# Secret").unwrap();
        fs::write(outside.path().join("secret.png"), b"PNG").unwrap();
        symlink(
            outside.path().join("secret.md"),
            repo.path().join("docs/link.md"),
        )
        .unwrap();
        symlink(
            outside.path().join("secret.png"),
            repo.path().join("docs/link.png"),
        )
        .unwrap();
        let reader = reader(&repo);

        assert_eq!(
            reader.read_document("docs/link.md").unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
        assert_eq!(
            reader.read_asset("docs/link.png").unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
    }

    #[test]
    fn asset_reader_allows_repository_raster_images_and_rejects_oversized_files() {
        let repo = fixture_repo(&[("docs/guide.md", "# Guide")]);
        fs::create_dir_all(repo.path().join("shared/images")).unwrap();
        fs::write(repo.path().join("shared/images/map.png"), b"PNG").unwrap();
        fs::File::create(repo.path().join("shared/images/huge.png"))
            .unwrap()
            .set_len(10 * 1024 * 1024 + 1)
            .unwrap();
        let reader = reader(&repo);

        assert!(matches!(
            reader.read_asset("shared/images/map.png").unwrap(),
            DocumentAsset::Raster { mime_type, base64 }
                if mime_type == "image/png" && base64 == "UE5H"
        ));
        assert_eq!(
            reader
                .read_asset("shared/images/huge.png")
                .unwrap_err()
                .code,
            ErrorCode::DocumentAssetTooLarge
        );
    }

    #[test]
    fn asset_reader_rejects_traversal_git_and_unsupported_types() {
        let repo = fixture_repo(&[("docs/guide.md", "# Guide"), ("docs/file.txt", "text")]);
        let reader = reader(&repo);

        for path in [
            "../image.png",
            "/tmp/image.png",
            ".git/icon.png",
            "docs/file.txt",
        ] {
            assert_eq!(
                reader.read_asset(path).unwrap_err().code,
                ErrorCode::DocumentPathInvalid,
                "path: {path}"
            );
        }
    }

    #[test]
    fn document_read_returns_original_markdown_properties_and_stable_toc_ids() {
        let source = "---\ntitle: API Guide\nowner: platform\ndraft: false\n---\n# API Guide\nIntro\n## Request Flow\n## Request Flow\n### 한국어 제목\n";
        let repo = fixture_repo(&[("docs/guide.md", source)]);
        let reader = reader(&repo);

        let content = reader.read_document("docs/guide.md").unwrap();

        assert_eq!(content.markdown, source);
        assert_eq!(content.summary.path, "docs/guide.md");
        assert_eq!(content.summary.title, "API Guide");
        assert!(content.last_commit.is_none());
        assert_eq!(content.properties["owner"], "platform");
        assert_eq!(content.properties["draft"], false);
        assert_eq!(
            content
                .table_of_contents
                .iter()
                .map(|item| (item.level, item.title.as_str(), item.id.as_str()))
                .collect::<Vec<_>>(),
            [
                (1, "API Guide", "api-guide"),
                (2, "Request Flow", "request-flow"),
                (2, "Request Flow", "request-flow-2"),
                (3, "한국어 제목", "한국어-제목"),
            ]
        );
    }

    #[test]
    fn toc_occurrences_do_not_collide_with_literal_numeric_suffixes() {
        let repo = fixture_repo(&[(
            "docs/guide.md",
            "# Guide\n## Request Flow\n## Request Flow\n## Request Flow-2\n",
        )]);
        let reader = reader(&repo);

        let ids = reader
            .read_document("docs/guide.md")
            .unwrap()
            .table_of_contents
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            [
                "guide",
                "request-flow",
                "request-flow-2",
                "request-flow-2-2"
            ]
        );
    }

    #[test]
    fn invalid_utf8_documents_and_svg_assets_are_rejected() {
        let repo = fixture_repo(&[("docs/guide.md", "# Guide")]);
        fs::write(repo.path().join("docs/invalid.md"), [0xff, 0xfe]).unwrap();
        fs::write(repo.path().join("docs/invalid.svg"), [0xff, 0xfe]).unwrap();
        let reader = reader(&repo);

        assert_eq!(
            reader.read_document("docs/invalid.md").unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
        assert_eq!(
            reader.read_asset("docs/invalid.svg").unwrap_err().code,
            ErrorCode::DocumentPathInvalid
        );
    }

    #[test]
    fn svg_is_returned_as_untrusted_source_and_reads_never_change_files() {
        let markdown = "# Guide\n![diagram](diagram.svg)\n";
        let svg = "<svg><script>alert('unsafe')</script></svg>";
        let repo = fixture_repo(&[("docs/guide.md", markdown), ("docs/diagram.svg", svg)]);
        let reader = reader(&repo);
        let document_before = snapshot(&repo.path().join("docs/guide.md"));
        let asset_before = snapshot(&repo.path().join("docs/diagram.svg"));

        let content = reader.read_document("docs/guide.md").unwrap();
        let asset = reader.read_asset("docs/diagram.svg").unwrap();

        assert_eq!(content.markdown, markdown);
        assert!(matches!(asset, DocumentAsset::Svg { source } if source == svg));
        assert_eq!(
            snapshot(&repo.path().join("docs/guide.md")),
            document_before
        );
        assert_eq!(
            snapshot(&repo.path().join("docs/diagram.svg")),
            asset_before
        );
    }

    #[test]
    fn raster_allowlist_has_deterministic_mime_types() {
        let repo = fixture_repo(&[("docs/guide.md", "# Guide")]);
        let cases = [
            ("docs/photo.jpeg", "image/jpeg"),
            ("docs/animation.GIF", "image/gif"),
            ("docs/preview.webp", "image/webp"),
        ];
        for (path, _) in cases {
            fs::write(repo.path().join(path), b"asset").unwrap();
        }
        let reader = reader(&repo);

        for (path, expected_mime) in cases {
            assert!(matches!(
                reader.read_asset(path).unwrap(),
                DocumentAsset::Raster { mime_type, .. } if mime_type == expected_mime
            ));
        }
    }

    #[test]
    fn reads_companion_html_inlines_local_css_and_reports_sync_status() {
        use super::super::contract::HtmlSyncStatus;

        let repo = fixture_repo(&[
            ("docs/_assets/okf-doc.css", "body { color: #171923; }"),
            ("docs/product/spec.md", "# Spec\n\nBody"),
            (
                "docs/product/spec.html",
                r#"<!doctype html><html><head><link rel="stylesheet" href="../_assets/okf-doc.css" /><link rel="stylesheet" href="https://example.com/ext.css" /></head><body><h1>Spec</h1></body></html>"#,
            ),
            ("docs/product/only-md.md", "# Only Md"),
            ("docs/product/index.md", "# Index"),
            ("docs/log.md", "# Log"),
            ("docs/README.md", "# Readme"),
        ]);
        let reader = reader(&repo);

        let paired = reader.read_document("docs/product/spec.md").unwrap();
        assert_eq!(paired.html_sync_status, HtmlSyncStatus::InSync);
        let companion = paired.companion_html.expect("companion html present");
        assert_eq!(companion.path, "docs/product/spec.html");
        assert!(companion.html.contains("body { color: #171923; }"));
        assert!(companion.html.contains("https://example.com/ext.css"));

        let missing = reader.read_document("docs/product/only-md.md").unwrap();
        assert_eq!(missing.html_sync_status, HtmlSyncStatus::Missing);
        assert!(missing.companion_html.is_none());

        for reserved in ["docs/product/index.md", "docs/log.md", "docs/README.md"] {
            let doc = reader.read_document(reserved).unwrap();
            assert_eq!(doc.html_sync_status, HtmlSyncStatus::NotApplicable);
            assert!(doc.companion_html.is_none());
        }
    }

    #[test]
    fn reports_outdated_when_companion_html_is_older_than_markdown() {
        use super::super::contract::HtmlSyncStatus;
        use std::time::Duration;

        let repo = fixture_repo(&[
            ("docs/guide.md", "# Guide"),
            ("docs/guide.html", "<html><body>Guide</body></html>"),
        ]);
        let html_file = fs::File::options()
            .write(true)
            .open(repo.path().join("docs/guide.html"))
            .unwrap();
        let older = std::time::SystemTime::now() - Duration::from_secs(30);
        html_file.set_modified(older).unwrap();
        drop(html_file);

        let reader = reader(&repo);
        let doc = reader.read_document("docs/guide.md").unwrap();
        assert_eq!(doc.html_sync_status, HtmlSyncStatus::Outdated);
        assert!(doc.companion_html.is_some());
    }

    #[test]
    fn stylesheet_inliner_checks_rel_token_case_insensitively_and_adds_csp_meta() {
        let repo = fixture_repo(&[
            ("docs/_assets/theme.css", ".ok { font-weight: 700; }"),
            ("docs/_assets/icon-stylesheet.css", "should-not-inline {}"),
            ("docs/product/spec.md", "# Spec"),
            (
                "docs/product/spec.html",
                "<!doctype html><html><head><LINK REL='Alternate Stylesheet' HREF='../_assets/theme.css'><link rel='icon' href='../_assets/icon-stylesheet.css'></head><body>Spec</body></html>",
            ),
        ]);
        let reader = reader(&repo);
        let doc = reader.read_document("docs/product/spec.md").unwrap();
        let html = doc.companion_html.unwrap().html;
        assert!(html.contains(".ok { font-weight: 700; }"));
        assert!(!html.contains("should-not-inline"));
        assert!(html.contains("http-equiv=\"Content-Security-Policy\""));
    }

    fn fixture_repo(files: &[(&str, &str)]) -> TempDir {
        let repo = TempDir::new().unwrap();
        fs::create_dir_all(repo.path().join("docs")).unwrap();
        fs::create_dir_all(repo.path().join(".git")).unwrap();
        fs::write(repo.path().join(".git/config"), "secret").unwrap();
        for (path, contents) in files {
            let path = repo.path().join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut file = fs::File::create(path).unwrap();
            file.write_all(contents.as_bytes()).unwrap();
        }
        repo
    }

    fn reader(repo: &TempDir) -> DocumentReader {
        DocumentReader::new(repo.path(), &["docs".to_owned()]).unwrap()
    }

    fn snapshot(path: &std::path::Path) -> (Vec<u8>, std::time::SystemTime) {
        let bytes = fs::read(path).unwrap();
        let modified = fs::metadata(path).unwrap().modified().unwrap();
        (bytes, modified)
    }
}
