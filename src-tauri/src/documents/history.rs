use std::path::{Component, Path, PathBuf};

use git2::{Delta, DiffFindOptions, ObjectType, Oid, Repository};
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};

use super::contract::{
    DocumentCommitSummary, DocumentContent, HistoryCursor, HistoryItem, HistoryPage,
};
use super::frontmatter::parse_document_reader;
use super::reader::document_content_from_bytes;

pub const DEFAULT_HISTORY_PAGE_LIMIT: usize = 20;

pub struct DocumentHistory {
    repository_root: PathBuf,
}

impl DocumentHistory {
    pub fn open(repository_root: &Path) -> Result<Self, AppError> {
        let repository = Repository::open(repository_root).map_err(history_git_error)?;
        let root = repository
            .workdir()
            .ok_or_else(|| history_error("bare repositories are not supported"))?
            .canonicalize()
            .map_err(|error| history_error(error.to_string()))?;
        Ok(Self {
            repository_root: root,
        })
    }

    pub fn history_page(
        &self,
        current_path: &str,
        document_id: Option<Uuid>,
        cursor: Option<HistoryCursor>,
        limit: usize,
    ) -> Result<HistoryPage, AppError> {
        let current_path = validate_history_path(current_path)?;
        let page_limit = if limit == 0 {
            DEFAULT_HISTORY_PAGE_LIMIT
        } else {
            limit
        };
        let repository = Repository::open(&self.repository_root).map_err(history_git_error)?;
        walk_page(&repository, current_path, document_id, cursor, page_limit)
    }

    pub fn latest_change(
        &self,
        current_path: &str,
        document_id: Option<Uuid>,
    ) -> Result<Option<DocumentCommitSummary>, AppError> {
        let current_path = validate_history_path(current_path)?;
        let repository = Repository::open(&self.repository_root).map_err(history_git_error)?;
        let mut commit = repository
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(history_git_error)?;
        if !commit_has_regular_blob(&repository, &commit, &current_path)
            || document_id.is_some_and(|id| {
                !blob_matches_document_id(&repository, &commit, &current_path, id)
            })
        {
            return Ok(None);
        }
        let tracked_path = current_path;

        loop {
            if let Some(change) = commit_change(&repository, &commit, &tracked_path, document_id)? {
                return Ok(Some(change.item.into()));
            }
            let Some(parent_oid) = commit.parent_ids().next() else {
                return Ok(None);
            };
            commit = repository
                .find_commit(parent_oid)
                .map_err(history_git_error)?;
        }
    }

    pub fn read_version(
        &self,
        commit_oid: &str,
        path_at_commit: &str,
    ) -> Result<DocumentContent, AppError> {
        let oid = parse_full_oid(commit_oid)?;
        let path_at_commit = validate_history_path(path_at_commit)?;
        if Path::new(&path_at_commit)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
        {
            return Err(history_error("version path must identify a Markdown file"));
        }

        let repository = Repository::open(&self.repository_root).map_err(history_git_error)?;
        let head = repository
            .head()
            .and_then(|head| head.peel_to_commit())
            .map_err(history_git_error)?;
        let commit = repository.find_commit(oid).map_err(history_git_error)?;
        let reachable = oid == head.id()
            || repository
                .graph_descendant_of(head.id(), oid)
                .map_err(history_git_error)?;
        if !reachable {
            return Err(history_error("version commit is not reachable from HEAD"));
        }

        let tree = commit.tree().map_err(history_git_error)?;
        let entry = tree
            .get_path(Path::new(&path_at_commit))
            .map_err(history_git_error)?;
        if entry.kind() != Some(ObjectType::Blob)
            || !matches!(entry.filemode(), 0o100644 | 0o100755)
        {
            return Err(history_error(
                "version path does not identify a regular blob",
            ));
        }
        let blob = repository
            .find_blob(entry.id())
            .map_err(history_git_error)?;
        let mut content = document_content_from_bytes(
            &path_at_commit,
            blob.content().to_vec(),
            commit.author().when().seconds().saturating_mul(1_000),
        )
        .map_err(|_| history_error("version blob is not valid UTF-8 Markdown"))?;
        content.last_commit = Some(history_item(&commit, &path_at_commit).into());
        Ok(content)
    }
}

