# Documents Exploration and Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연결된 OKF 저장소의 Markdown 문서를 빠르게 탐색·검색하고, 안전하게 렌더링하며, 문서별 Git 이력을 읽을 수 있는 Documents 기능을 구현한다.

**Architecture:** Rust가 현재 워크스페이스 경계 안에서 문서 발견, frontmatter 파싱, SQLite FTS5 검색 캐시, single-flight 재조정, 파일 감시와 Git 이력을 담당한다. Watcher는 변경 경로를 해석하지 않고 `RepositoryChanged`만 전달하며, metadata가 달라진 문서 본문만 제한된 동시성으로 읽어 하나의 cache transaction에 반영한다. React는 session/request ID가 포함된 좁은 Tauri 계약만 사용하여 문서 트리, 검색, 읽기 화면과 Mermaid를 렌더링하며 오래된 event와 검색 결과를 reducer에서 거부한다.

**Tech Stack:** Tauri 2, Rust 1.88, rusqlite 0.40 + bundled SQLite FTS5, notify 8.2, pulldown-cmark 0.13, git2 0.19, React 19, TypeScript 5, react-markdown 10, remark-gfm 4, rehype-sanitize 6, Mermaid 11, DOMPurify 3, Vitest 4.

## Global Constraints

- 구현은 `feat/workspace-identity-and-auth-status`가 main에 병합된 뒤 최신 main에서 새 feature worktree와 branch를 만들어 시작한다.
- Git의 Markdown이 유일한 문서 원본이다. 검색용 SQLite는 OS 앱 데이터 폴더의 삭제 가능한 workspace별 cache일 뿐이다.
- `.okf/workspace.yml`에 설정된 document root 아래의 `.md` 파일만 Documents에 포함한다.
- 제목은 `frontmatter.title → 확장자를 제외한 파일명` 순서로 정하고 첫 번째 H1은 본문으로 남긴다.
- 읽기, 발견, 검색 색인은 Markdown 파일을 다시 쓰지 않는다.
- `okf_hub_id`가 없는 기존 문서도 읽고 검색하며 이번 단계에서 ID를 자동 추가하지 않는다.
- raw HTML은 실행하지 않는다. 상대 asset은 현재 OKF repository 안에서만 읽는다.
- 초기 범위는 현재 worktree와 commit history다. 열린 PR의 제안 version, 편집, 댓글과 review는 포함하지 않는다.
- listener는 session command보다 먼저 등록하고 모든 event는 client가 생성한 UUID v4 session ID를 포함한다.
- Windows와 macOS에서 같은 Rust/TypeScript 계약을 사용한다.
- 각 task는 failing test → 최소 구현 → 전체 관련 test 순서로 완료하고, 사용자에게 결과를 보고해 명시적 승인을 받은 뒤에만 commit한다.

---

## File Structure

### Rust

- `src-tauri/src/documents/contract.rs`: Tauri에 노출하는 document/search/history DTO.
- `src-tauri/src/documents/frontmatter.rs`: YAML frontmatter와 제목·ID·오류 위치 파싱.
- `src-tauri/src/documents/discovery.rs`: document root 경계 안의 `.md` 발견과 tree 구성.
- `src-tauri/src/documents/search_text.rs`: Markdown에서 검색용 plain text와 snippet 생성.
- `src-tauri/src/documents/cache.rs`: workspace별 SQLite schema, migration, reconcile, FTS search.
- `src-tauri/src/documents/indexer.rs`: 제한된 동시성으로 변경 후보의 본문을 읽고 색인 입력을 생성.
- `src-tauri/src/documents/reconcile.rs`: single-flight 재조정 상태 머신과 후속 실행 결정.
- `src-tauri/src/documents/watcher.rs`: `notify` event를 `RepositoryChanged` 신호로 축약.
- `src-tauri/src/documents/reader.rs`: 현재 문서와 repository 내부 asset의 안전한 읽기.
- `src-tauri/src/documents/history.rs`: git2 기반 history pagination, rename 추적과 과거 blob 읽기.
- `src-tauri/src/documents/runtime.rs`: active session, 재조정 worker 수명과 stale session 방지.
- `src-tauri/src/documents/mod.rs`: documents module export.
- `src-tauri/src/commands/documents.rs`: Tauri commands와 document event emitter.
- `src-tauri/src/error.rs`: document/cache/history 오류 code와 recovery action.
- `src-tauri/src/state.rs`: `DocumentRuntime` 공유 state.
- `src-tauri/src/lib.rs`: dependency 초기화, command 등록.

### React/TypeScript

- `src/features/documents/model.ts`: frontend document/search/history/event types.
- `src/features/documents/DocumentsGateway.ts`: UI가 의존하는 port.
- `src/features/documents/documents-reducer.ts`: session, tree, index, selection, search ownership.
- `src/features/documents/DocumentsProvider.tsx`: listener lifecycle와 command orchestration.
- `src/features/documents/components/DocumentTree.tsx`: folder expand/collapse와 document selection.
- `src/features/documents/components/DocumentSearch.tsx`: debounce, progress와 result list.
- `src/features/documents/components/DocumentReader.tsx`: read state, header와 context panel layout.
- `src/features/documents/components/MarkdownDocument.tsx`: safe GFM, links, images와 Mermaid dispatch.
- `src/features/documents/components/MermaidBlock.tsx`: strict render와 sanitized SVG.
- `src/features/documents/components/DocumentOverview.tsx`: properties와 TOC.
- `src/features/documents/components/DocumentHistory.tsx`: commit pagination과 version selection.
- `src/features/documents/documents.css`: Documents feature layout and states.
- `src/infrastructure/documents/TauriDocumentsGateway.ts`: invoke/listen/opener adapter.
- `src/infrastructure/documents/UnavailableDocumentsGateway.ts`: browser-only recovery adapter.
- `src/infrastructure/documents/createDocumentsGateway.ts`: runtime factory.
- `src/test/FakeDocumentsGateway.ts`: component/provider test double.
- `src/pages/DocumentsPage.tsx`: Documents home/detail composition.
- `src/components/patterns/AppSidebar.tsx`: Documents route에서 tree panel 표시.
- `src/app/App.tsx`: DocumentsProvider dependency injection.

---

### Task 1: Markdown Discovery and Frontmatter Contracts

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/documents/mod.rs`
- Create: `src-tauri/src/documents/contract.rs`
- Create: `src-tauri/src/documents/frontmatter.rs`
- Create: `src-tauri/src/documents/discovery.rs`
- Create: `src-tauri/src/documents/fixtures/valid.md`
- Create: `src-tauri/src/documents/fixtures/invalid-frontmatter.md`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `WorkspaceConfigV1.documents.roots`, repository root `Path`.
- Produces: `discover_documents(repository_root, roots) -> Result<DocumentCatalog, AppError>`, `parse_document(source, file_name) -> ParsedDocumentMetadata`.

- [ ] **Step 1: Add parser/discovery dependencies and write failing contract tests**

Run:

```bash
cd src-tauri
cargo add pulldown-cmark@0.13.4 --no-default-features
```

Add tests that lock the wire names and title rule:

```rust
#[test]
fn frontmatter_title_precedes_filename_and_h1_is_not_a_title_fallback() {
    let metadata = parse_document("---\ntitle: API 계약\nokf_hub_id: 9df970bb-824b-4d26-b582-b34a8f0afc21\n---\n# 다른 H1\n", "map-api.md");
    assert_eq!(metadata.title, "API 계약");
    assert_eq!(metadata.document_id.unwrap().to_string(), "9df970bb-824b-4d26-b582-b34a8f0afc21");

    let fallback = parse_document("# 본문의 H1\n", "map-api.md");
    assert_eq!(fallback.title, "map-api");
    assert_eq!(fallback.frontmatter_status, FrontmatterStatus::Missing);
}

