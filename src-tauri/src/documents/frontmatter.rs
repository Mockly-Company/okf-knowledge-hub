use std::io::BufRead;

use serde_yaml_ng::Value;
use uuid::Uuid;

use super::contract::{FrontmatterError, FrontmatterStatus, ParsedDocumentMetadata};

const MAX_UNTERMINATED_FRONTMATTER_BYTES: usize = 256 * 1024;

pub fn parse_document(source: &str, file_name: &str) -> ParsedDocumentMetadata {
    let mut reader = std::io::Cursor::new(source.as_bytes());
    parse_document_reader(&mut reader, file_name)
}

pub(crate) fn parse_document_reader<R: BufRead>(
    reader: &mut R,
    file_name: &str,
) -> ParsedDocumentMetadata {
    let fallback_title = filename_title(file_name);
    match read_frontmatter(reader) {
        FrontmatterRead::Missing => ParsedDocumentMetadata {
            title: fallback_title,
            document_id: None,
            frontmatter_status: FrontmatterStatus::Missing,
        },
        FrontmatterRead::Invalid(error) => ParsedDocumentMetadata {
            title: fallback_title,
            document_id: None,
            frontmatter_status: FrontmatterStatus::Invalid { error },
        },
        FrontmatterRead::Present(source) => parse_frontmatter(&source, fallback_title),
    }
}

fn parse_frontmatter(source: &str, fallback_title: String) -> ParsedDocumentMetadata {
    let value = match serde_yaml_ng::from_str::<Value>(source) {
        Ok(value) => value,
        Err(error) => {
            return ParsedDocumentMetadata {
                title: fallback_title,
                document_id: None,
                frontmatter_status: FrontmatterStatus::Invalid {
                    error: FrontmatterError {
                        line: error.location().map_or(1, |location| location.line()),
                        message: error.to_string(),
                    },
                },
            };
        }
    };

    let title = value
        .get("title")
        .and_then(Value::as_str)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(&fallback_title)
        .to_owned();
    let document_id = value
        .get("okf_hub_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .filter(|id| id.get_version() == Some(uuid::Version::Random));

    ParsedDocumentMetadata {
        title,
        document_id,
        frontmatter_status: FrontmatterStatus::Valid,
    }
}

enum FrontmatterRead {
    Missing,
    Present(String),
    Invalid(FrontmatterError),
}

fn read_frontmatter<R: BufRead>(reader: &mut R) -> FrontmatterRead {
    let Some(first_line) = read_line(reader, None) else {
        return FrontmatterRead::Missing;
    };
    if delimiter(&first_line) != Some("---") {
        return FrontmatterRead::Missing;
    }

    let mut source = String::new();
    loop {
        let Some(line) = read_line(
            reader,
            Some(MAX_UNTERMINATED_FRONTMATTER_BYTES - source.len()),
        ) else {
            return FrontmatterRead::Invalid(FrontmatterError {
                line: source.lines().count() + 2,
                message: "frontmatter closing delimiter is missing".to_owned(),
            });
        };

        if delimiter(&line).is_some_and(|marker| matches!(marker, "---" | "...")) {
            return FrontmatterRead::Present(source);
        }
        source.push_str(&line);

        if source.len() >= MAX_UNTERMINATED_FRONTMATTER_BYTES {
            return FrontmatterRead::Invalid(FrontmatterError {
                line: source.lines().count() + 1,
                message: "frontmatter exceeds 256 KiB without a closing delimiter".to_owned(),
            });
        }
    }
}

fn read_line<R: BufRead>(reader: &mut R, limit: Option<usize>) -> Option<String> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().ok()?;
        if buffer.is_empty() {
            return (!line.is_empty()).then(|| String::from_utf8_lossy(&line).into_owned());
        }

        let remaining = limit.map_or(usize::MAX, |limit| limit.saturating_sub(line.len()));
        if remaining == 0 {
            return Some(String::from_utf8_lossy(&line).into_owned());
        }
        let take = buffer.len().min(remaining);
        let newline = buffer[..take].iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(take, |index| index + 1);
        line.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if newline.is_some() || count == remaining {
            return Some(String::from_utf8_lossy(&line).into_owned());
        }
    }
}

fn delimiter(line: &str) -> Option<&str> {
    Some(
        line.strip_suffix('\n')
            .unwrap_or(line)
            .trim_end_matches('\r'),
    )
}

fn filename_title(file_name: &str) -> String {
    std::path::Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::parse_document;
    use crate::documents::contract::FrontmatterStatus;

    #[test]
    fn frontmatter_title_precedes_filename_and_h1_is_not_a_title_fallback() {
        let metadata = parse_document(
            "---\ntitle: API 계약\nokf_hub_id: 9df970bb-824b-4d26-b582-b34a8f0afc21\n---\n# 다른 H1\n",
            "map-api.md",
        );
        assert_eq!(metadata.title, "API 계약");
        assert_eq!(
            metadata.document_id.unwrap().to_string(),
            "9df970bb-824b-4d26-b582-b34a8f0afc21"
        );

        let fallback = parse_document("# 본문의 H1\n", "map-api.md");
        assert_eq!(fallback.title, "map-api");
        assert_eq!(fallback.frontmatter_status, FrontmatterStatus::Missing);
    }

    #[test]
    fn invalid_frontmatter_keeps_the_document_with_a_located_warning() {
        let metadata = parse_document("---\ntitle: [broken\n---\n본문\n", "broken.md");
        let FrontmatterStatus::Invalid { error } = metadata.frontmatter_status else {
            panic!();
        };
        assert!(error.line >= 1);
        assert!(!error.message.is_empty());
        assert_eq!(metadata.title, "broken");
    }
}
