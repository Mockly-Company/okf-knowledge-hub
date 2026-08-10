use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use git2::{IndexAddOption, Repository, Signature, Time};
use tempfile::TempDir;
use tokio::sync::Semaphore;
use uuid::Uuid;

use super::contract::{DocumentCatalog, IndexStatus};
use super::discovery::discover_documents;
use super::history::DocumentHistory;
use super::reader::DocumentReader;
use super::runtime::{DocumentRuntime, DocumentSource, DocumentWorkspace};
use crate::error::AppError;

struct LargeWorkspace {
    directory: TempDir,
    workspace_id: Uuid,
}

impl LargeWorkspace {
    fn new(document_count: usize) -> Self {
        let directory = TempDir::new().expect("large workspace fixture directory");
        let docs = directory.path().join("docs");
        fs::create_dir_all(&docs).expect("docs root");
        for number in 0..document_count {
            fs::write(
                docs.join(format!("document-{number:04}.md")),
                format!("# Document {number}\n\nSmall deterministic fixture.\n"),
            )
            .expect("fixture Markdown");
        }
        Self {
            directory,
            workspace_id: Uuid::new_v4(),
        }
    }

    fn workspace(&self) -> DocumentWorkspace {
        DocumentWorkspace {
            workspace_id: self.workspace_id,
            repository_root: self.directory.path().to_owned(),
            document_roots: vec!["docs".to_owned()],
            cache_path: self.directory.path().join("document-search.sqlite3"),
        }
    }

    fn runtime_with_blocked_bodies(&self) -> (DocumentRuntime, GatedFileSystemSource) {
        let source = GatedFileSystemSource::new();
        (
            DocumentRuntime::with_source(Arc::new(source.clone())),
            source,
        )
    }
}

#[derive(Clone)]
struct GatedFileSystemSource {
    entered_body_gate: Arc<AtomicUsize>,
    completed_body_reads: Arc<AtomicUsize>,
    body_gate: Arc<Semaphore>,
}

impl GatedFileSystemSource {
    fn new() -> Self {
        Self {
            entered_body_gate: Arc::new(AtomicUsize::new(0)),
            completed_body_reads: Arc::new(AtomicUsize::new(0)),
            body_gate: Arc::new(Semaphore::new(0)),
        }
    }

    fn body_read_count(&self) -> usize {
        self.completed_body_reads.load(Ordering::SeqCst)
    }

    async fn wait_for_body_gate(&self) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.entered_body_gate.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("background body indexer should reach the source gate");
    }

    fn open_body_gate(&self, documents: usize) {
        self.body_gate.add_permits(documents);
    }
}

#[async_trait]
impl DocumentSource for GatedFileSystemSource {
    fn discover(&self, workspace: &DocumentWorkspace) -> Result<DocumentCatalog, AppError> {
        discover_documents(&workspace.repository_root, &workspace.document_roots)
    }

    async fn read_body(
        &self,
        workspace: &DocumentWorkspace,
        path: &str,
    ) -> Result<Vec<u8>, AppError> {
        self.entered_body_gate.fetch_add(1, Ordering::SeqCst);
        self.body_gate
            .acquire()
            .await
            .expect("source gate closed")
            .forget();
        self.completed_body_reads.fetch_add(1, Ordering::SeqCst);
        tokio::fs::read(workspace.repository_root.join(path))
            .await
            .map_err(|error| {
                AppError::new(
                    crate::error::ErrorCode::DocumentPathInvalid,
                    "fixture body read failed",
                )
                .with_detail("reason", error.to_string())
            })
    }
}

#[tokio::test]
async fn three_thousand_document_tree_is_returned_before_body_gate_opens() {
    let fixture = LargeWorkspace::new(3_000);
    let (runtime, source) = fixture.runtime_with_blocked_bodies();
    let session_id = Uuid::new_v4();

    let snapshot = runtime
        .start_session(session_id, fixture.workspace())
        .await
        .expect("catalog snapshot");

    assert_eq!(snapshot.catalog.documents.len(), 3_000);
    source.wait_for_body_gate().await;
    assert_eq!(source.body_read_count(), 0);

    source.open_body_gate(3_000);
    runtime
        .stop_session(session_id)
        .await
        .expect("stop fixture session");
}