impl From<HistoryItem> for DocumentCommitSummary {
    fn from(item: HistoryItem) -> Self {
        Self {
            commit_oid: item.commit_oid,
            short_oid: item.short_oid,
            author_name: item.author_name,
            authored_at_unix: item.authored_at_unix,
            message: item.message,
        }
    }
}

struct CommitChange {
    item: HistoryItem,
    previous_path: Option<String>,
}

fn walk_page(
    repository: &Repository,
    current_path: String,
    document_id: Option<Uuid>,
    cursor: Option<HistoryCursor>,
    limit: usize,
) -> Result<HistoryPage, AppError> {
    let head = repository
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(history_git_error)?;
    if !commit_has_regular_blob(repository, &head, &current_path)
        || document_id
            .is_some_and(|id| !blob_matches_document_id(repository, &head, &current_path, id))
    {
        return Ok(HistoryPage {
            items: Vec::new(),
            next_cursor: None,
        });
    }

    let (mut commit, mut tracked_path) = if let Some(cursor) = cursor {
        validate_cursor_and_resume(repository, head, current_path, document_id, cursor)?
    } else {
        (head, current_path)
    };
    let mut items = Vec::with_capacity(limit.min(DEFAULT_HISTORY_PAGE_LIMIT));
    let mut last_cursor = None;
    let mut has_more = false;

    loop {
        let change = commit_change(repository, &commit, &tracked_path, document_id)?;
        let previous_path = change
            .as_ref()
            .and_then(|change| change.previous_path.clone())
            .or_else(|| change.is_none().then(|| tracked_path.clone()));

        if let Some(change) = &change {
            if items.len() == limit {
                has_more = true;
                break;
            }
            items.push(change.item.clone());
            if let Some(previous_path) = &change.previous_path {
                last_cursor = Some(HistoryCursor {
                    before_commit_oid: commit.id().to_string(),
                    tracked_path: previous_path.clone(),
                });
            }
        }

        let Some(previous_path) = previous_path else {
            break;
        };
        tracked_path = previous_path;
        let Some(parent_oid) = commit.parent_ids().next() else {
            break;
        };
        commit = repository
            .find_commit(parent_oid)
            .map_err(history_git_error)?;
    }

    Ok(HistoryPage {
        items,
        next_cursor: has_more.then_some(last_cursor).flatten(),
    })
}

fn validate_cursor_and_resume<'repository>(
    repository: &'repository Repository,
    mut commit: git2::Commit<'repository>,
    mut tracked_path: String,
    document_id: Option<Uuid>,
    cursor: HistoryCursor,
) -> Result<(git2::Commit<'repository>, String), AppError> {
    let cursor_oid = parse_full_oid(&cursor.before_commit_oid)?;
    let cursor_path = validate_history_path(&cursor.tracked_path)?;

    loop {
        let change = commit_change(repository, &commit, &tracked_path, document_id)?;
        let previous_path = change
            .as_ref()
            .and_then(|change| change.previous_path.clone())
            .or_else(|| change.is_none().then(|| tracked_path.clone()));

        if commit.id() == cursor_oid {
            let Some(change) = change else {
                return Err(history_error(
                    "cursor does not identify a change to the requested document",
                ));
            };
            let Some(derived_path) = change.previous_path else {
                return Err(history_error(
                    "cursor points past the start of document history",
                ));
            };
            if derived_path != cursor_path {
                return Err(history_error(
                    "cursor path state does not match document history",
                ));
            }
            let parent = commit
                .parent(0)
                .map_err(|_| history_error("cursor points past the start of document history"))?;
            return Ok((parent, derived_path));
        }

        let Some(previous_path) = previous_path else {
            return Err(history_error(
                "cursor is outside the requested document's history",
            ));
        };
        tracked_path = previous_path;
        let Some(parent_oid) = commit.parent_ids().next() else {
            return Err(history_error(
                "cursor commit is not reachable through first-parent history",
            ));
        };
        commit = repository
            .find_commit(parent_oid)
            .map_err(history_git_error)?;
    }
}