#[test]
fn invalid_frontmatter_keeps_the_document_with_a_located_warning() {
    let metadata = parse_document("---\ntitle: [broken\n---\n본문\n", "broken.md");
    let FrontmatterStatus::Invalid { error } = metadata.frontmatter_status else { panic!() };
    assert!(error.line >= 1);
    assert!(!error.message.is_empty());
    assert_eq!(metadata.title, "broken");
}
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `cargo test documents::frontmatter --lib`

Expected: FAIL because the `documents` module and parser do not exist.

- [ ] **Step 3: Implement exact DTOs and frontmatter parsing**

Define these public contracts in `contract.rs`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub path: String,
    pub file_name: String,
    pub title: String,
    pub document_id: Option<Uuid>,
    pub frontmatter_status: FrontmatterStatus,
    pub modified_at_unix_ms: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FrontmatterStatus {
    Valid,
    Missing,
    Invalid { error: FrontmatterError },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DocumentTreeEntry {
    Folder { name: String, path: String, children: Vec<DocumentTreeEntry> },
    Document { summary: DocumentSummary },
}
```

Implement delimiter parsing only when the file begins with a `---` line. Discovery uses `BufRead`: a non-delimiter first line stops immediately, while a frontmatter block reads only through its closing delimiter. Cap an unterminated frontmatter prefix at 256 KiB and report it as `Invalid` so a malformed large document cannot block the tree. Parse YAML with `serde_yaml_ng`, accept `title` only as a non-empty string, parse `okf_hub_id` only as UUID v4, and preserve the body unchanged for later reading. A missing closing delimiter is `Invalid`, not `Missing`.

- [ ] **Step 4: Write failing discovery tests**

```rust
#[test]
fn discovery_includes_only_markdown_below_configured_roots() {
    let repo = fixture_repo(&[
        ("docs/api.md", "---\ntitle: API\n---\n"),
        ("docs/data.json", "{}"),
        ("outside/ignored.md", "# ignored"),
    ]);
    let catalog = discover_documents(repo.path(), &["docs".into()]).unwrap();
    assert_eq!(catalog.documents.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(), ["docs/api.md"]);
}

#[test]
fn discovery_rejects_a_root_that_escapes_the_repository() {
    let error = discover_documents(repo.path(), &["../outside".into()]).unwrap_err();
    assert_eq!(error.code, ErrorCode::DocumentPathInvalid);
}
```

- [ ] **Step 5: Implement discovery and stable tree ordering**

Use canonical path checks before reading, skip repository internals named `.git`, include only regular files whose extension equals `md` case-insensitively, and sort folders before documents using case-insensitive display names with path as the tie-breaker. Return a flat `documents` list plus nested `roots` so later cache reconciliation does not need to flatten the UI tree.

Add a reader-spy test with a 10 MiB body and a short valid frontmatter. Discovery must stop after the closing delimiter and must not consume body bytes.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cargo test documents:: --lib
cargo fmt --check
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/documents src-tauri/src/lib.rs
git commit -m "feat: discover OKF Markdown documents"
```

Expected: all new discovery/frontmatter tests pass.

---

### Task 2: Workspace-local SQLite Search Cache

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/documents/search_text.rs`
- Create: `src-tauri/src/documents/cache.rs`
- Modify: `src-tauri/src/documents/contract.rs`
- Modify: `src-tauri/src/documents/mod.rs`

**Interfaces:**
- Consumes: `DocumentSummary`, Markdown body and workspace UUID.
- Produces: `DocumentCache::reconcile_metadata`, `DocumentCache::upsert_content`, `DocumentCache::search` and `SearchResponse`.

- [ ] **Step 1: Add SQLite and write a failing cache migration test**

Run:

```bash
cd src-tauri
cargo add rusqlite@0.40.1 --features bundled
```

Test a temporary DB with this required schema behavior:

```rust
#[test]
fn opening_a_new_cache_creates_versioned_documents_and_trigram_fts() {
    let cache = DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
    assert_eq!(cache.index_version().unwrap(), 1);
    assert!(cache.has_table("documents").unwrap());
    assert!(cache.has_table("document_search").unwrap());
}
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `cargo test documents::cache::tests::opening_a_new_cache --lib`

Expected: FAIL because `DocumentCache` is undefined.

- [ ] **Step 3: Implement transactional schema creation and invalid-version rebuild**

Create `meta`, `documents`, and FTS5 tables in one transaction:

```sql
CREATE TABLE documents (
  path TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  document_id TEXT,
  frontmatter_status_json TEXT NOT NULL,
  modified_at_unix_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  content_hash TEXT,
  body_text TEXT
);
CREATE VIRTUAL TABLE document_search USING fts5(
  path UNINDEXED,
  title,
  body_text,
  tokenize='trigram'
);
```

Store `index_version=1` and the workspace UUID in `meta`. If either does not match, close the connection, rename the file to `search.invalid-<unix>.sqlite3`, and create a clean cache.

- [ ] **Step 4: Write failing reconcile and search ranking tests**

```rust
#[test]
fn reconcile_returns_only_new_changed_and_deleted_paths() {
    cache.seed(indexed("docs/old.md", 10, 100), "old body").unwrap();
    let delta = cache.reconcile_metadata(&[
        summary("docs/old.md", 10, 100),
        summary("docs/new.md", 20, 200),
    ]).unwrap();
    assert_eq!(delta.to_index, vec!["docs/new.md"]);
    assert!(delta.deleted.is_empty());
}

#[test]
fn search_ranks_exact_title_before_title_path_and_body_matches() {
    seed_search_fixture(&cache);
    let result = cache.search("지도 검색", 20).unwrap();
    assert_eq!(result.items.iter().map(|i| i.path.as_str()).collect::<Vec<_>>(), [
        "docs/exact.md", "docs/title.md", "docs/path/지도-검색.md", "docs/body.md"
    ]);
}
```

- [ ] **Step 5: Implement Markdown plain-text extraction, hash-aware update and search**

Use `pulldown_cmark::Parser` and concatenate `Text`, `Code`, soft/hard break events after removing frontmatter. Compute SHA-256 using the existing `sha2` dependency. If metadata changed but the new hash equals the stored hash, update metadata without rewriting the FTS row.

Each `SearchResult` returns `matchField: title | path | body` and `matchText` in addition to its bounded snippet. Do not return a plain-text byte offset because Markdown syntax means that offset cannot reliably address the rendered DOM.

For queries of three or more Unicode scalar values, use FTS trigram candidates; for one- or two-character queries, use parameterized `LIKE` against title/path/body. Apply ranking in SQL with exact title, title substring, path substring, then body match. Never interpolate query text into SQL.

- [ ] **Step 6: Add snippet and deletion tests, run and commit**

Test that snippets contain bounded context around the first match, invalid UTF-8 is rejected per document, and deleted paths disappear from both tables in one transaction.

Run:

```bash
cargo test documents::cache --lib
cargo test documents::search_text --lib
cargo fmt --check
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/documents
git commit -m "feat: cache document search locally"
```

---

### Task 3: Repository Change Signal

**Files:**
- Modify: `src-tauri/src/documents/watcher.rs`
- Modify: `src-tauri/src/documents/mod.rs`

**Interfaces:**
- Consumes: `notify::Event` and `notify::Error` from roots already registered with `RecursiveMode::Recursive`.
- Produces: `WatcherMessage::RepositoryChanged` and `WatcherMessage::BackendError`.

- [ ] **Step 1: Replace path-classification tests with coarse-signal tests**

Delete tests for `Paths`, `ScopedRescan`, `Rescan`, `affected_markdown_paths`, and `scoped_rescan_paths`. Add these exact cases in `watcher.rs`:

```rust
#[test]
fn file_and_directory_changes_become_one_repository_changed_signal() {
    for event in [
        event(EventKind::Create(CreateKind::File), "docs/new.md"),
        event(EventKind::Modify(ModifyKind::Data(DataChange::Any)), "docs/api.md"),
        event(EventKind::Remove(RemoveKind::Folder), "docs/legacy"),
        event(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), "docs/moved"),
    ] {
        assert!(matches!(
            watcher_message(Ok(event)),
            Some(WatcherMessage::RepositoryChanged)
        ));
    }
}

#[test]
fn watcher_backend_error_remains_distinct() {
    assert!(matches!(
        watcher_message(Err(notify::Error::generic("watch failed"))),
        Some(WatcherMessage::BackendError)
    ));
}
```

- [ ] **Step 2: Run the watcher tests and confirm RED**

Run: `cd src-tauri && cargo test documents::watcher --lib`

Expected: FAIL because `RepositoryChanged` does not exist and the watcher still returns path variants.

- [ ] **Step 3: Reduce the watcher message contract**

Use this exact enum and conversion rule:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatcherMessage {
    RepositoryChanged,
    BackendError,
}

fn watcher_message(result: notify::Result<Event>) -> Option<WatcherMessage> {
    match result {
        Ok(event) if is_repository_change(&event.kind) || event.need_rescan() => {
            Some(WatcherMessage::RepositoryChanged)
        }
        Ok(_) => None,
        Err(_) => Some(WatcherMessage::BackendError),
    }
}
```

`is_repository_change` accepts create, modify, remove, `EventKind::Any`, and rescan-required events regardless of whether the event path is a file or directory. Keep the existing 150 ms debounce in the runtime consumer. Remove path normalization and scoped-rescan helpers from `watcher.rs`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
cd src-tauri
cargo test documents::watcher --lib
cargo fmt --check
```

Expected: watcher tests PASS.

```bash
git add src-tauri/src/documents/watcher.rs src-tauri/src/documents/mod.rs
git commit -m "refactor: simplify document watcher signals"
```

---

### Task 4: Single-flight Reconciliation State Machine

**Files:**
- Create: `src-tauri/src/documents/reconcile.rs`
- Modify: `src-tauri/src/documents/mod.rs`

**Interfaces:**
- Consumes: requests from watcher, manual refresh, and the future Hub save path.
- Produces: `ReconcileGate::request() -> ReconcileDecision`, `finish() -> ReconcileDecision`, and `close()`.

- [ ] **Step 1: Write exhaustive failing state-machine tests**

```rust
#[test]
fn idle_request_starts_one_run() {
    let mut gate = ReconcileGate::default();
    assert_eq!(gate.request(), ReconcileDecision::Start);
    assert_eq!(gate.request(), ReconcileDecision::Wait);
}

#[test]
fn many_requests_during_a_run_become_one_follow_up() {
    let mut gate = ReconcileGate::default();
    assert_eq!(gate.request(), ReconcileDecision::Start);
    assert_eq!(gate.request(), ReconcileDecision::Wait);
    assert_eq!(gate.request(), ReconcileDecision::Wait);
    assert_eq!(gate.finish(), ReconcileDecision::Start);
    assert_eq!(gate.finish(), ReconcileDecision::Wait);
}

#[test]
fn closing_drops_pending_and_rejects_future_runs() {
    let mut gate = ReconcileGate::default();
    assert_eq!(gate.request(), ReconcileDecision::Start);
    assert_eq!(gate.request(), ReconcileDecision::Wait);
    gate.close();
    assert_eq!(gate.finish(), ReconcileDecision::Wait);
    assert_eq!(gate.request(), ReconcileDecision::Wait);
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd src-tauri && cargo test documents::reconcile --lib`

Expected: FAIL because the module and state machine do not exist.

- [ ] **Step 3: Implement the pure state machine**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReconcileDecision {
    Start,
    Wait,
}

#[derive(Debug, Default)]
pub(crate) struct ReconcileGate {
    running: bool,
    pending: bool,
    closed: bool,
}

impl ReconcileGate {
    pub(crate) fn request(&mut self) -> ReconcileDecision {
        if self.closed {
            return ReconcileDecision::Wait;
        }
        if self.running {
            self.pending = true;
            return ReconcileDecision::Wait;
        }
        self.running = true;
        ReconcileDecision::Start
    }

    pub(crate) fn finish(&mut self) -> ReconcileDecision {
        if self.closed {
            self.running = false;
            self.pending = false;
            return ReconcileDecision::Wait;
        }
        if std::mem::take(&mut self.pending) {
            return ReconcileDecision::Start;
        }
        self.running = false;
        ReconcileDecision::Wait
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.pending = false;
    }
}
```

- [ ] **Step 4: Run focused tests and commit**

```bash
cd src-tauri
cargo test documents::reconcile --lib
cargo fmt --check
git add src-tauri/src/documents/reconcile.rs src-tauri/src/documents/mod.rs
git commit -m "feat: add single-flight document reconciliation"
```

---

### Task 5: Transactional Reconciliation Batch

**Files:**
- Modify: `src-tauri/src/documents/cache.rs`
- Modify: `src-tauri/src/documents/indexer.rs`

**Interfaces:**
- Consumes: the discovered `DocumentCatalog` and bodies read only for metadata-changed paths.
- Produces: `DocumentCache::plan_reconcile(&self, summaries: &[DocumentSummary]) -> Result<ReconcileDelta, CacheError>`, `apply_reconcile(&mut self, summaries: &[DocumentSummary], contents: &[IndexedContent]) -> Result<(), CacheError>`, and `BodyReadCoordinator::read_changed(...)`.

- [ ] **Step 1: Write failing cache atomicity and unchanged-body tests**

Add a `FailBeforeCommit` test hook available only under `cfg(test)`, then verify rollback:

```rust
#[test]
fn reconcile_batch_rolls_back_metadata_and_content_together() {
    let mut cache = cache_with_indexed_document("docs/api.md", b"old body");
    let changed = summary("docs/api.md", 200, 20);
    cache.fail_next_batch_before_commit_for_test();

    assert!(cache
        .apply_reconcile(
            std::slice::from_ref(&changed),
            &[IndexedContent {
                summary: changed,
                markdown: b"new body".to_vec(),
            }],
        )
        .is_err());

    assert_eq!(cache.search("old body", 10).unwrap().items.len(), 1);
    assert!(cache.search("new body", 10).unwrap().items.is_empty());
}

#[tokio::test]
async fn indexer_reads_only_metadata_changed_documents() {
    let source = CountingDocumentSource::with_documents([
        ("docs/same.md", b"same"),
        ("docs/changed.md", b"changed"),
    ]);
    let candidates = vec![summary("docs/changed.md", 200, 7)];
    let contents = BodyReadCoordinator::default()
        .read_changed(Arc::new(source.clone()), workspace(), candidates)
        .await;
    assert_eq!(contents.len(), 1);
    assert_eq!(source.read_paths(), vec!["docs/changed.md"]);
}
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
cd src-tauri
cargo test documents::cache::tests::reconcile_batch_rolls_back_metadata_and_content_together --lib
cargo test documents::indexer::tests::indexer_reads_only_metadata_changed_documents --lib
```

Expected: FAIL because `IndexedContent`, `plan_reconcile`, `apply_reconcile`, and `read_changed` do not exist.

- [ ] **Step 3: Implement batch preparation and one SQLite transaction**

Define the batch value in `cache.rs` so the cache does not depend on the higher-level indexer module:

```rust
pub(crate) struct IndexedContent {
    pub summary: DocumentSummary,
    pub markdown: Vec<u8>,
}

pub(crate) async fn read_changed(
    &self,
    source: Arc<dyn DocumentSource>,
    workspace: DocumentWorkspace,
    documents: Vec<DocumentSummary>,
) -> Vec<Result<IndexedContent, AppError>>;
```

Retain exactly four semaphore permits. Do not accept a per-revision cancellation token. A session close may cause the runtime to discard the returned batch, but it must not start a replacement physical read batch concurrently.

Make `plan_reconcile` read-only: compare current summaries with stored metadata and return `ReconcileDelta { to_index, deleted }` without changing SQLite. The runtime maps `to_index` back to catalog summaries and passes only those summaries to `read_changed`.

Implement `apply_reconcile` with one `rusqlite::Transaction`: verify that every `to_index` candidate has one successful `IndexedContent`, upsert all supplied contents and FTS rows, update unchanged metadata, delete absent paths, then commit. Convert UTF-8 and size errors before starting the transaction. Do not publish partial cache updates or a successful delta before commit.

- [ ] **Step 4: Run cache/indexer suites and commit**

```bash
cd src-tauri
cargo test documents::cache --lib
cargo test documents::indexer --lib
cargo fmt --check
git add src-tauri/src/documents/cache.rs src-tauri/src/documents/indexer.rs
git commit -m "feat: reconcile document index atomically"
```

---

### Task 6: Session-owned Reconciliation Worker

**Files:**
- Modify: `src-tauri/src/documents/runtime.rs`
- Modify: `src-tauri/src/documents/mod.rs`

**Interfaces:**
- Consumes: `WatcherMessage`, `ReconcileGate`, `DocumentCache::plan_reconcile`/`apply_reconcile`, and the existing `DocumentEvent` contract.
- Produces: unchanged public methods `DocumentRuntime::start_session`, `stop_session`, `search`, and `refresh`; one private `request_reconcile(owner)` entry point for watcher and manual refresh.

- [ ] **Step 1: Replace revision/cancellation tests with worker lifecycle tests**

```rust
#[tokio::test]
async fn changes_during_a_blocked_run_produce_one_follow_up_run() {
    let source = BlockingDiscoverySource::new();
    let runtime = test_runtime_with(source.clone());
    let id = Uuid::new_v4();
    runtime.start_session(id, workspace()).await.unwrap();
    source.wait_until_reconcile_started().await;

    runtime.signal_repository_changed_for_test(id).await;
    runtime.signal_repository_changed_for_test(id).await;
    runtime.signal_repository_changed_for_test(id).await;
    source.release_current_reconcile();
    source.wait_until_reconcile_count(2).await;

    assert_eq!(source.max_concurrent_reconciles(), 1);
    assert_eq!(source.reconcile_count(), 2);
}

#[tokio::test]
async fn stale_session_result_never_updates_cache_or_events() {
    let source = BlockingDocumentSource::with_document("docs/stale.md");
    let runtime = test_runtime_with(source.clone());
    let first = Uuid::new_v4();
    runtime.start_session(first, workspace()).await.unwrap();
    source.wait_until_body_read_started().await;
    runtime.stop_session(first).await.unwrap();

    let second = Uuid::new_v4();
    runtime.start_session(second, other_workspace()).await.unwrap();
    source.release_body_read();

    assert!(!runtime.snapshot_for_test(second).catalog.documents.iter()
        .any(|document| document.path == "docs/stale.md"));
    assert!(!runtime.events_for_test().iter()
        .any(|event| event.session_id() == first && event.is_ready()));
}

#[tokio::test]
async fn failed_run_with_pending_change_retries_once() {
    let source = FailOnceBlockingSource::new();
    let runtime = test_runtime_with(source.clone());
    let id = Uuid::new_v4();
    runtime.start_session(id, workspace()).await.unwrap();
    source.wait_until_reconcile_started().await;
    runtime.signal_repository_changed_for_test(id).await;
    source.release_failure();
    source.wait_until_reconcile_count(2).await;
    assert_eq!(runtime.snapshot_for_test(id).index_status, IndexStatus::Ready);
}
```

Keep and adapt these existing runtime tests to the coarse signal contract:

- `initial_tree_is_available_before_body_indexing_finishes`: the snapshot contains the discovered tree and `Preparing` before the blocked body read is released.
- `cold_start_reconciles_after_watcher_install_to_close_the_handoff_window`: a change between discovery and watcher installation cannot be missed.
- `warm_start_filters_changed_roots_and_clears_out_of_scope_selection`: cached documents outside the current configured roots are not published.
- `injected_watcher_failure_degrades_without_disabling_search_or_refresh`: `BackendError` publishes `Degraded`, and a later manual refresh reaches `Ready` without replacing the session.
- `dropping_the_last_runtime_handle_releases_watcher_task_and_cache_state`: after session shutdown and completion of any already-started read, the weak runtime reference can no longer be upgraded.

Add one shared-entry test:

```rust
#[tokio::test]
async fn manual_refresh_and_watcher_change_share_the_same_gate() {
    let source = BlockingDiscoverySource::new();
    let runtime = test_runtime_with(source.clone());
    let id = Uuid::new_v4();
    runtime.start_session(id, workspace()).await.unwrap();
    source.wait_until_reconcile_started().await;

    runtime.refresh(id).await.unwrap();
    runtime.signal_repository_changed_for_test(id).await;
    source.release_current_reconcile();
    source.wait_until_reconcile_count(2).await;

    assert_eq!(source.max_concurrent_reconciles(), 1);
    assert_eq!(source.reconcile_count(), 2);
}
```

- [ ] **Step 2: Run runtime tests and confirm RED**

Run: `cd src-tauri && cargo test documents::runtime --lib`

Expected: the new worker tests FAIL while the runtime still cancels revisions and stores affected paths.

- [ ] **Step 3: Replace revision state with the reconciliation gate**

Use this active-session state:

```rust
struct ActiveSession {
    owner: SessionOwner,
    cancellation: CancellationToken,
    workspace: DocumentWorkspace,
    cache: DocumentCache,
    snapshot: DocumentSessionSnapshot,
    reconcile: ReconcileGate,
    watcher_degraded: Option<String>,
    watcher: Option<Box<dyn WatcherGuard>>,
}
```

Remove `index_revision`, `index_cancellation`, `pending_affected_paths`, `refresh_affected`, `forced_paths`, and every path-specific watcher branch. `request_reconcile` locks the session only long enough to call `ReconcileGate::request`; only `Start` spawns a worker. The worker owns a `Weak<RuntimeInner>`, upgrades it for one operation, discovers metadata, reads changed bodies, then checks `SessionOwner` immediately before the batch cache commit and each event publication.

After success or failure, call `ReconcileGate::finish`. `Start` loops once more; `Wait` exits. `stop_session` calls `ReconcileGate::close`, cancels watcher reception, and removes the generation. A late physical read may finish, but its owner check must reject cache and event publication.

- [ ] **Step 4: Make watcher and manual refresh share the entry point**

In `watch_changes`, debounce `RepositoryChanged` for 150 ms without retaining paths, then call `request_reconcile(owner)`. `DocumentRuntime::refresh(session_id)` resolves the current owner, calls the same method, and returns after the request has been accepted; it does not run a second inline reconcile path.

- [ ] **Step 5: Run complete Rust verification and commit**

```bash
cd src-tauri
cargo test documents::runtime --lib
cargo test documents::watcher --lib
cargo test documents::indexer --lib
cargo test documents::cache --lib
cargo test --lib
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
git add src-tauri/src/documents
git commit -m "feat: run document reconciliation single flight"
```

Expected: all commands PASS, no affected-path or per-revision cancellation symbols remain, and `runtime.rs` contains only session orchestration rather than watcher path classification.

---

### Task 7: Safe Document and Repository Asset Reading

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/documents/reader.rs`
- Modify: `src-tauri/src/documents/contract.rs`
- Modify: `src-tauri/src/documents/mod.rs`
- Modify: `src-tauri/src/error.rs`

**Interfaces:**
- Consumes: validated repository root, configured roots and repository-relative path.
- Produces: `read_document`, `read_asset`, `DocumentContent`, `DocumentAsset`.

- [ ] **Step 1: Add Base64 and write path traversal/size tests**

Run: `cd src-tauri && cargo add base64@0.23.0`

```rust
#[test]
fn reader_rejects_paths_outside_the_repository_and_non_markdown_documents() {
    assert_eq!(reader.read_document("../secret.md").unwrap_err().code, ErrorCode::DocumentPathInvalid);
    assert_eq!(reader.read_document("docs/data.json").unwrap_err().code, ErrorCode::DocumentPathInvalid);
}

#[test]
fn asset_reader_allows_repository_raster_images_and_rejects_oversized_files() {
    assert!(matches!(reader.read_asset("docs/images/map.png").unwrap(), DocumentAsset::Raster { mime_type, .. } if mime_type == "image/png"));
    assert_eq!(reader.read_asset("docs/images/huge.png").unwrap_err().code, ErrorCode::DocumentAssetTooLarge);
}
```

- [ ] **Step 2: Run and confirm RED**

Run: `cargo test documents::reader --lib`

- [ ] **Step 3: Implement canonical path containment and content contracts**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub summary: DocumentSummary,
    pub markdown: String,
    pub properties: serde_json::Value,
    pub table_of_contents: Vec<TableOfContentsItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DocumentAsset {
    Raster { mime_type: String, base64: String },
    Svg { source: String },
}
```

Canonicalize the existing target and require it to start with the canonical repository root. Documents must also be inside a configured document root. Assets may be anywhere inside the same repository when reached from a document-relative path. Allow PNG, JPEG, GIF, WebP and UTF-8 SVG; cap asset reads at 10 MiB. React sanitizes SVG before display.

Extract a flat TOC from Markdown heading events with stable slug+occurrence IDs. Do not remove the first H1 from the returned Markdown.

- [ ] **Step 4: Test invalid UTF-8, SVG and unchanged source files**

Record file bytes and modification time before/after reads. Assert they are identical. Verify an SVG containing `<script>` is returned as source, never pre-marked as trusted HTML.

- [ ] **Step 5: Run and commit**

```bash
cargo test documents::reader --lib
cargo fmt --check
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/documents src-tauri/src/error.rs
git commit -m "feat: read documents within repository boundaries"
```

---

### Task 8: Paginated Git Document History

**Files:**
- Create: `src-tauri/src/documents/history.rs`
- Modify: `src-tauri/src/documents/contract.rs`
- Modify: `src-tauri/src/documents/reader.rs`
- Modify: `src-tauri/src/documents/mod.rs`
- Modify: `src-tauri/src/error.rs`

**Interfaces:**
- Consumes: current document path, optional `okf_hub_id`, optional `HistoryCursor`.
- Produces: `history_page(limit=20) -> HistoryPage`, `read_version(commit_oid, path_at_commit) -> DocumentContent`.

- [ ] **Step 1: Write a failing temporary-repository history test**

Create three commits: add `docs/api.md`, rename it to `docs/map-api.md`, then edit it while keeping the same `okf_hub_id`.

```rust
#[test]
fn history_follows_a_renamed_document_and_paginates_without_duplicates() {
    let repo = history_fixture();
    let first = repo.history_page("docs/map-api.md", Some(document_id()), None, 2).unwrap();
    assert_eq!(first.items.len(), 2);
    let second = repo.history_page("docs/map-api.md", Some(document_id()), first.next_cursor, 2).unwrap();
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].path_at_commit, "docs/api.md");
}
```

- [ ] **Step 2: Run and confirm RED**

Run: `cargo test documents::history --lib`

- [ ] **Step 3: Implement the explicit page contract**

```rust
pub struct HistoryCursor {
    pub before_commit_oid: String,
    pub tracked_path: String,
}

