use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

use super::contract::{DocumentCatalog, DocumentSummary, DocumentTreeEntry};
use super::runtime::{DocumentSource, DocumentWorkspace};

const MAX_CONCURRENT_BODY_READS: usize = 4;

pub(crate) struct BodyRead {
    pub summary: DocumentSummary,
    pub result: Result<Vec<u8>, AppError>,
}

pub(crate) fn spawn_body_reads(
    source: Arc<dyn DocumentSource>,
    workspace: DocumentWorkspace,
    documents: Vec<DocumentSummary>,
    cancellation: CancellationToken,
) -> mpsc::Receiver<BodyRead> {
    let capacity = documents.len().max(1);
    let (sender, receiver) = mpsc::channel(capacity);
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_BODY_READS));

    for summary in documents {
        let source = source.clone();
        let workspace = workspace.clone();
        let cancellation = cancellation.clone();
        let semaphore = semaphore.clone();
        let sender = sender.clone();
        tokio::spawn(async move {
            let permit = tokio::select! {
                _ = cancellation.cancelled() => return,
                permit = semaphore.acquire_owned() => match permit {
                    Ok(permit) => permit,
                    Err(_) => return,
                },
            };
            let result = tokio::select! {
                _ = cancellation.cancelled() => return,
                result = source.read_body(&workspace, &summary.path) => result,
            };
            drop(permit);
            let _ = sender.send(BodyRead { summary, result }).await;
        });
    }
    drop(sender);
    receiver
}

pub(crate) fn catalog_from_summaries(
    roots: &[String],
    mut documents: Vec<DocumentSummary>,
) -> DocumentCatalog {
    documents.sort_by(|left, right| left.path.cmp(&right.path));
    let mut assigned = HashSet::new();
    let mut tree_roots = roots
        .iter()
        .filter_map(|root| {
            let portable_root = root.replace('\\', "/").trim_matches('/').to_owned();
            if portable_root.is_empty() {
                return None;
            }
            let mut node = FolderNode::new(
                Path::new(&portable_root)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_owned(),
                portable_root.clone(),
            );
            for document in &documents {
                if assigned.contains(&document.path) {
                    continue;
                }
                let Some(relative) = document.path.strip_prefix(&format!("{portable_root}/"))
                else {
                    continue;
                };
                node.insert(relative, document.clone());
                assigned.insert(document.path.clone());
            }
            Some(node.into_entry())
        })
        .collect::<Vec<_>>();
    tree_roots.sort_by(compare_tree_entries);
    DocumentCatalog {
        documents,
        roots: tree_roots,
    }
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
    use crate::error::AppError;

    use super::{catalog_from_summaries, spawn_body_reads, tree_path};

    struct ConcurrencySource {
        active: AtomicUsize,
        maximum: AtomicUsize,
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
        let mut reads = spawn_body_reads(
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
}