#[tokio::test]
async fn discovery_read_search_and_history_leave_markdown_byte_for_byte_unchanged() {
    let fixture = TempDir::new().expect("repository fixture");
    let repository = Repository::init(fixture.path()).expect("initialize repository");
    let docs = fixture.path().join("docs");
    fs::create_dir_all(&docs).expect("docs root");
    let historic_markdown = "# Guide\n\nHistorical searchable text.\n";
    fs::write(docs.join("guide.md"), historic_markdown).expect("historic document");
    let historic_oid = commit_all(&repository, "add guide", 1_721_000_000);
    let current_markdown = "# Guide\n\nCurrent searchable text.\n";
    fs::write(docs.join("guide.md"), current_markdown).expect("current document");
    commit_all(&repository, "update guide", 1_721_000_001);
    let document_path = docs.join("guide.md");
    let bytes_before = fs::read(&document_path).expect("current bytes");

    let workspace = DocumentWorkspace {
        workspace_id: Uuid::new_v4(),
        repository_root: fixture.path().to_owned(),
        document_roots: vec!["docs".to_owned()],
        cache_path: fixture.path().join("document-search.sqlite3"),
    };
    let runtime = DocumentRuntime::new();
    let session_id = Uuid::new_v4();
    let snapshot = runtime
        .start_session(session_id, workspace.clone())
        .await
        .expect("discovery snapshot");
    assert_eq!(snapshot.catalog.documents.len(), 1);
    wait_for_ready(&runtime, session_id).await;

    let reader = DocumentReader::new(fixture.path(), &["docs".to_owned()]).expect("reader");
    let current = reader.read_document("docs/guide.md").expect("current read");
    assert_eq!(current.markdown, current_markdown);
    assert_eq!(
        runtime
            .search(session_id, "Current searchable", 20)
            .await
            .expect("search")
            .items
            .len(),
        1
    );

    let history = DocumentHistory::open(fixture.path()).expect("history");
    let page = history
        .history_page("docs/guide.md", None, None, 20)
        .expect("history page");
    assert_eq!(page.items.len(), 2);
    let historic = history
        .read_version(&historic_oid.to_string(), "docs/guide.md")
        .expect("historic read");
    assert_eq!(historic.markdown, historic_markdown);
    assert_eq!(
        fs::read(&document_path).expect("current bytes"),
        bytes_before
    );

    runtime
        .stop_session(session_id)
        .await
        .expect("stop session");
}

#[tokio::test]
#[ignore = "records non-gating cold-index and warm-reconcile timings"]
async fn benchmark_three_thousand_document_cold_index_and_warm_reconcile() {
    let fixture = LargeWorkspace::new(3_000);
    let cold_runtime = DocumentRuntime::new();
    let cold_session = Uuid::new_v4();
    let cold_started = Instant::now();
    cold_runtime
        .start_session(cold_session, fixture.workspace())
        .await
        .expect("cold snapshot");
    wait_for_ready(&cold_runtime, cold_session).await;
    eprintln!(
        "Task 14 benchmark: cold index for 3,000 documents: {:?}",
        cold_started.elapsed()
    );
    cold_runtime
        .stop_session(cold_session)
        .await
        .expect("stop cold session");

    let warm_runtime = DocumentRuntime::new();
    let warm_session = Uuid::new_v4();
    let warm_started = Instant::now();
    warm_runtime
        .start_session(warm_session, fixture.workspace())
        .await
        .expect("warm snapshot");
    wait_for_ready(&warm_runtime, warm_session).await;
    eprintln!(
        "Task 14 benchmark: warm reconcile for 3,000 documents: {:?}",
        warm_started.elapsed()
    );
    warm_runtime
        .stop_session(warm_session)
        .await
        .expect("stop warm session");
}

async fn wait_for_ready(runtime: &DocumentRuntime, session_id: Uuid) {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if matches!(
                runtime
                    .snapshot(session_id)
                    .expect("active session")
                    .index_status,
                IndexStatus::Ready
            ) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("fixture indexing should complete");
}

fn commit_all(repository: &Repository, message: &str, timestamp: i64) -> git2::Oid {
    let mut index = repository.index().expect("repository index");
    index
        .add_all(["*"], IndexAddOption::DEFAULT, None)
        .expect("stage fixture files");
    index.write().expect("write fixture index");
    let tree_id = index.write_tree().expect("fixture tree");
    let tree = repository.find_tree(tree_id).expect("fixture tree object");
    let signature = Signature::new("Task 14", "task14@example.test", &Time::new(timestamp, 0))
        .expect("fixture signature");
    let parent = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok());
    repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parent.iter().collect::<Vec<_>>(),
        )
        .expect("fixture commit")
}