pub struct HistoryItem {
    pub commit_oid: String,
    pub short_oid: String,
    pub path_at_commit: String,
    pub author_name: String,
    pub authored_at_unix: i64,
    pub message: String,
}
```

Walk from HEAD newest-first. Diff each commit with its first parent using git2 rename similarity detection; carry the prior path backward. When an ID exists, parse candidate blobs to confirm continuity. Without an ID, rely on rename detection and path history. Return exactly 20 by default and an explicit cursor when more matching commits exist.

Expose `latest_change(path, document_id) -> Option<DocumentCommitSummary>` using the same traversal primitives. `read_document` uses only this one-item query for the title-area author and commit time; opening the full History tab remains lazy.

In this task, extend `DocumentContent` with `last_commit: Option<DocumentCommitSummary>`. The core filesystem reader sets no Git value; the Task 9 command service enriches the response through `latest_change`, keeping filesystem parsing separate from Git traversal.

- [ ] **Step 4: Add version-read and unreachable/path escape tests**

Require a full 40-character commit OID that resolves to a commit reachable from HEAD. Use the `path_at_commit` returned by history, validate it as repository-relative, and read the blob without checking out or modifying the worktree.

- [ ] **Step 5: Run and commit**

```bash
cargo test documents::history --lib
cargo fmt --check
git add src-tauri/src/documents src-tauri/src/error.rs
git commit -m "feat: expose document commit history"
```

---

### Task 9: Tauri Document Session Commands

**Files:**
- Create: `src-tauri/src/commands/documents.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/settings/service.rs`

**Interfaces:**
- Consumes: current connected workspace from `LocalSettingsService`, app data directory, client UUID v4 IDs.
- Produces: Tauri commands and `okhub://documents/event` events.

