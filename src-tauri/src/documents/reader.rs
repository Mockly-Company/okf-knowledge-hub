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
    CompanionHtml, DocumentAsset, DocumentContent, DocumentSummary, FrontmatterStatus,
    HtmlSyncStatus, TableOfContentsItem,
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
        content.summary.has_companion_html = content.companion_html.is_some();
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
        let Ok(canonical_root) = self.repository_root.canonicalize() else {
            return (None, HtmlSyncStatus::Missing);
        };
        let canonical_markdown = markdown_path
            .canonicalize()
            .unwrap_or_else(|_| markdown_path.to_path_buf());
        let relative_path = portable_path(&canonical_root, &canonical_markdown);
        if is_reserved_markdown_path(&relative_path, file_name) {
            return (None, HtmlSyncStatus::NotApplicable);
        }
        let Some((canonical, metadata)) =
            resolve_companion_html(&canonical_root, &canonical_markdown)
        else {
            return (None, HtmlSyncStatus::Missing);
        };
        let Ok(bytes) = fs::read(&canonical) else {
            return (None, HtmlSyncStatus::Missing);
        };
        let Ok(raw_html) = String::from_utf8(bytes) else {
            return (None, HtmlSyncStatus::Missing);
        };
        let html_modified_ms = modified_at_unix_ms(&metadata);
        let inlined_css = self.inline_local_stylesheets(&canonical_root, &canonical, &raw_html);
        let html = inline_local_images(&canonical_root, &canonical, &inlined_css);
        // Allow 5s tolerance for git checkout/fast-forward mtime jitter.
        let sync_status = if html_modified_ms.saturating_add(5_000) >= markdown_modified_ms {
            HtmlSyncStatus::InSync
        } else {
            HtmlSyncStatus::Outdated
        };
        (
            Some(CompanionHtml {
                path: portable_path(&canonical_root, &canonical),
                html,
                modified_at_unix_ms: html_modified_ms,
            }),
            sync_status,
        )
    }

    fn inline_local_stylesheets(
        &self,
        canonical_root: &Path,
        html_path: &Path,
        raw_html: &str,
    ) -> String {
        let Some(parent_dir) = html_path.parent() else {
            return inject_csp_meta(raw_html);
        };
        sanitize_and_inline_html(raw_html, |clean_href| {
            let css_candidate = parent_dir.join(clean_href);
            let canonical_css = css_candidate.canonicalize().ok()?;
            let metadata = fs::metadata(&canonical_css).ok()?;
            if !canonical_css.starts_with(canonical_root)
                || is_git_path(canonical_root, &canonical_css)
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

const MAX_INLINED_IMAGES: usize = 16;
const MAX_TOTAL_INLINED_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_PREVIEW_SCAN_BYTES: usize = 16 * 1024;

pub(crate) fn inline_local_images(canonical_root: &Path, html_path: &Path, html: &str) -> String {
    let Some(parent_dir) = html_path.parent() else {
        return html.to_owned();
    };
    let lower_html = html.to_ascii_lowercase();
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    let mut inlined_count = 0usize;
    let mut inlined_bytes = 0usize;

    while let Some(rel_idx) = lower_html[cursor..].find("<img") {
        let tag_start = cursor + rel_idx;
        output.push_str(&html[cursor..tag_start]);
        let Some(end_offset) = html[tag_start..].find('>') else {
            output.push_str(&html[tag_start..]);
            return output;
        };
        let tag_end = tag_start + end_offset + 1;
        let tag = &html[tag_start..tag_end];
        let mut replaced_tag = None;
        if inlined_count < MAX_INLINED_IMAGES {
            if let Some(src_attr) = extract_html_attr(tag, "src") {
                let trimmed = src_attr.trim();
                let clean = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
                let lower = clean.to_ascii_lowercase();
                let is_remote_or_data = clean.is_empty()
                    || lower.starts_with("http://")
                    || lower.starts_with("https://")
                    || clean.starts_with("//")
                    || lower.starts_with("data:")
                    || lower.starts_with("blob:");
                if !is_remote_or_data {
                    if let Some(mime) = local_image_mime(Path::new(clean)) {
                        let candidate = parent_dir.join(clean);
                        if let Ok(canonical_img) = candidate.canonicalize() {
                            if canonical_img.starts_with(canonical_root)
                                && !is_git_path(canonical_root, &canonical_img)
                            {
                                if let Ok(metadata) = fs::metadata(&canonical_img) {
                                    if metadata.is_file()
                                        && metadata.len() <= MAX_ASSET_BYTES
                                        && inlined_bytes.saturating_add(metadata.len() as usize)
                                            <= MAX_TOTAL_INLINED_IMAGE_BYTES
                                    {
                                        if let Ok(bytes) = fs::read(&canonical_img) {
                                            inlined_count += 1;
                                            inlined_bytes += bytes.len();
                                            let data_uri = format!(
                                                "data:{mime};base64,{}",
                                                STANDARD.encode(bytes)
                                            );
                                            if let Some(swapped) =
                                                replace_html_attr_value(tag, "src", &data_uri)
                                            {
                                                replaced_tag = Some(swapped);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if let Some(next_tag) = replaced_tag {
            output.push_str(&next_tag);
        } else {
            output.push_str(tag);
        }
        cursor = tag_end;
    }
    output.push_str(&html[cursor..]);
    output
}

fn local_image_mime(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(OsStr::to_str)?
        .to_ascii_lowercase();
    match ext.as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Byte range of `attr_name`'s value inside one start tag (`<tag ...>`).
///
/// Walks the tag attribute by attribute so that only whole attribute names match
/// (`data-src` never matches `src`) and text inside other attributes' quoted values
/// (`alt="a src=x"`) is never mistaken for an attribute.
fn html_attr_value_range(tag: &str, attr_name: &str) -> Option<(usize, usize)> {
    let bytes = tag.as_bytes();
    let len = bytes.len();
    let mut i = usize::from(bytes.first() == Some(&b'<'));
    while i < len && !bytes[i].is_ascii_whitespace() && !matches!(bytes[i], b'>' | b'/') {
        i += 1;
    }
    loop {
        while i < len && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        if i >= len || bytes[i] == b'>' {
            return None;
        }
        let name_start = i;
        while i < len && !bytes[i].is_ascii_whitespace() && !matches!(bytes[i], b'=' | b'>' | b'/')
        {
            i += 1;
        }
        let name = &tag[name_start..i];
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len || bytes[i] != b'=' {
            // Boolean attribute without a value.
            continue;
        }
        i += 1;
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            return None;
        }
        let (value_start, value_end) = if matches!(bytes[i], b'"' | b'\'') {
            let quote = bytes[i];
            let start = i + 1;
            let end = start + bytes[start..].iter().position(|byte| *byte == quote)?;
            i = end + 1;
            (start, end)
        } else {
            let start = i;
            while i < len && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                i += 1;
            }
            // `src=a.png/>`: treat the trailing `/` as the self-closing marker, not the value.
            let end = if i > start && bytes[i - 1] == b'/' && bytes.get(i) == Some(&b'>') {
                i - 1
            } else {
                i
            };
            (start, end)
        };
        if name.eq_ignore_ascii_case(attr_name) {
            return Some((value_start, value_end));
        }
    }
}

fn replace_html_attr_value(tag: &str, attr_name: &str, new_value: &str) -> Option<String> {
    let (replace_start, replace_end) = html_attr_value_range(tag, attr_name)?;
    let mut out = String::with_capacity(tag.len() + new_value.len());
    out.push_str(&tag[..replace_start]);
    out.push_str(new_value);
    out.push_str(&tag[replace_end..]);
    Some(out)
}

pub(crate) fn scan_markdown_preview<R: Read>(
    reader: R,
    max_bytes: usize,
    doc_relative_path: &str,
    frontmatter_links: &[String],
) -> (Option<String>, Vec<String>, Vec<String>) {
    let mut bytes = Vec::with_capacity(max_bytes.min(16 * 1024));
    let _ = reader.take(max_bytes as u64).read_to_end(&mut bytes);
    let source = String::from_utf8_lossy(&bytes);

    let mut preview_headings = Vec::new();
    let mut fallback_description: Option<String> = None;
    let mut linked_paths = Vec::new();
    let mut seen_links = HashSet::new();
    let mut push_link = |raw_href: &str, is_frontmatter: bool| {
        if let Some(resolved) =
            resolve_relative_doc_target(doc_relative_path, raw_href, is_frontmatter)
        {
            let key = resolved.to_ascii_lowercase();
            if seen_links.insert(key) {
                linked_paths.push(resolved);
            }
        }
    };

    for link in frontmatter_links {
        push_link(link, true);
    }

    let mut in_fence = false;
    let mut active_fence = "";
    for raw_line in source.lines() {
        let trimmed = raw_line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let marker = if trimmed.starts_with("```") {
                "```"
            } else {
                "~~~"
            };
            if !in_fence {
                in_fence = true;
                active_fence = marker;
            } else if active_fence == marker {
                in_fence = false;
            }
            continue;
        }
        if in_fence {
            continue;
        }

        for href in extract_inline_markdown_links(trimmed) {
            push_link(href, false);
        }

        if let Some((level, heading_text)) = parse_atx_heading(trimmed) {
            if matches!(level, 2 | 3) && preview_headings.len() < 4 {
                let clean = clean_markdown_inline_text(heading_text);
                if !clean.is_empty()
                    && clean != "이번 변경 요약"
                    && !preview_headings.contains(&clean)
                {
                    preview_headings.push(truncate_chars(&clean, 64));
                }
            }
            continue;
        }

        if fallback_description.is_none()
            && !trimmed.is_empty()
            && !trimmed.starts_with('#')
            && !trimmed.starts_with('>')
            && !trimmed.starts_with('|')
            && !trimmed.starts_with("<!--")
            && !trimmed.starts_with("---")
            && !trimmed.starts_with("***")
            && !trimmed.starts_with("- ")
            && !trimmed.starts_with("* ")
            && !trimmed.starts_with("![")
        {
            let clean = clean_markdown_inline_text(trimmed);
            if clean.chars().count() >= 10 {
                fallback_description = Some(truncate_chars(&clean, 140));
            }
        }
    }

    (fallback_description, preview_headings, linked_paths)
}

pub(crate) fn strip_leading_frontmatter(source: &str) -> &str {
    let mut offset = 0usize;
    let mut lines = source.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return source;
    };
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return source;
    }
    offset += first.len();
    for line in lines {
        offset += line.len();
        let marker = line.trim_end_matches(['\r', '\n']);
        if marker == "---" || marker == "..." {
            return &source[offset..];
        }
    }
    source
}

fn parse_atx_heading(line: &str) -> Option<(u8, &str)> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = line[hashes..].strip_prefix(' ')?;
    let trimmed = rest.trim().trim_end_matches('#').trim();
    (!trimmed.is_empty()).then_some((hashes as u8, trimmed))
}

fn clean_markdown_inline_text(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some(close_bracket) = chars[i + 1..].iter().position(|c| *c == ']') {
                let bracket_end = i + 1 + close_bracket;
                if bracket_end + 1 < chars.len() && chars[bracket_end + 1] == '(' {
                    if let Some(close_paren) =
                        chars[bracket_end + 2..].iter().position(|c| *c == ')')
                    {
                        for ch in &chars[i + 1..bracket_end] {
                            result.push(*ch);
                        }
                        i = bracket_end + 2 + close_paren + 1;
                        continue;
                    }
                }
            }
        }
        let ch = chars[i];
        if ch != '`' {
            result.push(ch);
        }
        i += 1;
    }
    let collapsed = result
        .replace("**", "")
        .replace("__", "")
        .replace("[NEW]", "")
        .replace("[CHANGED]", "");
    collapsed.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in value.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn extract_inline_markdown_links(line: &str) -> Vec<&str> {
    let mut links = Vec::new();
    let bytes = line.as_bytes();
    let mut cursor = 0usize;
    while let Some(rel_idx) = line[cursor..].find("](") {
        let open_paren = cursor + rel_idx + 2;
        if let Some(rel_close) = line[open_paren..].find(')') {
            let close_paren = open_paren + rel_close;
            let bracket_pos = cursor + rel_idx;
            // Skip image embeds ![alt](...)
            let is_image = line[..bracket_pos]
                .rfind('[')
                .is_some_and(|open| open > 0 && bytes[open - 1] == b'!');
            if !is_image {
                let inside = line[open_paren..close_paren].trim();
                let href = inside.split_whitespace().next().unwrap_or("");
                if !href.is_empty() {
                    links.push(href);
                }
            }
            cursor = close_paren + 1;
        } else {
            break;
        }
    }
    links
}

pub(crate) fn resolve_relative_doc_target(
    doc_relative_path: &str,
    raw_href: &str,
    is_frontmatter_link: bool,
) -> Option<String> {
    let trimmed = raw_href.trim().trim_matches(|ch| ch == '<' || ch == '>');
    let without_fragment = trimmed.split(['#', '?']).next().unwrap_or("").trim();
    if without_fragment.is_empty() || without_fragment.starts_with('#') {
        return None;
    }
    let lower_scheme = without_fragment.to_ascii_lowercase();
    if lower_scheme.starts_with("http://")
        || lower_scheme.starts_with("https://")
        || lower_scheme.starts_with("mailto:")
        || lower_scheme.starts_with("tel:")
        || lower_scheme.starts_with("data:")
    {
        return None;
    }

    let joined = if let Some(stripped) = without_fragment.strip_prefix('/') {
        stripped.to_owned()
    } else if is_frontmatter_link
        && !without_fragment.starts_with("./")
        && !without_fragment.starts_with("../")
        && without_fragment.to_ascii_lowercase().starts_with("docs/")
    {
        without_fragment.to_owned()
    } else {
        let parent = Path::new(doc_relative_path)
            .parent()
            .and_then(Path::to_str)
            .unwrap_or("");
        if parent.is_empty() {
            without_fragment.to_owned()
        } else {
            format!("{parent}/{without_fragment}")
        }
    };

    let normalized = normalize_portable_doc_path(&joined);
    if normalized.is_empty() {
        return None;
    }

    let resolved_md = if normalized.to_ascii_lowercase().ends_with(".html") {
        let stem_len = normalized.len() - 5;
        format!("{}.md", &normalized[..stem_len])
    } else if normalized.to_ascii_lowercase().ends_with(".md") {
        normalized
    } else {
        return None;
    };

    let doc_clean = normalize_portable_doc_path(doc_relative_path);
    if resolved_md.eq_ignore_ascii_case(&doc_clean) {
        return None;
    }
    let file_name = Path::new(&resolved_md)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("");
    if is_reserved_markdown_path(&resolved_md, file_name) {
        return None;
    }
    Some(resolved_md)
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

fn is_reserved_stem(file_name: &str, ext: &str) -> bool {
    let Some((stem, file_ext)) = file_name.rsplit_once('.') else {
        return false;
    };
    file_ext.eq_ignore_ascii_case(ext)
        && matches!(
            stem.to_ascii_lowercase().as_str(),
            "index" | "log" | "readme" | "agents"
        )
}

pub(crate) fn validate_companion_html_path(
    canonical_root: &Path,
    candidate: &Path,
) -> Option<(PathBuf, fs::Metadata)> {
    let canonical = candidate.canonicalize().ok()?;
    if !canonical.starts_with(canonical_root) || is_git_path(canonical_root, &canonical) {
        return None;
    }
    let metadata = fs::metadata(&canonical).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES {
        return None;
    }
    Some((canonical, metadata))
}

pub(crate) fn lower_stem_key(path: &Path) -> Option<String> {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_lowercase())
}

pub(crate) fn sort_companion_html_candidates(
    candidates: &mut [PathBuf],
    preferred_stem: Option<&OsStr>,
) {
    candidates.sort_by(|left, right| {
        let left_exact_stem = preferred_stem.is_some_and(|stem| left.file_stem() == Some(stem));
        let right_exact_stem = preferred_stem.is_some_and(|stem| right.file_stem() == Some(stem));
        let left_exact_ext = left.extension().and_then(OsStr::to_str) == Some("html");
        let right_exact_ext = right.extension().and_then(OsStr::to_str) == Some("html");
        right_exact_stem
            .cmp(&left_exact_stem)
            .then_with(|| right_exact_ext.cmp(&left_exact_ext))
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
}

pub(crate) fn resolve_companion_html(
    repository_root: &Path,
    markdown_path: &Path,
) -> Option<(PathBuf, fs::Metadata)> {
    let canonical_root = repository_root.canonicalize().ok()?;
    if let Some(found) =
        validate_companion_html_path(&canonical_root, &markdown_path.with_extension("html"))
    {
        return Some(found);
    }
    let parent = markdown_path.parent()?;
    let stem = markdown_path.file_stem()?;
    let target_key = stem.to_string_lossy().to_lowercase();
    let mut candidates: Vec<PathBuf> = fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            lower_stem_key(path).as_deref() == Some(target_key.as_str())
                && is_extension(path, "html")
        })
        .collect();
    sort_companion_html_candidates(&mut candidates, Some(stem));
    candidates
        .into_iter()
        .find_map(|candidate| validate_companion_html_path(&canonical_root, &candidate))
}

pub(crate) fn normalize_portable_doc_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    let mut segments = Vec::new();
    for segment in normalized.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if segments.pop().is_none() {
                return String::new();
            }
            continue;
        }
        segments.push(segment);
    }
    segments.join("/")
}

pub(crate) fn is_okf_path(relative_path: &str) -> bool {
    let clean = normalize_portable_doc_path(relative_path);
    clean
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(".okf/"))
}

fn is_reserved_path_for_ext(relative_path: &str, file_name: &str, ext: &str) -> bool {
    is_okf_path(relative_path) || is_reserved_stem(file_name, ext)
}

pub(crate) fn is_reserved_markdown_path(relative_path: &str, file_name: &str) -> bool {
    is_reserved_path_for_ext(relative_path, file_name, "md")
}

pub(crate) fn is_reserved_html_path(relative_path: &str, file_name: &str) -> bool {
    is_reserved_path_for_ext(relative_path, file_name, "html")
}

fn extract_html_attr<'a>(tag: &'a str, attr_name: &str) -> Option<&'a str> {
    let (start, end) = html_attr_value_range(tag, attr_name)?;
    Some(&tag[start..end])
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
    let body_slice = strip_leading_frontmatter(&markdown);
    // Invalid frontmatter that `strip_leading_frontmatter` could not remove has no closing
    // delimiter; like discovery, never turn its YAML lines into a description.
    let unterminated_frontmatter =
        matches!(parsed.frontmatter_status, FrontmatterStatus::Invalid { .. })
            && body_slice.len() == markdown.len();
    let (fallback_description, preview_headings, linked_paths) = scan_markdown_preview(
        body_slice.as_bytes(),
        MAX_PREVIEW_SCAN_BYTES,
        repository_relative_path,
        &parsed.frontmatter_links,
    );
    let fallback_description = fallback_description.filter(|_| !unterminated_frontmatter);
    let summary = DocumentSummary {
        path: repository_relative_path.to_owned(),
        file_name,
        title: parsed.title,
        document_id: parsed.document_id,
        frontmatter_status: parsed.frontmatter_status,
        doc_type: parsed.doc_type,
        domain: parsed.domain,
        status: parsed.status,
        description: parsed.description.or(fallback_description),
        preview_headings,
        linked_paths,
        designs: parsed.designs,
        wireframes: parsed.wireframes,
        has_companion_html: false,
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

    use super::{extract_html_attr, replace_html_attr_value, DocumentReader};
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
            ("docs/product/UPPER.MD", "# Upper"),
            (
                "docs/product/UPPER.HTML",
                "<html><body>Upper HTML</body></html>",
            ),
            ("docs/product/lower-stem.md", "# Lower Stem"),
            (
                "docs/product/LOWER-STEM.HTML",
                "<html><body>Mismatched Stem</body></html>",
            ),
        ]);
        let reader = reader(&repo);

        let paired = reader.read_document("docs/product/spec.md").unwrap();
        assert_eq!(paired.html_sync_status, HtmlSyncStatus::InSync);
        let companion = paired.companion_html.expect("companion html present");
        assert_eq!(companion.path, "docs/product/spec.html");
        assert!(companion.html.contains("body { color: #171923; }"));
        assert!(companion.html.contains("https://example.com/ext.css"));

        let upper = reader.read_document("docs/product/UPPER.MD").unwrap();
        assert_eq!(upper.html_sync_status, HtmlSyncStatus::InSync);
        let upper_companion = upper.companion_html.expect("uppercase companion html");
        assert!(upper_companion
            .path
            .eq_ignore_ascii_case("docs/product/UPPER.HTML"));
        assert!(upper_companion.html.contains("Upper HTML"));

        let mismatched = reader.read_document("docs/product/lower-stem.md").unwrap();
        assert_eq!(mismatched.html_sync_status, HtmlSyncStatus::InSync);
        let mismatched_companion = mismatched
            .companion_html
            .expect("case-insensitive stem companion html");
        assert!(mismatched_companion
            .path
            .eq_ignore_ascii_case("docs/product/LOWER-STEM.HTML"));
        assert!(mismatched_companion.html.contains("Mismatched Stem"));

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

    #[test]
    fn sort_companion_html_candidates_prefers_exact_stem_then_lowercase_html_extension() {
        use std::ffi::OsStr;
        use std::path::PathBuf;

        let mut candidates = vec![
            PathBuf::from("docs/SPEC.HTML"),
            PathBuf::from("docs/SPEC.html"),
            PathBuf::from("docs/spec.HTML"),
            PathBuf::from("docs/spec.html"),
        ];
        super::sort_companion_html_candidates(&mut candidates, Some(OsStr::new("spec")));

        let ordered: Vec<String> = candidates
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            ordered,
            ["spec.html", "spec.HTML", "SPEC.html", "SPEC.HTML"]
        );
    }

    #[test]
    fn load_companion_html_canonicalizes_symlinked_repository_root() {
        use super::super::contract::HtmlSyncStatus;

        let parent = TempDir::new().unwrap();
        let repo_real = parent.path().join("real-repo");
        fs::create_dir_all(repo_real.join("docs/_assets")).unwrap();
        fs::create_dir_all(repo_real.join(".git")).unwrap();
        fs::write(
            repo_real.join("docs/_assets/okf-doc.css"),
            "body { color: #171923; }",
        )
        .unwrap();
        fs::write(repo_real.join("docs/regular.md"), "# Regular").unwrap();
        fs::write(
            repo_real.join("docs/regular.html"),
            r#"<html><head><link rel="stylesheet" href="_assets/okf-doc.css" /></head><body>Regular</body></html>"#,
        )
        .unwrap();
        fs::write(repo_real.join("docs/escaped.md"), "# Escaped").unwrap();
        fs::write(repo_real.join("docs/git-linked.md"), "# Git Linked").unwrap();
        fs::write(repo_real.join(".git/internal.html"), "<html>git</html>").unwrap();

        let outside = TempDir::new().unwrap();
        let escaped_html = outside.path().join("escaped.html");
        fs::write(&escaped_html, "<html>escaped</html>").unwrap();

        let direct_reader = DocumentReader::new(&repo_real, &["docs".to_owned()]).unwrap();
        let direct_regular = direct_reader.read_document("docs/regular.md").unwrap();
        assert!(direct_regular
            .companion_html
            .expect("direct companion html")
            .html
            .contains("body { color: #171923; }"));

        let repo_alias = parent.path().join("alias-repo");
        if !try_create_dir_symlink(&repo_real, &repo_alias) {
            return;
        }
        assert!(try_create_file_symlink(
            &escaped_html,
            &repo_real.join("docs/escaped.html"),
        ));
        assert!(try_create_file_symlink(
            &repo_real.join(".git/internal.html"),
            &repo_real.join("docs/git-linked.html"),
        ));

        let alias_reader = DocumentReader::new(&repo_alias, &["docs".to_owned()]).unwrap();
        let regular = alias_reader.read_document("docs/regular.md").unwrap();
        assert_eq!(regular.html_sync_status, HtmlSyncStatus::InSync);
        let companion = regular
            .companion_html
            .expect("canonicalized root companion html");
        assert_eq!(companion.path, "docs/regular.html");
        assert!(companion.html.contains("body { color: #171923; }"));
        assert_eq!(
            alias_reader
                .read_document("docs/escaped.md")
                .unwrap()
                .html_sync_status,
            HtmlSyncStatus::Missing
        );
        assert_eq!(
            alias_reader
                .read_document("docs/git-linked.md")
                .unwrap()
                .html_sync_status,
            HtmlSyncStatus::Missing
        );

        let uncanonical_reader = DocumentReader {
            repository_root: repo_alias.clone(),
            document_roots: vec![repo_real.join("docs")],
        };
        let (uncanon_companion, uncanon_status) = uncanonical_reader.load_companion_html(
            &repo_alias.join("docs/regular.md"),
            "regular.md",
            0,
        );
        assert_eq!(uncanon_status, HtmlSyncStatus::InSync);
        let uncanon_companion =
            uncanon_companion.expect("load_companion_html handles symlink root");
        assert_eq!(uncanon_companion.path, "docs/regular.html");
        assert!(uncanon_companion.html.contains("body { color: #171923; }"));
        assert_eq!(
            uncanonical_reader
                .load_companion_html(&repo_alias.join("docs/escaped.md"), "escaped.md", 0)
                .1,
            HtmlSyncStatus::Missing
        );
        assert_eq!(
            uncanonical_reader
                .load_companion_html(&repo_alias.join("docs/git-linked.md"), "git-linked.md", 0)
                .1,
            HtmlSyncStatus::Missing
        );
    }

    #[test]
    fn companion_html_inlines_safe_local_images_and_skips_escaped_or_git_images() {
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.svg"), "<svg>secret</svg>").unwrap();
        let repo = fixture_repo(&[
            (
                "docs/domains/dashboard/assets/mock.svg",
                "<svg><rect width=\"10\" height=\"10\"/></svg>",
            ),
            ("docs/domains/dashboard/spec.md", "# Spec"),
            (
                "docs/domains/dashboard/spec.html",
                r#"<html><body><img src="assets/mock.svg" alt="Mock" /><img src="../../../outside.svg" alt="Escaped" /><img src="https://example.com/ext.png" alt="Ext" /></body></html>"#,
            ),
        ]);

        let reader = reader(&repo);
        let doc = reader
            .read_document("docs/domains/dashboard/spec.md")
            .unwrap();
        let html = doc.companion_html.unwrap().html;
        assert!(html.contains("data:image/svg+xml;base64,"));
        assert!(html.contains(r#"src="../../../outside.svg""#));
        assert!(html.contains(r#"src="https://example.com/ext.png""#));
    }

    #[cfg(unix)]
    fn try_create_file_symlink(original: &std::path::Path, link: &std::path::Path) -> bool {
        std::os::unix::fs::symlink(original, link).unwrap();
        true
    }

    #[cfg(windows)]
    fn try_create_file_symlink(original: &std::path::Path, link: &std::path::Path) -> bool {
        match std::os::windows::fs::symlink_file(original, link) {
            Ok(()) => true,
            Err(error) if error.raw_os_error() == Some(1314) => false,
            Err(error) => panic!("unexpected windows symlink failure: {error}"),
        }
    }

    #[cfg(unix)]
    fn try_create_dir_symlink(original: &std::path::Path, link: &std::path::Path) -> bool {
        std::os::unix::fs::symlink(original, link).unwrap();
        true
    }

    #[cfg(windows)]
    fn try_create_dir_symlink(original: &std::path::Path, link: &std::path::Path) -> bool {
        match std::os::windows::fs::symlink_dir(original, link) {
            Ok(()) => true,
            Err(error) if error.raw_os_error() == Some(1314) => false,
            Err(error) => panic!("unexpected windows dir symlink failure: {error}"),
        }
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

    #[test]
    fn inline_local_images_skips_uppercase_remote_and_data_schemes() {
        let repo = fixture_repo(&[
            ("docs/spec.md", "# Spec"),
            (
                "docs/spec.html",
                r#"<img src="HTTP://example.com/a.svg" alt="remote" /><img src="DATA:image/png;base64,AAA" alt="data" />"#,
            ),
        ]);
        let reader = reader(&repo);
        let doc = reader.read_document("docs/spec.md").unwrap();
        let html = doc.companion_html.unwrap();
        assert!(html.html.contains(r#"src="HTTP://example.com/a.svg""#));
        assert!(html.html.contains(r#"src="DATA:image/png;base64,AAA""#));
    }

    #[test]
    fn html_attr_helpers_respect_attribute_name_boundaries() {
        let tag = r#"<img data-src="lazy.png" alt='a src=x' src="real.png">"#;
        assert_eq!(extract_html_attr(tag, "src"), Some("real.png"));
        assert_eq!(
            replace_html_attr_value(tag, "src", "data:image/png;base64,AAA").as_deref(),
            Some(r#"<img data-src="lazy.png" alt='a src=x' src="data:image/png;base64,AAA">"#)
        );

        let unquoted = "<IMG Data-Src=lazy.png SRC = real.png/>";
        assert_eq!(extract_html_attr(unquoted, "src"), Some("real.png"));
        assert_eq!(
            replace_html_attr_value(unquoted, "src", "x").as_deref(),
            Some("<IMG Data-Src=lazy.png SRC = x/>")
        );

        assert_eq!(
            extract_html_attr("<img src=img/a.png>", "src"),
            Some("img/a.png")
        );
        assert_eq!(
            extract_html_attr(r#"<img data-src="only.png">"#, "src"),
            None
        );
        assert_eq!(
            replace_html_attr_value(r#"<img data-src="only.png">"#, "src", "x"),
            None
        );
        assert_eq!(
            extract_html_attr(
                r#"<link data-rel="icon" rel="stylesheet" href="a.css">"#,
                "rel"
            ),
            Some("stylesheet")
        );
    }

    #[test]
    fn inline_local_images_keeps_data_src_when_inlining_src() {
        let repo = fixture_repo(&[
            ("docs/spec.md", "# Spec"),
            (
                "docs/real.svg",
                "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            ),
            (
                "docs/spec.html",
                r#"<img data-src="lazy.svg" src="real.svg" alt="screen" />"#,
            ),
        ]);
        let reader = reader(&repo);
        let doc = reader.read_document("docs/spec.md").unwrap();
        let html = doc.companion_html.unwrap().html;
        assert!(html.contains(r#"data-src="lazy.svg""#), "{html}");
        assert!(
            html.contains(r#"src="data:image/svg+xml;base64,"#),
            "{html}"
        );
    }

    #[test]
    fn read_document_drops_fallback_description_for_unterminated_frontmatter() {
        let repo = fixture_repo(&[
            (
                "docs/unterminated.md",
                "---\ntitle: [broken frontmatter value\n## 남은 제목\n",
            ),
            (
                "docs/plain.md",
                "# 제목\n\n프론트매터 없는 문서의 첫 문단입니다\n",
            ),
        ]);
        let reader = reader(&repo);

        let unterminated = reader.read_document("docs/unterminated.md").unwrap();
        assert_eq!(unterminated.summary.description, None);
        assert!(unterminated
            .summary
            .preview_headings
            .iter()
            .any(|heading| heading == "남은 제목"));

        // Documents without frontmatter keep their first-paragraph description.
        let plain = reader.read_document("docs/plain.md").unwrap();
        assert_eq!(
            plain.summary.description.as_deref(),
            Some("프론트매터 없는 문서의 첫 문단입니다")
        );
    }
}
