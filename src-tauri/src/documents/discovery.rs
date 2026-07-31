use std::cmp::Ordering;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::io::BufReader;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::error::{AppError, ErrorCode};

use super::contract::{DocumentCatalog, DocumentSummary, DocumentTreeEntry};
use super::frontmatter::parse_document_reader;

pub fn discover_documents(
    repository_root: &Path,
    roots: &[String],
) -> Result<DocumentCatalog, AppError> {
    let repository_root = repository_root.canonicalize().map_err(|error| {
        document_path_error(
            repository_root,
            format!("repository cannot be read: {error}"),
        )
    })?;
    let mut documents = Vec::new();
    let mut seen_documents = HashSet::new();
    let mut tree_roots = Vec::new();

    for root in roots {
        if contains_git_component(root) {
            continue;
        }
        let root_path = resolve_root(&repository_root, root)?;
        let tree = discover_directory(
            &repository_root,
            &root_path,
            &mut documents,
            &mut seen_documents,
        )?;
        tree_roots.push(tree);
    }

    documents
        .sort_by(|left, right| compare_display(&left.path, &left.path, &right.path, &right.path));
    tree_roots.sort_by(compare_tree_entries);
    Ok(DocumentCatalog {
        documents,
        roots: tree_roots,
    })
}

fn resolve_root(repository_root: &Path, configured_root: &str) -> Result<PathBuf, AppError> {
    let normalized = configured_root.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.trim().is_empty()
        || path.is_absolute()
        || has_windows_drive_prefix(&normalized)
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(document_path_error(
            Path::new(configured_root),
            "configured document root escapes the repository",
        ));
    }

    let root_path = repository_root.join(path);
    let canonical_root = root_path.canonicalize().map_err(|error| {
        document_path_error(&root_path, format!("document root cannot be read: {error}"))
    })?;
    if !canonical_root.starts_with(repository_root)
        || !fs::metadata(&canonical_root)
            .map_err(|error| document_path_error(&canonical_root, error.to_string()))?
            .is_dir()
    {
        return Err(document_path_error(
            &root_path,
            "configured document root must be a directory inside the repository",
        ));
    }
    Ok(canonical_root)
}

