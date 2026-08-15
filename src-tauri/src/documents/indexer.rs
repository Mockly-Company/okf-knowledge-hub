use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::cache::IndexedContent;
use super::contract::{DocumentCatalog, DocumentSummary, DocumentTreeEntry};
use super::runtime::{DocumentSource, DocumentWorkspace};

const MAX_CONCURRENT_BODY_READS: usize = 4;

pub(crate) struct BodyRead {
    pub summary: DocumentSummary,
    pub result: Result<Vec<u8>, AppError>,
    _permit: OwnedSemaphorePermit,
}

#[derive(Clone)]
pub(crate) struct BodyReadCoordinator {
    permits: Arc<Semaphore>,
}

impl Default for BodyReadCoordinator {
    fn default() -> Self {
        Self {
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_BODY_READS)),
        }
    }
}

impl BodyReadCoordinator {
    pub(crate) async fn read_changed(
        &self,
        source: Arc<dyn DocumentSource>,
        workspace: DocumentWorkspace,
        documents: Vec<DocumentSummary>,
    ) -> Vec<Result<IndexedContent, AppError>> {
        let mut reads =
            self.spawn_body_reads(source, workspace, documents, CancellationToken::new());
        let mut contents = Vec::new();
        while let Some(read) = reads.recv().await {
            contents.push(read.result.map(|markdown| IndexedContent {
                summary: read.summary,
                markdown,
            }));
        }
        contents
    }

    pub(crate) fn spawn_body_reads(
        &self,
        source: Arc<dyn DocumentSource>,
        workspace: DocumentWorkspace,
        documents: Vec<DocumentSummary>,
        cancellation: CancellationToken,
    ) -> mpsc::Receiver<BodyRead> {
        let (sender, receiver) = mpsc::channel(MAX_CONCURRENT_BODY_READS);
        let worker_count = documents.len().min(MAX_CONCURRENT_BODY_READS);
        let documents = Arc::new(Mutex::new(VecDeque::from(documents)));

        for _ in 0..worker_count {
            let source = source.clone();
            let workspace = workspace.clone();
            let cancellation = cancellation.clone();
            let permits = self.permits.clone();
            let documents = documents.clone();
            let sender = sender.clone();
            tokio::spawn(async move {
                loop {
                    let summary = {
                        documents
                            .lock()
                            .expect("document body queue poisoned")
                            .pop_front()
                    };
                    let Some(summary) = summary else {
                        return;
                    };
                    let permit = tokio::select! {
                        _ = cancellation.cancelled() => return,
                        permit = permits.clone().acquire_owned() => match permit {
                            Ok(permit) => permit,
                            Err(_) => return,
                        },
                    };
                    let result = tokio::select! {
                        _ = cancellation.cancelled() => return,
                        result = source.read_body(&workspace, &summary.path) => result,
                    };
                    let read = BodyRead {
                        summary,
                        result,
                        _permit: permit,
                    };
                    let sent = tokio::select! {
                        _ = cancellation.cancelled() => return,
                        sent = sender.send(read) => sent,
                    };
                    if sent.is_err() {
                        return;
                    }
                }
            });
        }
        drop(sender);
        receiver
    }
}

pub(crate) fn catalog_from_summaries(
    roots: &[String],
    documents: Vec<DocumentSummary>,
) -> DocumentCatalog {
    let normalized_roots = roots
        .iter()
        .filter_map(|root| {
            let components = normalize_relative_components(root)?;
            if components
                .iter()
                .any(|component| component.eq_ignore_ascii_case(".git"))
            {
                return None;
            }
            let path = components.join("/");
            let name = components.last().cloned().unwrap_or_else(|| ".".to_owned());
            Some((components, path, name))
        })
        .collect::<Vec<_>>();
    let mut seen_paths = HashSet::new();
    let mut documents = documents
        .into_iter()
        .filter_map(|mut document| {
            let components = normalize_relative_components(&document.path)?;
            if components.is_empty()
                || components
                    .iter()
                    .any(|component| component.eq_ignore_ascii_case(".git"))
                || !components.last().is_some_and(|file_name| {
                    file_name
                        .rsplit_once('.')
                        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("md"))
                })
                || !normalized_roots
                    .iter()
                    .any(|(root, _, _)| components_start_with(&components, root))
            {
                return None;
            }
            document.path = components.join("/");
            seen_paths.insert(document.path.clone()).then_some(document)
        })
        .collect::<Vec<_>>();
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let mut assigned = HashSet::new();
    let mut tree_roots = normalized_roots
        .iter()
        .map(|(root, portable_root, name)| {
            let mut node = FolderNode::new(name.clone(), portable_root.clone());
            for document in &documents {
                if assigned.contains(&document.path) {
                    continue;
                }
                let document_components = document.path.split('/').collect::<Vec<_>>();
                if document_components.len() <= root.len()
                    || !document_components
                        .iter()
                        .zip(root)
                        .all(|(document, root)| *document == root)
                {
                    continue;
                }
                let relative = document_components[root.len()..].join("/");
                node.insert(&relative, document.clone());
                assigned.insert(document.path.clone());
            }
            node.into_entry()
        })
        .collect::<Vec<_>>();
    tree_roots.sort_by(compare_tree_entries);
    DocumentCatalog {
        documents,
        roots: tree_roots,
    }
}