- [ ] **Step 1: Write failing command-boundary tests**

Test inner functions without creating a Tauri window:

```rust
#[tokio::test]
async fn start_session_uses_the_saved_workspace_and_echoes_client_id() {
    let services = document_services_with_connected_workspace();
    let request_id = Uuid::new_v4();
    let snapshot = start_document_session_inner(&services, request_id).await.unwrap();
    assert_eq!(snapshot.session_id, request_id);
    assert_eq!(snapshot.workspace_id, workspace_id());
}

#[tokio::test]
async fn search_rejects_an_inactive_session() {
    let error = search_documents_inner(&services, old_id(), Uuid::new_v4(), "api".into(), 20).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::DocumentSessionStale);
}
```

- [ ] **Step 2: Run and confirm RED**

Run: `cargo test commands::documents --lib`

- [ ] **Step 3: Register runtime and exact commands**

Initialize `DocumentRuntime` with `app.path().app_data_dir()?.join("document-search")`. Register:

```text
start_document_session(requestId)
stop_document_session(sessionId)
refresh_document_session(sessionId)
search_documents(sessionId, requestId, query, limit)
read_document(sessionId, path)
read_document_asset(sessionId, documentPath, assetPath)
list_document_history(sessionId, path, cursor)
read_document_version(sessionId, commitOid, pathAtCommit)
```

