use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

use super::contract::{
    DocumentSummary, ReconcileDelta, SearchMatchField, SearchResponse, SearchResult,
};
use super::search_text::markdown_to_plain_text;

const INDEX_VERSION: i64 = 1;

#[derive(Debug, Error)]
pub enum CacheError {
    #[error("cache file operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("SQLite cache operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("document size cannot be represented by SQLite: {0}")]
    SizeOverflow(u64),
    #[error("document is not valid UTF-8: {path}")]
    InvalidUtf8 {
        path: String,
        #[source]
        source: std::str::Utf8Error,
    },
}

pub struct DocumentCache {
    connection: Connection,
}

impl DocumentCache {
    pub fn open(path: impl AsRef<Path>, workspace_id: Uuid) -> Result<Self, CacheError> {
        let path = path.as_ref();
        if path.exists() {
            let connection = Connection::open(path)?;
            if identity_matches(&connection, workspace_id) {
                return Ok(Self { connection });
            }
            drop(connection);
            std::fs::rename(path, invalid_cache_path(path))?;
        }

        let mut connection = Connection::open(path)?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
             );",
        )?;
        transaction.execute(
            "INSERT INTO meta (key, value) VALUES ('index_version', ?1)",
            params![INDEX_VERSION],
        )?;
        transaction.execute(
            "INSERT INTO meta (key, value) VALUES ('workspace_id', ?1)",
            params![workspace_id.to_string()],
        )?;
        transaction.commit()?;
        Ok(Self { connection })
    }

    pub fn index_version(&self) -> Result<i64, CacheError> {
        Ok(self.connection.query_row(
            "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'index_version'",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn has_table(&self, name: &str) -> Result<bool, CacheError> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?1)",
            params![name],
            |row| row.get(0),
        )?)
    }

    pub fn reconcile_metadata(
        &mut self,
        summaries: &[DocumentSummary],
    ) -> Result<ReconcileDelta, CacheError> {
        let transaction = self.connection.transaction()?;
        let mut to_index = Vec::new();
        for summary in summaries {
            let size = sqlite_size(summary.size)?;
            let document_id = summary.document_id.map(|id| id.to_string());
            let frontmatter_status_json = serde_json::to_string(&summary.frontmatter_status)
                .expect("serializing enum cannot fail");
            let stored = transaction.query_row(
                "SELECT file_name, title, document_id, frontmatter_status_json,
                        modified_at_unix_ms, size
                 FROM documents WHERE path = ?1",
                params![summary.path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            );
            let unchanged = matches!(
                stored,
                Ok((file_name, title, stored_document_id, stored_frontmatter, modified, stored_size))
                    if file_name == summary.file_name
                        && title == summary.title
                        && stored_document_id == document_id
                        && stored_frontmatter == frontmatter_status_json
                        && modified == summary.modified_at_unix_ms
                        && stored_size == size
            );
            if !unchanged {
                to_index.push(summary.path.clone());
            }
        }

        let stored_paths = {
            let mut statement = transaction.prepare("SELECT path FROM documents ORDER BY path")?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let current_paths = summaries
            .iter()
            .map(|summary| summary.path.as_str())
            .collect::<std::collections::HashSet<_>>();
        let deleted = stored_paths
            .into_iter()
            .filter(|path| !current_paths.contains(path.as_str()))
            .collect::<Vec<_>>();
        for path in &deleted {
            transaction.execute(
                "DELETE FROM document_search
                 WHERE rowid = (SELECT rowid FROM documents WHERE path = ?1)",
                params![path],
            )?;
            transaction.execute("DELETE FROM documents WHERE path = ?1", params![path])?;
        }
        transaction.commit()?;
        Ok(ReconcileDelta { to_index, deleted })
    }

    pub fn upsert_content(
        &mut self,
        summary: &DocumentSummary,
        markdown: &[u8],
    ) -> Result<(), CacheError> {
        let markdown = std::str::from_utf8(markdown).map_err(|source| CacheError::InvalidUtf8 {
            path: summary.path.clone(),
            source,
        })?;
        let content_hash = sha256_hex(markdown.as_bytes());
        let body_text = markdown_to_plain_text(markdown);
        let size = sqlite_size(summary.size)?;
        let document_id = summary.document_id.map(|id| id.to_string());
        let frontmatter_status_json = serde_json::to_string(&summary.frontmatter_status)
            .expect("serializing enum cannot fail");

        let transaction = self.connection.transaction()?;
        let stored = transaction
            .query_row(
                "SELECT rowid, content_hash FROM documents WHERE path = ?1",
                params![summary.path],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;

        if let Some((_, Some(stored_hash))) = &stored {
            if stored_hash == &content_hash {
                transaction.execute(
                    "UPDATE documents SET
                       file_name = ?2, title = ?3, document_id = ?4,
                       frontmatter_status_json = ?5, modified_at_unix_ms = ?6, size = ?7
                     WHERE path = ?1",
                    params![
                        summary.path,
                        summary.file_name,
                        summary.title,
                        document_id,
                        frontmatter_status_json,
                        summary.modified_at_unix_ms,
                        size,
                    ],
                )?;
                transaction.commit()?;
                return Ok(());
            }
        }

        let rowid = if let Some((rowid, _)) = stored {
            transaction.execute(
                "UPDATE documents SET
                   file_name = ?2, title = ?3, document_id = ?4,
                   frontmatter_status_json = ?5, modified_at_unix_ms = ?6, size = ?7,
                   content_hash = ?8, body_text = ?9
                 WHERE path = ?1",
                params![
                    summary.path,
                    summary.file_name,
                    summary.title,
                    document_id,
                    frontmatter_status_json,
                    summary.modified_at_unix_ms,
                    size,
                    content_hash,
                    body_text,
                ],
            )?;
            transaction.execute(
                "DELETE FROM document_search WHERE rowid = ?1",
                params![rowid],
            )?;
            rowid
        } else {
            transaction.execute(
                "INSERT INTO documents (
                   path, file_name, title, document_id, frontmatter_status_json,
                   modified_at_unix_ms, size, content_hash, body_text
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    summary.path,
                    summary.file_name,
                    summary.title,
                    document_id,
                    frontmatter_status_json,
                    summary.modified_at_unix_ms,
                    size,
                    content_hash,
                    body_text,
                ],
            )?;
            transaction.last_insert_rowid()
        };
        transaction.execute(
            "INSERT INTO document_search (rowid, path, title, body_text)
             VALUES (?1, ?2, ?3, ?4)",
            params![rowid, summary.path, summary.title, body_text],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<SearchResponse, CacheError> {
        let query = query.trim();
        if query.is_empty() || limit == 0 {
            return Ok(SearchResponse { items: Vec::new() });
        }

        let like = literal_like_pattern(query);
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let rows = if query.chars().count() >= 3 {
            let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
            self.query_search_rows(
                "SELECT path, title, COALESCE(body_text, '')
                 FROM documents
                 WHERE rowid IN (
                   SELECT rowid FROM document_search WHERE document_search MATCH ?2
                 ) OR path LIKE ?3 ESCAPE '\\' COLLATE NOCASE
                 ORDER BY CASE
                   WHEN title = ?1 COLLATE NOCASE THEN 0
                   WHEN title LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 1
                   WHEN path LIKE ?3 ESCAPE '\\' COLLATE NOCASE THEN 2
                   ELSE 3
                 END, path
                 LIMIT ?4",
                params![query, fts_query, like, limit],
            )?
        } else {
            self.query_search_rows(
                "SELECT path, title, COALESCE(body_text, '')
                 FROM documents
                 WHERE title LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                    OR path LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                    OR body_text LIKE ?2 ESCAPE '\\' COLLATE NOCASE
                 ORDER BY CASE
                   WHEN title = ?1 COLLATE NOCASE THEN 0
                   WHEN title LIKE ?2 ESCAPE '\\' COLLATE NOCASE THEN 1
                   WHEN path LIKE ?2 ESCAPE '\\' COLLATE NOCASE THEN 2
                   ELSE 3
                 END, path
                 LIMIT ?3",
                params![query, like, limit],
            )?
        };

        Ok(SearchResponse {
            items: rows
                .into_iter()
                .map(|(path, title, body)| search_result(path, title, body, query))
                .collect(),
        })
    }

    fn query_search_rows<P: rusqlite::Params>(
        &self,
        sql: &str,
        params: P,
    ) -> Result<Vec<(String, String, String)>, CacheError> {
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement
            .query_map(params, |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn sqlite_size(size: u64) -> Result<i64, CacheError> {
    i64::try_from(size).map_err(|_| CacheError::SizeOverflow(size))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn literal_like_pattern(query: &str) -> String {
    let escaped = query
        .split_whitespace()
        .map(|part| {
            part.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        })
        .collect::<Vec<_>>()
        .join("%");
    format!("%{escaped}%")
}

fn search_result(path: String, title: String, body: String, query: &str) -> SearchResult {
    let (match_field, matched_value, span) = if let Some(span) = match_span(&title, query) {
        (SearchMatchField::Title, title.as_str(), span)
    } else if let Some(span) = match_span(&path, query) {
        (SearchMatchField::Path, path.as_str(), span)
    } else {
        (
            SearchMatchField::Body,
            body.as_str(),
            match_span(&body, query).unwrap_or((0, 0)),
        )
    };
    let match_text = matched_value[span.0..span.1].to_owned();
    let snippet = bounded_snippet(matched_value, span);
    SearchResult {
        path,
        title,
        match_field,
        match_text,
        snippet,
    }
}

fn match_span(value: &str, query: &str) -> Option<(usize, usize)> {
    let mut search_from = 0;
    let mut first = None;
    let mut end = 0;
    for part in query.split_whitespace() {
        let remaining = &value[search_from..];
        let relative = remaining.find(part).or_else(|| {
            let lowercase = remaining.to_lowercase();
            let part = part.to_lowercase();
            lowercase.find(&part).filter(|index| {
                remaining.is_char_boundary(*index)
                    && remaining.is_char_boundary(index.saturating_add(part.len()))
            })
        })?;
        let start = search_from + relative;
        end = start + part.len();
        first.get_or_insert(start);
        search_from = end;
    }
    first.map(|start| (start, end))
}

fn bounded_snippet(value: &str, span: (usize, usize)) -> String {
    const CONTEXT_CHARS: usize = 60;

    let chars = value.chars().collect::<Vec<_>>();
    let match_start = value[..span.0].chars().count();
    let match_end = value[..span.1].chars().count();
    let from = match_start.saturating_sub(CONTEXT_CHARS);
    let to = (match_end + CONTEXT_CHARS).min(chars.len());
    let mut snippet = String::new();
    if from > 0 {
        snippet.push('…');
    }
    snippet.extend(chars[from..to].iter());
    if to < chars.len() {
        snippet.push('…');
    }
    snippet
}

fn identity_matches(connection: &Connection, workspace_id: Uuid) -> bool {
    let value = |key| {
        connection.query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
    };
    matches!(value("index_version"), Ok(version) if version == INDEX_VERSION.to_string())
        && matches!(value("workspace_id"), Ok(id) if id == workspace_id.to_string())
}

fn invalid_cache_path(path: &Path) -> PathBuf {
    let mut unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    loop {
        let candidate = path.with_file_name(format!("search.invalid-{unix}.sqlite3"));
        if !candidate.exists() {
            return candidate;
        }
        unix += 1;
    }
}

#[cfg(test)]
mod tests {
    use crate::documents::contract::{DocumentSummary, FrontmatterStatus, SearchMatchField};
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{CacheError, DocumentCache};

    fn workspace_id() -> Uuid {
        Uuid::parse_str("9f9e8ac7-cf5a-4f83-b716-0b52e69fb9d6").unwrap()
    }

    fn summary(path: &str, modified_at_unix_ms: i64, size: u64) -> DocumentSummary {
        DocumentSummary {
            path: path.to_owned(),
            file_name: path.rsplit('/').next().unwrap().to_owned(),
            title: path
                .trim_end_matches(".md")
                .rsplit('/')
                .next()
                .unwrap()
                .to_owned(),
            document_id: None,
            frontmatter_status: FrontmatterStatus::Missing,
            modified_at_unix_ms,
            size,
        }
    }

    fn seed(cache: &DocumentCache, summary: &DocumentSummary, body: &str) {
        cache
            .connection
            .execute(
                "INSERT INTO documents (
                   path, file_name, title, document_id, frontmatter_status_json,
                   modified_at_unix_ms, size, content_hash, body_text
                 ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, 'seed-hash', ?7)",
                rusqlite::params![
                    summary.path,
                    summary.file_name,
                    summary.title,
                    serde_json::to_string(&summary.frontmatter_status).unwrap(),
                    summary.modified_at_unix_ms,
                    i64::try_from(summary.size).unwrap(),
                    body,
                ],
            )
            .unwrap();
        let rowid = cache.connection.last_insert_rowid();
        cache
            .connection
            .execute(
                "INSERT INTO document_search (rowid, path, title, body_text)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![rowid, summary.path, summary.title, body],
            )
            .unwrap();
    }

    #[test]
    fn opening_a_new_cache_creates_versioned_documents_and_trigram_fts() {
        let temp = tempdir().unwrap();
        let cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        assert_eq!(cache.index_version().unwrap(), 1);
        assert!(cache.has_table("documents").unwrap());
        assert!(cache.has_table("document_search").unwrap());
    }

    #[test]
    fn identity_mismatches_preserve_invalid_database_and_create_clean_cache() {
        for (case, key, value) in [
            ("version", "index_version", "999"),
            (
                "workspace",
                "workspace_id",
                "0f2df13c-849f-4d20-af63-224b500547c5",
            ),
        ] {
            let temp = tempdir().unwrap();
            let case_dir = temp.path().join(case);
            std::fs::create_dir(&case_dir).unwrap();
            let path = case_dir.join("search.sqlite3");
            drop(DocumentCache::open(&path, workspace_id()).unwrap());

            let connection = rusqlite::Connection::open(&path).unwrap();
            connection
                .execute("UPDATE meta SET value = ?1 WHERE key = ?2", [value, key])
                .unwrap();
            connection
                .execute("CREATE TABLE marker (value TEXT)", [])
                .unwrap();
            drop(connection);

            let rebuilt = DocumentCache::open(&path, workspace_id()).unwrap();
            assert_eq!(rebuilt.index_version().unwrap(), 1);
            assert!(!rebuilt.has_table("marker").unwrap());
            assert_eq!(
                std::fs::read_dir(&case_dir)
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter(|entry| entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("search.invalid-"))
                    .count(),
                1
            );
        }
    }

    #[test]
    fn repeated_identity_mismatches_never_overwrite_preserved_invalid_caches() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("search.sqlite3");
        drop(DocumentCache::open(&path, workspace_id()).unwrap());

        for invalid_version in ["2", "3"] {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection
                .execute(
                    "UPDATE meta SET value = ?1 WHERE key = 'index_version'",
                    [invalid_version],
                )
                .unwrap();
            drop(connection);
            drop(DocumentCache::open(&path, workspace_id()).unwrap());
        }

        assert_eq!(
            std::fs::read_dir(temp.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("search.invalid-"))
                .count(),
            2
        );
    }

    #[test]
    fn reconcile_returns_only_new_changed_and_deleted_paths() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        seed(&cache, &summary("docs/old.md", 10, 100), "old body");

        let delta = cache
            .reconcile_metadata(&[
                summary("docs/old.md", 10, 100),
                summary("docs/new.md", 20, 200),
            ])
            .unwrap();

        assert_eq!(delta.to_index, vec!["docs/new.md"]);
        assert!(delta.deleted.is_empty());
    }

    #[test]
    fn reconcile_detects_changed_metadata_and_removes_absent_paths() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let unchanged = summary("docs/unchanged.md", 10, 100);
        let mut changed = summary("docs/changed.md", 10, 100);
        let deleted = summary("docs/deleted.md", 10, 100);
        seed(&cache, &unchanged, "unchanged body");
        seed(&cache, &changed, "changed body");
        seed(&cache, &deleted, "deleted body");
        changed.title = "Changed title".to_owned();

        let delta = cache
            .reconcile_metadata(&[unchanged, changed, summary("docs/new.md", 20, 200)])
            .unwrap();

        assert_eq!(delta.to_index, ["docs/changed.md", "docs/new.md"]);
        assert_eq!(delta.deleted, ["docs/deleted.md"]);
    }

    #[test]
    fn search_ranks_exact_title_before_title_path_and_body_matches() {
        let temp = tempdir().unwrap();
        let cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        for (path, title, body) in [
            (
                "docs/body.md",
                "본문 일치",
                "이 문서는 지도 검색을 설명합니다.",
            ),
            ("docs/path/지도-검색.md", "경로 일치", "다른 본문"),
            ("docs/title.md", "지도 검색 안내", "다른 본문"),
            ("docs/exact.md", "지도 검색", "다른 본문"),
        ] {
            let mut item = summary(path, 10, 100);
            item.title = title.to_owned();
            seed(&cache, &item, body);
        }

        let result = cache.search("지도 검색", 20).unwrap();

        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.path.as_str())
                .collect::<Vec<_>>(),
            [
                "docs/exact.md",
                "docs/title.md",
                "docs/path/지도-검색.md",
                "docs/body.md"
            ]
        );
    }

    #[test]
    fn same_content_hash_updates_metadata_without_rewriting_fts_row() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let original = summary("docs/map.md", 10, 100);
        cache
            .upsert_content(&original, b"# Map\nsearchable body")
            .unwrap();
        cache
            .connection
            .execute(
                "UPDATE document_search SET body_text = 'fts sentinel' WHERE path = ?1",
                [&original.path],
            )
            .unwrap();

        let touched = summary("docs/map.md", 20, 100);
        cache
            .upsert_content(&touched, b"# Map\nsearchable body")
            .unwrap();

        let modified: i64 = cache
            .connection
            .query_row(
                "SELECT modified_at_unix_ms FROM documents WHERE path = ?1",
                [&touched.path],
                |row| row.get(0),
            )
            .unwrap();
        let fts_body: String = cache
            .connection
            .query_row(
                "SELECT body_text FROM document_search WHERE path = ?1",
                [&touched.path],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(modified, 20);
        assert_eq!(fts_body, "fts sentinel");
    }

    #[test]
    fn upsert_stores_the_sha256_content_hash() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let document = summary("docs/hash.md", 10, 3);

        cache.upsert_content(&document, b"abc").unwrap();

        let hash: String = cache
            .connection
            .query_row(
                "SELECT content_hash FROM documents WHERE path = ?1",
                [&document.path],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn invalid_utf8_fails_only_that_document_and_preserves_other_cached_documents() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let good = summary("docs/good.md", 10, 100);
        cache
            .upsert_content(&good, "# Good\n검색 가능한 본문".as_bytes())
            .unwrap();

        let bad = summary("docs/bad.md", 20, 3);
        let result = cache.upsert_content(&bad, &[0xff, 0xfe, 0xfd]);

        assert!(matches!(
            result,
            Err(CacheError::InvalidUtf8 { path, .. }) if path == "docs/bad.md"
        ));
        assert_eq!(
            cache.search("검색 가능", 20).unwrap().items[0].path,
            good.path
        );
    }

    #[test]
    fn body_match_returns_match_text_and_bounded_context_without_byte_offset() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let document = summary("docs/long.md", 10, 1_000);
        let markdown = format!("{} 지도 검색 {}", "앞".repeat(100), "뒤".repeat(100));
        cache
            .upsert_content(&document, markdown.as_bytes())
            .unwrap();

        let item = cache.search("지도 검색", 20).unwrap().items.remove(0);

        assert_eq!(item.match_field, SearchMatchField::Body);
        assert_eq!(item.match_text, "지도 검색");
        assert!(item.snippet.contains("지도 검색"));
        assert!(item.snippet.chars().count() <= 130);
        assert!(item.snippet.starts_with('…'));
        assert!(item.snippet.ends_with('…'));
        let json = serde_json::to_value(item).unwrap();
        assert_eq!(json["matchField"], "body");
        assert_eq!(json["matchText"], "지도 검색");
        assert!(json.get("offset").is_none());
    }

    #[test]
    fn reconcile_deletes_missing_paths_from_documents_and_fts_together() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let document = summary("docs/deleted.md", 10, 100);
        cache
            .upsert_content(&document, b"searchable deleted body")
            .unwrap();

        let delta = cache.reconcile_metadata(&[]).unwrap();

        assert_eq!(delta.deleted, ["docs/deleted.md"]);
        let documents: i64 = cache
            .connection
            .query_row("SELECT count(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        let fts: i64 = cache
            .connection
            .query_row("SELECT count(*) FROM document_search", [], |row| row.get(0))
            .unwrap();
        assert_eq!(documents, 0);
        assert_eq!(fts, 0);
    }

    #[test]
    fn one_and_two_character_queries_use_literal_like_matching() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        for (path, title, body) in [
            ("docs/percent.md", "100% 안내", "다른 본문"),
            ("docs/plain.md", "1000 안내", "지도 본문"),
        ] {
            let mut document = summary(path, 10, 100);
            document.title = title.to_owned();
            cache.upsert_content(&document, body.as_bytes()).unwrap();
        }

        let percent = cache.search("%", 20).unwrap();
        assert_eq!(
            percent
                .items
                .iter()
                .map(|item| item.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/percent.md"]
        );
        let korean = cache.search("지도", 20).unwrap();
        assert_eq!(korean.items[0].path, "docs/plain.md");
    }

    #[test]
    fn long_queries_with_fts_syntax_are_bound_as_literal_parameters() {
        let temp = tempdir().unwrap();
        let mut cache =
            DocumentCache::open(temp.path().join("search.sqlite3"), workspace_id()).unwrap();
        let mut quoted = summary("docs/quoted.md", 10, 100);
        quoted.title = "literal \"quote\"".to_owned();
        cache.upsert_content(&quoted, b"safe body").unwrap();
        let other = summary("docs/other.md", 10, 100);
        cache.upsert_content(&other, b"unrelated body").unwrap();

        let result = cache.search("\"quote", 20).unwrap();

        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.path.as_str())
                .collect::<Vec<_>>(),
            ["docs/quoted.md"]
        );
    }
}