fn normalize_relative_components(path: &str) -> Option<Vec<String>> {
    let portable = path.replace('\\', "/");
    let bytes = portable.as_bytes();
    if portable.starts_with('/')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return None;
    }
    let mut components = Vec::new();
    for component in portable.split('/') {
        match component {
            "" | "." => {}
            ".." => return None,
            component => components.push(component.to_owned()),
        }
    }
    Some(components)
}

fn components_start_with(path: &[String], root: &[String]) -> bool {
    path.len() >= root.len() && path.iter().zip(root).all(|(path, root)| path == root)
}

struct FolderNode {
    name: String,
    path: String,
    folders: BTreeMap<String, FolderNode>,
    documents: Vec<DocumentSummary>,
}

impl FolderNode {
    fn new(name: String, path: String) -> Self {
        Self {
            name,
            path,
            folders: BTreeMap::new(),
            documents: Vec::new(),
        }
    }

    fn insert(&mut self, relative: &str, document: DocumentSummary) {
        let mut components = relative.split('/').collect::<Vec<_>>();
        if components.len() <= 1 {
            self.documents.push(document);
            return;
        }
        let first = components.remove(0);
        let child_path = format!("{}/{}", self.path, first);
        self.folders
            .entry(first.to_owned())
            .or_insert_with(|| FolderNode::new(first.to_owned(), child_path))
            .insert(&components.join("/"), document);
    }

    fn into_entry(self) -> DocumentTreeEntry {
        let mut children = self
            .folders
            .into_values()
            .map(FolderNode::into_entry)
            .collect::<Vec<_>>();
        children.sort_by(compare_tree_entries);
        let mut documents = self.documents;
        documents.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
                .then_with(|| left.path.cmp(&right.path))
        });
        children.extend(
            documents
                .into_iter()
                .map(|summary| DocumentTreeEntry::Document { summary }),
        );
        DocumentTreeEntry::Folder {
            name: self.name,
            path: self.path,
            children,
        }
    }
}

fn tree_path(entry: &DocumentTreeEntry) -> &str {
    match entry {
        DocumentTreeEntry::Folder { path, .. } => path,
        DocumentTreeEntry::Document { summary } => &summary.path,
    }
}

fn compare_tree_entries(left: &DocumentTreeEntry, right: &DocumentTreeEntry) -> std::cmp::Ordering {
    tree_name(left)
        .to_lowercase()
        .cmp(&tree_name(right).to_lowercase())
        .then_with(|| tree_path(left).cmp(tree_path(right)))
}