The start command loads the current workspace from `LocalSettingsService`; it never accepts an arbitrary repository root from React. Validate UUID v4 before registering the session. Emit every runtime event as `okhub://documents/event` with the session ID.

`DocumentSessionSnapshot` also returns the workspace UUID, connected repository `fullName`, current Git branch, and valid `lastOpenedPath`. These public values let React label the current version, restore the last document and construct its GitHub blob URL without exposing an absolute local path.

- [ ] **Step 4: Test event-before-command-result and stale isolation**

Use a blocking command hook like the auth/clone tests. Publish `IndexStatusChanged` before resolving `start_document_session_inner`; assert it carries the supplied ID. Assert a stopped session cannot emit or mutate cache state through the command adapter.

- [ ] **Step 5: Run Rust verification and commit**

```bash
cargo test commands::documents --lib
cargo test --lib
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
git add src-tauri/src/commands src-tauri/src/state.rs src-tauri/src/lib.rs src-tauri/src/error.rs src-tauri/src/settings/service.rs
git commit -m "feat: add document session commands"
```

---

### Task 10: Frontend Gateway, Reducer, and Provider Ownership

**Files:**
- Create: `src/features/documents/model.ts`
- Create: `src/features/documents/DocumentsGateway.ts`
- Create: `src/features/documents/documents-reducer.ts`
- Create: `src/features/documents/documents-reducer.test.ts`
- Create: `src/features/documents/DocumentsProvider.tsx`
- Create: `src/features/documents/DocumentsProvider.test.tsx`
- Create: `src/infrastructure/documents/TauriDocumentsGateway.ts`
- Create: `src/infrastructure/documents/TauriDocumentsGateway.test.ts`
- Create: `src/infrastructure/documents/UnavailableDocumentsGateway.ts`
- Create: `src/infrastructure/documents/createDocumentsGateway.ts`
- Create: `src/test/FakeDocumentsGateway.ts`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: Task 9 command/event wire contract.
- Produces: `useDocuments()` with tree/index/search/selection/history state and actions.