fn commit_change(
    repository: &Repository,
    commit: &git2::Commit<'_>,
    tracked_path: &str,
    document_id: Option<Uuid>,
) -> Result<Option<CommitChange>, AppError> {
    let parent = commit.parent(0).ok();
    let diff = commit_diff(repository, commit)?;

    let matching_delta = diff
        .deltas()
        .find(|delta| delta.new_file().path() == Some(Path::new(tracked_path)));
    let Some(delta) = matching_delta else {
        return Ok(None);
    };

    if document_id.is_some_and(|id| !blob_matches_document_id(repository, commit, tracked_path, id))
    {
        return Ok(None);
    }

    let previous_path =
        match delta.status() {
            Delta::Added => document_id.and_then(|id| {
                diff.deltas()
                    .filter(|candidate| candidate.status() == Delta::Deleted)
                    .filter_map(|candidate| candidate.old_file().path())
                    .filter_map(Path::to_str)
                    .find(|candidate_path| {
                        parent.as_ref().is_some_and(|parent| {
                            blob_matches_document_id(repository, parent, candidate_path, id)
                        })
                    })
                    .map(str::to_owned)
            }),
            Delta::Renamed => delta
                .old_file()
                .path()
                .and_then(Path::to_str)
                .and_then(|old_path| match (document_id, parent.as_ref()) {
                    (Some(id), Some(parent))
                        if blob_matches_document_id(repository, parent, old_path, id) =>
                    {
                        Some(old_path.to_owned())
                    }
                    (Some(_), _) => None,
                    (None, _) => Some(old_path.to_owned()),
                }),
            Delta::Deleted => None,
            _ => match (document_id, parent.as_ref()) {
                (Some(id), Some(parent))
                    if blob_matches_document_id(repository, parent, tracked_path, id) =>
                {
                    Some(tracked_path.to_owned())
                }
                (Some(_), _) => None,
                (None, _) => Some(tracked_path.to_owned()),
            },
        };

    Ok(Some(CommitChange {
        item: history_item(commit, tracked_path),
        previous_path,
    }))
}

fn commit_diff<'repository>(
    repository: &'repository Repository,
    commit: &git2::Commit<'_>,
) -> Result<git2::Diff<'repository>, AppError> {
    let tree = commit.tree().map_err(history_git_error)?;
    let parent_tree = commit
        .parent(0)
        .ok()
        .map(|parent| parent.tree().map_err(history_git_error))
        .transpose()?;
    let mut diff = repository
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(history_git_error)?;
    let mut find_options = DiffFindOptions::new();
    find_options.renames(true).renames_from_rewrites(true);
    diff.find_similar(Some(&mut find_options))
        .map_err(history_git_error)?;
    Ok(diff)
}

fn history_item(commit: &git2::Commit<'_>, path_at_commit: &str) -> HistoryItem {
    let oid = commit.id().to_string();
    HistoryItem {
        short_oid: oid.chars().take(7).collect(),
        commit_oid: oid,
        path_at_commit: path_at_commit.to_owned(),
        author_name: commit.author().name().unwrap_or_default().to_owned(),
        authored_at_unix: commit.author().when().seconds(),
        message: commit.message().unwrap_or_default().trim().to_owned(),
    }
}

fn blob_matches_document_id(
    repository: &Repository,
    commit: &git2::Commit<'_>,
    path: &str,
    expected: Uuid,
) -> bool {
    let Ok(tree) = commit.tree() else {
        return false;
    };
    let Ok(entry) = tree.get_path(Path::new(path)) else {
        return false;
    };
    let Ok(blob) = repository.find_blob(entry.id()) else {
        return false;
    };
    let mut reader = std::io::Cursor::new(blob.content());
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path);
    parse_document_reader(&mut reader, file_name).document_id == Some(expected)
}