fn discover_directory(
    repository_root: &Path,
    directory: &Path,
    documents: &mut Vec<DocumentSummary>,
    seen_documents: &mut HashSet<PathBuf>,
) -> Result<DocumentTreeEntry, AppError> {
    let mut children = Vec::new();
    let entries = fs::read_dir(directory)
        .map_err(|error| document_path_error(directory, error.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| document_path_error(directory, error.to_string()))?;

    for entry in entries {
        if entry.file_name() == OsStr::new(".git") {
            continue;
        }
        let path = entry.path();
        let canonical_path = path
            .canonicalize()
            .map_err(|error| document_path_error(&path, error.to_string()))?;
        if !canonical_path.starts_with(repository_root) {
            continue;
        }
        let metadata = fs::metadata(&canonical_path)
            .map_err(|error| document_path_error(&canonical_path, error.to_string()))?;

        if metadata.is_dir() {
            children.push(discover_directory(
                repository_root,
                &canonical_path,
                documents,
                seen_documents,
            )?);
        } else if metadata.is_file() && is_markdown(&canonical_path) {
            let summary = summarize_document(repository_root, &canonical_path, metadata)?;
            if seen_documents.insert(canonical_path) {
                documents.push(summary.clone());
                children.push(DocumentTreeEntry::Document { summary });
            }
        }
    }

    children.sort_by(compare_tree_entries);
    Ok(DocumentTreeEntry::Folder {
        name: directory
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_owned(),
        path: portable_path(repository_root, directory),
        children,
    })
}

fn summarize_document(
    repository_root: &Path,
    path: &Path,
    metadata: fs::Metadata,
) -> Result<DocumentSummary, AppError> {
    let file =
        fs::File::open(path).map_err(|error| document_path_error(path, error.to_string()))?;
    let file_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_owned();
    let parsed = parse_document_reader(&mut BufReader::new(file), &file_name);
    let modified_at_unix_ms = match metadata.modified() {
        Ok(modified) => match modified.duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis().min(i64::MAX as u128) as i64,
            Err(error) => -(error.duration().as_millis().min(i64::MAX as u128) as i64),
        },
        Err(_) => 0,
    };

    Ok(DocumentSummary {
        path: portable_path(repository_root, path),
        file_name,
        title: parsed.title,
        document_id: parsed.document_id,
        frontmatter_status: parsed.frontmatter_status,
        modified_at_unix_ms,
        size: metadata.len(),
    })
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn portable_path(repository_root: &Path, path: &Path) -> String {
    path.strip_prefix(repository_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn compare_tree_entries(left: &DocumentTreeEntry, right: &DocumentTreeEntry) -> Ordering {
    let (left_folder, left_name, left_path) = tree_sort_fields(left);
    let (right_folder, right_name, right_path) = tree_sort_fields(right);
    right_folder
        .cmp(&left_folder)
        .then_with(|| compare_display(left_name, left_path, right_name, right_path))
}

fn tree_sort_fields(entry: &DocumentTreeEntry) -> (bool, &str, &str) {
    match entry {
        DocumentTreeEntry::Folder { name, path, .. } => (true, name, path),
        DocumentTreeEntry::Document { summary } => (false, &summary.file_name, &summary.path),
    }
}

fn compare_display(
    left_name: &str,
    left_path: &str,
    right_name: &str,
    right_path: &str,
) -> Ordering {
    left_name
        .to_lowercase()
        .cmp(&right_name.to_lowercase())
        .then_with(|| left_path.cmp(right_path))
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn contains_git_component(path: &str) -> bool {
    path.replace('\\', "/")
        .split('/')
        .any(|component| component == ".git")
}

fn document_path_error(path: &Path, reason: impl Into<String>) -> AppError {
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
    use std::io::{BufRead, Read};

    use tempfile::TempDir;

    use crate::documents::contract::{DocumentTreeEntry, FrontmatterStatus};
    use crate::documents::discovery::discover_documents;
    use crate::documents::frontmatter::parse_document_reader;
    use crate::error::ErrorCode;

    #[test]
    fn discovery_includes_only_markdown_below_configured_roots() {
        let repo = fixture_repo(&[
            ("docs/api.md", "---\ntitle: API\n---\n"),
            ("docs/data.json", "{}"),
            ("outside/ignored.md", "# ignored"),
        ]);
        let catalog = discover_documents(repo.path(), &["docs".into()]).unwrap();
        assert_eq!(
            catalog
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/api.md"]
        );
    }

    #[test]
    fn discovery_rejects_a_root_that_escapes_the_repository() {
        let repo = fixture_repo(&[]);
        let error = discover_documents(repo.path(), &["../outside".into()]).unwrap_err();
        assert_eq!(error.code, ErrorCode::DocumentPathInvalid);
    }

    #[test]
    fn discovery_skips_git_entries_and_orders_folders_before_documents() {
        let repo = fixture_repo(&[
            ("docs/zeta/last.MD", "# last"),
            ("docs/Alpha/first.md", "# first"),
            ("docs/readme.md", "# readme"),
            ("docs/.git/internal.md", "# internal"),
        ]);

        let catalog = discover_documents(repo.path(), &["docs".into()]).unwrap();
        assert_eq!(
            catalog
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/Alpha/first.md", "docs/readme.md", "docs/zeta/last.MD"]
        );
        let DocumentTreeEntry::Folder { children, .. } = &catalog.roots[0] else {
            panic!();
        };
        assert!(
            matches!(children[0], DocumentTreeEntry::Folder { ref name, .. } if name == "Alpha")
        );
        assert!(
            matches!(children[1], DocumentTreeEntry::Folder { ref name, .. } if name == "zeta")
        );
        assert!(matches!(children[2], DocumentTreeEntry::Document { .. }));
    }

    #[test]
    fn discovery_skips_a_configured_git_directory() {
        let repo = fixture_repo(&[(".git/internal.md", "# internal")]);

        let catalog = discover_documents(repo.path(), &[".git".into()]).unwrap();

        assert!(catalog.documents.is_empty());
        assert!(catalog.roots.is_empty());
    }

    #[test]
    fn frontmatter_reader_stops_after_the_closing_delimiter() {
        let mut source = b"---\ntitle: Small header\n---\n".to_vec();
        source.extend(std::iter::repeat_n(b'x', 10 * 1024 * 1024));
        let header_bytes = source.len() - 10 * 1024 * 1024;
        let mut reader = SpyReader::new(source);

        let metadata = parse_document_reader(&mut reader, "large.md");

        assert_eq!(metadata.title, "Small header");
        assert_eq!(metadata.frontmatter_status, FrontmatterStatus::Valid);
        assert_eq!(reader.bytes_consumed, header_bytes);
    }

    fn fixture_repo(files: &[(&str, &str)]) -> TempDir {
        let repo = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let path = repo.path().join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        repo
    }

    struct SpyReader {
        inner: std::io::Cursor<Vec<u8>>,
        bytes_consumed: usize,
    }

    impl SpyReader {
        fn new(source: Vec<u8>) -> Self {
            Self {
                inner: std::io::Cursor::new(source),
                bytes_consumed: 0,
            }
        }
    }

    impl Read for SpyReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.inner.read(buffer)
        }
    }

    impl BufRead for SpyReader {
        fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
            self.inner.fill_buf()
        }

        fn consume(&mut self, amount: usize) {
            self.bytes_consumed += amount;
            self.inner.consume(amount);
        }
    }
}