- [ ] **Step 1: Define wire types and write stale reducer tests**

```ts
export type DocumentEvent =
  | { type: "tree_changed"; sessionId: string; catalog: DocumentCatalog }
  | { type: "index_status_changed"; sessionId: string; status: IndexStatus }
  | { type: "open_document_changed"; sessionId: string; path: string }
  | { type: "failed"; sessionId: string; error: AppError };

it("ignores events and search results owned by older requests", () => {
  const active = readyState({ sessionId: "new", searchRequestId: "query-new" });
  expect(reducer(active, staleTreeEvent("old"))).toBe(active);
  expect(reducer(active, searchSucceeded("query-old"))).toBe(active);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm test:run src/features/documents/documents-reducer.test.ts`

- [ ] **Step 3: Implement the gateway and reducer**

Define `DocumentsGateway` methods with the exact Task 9 arguments. The reducer owns `activeSessionId`, `activeSearchRequestId`, selected document/version, tree, index status and recoverable error. Return the identical state object for every stale action so providers can gate follow-up commands on reducer acceptance.

The gateway also exposes `copyText(value)` through `@tauri-apps/plugin-clipboard-manager` and `openExternal(url)` through the existing opener plugin. Tokens, absolute workspace paths and cache paths never enter this contract.

- [ ] **Step 4: Write provider ordering tests**

```tsx
it("subscribes, registers ownership, then starts the backend session", async () => {
  const gateway = new FakeDocumentsGateway();
  render(<DocumentsProvider gateway={gateway}><Probe /></DocumentsProvider>);
  await waitFor(() => expect(gateway.calls.slice(0, 2).map(c => c.method)).toEqual([
    "onDocumentEvent", "startSession"
  ]));
});

it("does not read or navigate from an event the reducer rejected", async () => {
  gateway.emit(staleOpenDocumentChanged("old-session", "docs/stale.md"));
  expect(gateway.calls.some(c => c.method === "readDocument")).toBe(false);
});
```

- [ ] **Step 5: Implement provider lifecycle**

On mount: create UUID v4, dispatch `sessionStarting`, await listener registration, then invoke `startSession(id)`. On unmount: call `stopSession(id)` and `unlisten`. For search, create a new request ID after debounce and dispatch ownership before calling the gateway. Only trigger `readDocument` after the reducer accepts selection/event ownership; do not add a provider-only `lastAction` ref.

- [ ] **Step 6: Run frontend tests and commit**

```bash
pnpm test:run src/features/documents src/infrastructure/documents
pnpm build
git add src/features/documents src/infrastructure/documents src/test/FakeDocumentsGateway.ts src/app/App.tsx
git commit -m "feat: manage document sessions in the frontend"
```

---

### Task 11: Documents Tree and Search Experience