fn tree_name(entry: &DocumentTreeEntry) -> &str {
    match entry {
        DocumentTreeEntry::Folder { name, .. } => name,
        DocumentTreeEntry::Document { summary } => &summary.title,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use async_trait::async_trait;
    use tempfile::TempDir;
    use tokio::sync::{Notify, Semaphore};
    use tokio_util::sync::CancellationToken;

    use crate::documents::contract::{
        DocumentCatalog, DocumentSummary, DocumentTreeEntry, FrontmatterStatus,
    };
    use crate::documents::runtime::{DocumentSource, DocumentWorkspace};
    use crate::error::{AppError, ErrorCode};

    use super::{catalog_from_summaries, tree_path, BodyReadCoordinator};

    #[derive(Clone)]
    struct CountingDocumentSource {
        documents: Arc<std::collections::HashMap<String, Vec<u8>>>,
        read_paths: Arc<Mutex<Vec<String>>>,
    }

    impl CountingDocumentSource {
        fn with_documents<const N: usize>(documents: [(&str, &[u8]); N]) -> Self {
            Self {
                documents: Arc::new(
                    documents
                        .into_iter()
                        .map(|(path, body)| (path.to_owned(), body.to_vec()))
                        .collect(),
                ),
                read_paths: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn read_paths(&self) -> Vec<String> {
            self.read_paths.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl DocumentSource for CountingDocumentSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            unreachable!()
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            self.read_paths.lock().unwrap().push(path.to_owned());
            self.documents.get(path).cloned().ok_or_else(|| {
                AppError::new(
                    ErrorCode::DocumentIndexUnavailable,
                    format!("missing test document: {path}"),
                )
            })
        }
    }

    #[tokio::test]
    async fn indexer_reads_only_metadata_changed_documents() {
        let source = CountingDocumentSource::with_documents([
            ("docs/same.md", b"same".as_slice()),
            ("docs/changed.md", b"changed".as_slice()),
        ]);
        let candidates = vec![summary("docs/changed.md")];
        let contents = BodyReadCoordinator::default()
            .read_changed(Arc::new(source.clone()), workspace(), candidates)
            .await;

        assert_eq!(contents.len(), 1);
        assert_eq!(source.read_paths(), vec!["docs/changed.md"]);
    }

    struct ConcurrencySource {
        active: AtomicUsize,
        maximum: AtomicUsize,
        total_started: AtomicUsize,
        started: Notify,
        release: Semaphore,
    }

    #[async_trait]
    impl DocumentSource for ConcurrencySource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            unreachable!()
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            self.total_started.fetch_add(1, Ordering::SeqCst);
            self.started.notify_waiters();
            self.release.acquire().await.unwrap().forget();
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(path.as_bytes().to_vec())
        }
    }

    #[tokio::test]
    async fn body_reads_are_bounded_to_four_concurrent_operations() {
        let source = Arc::new(ConcurrencySource {
            active: AtomicUsize::new(0),
            maximum: AtomicUsize::new(0),
            total_started: AtomicUsize::new(0),
            started: Notify::new(),
            release: Semaphore::new(0),
        });
        let temp = TempDir::new().unwrap();
        let workspace = DocumentWorkspace {
            workspace_id: uuid::Uuid::new_v4(),
            repository_root: temp.path().join("repository"),
            document_roots: vec!["docs".to_owned()],
            cache_path: temp.path().join("search.sqlite3"),
        };
        let documents = (0..6)
            .map(|index| summary(&format!("docs/{index}.md")))
            .collect::<Vec<_>>();
        let mut reads = BodyReadCoordinator::default().spawn_body_reads(
            source.clone(),
            workspace,
            documents,
            CancellationToken::new(),
        );

        tokio::time::timeout(Duration::from_secs(2), async {
            while source.maximum.load(Ordering::SeqCst) < 4 {
                source.started.notified().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(source.maximum.load(Ordering::SeqCst), 4);
        source.release.add_permits(6);

        let completed = Arc::new(Mutex::new(Vec::new()));
        while let Some(read) = reads.recv().await {
            completed.lock().unwrap().push(read.summary.path);
        }
        assert_eq!(completed.lock().unwrap().len(), 6);
        assert!(source.maximum.load(Ordering::SeqCst) <= 4);
    }

    #[tokio::test]
    async fn overlapping_generations_share_one_four_read_budget() {
        let source = Arc::new(ConcurrencySource {
            active: AtomicUsize::new(0),
            maximum: AtomicUsize::new(0),
            total_started: AtomicUsize::new(0),
            started: Notify::new(),
            release: Semaphore::new(0),
        });
        let temp = TempDir::new().unwrap();
        let workspace = DocumentWorkspace {
            workspace_id: uuid::Uuid::new_v4(),
            repository_root: temp.path().join("repository"),
            document_roots: vec!["docs".to_owned()],
            cache_path: temp.path().join("search.sqlite3"),
        };
        let first_documents = (0..8)
            .map(|index| summary(&format!("docs/first-{index}.md")))
            .collect::<Vec<_>>();
        let second_documents = (0..8)
            .map(|index| summary(&format!("docs/second-{index}.md")))
            .collect::<Vec<_>>();
        let coordinator = BodyReadCoordinator::default();
        let first_reads = coordinator.spawn_body_reads(
            source.clone(),
            workspace.clone(),
            first_documents,
            CancellationToken::new(),
        );
        let second_reads = coordinator.spawn_body_reads(
            source.clone(),
            workspace,
            second_documents,
            CancellationToken::new(),
        );

        tokio::time::timeout(Duration::from_secs(2), async {
            while source.total_started.load(Ordering::SeqCst) < 4 {
                tokio::task::yield_now().await;
            }
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(source.maximum.load(Ordering::SeqCst), 4);

        drop(first_reads);
        drop(second_reads);
        source.release.add_permits(16);
    }

    struct ImmediateSource {
        total_started: AtomicUsize,
    }

    #[async_trait]
    impl DocumentSource for ImmediateSource {
        fn discover(&self, _workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
            unreachable!()
        }

        async fn read_body(
            &self,
            _workspace: &DocumentWorkspace,
            path: &str,
        ) -> Result<Vec<u8>, AppError> {
            self.total_started.fetch_add(1, Ordering::SeqCst);
            Ok(path.as_bytes().to_vec())
        }
    }

    #[tokio::test]
    async fn unconsumed_bodies_backpressure_a_large_catalog_at_the_read_window() {
        let source = Arc::new(ImmediateSource {
            total_started: AtomicUsize::new(0),
        });
        let temp = TempDir::new().unwrap();
        let workspace = DocumentWorkspace {
            workspace_id: uuid::Uuid::new_v4(),
            repository_root: temp.path().join("repository"),
            document_roots: vec!["docs".to_owned()],
            cache_path: temp.path().join("search.sqlite3"),
        };
        let documents = (0..100)
            .map(|index| summary(&format!("docs/{index}.md")))
            .collect::<Vec<_>>();
        let mut reads = BodyReadCoordinator::default().spawn_body_reads(
            source.clone(),
            workspace,
            documents,
            CancellationToken::new(),
        );

        tokio::time::timeout(Duration::from_secs(2), async {
            while source.total_started.load(Ordering::SeqCst) < 4 {
                tokio::task::yield_now().await;
            }
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(source.total_started.load(Ordering::SeqCst), 4);

        drop(reads.recv().await.unwrap());
        tokio::time::timeout(Duration::from_secs(2), async {
            while source.total_started.load(Ordering::SeqCst) < 5 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(source.total_started.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn cached_catalog_matches_cold_tree_order_and_assigns_overlapping_roots_once() {
        let catalog = catalog_from_summaries(
            &["docs".to_owned(), "docs/alpha".to_owned()],
            vec![
                summary("docs/Zoo/z.md"),
                summary("docs/alpha/a.md"),
                summary("docs/readme.md"),
            ],
        );

        assert_eq!(
            catalog.roots.iter().map(tree_path).collect::<Vec<_>>(),
            ["docs/alpha", "docs"]
        );
        let DocumentTreeEntry::Folder { children, .. } = catalog
            .roots
            .iter()
            .find(|entry| tree_path(entry) == "docs")
            .unwrap()
        else {
            panic!();
        };
        assert!(matches!(
            &children[0],
            DocumentTreeEntry::Folder { name, .. } if name == "alpha"
        ));
        assert!(matches!(
            &children[1],
            DocumentTreeEntry::Folder { name, .. } if name == "Zoo"
        ));
        let DocumentTreeEntry::Folder {
            children: overlapping,
            ..
        } = catalog
            .roots
            .iter()
            .find(|entry| tree_path(entry) == "docs/alpha")
            .unwrap()
        else {
            panic!();
        };
        assert!(overlapping.is_empty());
    }

    #[test]
    fn cached_catalog_filters_to_normalized_roots_and_excludes_git() {
        let catalog = catalog_from_summaries(
            &[
                "./docs".to_owned(),
                "docs/alpha".to_owned(),
                ".git".to_owned(),
            ],
            vec![
                summary("docs/readme.md"),
                summary("docs/alpha/a.md"),
                summary("docs/.git/hidden.md"),
                summary(".git/internal.md"),
                summary("docs2/prefix.md"),
                summary("legacy/old.md"),
            ],
        );

        assert_eq!(
            catalog
                .documents
                .iter()
                .map(|document| document.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/alpha/a.md", "docs/readme.md"]
        );
        assert_eq!(
            catalog.roots.iter().map(tree_path).collect::<Vec<_>>(),
            ["docs/alpha", "docs"]
        );
        let DocumentTreeEntry::Folder { children, .. } = catalog
            .roots
            .iter()
            .find(|entry| tree_path(entry) == "docs")
            .unwrap()
        else {
            panic!();
        };
        assert_eq!(
            document_paths(children),
            ["docs/alpha/a.md", "docs/readme.md"]
        );
        let DocumentTreeEntry::Folder {
            children: overlapping,
            ..
        } = catalog
            .roots
            .iter()
            .find(|entry| tree_path(entry) == "docs/alpha")
            .unwrap()
        else {
            panic!();
        };
        assert!(overlapping.is_empty());
    }

    fn document_paths(entries: &[DocumentTreeEntry]) -> Vec<&str> {
        let mut paths = Vec::new();
        for entry in entries {
            match entry {
                DocumentTreeEntry::Folder { children, .. } => {
                    paths.extend(document_paths(children));
                }
                DocumentTreeEntry::Document { summary } => paths.push(summary.path.as_str()),
            }
        }
        paths
    }

    fn summary(path: &str) -> DocumentSummary {
        DocumentSummary {
            path: path.to_owned(),
            file_name: path.rsplit('/').next().unwrap().to_owned(),
            title: path.to_owned(),
            document_id: None,
            frontmatter_status: FrontmatterStatus::Missing,
            modified_at_unix_ms: 1,
            size: 1,
        }
    }

    fn workspace() -> DocumentWorkspace {
        let temp = TempDir::new().unwrap();
        DocumentWorkspace {
            workspace_id: uuid::Uuid::new_v4(),
            repository_root: temp.path().join("repository"),
            document_roots: vec!["docs".to_owned()],
            cache_path: temp.path().join("search.sqlite3"),
        }
    }
}
