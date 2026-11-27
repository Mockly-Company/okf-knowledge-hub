use std::path::PathBuf;

use super::{
    contract::{DocumentCatalog, DocumentContent, DocumentSummary, DocumentTreeEntry},
    reader::DocumentReader,
    runtime::DocumentWorkspace,
};
use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone)]
pub struct DocumentRepositoryWorkspace {
    pub full_name: String,
    pub repository_root: PathBuf,
    pub document_roots: Vec<String>,
    pub excluded_paths: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedDocumentPath {
    pub repository_root: PathBuf,
    pub document_roots: Vec<String>,
    pub excluded_paths: Vec<String>,
    pub path: String,
    pub prefix: String,
}

impl ResolvedDocumentPath {
    pub fn excludes(&self, path: &str) -> bool {
        use crate::workspace::model::document_scopes::{normalized_path, within};
        let Some(path) = normalized_path(path) else {
            return true;
        };
        self.excluded_paths.iter().any(|excluded| {
            normalized_path(excluded).is_none_or(|excluded| within(&path, &excluded))
        })
    }

    pub fn reader(&self) -> Result<DocumentReader, AppError> {
        DocumentReader::with_exclusions(
            &self.repository_root,
            &self.document_roots,
            &self.excluded_paths,
        )
    }

    pub fn qualify_content(&self, mut content: DocumentContent) -> DocumentContent {
        content.summary.path = format!("{}{}", self.prefix, content.summary.path);
        if let Some(html) = content.companion_html.as_mut() {
            html.path = format!("{}{}", self.prefix, html.path);
        }
        content
    }
}

impl DocumentWorkspace {
    pub fn ensure_current_configuration(&self) -> Result<(), AppError> {
        if let Some((path, fingerprint)) = &self.source_config {
            let current = std::fs::read(path)
                .ok()
                .map(|bytes| configuration_fingerprint(&bytes));
            if current.as_deref() != Some(fingerprint) {
                return Err(AppError::new(
                    ErrorCode::DocumentSessionStale,
                    "공유 문서 범위가 변경되었습니다. 문서 세션을 다시 여세요.",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn scope_fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let definition = format!(
            "{:?}|{:?}|{:?}|{:?}",
            self.repository_root,
            self.document_roots,
            self.excluded_paths,
            self.additional_repositories
        );
        format!("{:x}", Sha256::digest(definition.as_bytes()))
    }

    pub fn resolve_path(&self, path: &str) -> Result<ResolvedDocumentPath, AppError> {
        if path.starts_with("repo:") {
            for repository in &self.additional_repositories {
                let prefix = format!("repo:{}/", repository.full_name);
                if let Some(relative) = path.strip_prefix(&prefix) {
                    return Ok(ResolvedDocumentPath {
                        repository_root: repository.repository_root.clone(),
                        document_roots: repository.document_roots.clone(),
                        excluded_paths: repository.excluded_paths.clone(),
                        path: relative.into(),
                        prefix,
                    });
                }
            }
            return Err(AppError::new(
                ErrorCode::DocumentPathInvalid,
                "등록되지 않은 문서 저장소입니다.",
            ));
        }
        Ok(ResolvedDocumentPath {
            repository_root: self.repository_root.clone(),
            document_roots: self.document_roots.clone(),
            excluded_paths: self.excluded_paths.clone(),
            path: path.into(),
            prefix: String::new(),
        })
    }

    pub(crate) fn cached_catalog(&self, documents: Vec<DocumentSummary>) -> DocumentCatalog {
        let mut catalog = super::indexer::catalog_from_summaries(
            &self.document_roots,
            documents
                .iter()
                .filter(|document| !document.path.starts_with("repo:"))
                .cloned()
                .collect(),
        );
        for repository in &self.additional_repositories {
            let prefix = format!("repo:{}/", repository.full_name);
            let summaries = documents
                .iter()
                .filter_map(|document| {
                    document.path.strip_prefix(&prefix).map(|path| {
                        let mut document = document.clone();
                        document.path = path.into();
                        document
                    })
                })
                .collect();
            let mut additional =
                super::indexer::catalog_from_summaries(&repository.document_roots, summaries);
            for summary in &mut additional.documents {
                summary.path = format!("{prefix}{}", summary.path);
            }
            for root in &mut additional.roots {
                qualify_tree(root, &prefix);
            }
            catalog.documents.extend(additional.documents);
            catalog.roots.push(DocumentTreeEntry::Folder {
                name: repository.full_name.clone(),
                path: prefix.trim_end_matches('/').into(),
                children: additional.roots,
            });
        }
        catalog
    }

    pub(crate) fn allows_cached_path(&self, path: &str) -> bool {
        self.resolve_path(path).ok().is_some_and(|resolved| {
            resolved.reader().ok().is_some_and(|reader| {
                reader.allows_path(&resolved.repository_root.join(&resolved.path))
            })
        })
    }
}

pub(crate) fn configuration_fingerprint(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn qualify_tree(entry: &mut DocumentTreeEntry, prefix: &str) {
    match entry {
        DocumentTreeEntry::Folder { path, children, .. } => {
            *path = format!("{prefix}{path}");
            for child in children {
                qualify_tree(child, prefix);
            }
        }
        DocumentTreeEntry::Document { summary } => {
            summary.path = format!("{prefix}{}", summary.path)
        }
    }
}