fn commit_has_regular_blob(repository: &Repository, commit: &git2::Commit<'_>, path: &str) -> bool {
    let Ok(tree) = commit.tree() else {
        return false;
    };
    let Ok(entry) = tree.get_path(Path::new(path)) else {
        return false;
    };
    entry.kind() == Some(ObjectType::Blob)
        && matches!(entry.filemode(), 0o100644 | 0o100755)
        && repository.find_blob(entry.id()).is_ok()
}

fn parse_full_oid(value: &str) -> Result<Oid, AppError> {
    if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(history_error(
            "commit OID must contain exactly 40 hexadecimal characters",
        ));
    }
    Oid::from_str(value).map_err(history_git_error)
}

fn validate_history_path(value: &str) -> Result<String, AppError> {
    let bytes = value.as_bytes();
    if value.trim().is_empty()
        || value.contains('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return Err(history_error("history path must be repository-relative"));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            ) || component.as_os_str() == ".git"
        })
    {
        return Err(history_error("history path must be repository-relative"));
    }
    Ok(value.to_owned())
}

fn history_git_error(error: git2::Error) -> AppError {
    history_error(error.message())
}

fn history_error(reason: impl Into<String>) -> AppError {
    AppError::new(
        ErrorCode::DocumentHistoryInvalid,
        "문서 변경 이력을 읽을 수 없습니다.",
    )
    .with_detail("reason", reason)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use git2::{IndexAddOption, Repository, Signature, Time};
    use tempfile::TempDir;
    use uuid::Uuid;

    use super::DocumentHistory;
    use crate::documents::contract::HistoryCursor;
    use crate::error::ErrorCode;

    const DOCUMENT_ID: &str = "9df970bb-824b-4d26-b582-b34a8f0afc21";

    #[test]
    fn history_follows_a_renamed_document_and_paginates_without_duplicates() {
        let fixture = history_fixture();
        let history = DocumentHistory::open(fixture.directory.path()).unwrap();

        let first = history
            .history_page("docs/map-api.md", Some(document_id()), None, 2)
            .unwrap();
        assert_eq!(first.items.len(), 2);
        assert_eq!(first.items[0].message, "edit map api");
        assert_eq!(first.items[0].path_at_commit, "docs/map-api.md");
        assert_eq!(first.items[1].message, "rename api");
        assert_eq!(first.items[1].path_at_commit, "docs/map-api.md");
        assert!(first.next_cursor.is_some());

        let second = history
            .history_page("docs/map-api.md", Some(document_id()), first.next_cursor, 2)
            .unwrap();
        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].message, "add api");
        assert_eq!(second.items[0].path_at_commit, "docs/api.md");
        assert!(second.next_cursor.is_none());

        let first_oids = first
            .items
            .iter()
            .map(|item| item.commit_oid.as_str())
            .collect::<Vec<_>>();
        assert!(!first_oids.contains(&second.items[0].commit_oid.as_str()));
    }

    #[test]
    fn latest_change_returns_only_the_newest_matching_commit_summary() {
        let fixture = history_fixture();
        let history = DocumentHistory::open(fixture.directory.path()).unwrap();

        let latest = history
            .latest_change("docs/map-api.md", Some(document_id()))
            .unwrap()
            .unwrap();

        assert_eq!(latest.commit_oid, fixture.edit_oid.to_string());
        assert_eq!(latest.short_oid.len(), 7);
        assert_eq!(latest.author_name, "History Fixture");
        assert_eq!(latest.authored_at_unix, 1_700_000_003);
        assert_eq!(latest.message, "edit map api");
    }

    #[test]
    fn history_uses_twenty_as_the_default_page_limit() {
        let directory = TempDir::new().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        fs::create_dir_all(directory.path().join("docs")).unwrap();
        for revision in 0..22 {
            fs::write(
                directory.path().join("docs/guide.md"),
                format!("# Guide {revision}\n"),
            )
            .unwrap();
            commit_all(
                &repository,
                &format!("guide {revision}"),
                1_700_001_000 + revision,
            );
        }
        let history = DocumentHistory::open(directory.path()).unwrap();

        let first = history
            .history_page("docs/guide.md", None, None, 0)
            .unwrap();
        let second = history
            .history_page("docs/guide.md", None, first.next_cursor, 0)
            .unwrap();

        assert_eq!(first.items.len(), 20);
        assert_eq!(second.items.len(), 2);
        assert!(second.next_cursor.is_none());
    }

    #[test]
    fn history_rejects_malformed_unreachable_and_path_tampered_cursors() {
        let fixture = history_fixture();
        let repository = Repository::open(fixture.directory.path()).unwrap();
        let history = DocumentHistory::open(fixture.directory.path()).unwrap();

        let malformed = HistoryCursor {
            before_commit_oid: "deadbeef".to_owned(),
            tracked_path: "docs/map-api.md".to_owned(),
        };
        assert_eq!(
            history
                .history_page("docs/map-api.md", Some(document_id()), Some(malformed), 2,)
                .unwrap_err()
                .code,
            ErrorCode::DocumentHistoryInvalid
        );

        let first = history
            .history_page("docs/map-api.md", Some(document_id()), None, 2)
            .unwrap();
        let mut tampered = first.next_cursor.unwrap();
        tampered.tracked_path = "docs/map-api.md".to_owned();
        assert_eq!(
            history
                .history_page("docs/map-api.md", Some(document_id()), Some(tampered), 2,)
                .unwrap_err()
                .code,
            ErrorCode::DocumentHistoryInvalid
        );

        let unreachable_oid = commit_unreferenced(&repository, "unreachable", 1_700_000_004);
        let unreachable = HistoryCursor {
            before_commit_oid: unreachable_oid.to_string(),
            tracked_path: "docs/map-api.md".to_owned(),
        };
        assert_eq!(
            history
                .history_page("docs/map-api.md", Some(document_id()), Some(unreachable), 2,)
                .unwrap_err()
                .code,
            ErrorCode::DocumentHistoryInvalid
        );
    }

    #[test]
    fn no_id_history_rejects_a_cursor_from_another_documents_change() {
        let directory = TempDir::new().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        fs::create_dir_all(directory.path().join("docs")).unwrap();

        fs::write(directory.path().join("docs/a.md"), "# A v1\n").unwrap();
        commit_all(&repository, "add a", 1_700_002_001);
        fs::write(directory.path().join("docs/a.md"), "# A v2\n").unwrap();
        commit_all(&repository, "edit a", 1_700_002_002);

        fs::write(directory.path().join("docs/b.md"), "# B v1\n").unwrap();
        commit_all(&repository, "add b", 1_700_002_003);
        fs::write(directory.path().join("docs/b.md"), "# B v2\n").unwrap();
        let b_edit_oid = commit_all(&repository, "edit b", 1_700_002_004);

        fs::write(directory.path().join("docs/a.md"), "# A v3\n").unwrap();
        commit_all(&repository, "edit a again", 1_700_002_005);

        let history = DocumentHistory::open(directory.path()).unwrap();
        let forged = HistoryCursor {
            before_commit_oid: b_edit_oid.to_string(),
            tracked_path: "docs/b.md".to_owned(),
        };

        assert_eq!(
            history
                .history_page("docs/a.md", None, Some(forged), 2)
                .unwrap_err()
                .code,
            ErrorCode::DocumentHistoryInvalid
        );
    }

    #[test]
    fn history_uses_only_the_first_parent_of_merge_commits() {
        let fixture = history_fixture();
        let repository = Repository::open(fixture.directory.path()).unwrap();
        let base = repository.head().unwrap().peel_to_commit().unwrap();

        fs::write(
            fixture.directory.path().join("docs/map-api.md"),
            document("SIDE VERSION"),
        )
        .unwrap();
        let side_oid = commit_index(&repository, None, "side edit", 1_700_000_004, &[&base]);

        fs::write(
            fixture.directory.path().join("docs/map-api.md"),
            document("API v2"),
        )
        .unwrap();
        fs::write(fixture.directory.path().join("docs/note.txt"), "main\n").unwrap();
        let main_oid = commit_index(
            &repository,
            Some("HEAD"),
            "main note",
            1_700_000_005,
            &[&base],
        );

        fs::write(
            fixture.directory.path().join("docs/map-api.md"),
            document("SIDE VERSION"),
        )
        .unwrap();
        let main = repository.find_commit(main_oid).unwrap();
        let side = repository.find_commit(side_oid).unwrap();
        let merge_oid = commit_index(
            &repository,
            Some("HEAD"),
            "merge side",
            1_700_000_006,
            &[&main, &side],
        );
        drop((base, main, side));

        let history = DocumentHistory::open(fixture.directory.path()).unwrap();
        let page = history
            .history_page("docs/map-api.md", Some(document_id()), None, 20)
            .unwrap();
        let oids = page
            .items
            .iter()
            .map(|item| item.commit_oid.as_str())
            .collect::<Vec<_>>();

        assert_eq!(oids[0], merge_oid.to_string());
        assert!(!oids.contains(&side_oid.to_string().as_str()));
        assert!(!page.items.iter().any(|item| item.message == "main note"));
        assert_eq!(page.items.last().unwrap().path_at_commit, "docs/api.md");

        let second_parent_cursor = HistoryCursor {
            before_commit_oid: side_oid.to_string(),
            tracked_path: "docs/map-api.md".to_owned(),
        };
        assert_eq!(
            history
                .history_page(
                    "docs/map-api.md",
                    Some(document_id()),
                    Some(second_parent_cursor),
                    20,
                )
                .unwrap_err()
                .code,
            ErrorCode::DocumentHistoryInvalid
        );
    }

    #[test]
    fn document_id_confirmation_stops_at_a_different_document_on_the_same_rename() {
        let directory = TempDir::new().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        fs::create_dir_all(directory.path().join("docs")).unwrap();
        fs::write(
            directory.path().join("docs/api.md"),
            "---\ntitle: Old\nokf_hub_id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n---\n# API\n",
        )
        .unwrap();
        let old_oid = commit_all(&repository, "add old", 1_700_000_001);
        fs::rename(
            directory.path().join("docs/api.md"),
            directory.path().join("docs/map-api.md"),
        )
        .unwrap();
        fs::write(
            directory.path().join("docs/map-api.md"),
            "---\ntitle: New\nokf_hub_id: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\n---\n# API\n",
        )
        .unwrap();
        commit_all(
            &repository,
            "replace identity while renaming",
            1_700_000_002,
        );
        let history = DocumentHistory::open(directory.path()).unwrap();
        let new_id = Uuid::parse_str("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap();

        let page = history
            .history_page("docs/map-api.md", Some(new_id), None, 20)
            .unwrap();

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].message, "replace identity while renaming");
        assert_ne!(page.items[0].commit_oid, old_oid.to_string());
    }

    #[test]
    fn version_read_uses_the_commit_tree_and_never_changes_the_worktree() {
        let fixture = history_fixture();
        let history = DocumentHistory::open(fixture.directory.path()).unwrap();
        let current_path = fixture.directory.path().join("docs/map-api.md");
        let current_bytes = fs::read(&current_path).unwrap();

        let version = history
            .read_version(&fixture.add_oid.to_string(), "docs/api.md")
            .unwrap();

        assert_eq!(version.markdown, document("API v1"));
        assert_eq!(version.summary.path, "docs/api.md");
        assert_eq!(version.summary.document_id, Some(document_id()));
        assert_eq!(
            version.last_commit.unwrap().commit_oid,
            fixture.add_oid.to_string()
        );
        assert_eq!(fs::read(&current_path).unwrap(), current_bytes);
        assert!(!fixture.directory.path().join("docs/api.md").exists());
    }

    #[test]
    fn version_read_rejects_abbreviated_unreachable_and_unsafe_inputs() {
        let fixture = history_fixture();
        let repository = Repository::open(fixture.directory.path()).unwrap();
        let history = DocumentHistory::open(fixture.directory.path()).unwrap();
        let unreachable_oid = commit_unreferenced(&repository, "unreachable", 1_700_000_004);

        for (oid, path) in [
            ("deadbeef".to_owned(), "docs/api.md"),
            (unreachable_oid.to_string(), "docs/map-api.md"),
            (fixture.add_oid.to_string(), "../docs/api.md"),
            (fixture.add_oid.to_string(), "/docs/api.md"),
            (fixture.add_oid.to_string(), ".git/config"),
            (fixture.add_oid.to_string(), "docs"),
        ] {
            assert_eq!(
                history.read_version(&oid, path).unwrap_err().code,
                ErrorCode::DocumentHistoryInvalid,
                "oid={oid}, path={path}"
            );
        }
    }

    struct HistoryFixture {
        directory: TempDir,
        add_oid: git2::Oid,
        edit_oid: git2::Oid,
    }

    fn history_fixture() -> HistoryFixture {
        let directory = TempDir::new().unwrap();
        let repository = Repository::init(directory.path()).unwrap();
        fs::create_dir_all(directory.path().join("docs")).unwrap();

        fs::write(directory.path().join("docs/api.md"), document("API v1")).unwrap();
        let add_oid = commit_all(&repository, "add api", 1_700_000_001);

        fs::rename(
            directory.path().join("docs/api.md"),
            directory.path().join("docs/map-api.md"),
        )
        .unwrap();
        commit_all(&repository, "rename api", 1_700_000_002);

        fs::write(directory.path().join("docs/map-api.md"), document("API v2")).unwrap();
        let edit_oid = commit_all(&repository, "edit map api", 1_700_000_003);

        HistoryFixture {
            directory,
            add_oid,
            edit_oid,
        }
    }

    fn document(body: &str) -> String {
        format!("---\ntitle: Map API\nokf_hub_id: {DOCUMENT_ID}\n---\n# {body}\n")
    }

    fn document_id() -> Uuid {
        Uuid::parse_str(DOCUMENT_ID).unwrap()
    }

    fn commit_all(repository: &Repository, message: &str, seconds: i64) -> git2::Oid {
        let parent = repository
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok());
        let parents = parent.iter().collect::<Vec<_>>();
        commit_index(repository, Some("HEAD"), message, seconds, &parents)
    }

    fn commit_index(
        repository: &Repository,
        update_ref: Option<&str>,
        message: &str,
        seconds: i64,
        parents: &[&git2::Commit<'_>],
    ) -> git2::Oid {
        let mut index = repository.index().unwrap();
        index
            .add_all(["docs"], IndexAddOption::DEFAULT, None)
            .unwrap();
        index.update_all(["docs"], None).unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_oid).unwrap();
        let signature = Signature::new(
            "History Fixture",
            "history@example.com",
            &Time::new(seconds, 0),
        )
        .unwrap();
        repository
            .commit(update_ref, &signature, &signature, message, &tree, parents)
            .unwrap()
    }

    fn commit_unreferenced(repository: &Repository, message: &str, seconds: i64) -> git2::Oid {
        let head = repository.head().unwrap().peel_to_commit().unwrap();
        let tree = head.tree().unwrap();
        let signature = Signature::new(
            "History Fixture",
            "history@example.com",
            &Time::new(seconds, 0),
        )
        .unwrap();
        repository
            .commit(None, &signature, &signature, message, &tree, &[&head])
            .unwrap()
    }

    #[allow(dead_code)]
    fn write_file(root: &Path, path: &str, contents: &str) {
        let target = root.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, contents).unwrap();
    }
}