**Files:**
- Create: `src/features/documents/components/DocumentTree.tsx`
- Create: `src/features/documents/components/DocumentTree.test.tsx`
- Create: `src/features/documents/components/DocumentSearch.tsx`
- Create: `src/features/documents/components/DocumentSearch.test.tsx`
- Create: `src/features/documents/documents.css`
- Modify: `src/components/patterns/AppSidebar.tsx`
- Modify: `src/components/patterns/AppSidebar.test.tsx`
- Modify: `src/pages/DocumentsPage.tsx`
- Create: `src/pages/DocumentsPage.test.tsx`

**Interfaces:**
- Consumes: `useDocuments()` tree, index status, search results and selection action.
- Produces: accessible folder tree in the app sidebar and Documents search home.

- [ ] **Step 1: Write failing tree behavior tests**

```tsx
it("expands folders without navigating and opens documents", async () => {
  const user = userEvent.setup();
  renderDocumentsWithCatalog(catalogFixture());
  await user.click(screen.getByRole("treeitem", { name: "api" }));
  expect(screen.getByRole("treeitem", { name: "지도 API" })).toBeVisible();
  await user.click(screen.getByRole("treeitem", { name: "지도 API" }));
  expect(fakeGateway.lastReadPath).toBe("docs/api/map.md");
});
```

Assert keyboard ArrowRight/ArrowLeft behavior, `aria-expanded`, selected item, long-label tooltip, empty roots, and that no search field appears in the sidebar.

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm test:run src/features/documents/components/DocumentTree.test.tsx src/components/patterns/AppSidebar.test.tsx`

- [ ] **Step 3: Implement route-context tree in AppSidebar**

Use `useLocation()` and render `DocumentTree` below the main navigation only while pathname starts with `/documents`. Keep Home/Documents/Project/Settings as one item per row. Folder buttons only expand/collapse; document buttons select/open. Do not add create controls in this read-only stage.

- [ ] **Step 4: Write failing search and loading-state tests**

```tsx
it("shows title and path results while body indexing is preparing", async () => {
  renderDocuments({ indexStatus: { status: "preparing", indexed: 3, total: 100 } });
  expect(screen.getByText("본문 검색을 준비하는 중… 3/100")).toBeVisible();
  await userEvent.type(screen.getByRole("searchbox", { name: "문서 검색" }), "api");
  expect(await screen.findByText("지도 API")).toBeVisible();
});
```

Assert the search result shows title, repository-relative path and snippet; selecting it opens the document and forwards `matchField` plus `matchText`. Assert a newer query replaces an older pending query.

- [ ] **Step 5: Implement Documents home and feature styles**

Use the approved compact search row. Do not implement Type/Status/Feature filters because their schema is unresolved. When no document is selected, show the search home and a flat all-documents list derived from the catalog. Provide retry/Settings links for invalid roots and degraded cache states.

- [ ] **Step 6: Run accessibility tests and commit**

```bash
pnpm test:run src/features/documents/components src/pages/DocumentsPage.test.tsx src/components/patterns/AppSidebar.test.tsx
pnpm build
git add src/features/documents/components/DocumentTree* src/features/documents/components/DocumentSearch* src/features/documents/documents.css src/components/patterns/AppSidebar* src/pages/DocumentsPage*
git commit -m "feat: browse and search workspace documents"
```

---

### Task 12: Safe GFM and Mermaid Rendering

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/documents/components/MarkdownDocument.tsx`
- Create: `src/features/documents/components/MarkdownDocument.test.tsx`
- Create: `src/features/documents/components/MermaidBlock.tsx`
- Create: `src/features/documents/components/MermaidBlock.test.tsx`
- Create: `src/features/documents/remark-literal-html.ts`
- Modify: `src/features/documents/documents.css`

**Interfaces:**
- Consumes: `DocumentContent.markdown`, current document path and gateway link/asset actions.
- Produces: safe rendered document with heading anchors, internal links, repository images and Mermaid blocks.

- [ ] **Step 1: Install renderer dependencies and write security-first failing tests**

Run:

```bash
pnpm add react-markdown@^10 remark-gfm@^4 rehype-sanitize@^6 mermaid@^11 dompurify@^3
```

```tsx
it("renders raw HTML as text and never creates executable elements", () => {
  renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  expect(screen.getByText(/<img src=x/)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector("img[src='x']")).toBeNull();
});

it("rejects javascript links and routes relative markdown links internally", async () => {
  renderMarkdown('[bad](javascript:alert(1)) [API](../api.md)');
  expect(screen.getByRole("link", { name: "bad" })).not.toHaveAttribute("href", expect.stringContaining("javascript:"));
  await userEvent.click(screen.getByRole("link", { name: "API" }));
  expect(fakeGateway.lastSelectedPath).toBe("docs/api.md");
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `pnpm test:run src/features/documents/components/MarkdownDocument.test.tsx`

- [ ] **Step 3: Implement literal HTML, GFM and URL policy**

Use a local remark plugin that recursively replaces mdast `html` nodes with `text` nodes before `react-markdown`. Add `remark-gfm` and `rehype-sanitize`; do not add `rehype-raw`. Keep `react-markdown`'s safe URL transform and additionally permit only `http`, `https`, `mailto`, fragment anchors and validated relative paths.

Custom components must:

- assign the Rust-provided TOC slug sequence to headings,
- route relative `.md` links through `selectDocument`,
- open `http/https` through the Tauri opener,
- request relative images through `readDocumentAsset`,
- show an explicit unsupported-file message for other relative links.

When navigation came from a search result, add a local rehype transform that wraps only the first visible matching text node in `<mark data-search-match>`. After render, scroll that mark into view. For title/path matches, focus and scroll the document header instead. Include `mark` in the sanitize schema and never inject the query as HTML.

- [ ] **Step 4: Write failing Mermaid and SVG sanitization tests**

Mock `mermaid.render` to return SVG containing a script, event attribute and external URL. Assert DOMPurify removes all three. Assert Mermaid rejection renders the fenced source plus `다이어그램을 표시할 수 없습니다.` without crashing the rest of the document.

- [ ] **Step 5: Implement MermaidBlock and repository images**

Initialize Mermaid once with:

```ts
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
```

Render each diagram with a unique ID, cancel DOM updates after unmount, sanitize with DOMPurify's SVG profile, and only then insert the SVG. Sanitize repository SVG assets through the same path; raster assets use the Rust-provided MIME and Base64 data URL.

- [ ] **Step 6: Run tests, build and commit**

```bash
pnpm test:run src/features/documents/components/MarkdownDocument.test.tsx src/features/documents/components/MermaidBlock.test.tsx
pnpm build
git add package.json pnpm-lock.yaml src/features/documents/components src/features/documents/remark-literal-html.ts src/features/documents/documents.css
git commit -m "feat: render OKF Markdown safely"
```

---

### Task 13: Document Detail, Overview, and History UI

**Files:**
- Create: `src/features/documents/components/DocumentReader.tsx`
- Create: `src/features/documents/components/DocumentReader.test.tsx`
- Create: `src/features/documents/components/DocumentOverview.tsx`
- Create: `src/features/documents/components/DocumentHistory.tsx`
- Create: `src/features/documents/components/DocumentHistory.test.tsx`
- Modify: `src/features/documents/DocumentsProvider.tsx`
- Modify: `src/features/documents/documents-reducer.ts`
- Modify: `src/pages/DocumentsPage.tsx`
- Modify: `src/features/documents/documents.css`

**Interfaces:**
- Consumes: read/history/version gateway methods and Task 12 renderer.
- Produces: three-pane detail flow and lazy paginated History.

- [ ] **Step 1: Write failing detail layout and frontmatter warning tests**

```tsx
it("shows properties before the table of contents and keeps invalid documents readable", async () => {
  renderSelectedDocument(invalidFrontmatterDocument());
  const properties = await screen.findByRole("region", { name: "문서 속성" });
  const toc = screen.getByRole("navigation", { name: "목차" });
  expect(properties.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/frontmatter를 읽을 수 없습니다/)).toBeVisible();
  expect(screen.getByText("본문은 계속 표시됩니다")).toBeVisible();
});
```

- [ ] **Step 2: Implement reader header and context panel**

Display title, `확정본 · <current branch>` and last modified summary. Main content is read-only. The collapsible right panel has `개요 / 연결 / History`; omit 댓글 until review context exists. `개요` orders properties then TOC. `연결` shows an empty explanation until relation parsing is implemented; it must not invent relations.

Add the approved read-only overflow actions:

```text
문서 링크 복사       → [title](repository-relative-path) Markdown link
Git 파일 경로 복사  → repository-relative-path only
GitHub에서 보기      → https://github.com/{fullName}/blob/{branch}/{encodedPath}
```

Do not show path rename, duplicate or delete-proposal actions until the document-change workflow exists. Test clipboard text exactly and open the GitHub URL through the gateway rather than `window.open`.

- [ ] **Step 3: Write failing lazy history tests**

Assert no history command runs before the History tab is selected; the first call uses limit 20; `더 불러오기` sends the returned cursor; choosing a commit shows `과거 버전` and `현재 문서로 돌아가기`; stale history pages from another document are ignored.

- [ ] **Step 4: Implement history/version ownership**

Add `activeHistoryPath` and `activeVersionRequestId` to reducer state. Register request ownership before each gateway call. Pass `pathAtCommit` from the selected `HistoryItem` into `readDocumentVersion`. Never checkout, mutate the worktree, or replace the current catalog selection when showing a historical blob.

- [ ] **Step 5: Add external file-change and deleted-selection tests**

When an accepted `open_document_changed` event matches the selected path, re-read it and show `외부 변경사항을 반영했습니다.`. When a tree update removes the selected path, clear selection, return to Documents home, and show `선택한 문서가 삭제되었습니다.`.

Add a restart test where `lastOpenedPath` exists and is automatically read after session acceptance, plus a missing-path test that remains on Documents home and clears the stale cache value.

- [ ] **Step 6: Run and commit**

```bash
pnpm test:run src/features/documents src/pages/DocumentsPage.test.tsx
pnpm build
git add src/features/documents src/pages/DocumentsPage.tsx
git commit -m "feat: show document details and history"
```

---

### Task 14: End-to-end Boundaries, Performance Fixtures, and Documentation

**Files:**
- Create: `src-tauri/src/documents/performance_tests.rs`
- Modify: `src-tauri/src/documents/mod.rs`
- Modify: `src/app/App.test.tsx`
- Modify: `src/pages/DocumentsPage.test.tsx`
- Modify: `docs/superpowers/specs/2026-07-31-documents-exploration-reading-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-okhub-mvp-roadmap.md`

**Interfaces:**
- Consumes: all Tasks 1–10.
- Produces: verified Stage 2 slice and updated completion record.

- [ ] **Step 1: Add a deterministic large-workspace fixture test**

Generate 3,000 small Markdown files under a temporary `docs/` root. Use a body source gate rather than a wall-clock-only assertion:

```rust
#[tokio::test]
async fn three_thousand_document_tree_is_returned_before_body_gate_opens() {
    let fixture = LargeWorkspace::new(3_000);
    let runtime = fixture.runtime_with_blocked_bodies();
    let snapshot = runtime.start_session(Uuid::new_v4(), fixture.workspace()).await.unwrap();
    assert_eq!(snapshot.catalog.documents.len(), 3_000);
    assert_eq!(fixture.body_read_count(), 0);
}
```

Also record a non-gating benchmark log for cold index and warm reconcile so regressions are visible without making CI depend on machine speed.

- [ ] **Step 2: Add full app boundary tests**

Render `App` with a connected `FakeWorkspaceConnectionGateway` and `FakeDocumentsGateway`. Navigate to Documents, expand a folder, search, open a document, render a Mermaid block, open History, view an old version, and return to current. Assert unmount stops the session and listener count returns to zero.

- [ ] **Step 3: Add security and no-write regression tests**

Cover raw HTML, JavaScript URLs, repository traversal, oversized asset, invalid frontmatter, stale session/search/history IDs, corrupt cache rebuild, and byte-for-byte unchanged Markdown after discovery/read/search/history.

- [ ] **Step 4: Run the complete verification matrix**

Run:

```bash
pnpm test:run
pnpm build
cd src-tauri
cargo test --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
cargo check --locked
cd ..
pnpm tauri build --debug --bundles app
```

Expected: every command exits 0 and the macOS `.app` bundle is produced. On Windows CI, require the existing Rust check, frontend build and Tauri compile job to pass.

- [ ] **Step 5: Perform manual desktop acceptance**

Use an OKF repository containing valid, missing and invalid frontmatter, nested folders, a large document, GFM table/task list, Mermaid, relative image and at least two Git commits. Confirm:

```text
Documents tree appears before body indexing completes
Search changes from title/path-only to body-ready without reload
External editor changes update one document
Raw HTML does not execute
Relative repository image displays; ../ escape is rejected
History loads 20 at a time and old versions are visibly read-only
Restart reuses cache and only changed files are indexed
```

- [ ] **Step 6: Update approved docs and commit**

Mark Stage 2 as implemented only after all automated and manual checks pass. Record actual dependency versions and any accepted deviation in the approved spec; do not add visual iteration history.

```bash
git add src-tauri/src/documents/performance_tests.rs src-tauri/src/documents/mod.rs src/app/App.test.tsx src/pages/DocumentsPage.test.tsx docs/superpowers/specs/2026-07-31-documents-exploration-reading-design.md docs/superpowers/plans/2026-07-23-okhub-mvp-roadmap.md
git commit -m "test: verify document exploration flow"
```

---

## Self-review Results

- **Spec coverage:** document roots, `.md` scope, title fallback, invalid frontmatter, tree-first startup, local cache, incremental indexing, search ranking/snippet, safe GFM/Mermaid, relative assets, current/history versions, stale ownership, error isolation and no-write guarantees each map to at least one task.
- **Scope control:** new document, editing, PR proposal versions, comments, code/OpenAPI browsing, AI search and unresolved metadata filters are explicitly excluded.
- **Type consistency:** Rust `session_id/request_id` serialize to frontend `sessionId/requestId`; history always uses `pathAtCommit`; provider and reducer use the same client-created UUID v4 ownership model.
- **Completeness scan:** every task identifies files, signatures, failing tests, implementation behavior, verification commands and a commit boundary; no unfinished marker remains.
