use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions as CapOpenOptions};
use git2::{Repository, WorktreeAddOptions, WorktreePruneOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::documents::authoring::{
    normalize_document_file_name, render_new_document, validate_document_target,
    NewDocumentTemplate,
};
use crate::documents::contract::FrontmatterStatus;
use crate::documents::frontmatter::parse_document;
use crate::error::{AppError, ErrorCode, RecoveryAction};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub workspace_id: Uuid,
    pub change_id: Uuid,
    pub author_login: String,
    pub base_commit: String,
    pub branch: String,
    pub created_at_unix_ms: i64,
    pub last_opened_at_unix_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDocument {
    pub change_id: Uuid,
    pub document_id: Uuid,
    pub path: String,
    pub markdown: String,
    pub content_hash: String,
    pub draft: DraftSummary,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedDocument {
    pub change_id: Uuid,
    pub document_id: Uuid,
    pub path: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentConflict {
    pub change_id: Uuid,
    pub document_id: Uuid,
    pub path: String,
    pub disk_hash: String,
    pub disk_markdown: String,
    pub hub_markdown: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredDocument {
    pub document: CreatedDocument,
    pub conflict: Option<SaveDocumentResult>,
    pub has_unsaved_recovery: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SaveDocumentResult {
    Saved(SavedDocument),
    Conflict(DocumentConflict),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DraftDocumentRecord {
    document_id: Uuid,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DraftRecord {
    #[serde(flatten)]
    summary: DraftSummary,
    source_repository_root: PathBuf,
    worktree_path: PathBuf,
    document_roots: Vec<String>,
    #[serde(default)]
    documents: Vec<DraftDocumentRecord>,
    #[serde(default)]
    last_document_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecoveryJournal {
    change_id: Uuid,
    document_id: Uuid,
    path: String,
    expected_hash: String,
    markdown: String,
}

#[derive(Serialize)]
struct TeamTemplateFile<'a> {
    label: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    type_key: Option<&'a str>,
    defaults: &'a crate::documents::authoring::DocumentTemplateDefaults,
}

#[derive(Serialize)]
struct ExistingDocumentFrontmatter<'a> {
    okf_hub_id: Uuid,
    title: &'a str,
}

#[derive(Clone)]
pub struct DraftManager {
    root: PathBuf,
    mutations: Arc<Mutex<()>>,
}

struct AnchoredWorktree {
    root: Dir,
}

enum AnchoredReplace {
    Replaced,
    Conflict {
        disk_hash: String,
        disk_markdown: String,
    },
}

impl AnchoredWorktree {
    fn open(path: &Path) -> Result<Self, AppError> {
        let root = Dir::open_ambient_dir(path, cap_std::ambient_authority())
            .map_err(|_| draft_storage_error())?;
        Ok(Self { root })
    }

    fn create_dir_all(&self, path: &Path) -> Result<(), AppError> {
        self.root
            .create_dir_all(path)
            .map_err(|_| invalid_document_error())
    }

    fn write_new(&self, path: &Path, bytes: &[u8]) -> Result<(), AppError> {
        let mut options = CapOpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = self
            .root
            .open_with(path, &options)
            .map_err(|_| draft_conflict_error())?;
        file.write_all(bytes).map_err(|_| draft_storage_error())?;
        file.sync_all().map_err(|_| draft_storage_error())
    }

    fn read_existing(&self, path: &Path) -> Result<String, AppError> {
        let mut options = CapOpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let mut file = self
            .root
            .open_with(path, &options)
            .map_err(|_| invalid_document_error())?;
        if !file
            .metadata()
            .map_err(|_| invalid_document_error())?
            .is_file()
        {
            return Err(invalid_document_error());
        }
        let mut markdown = String::new();
        file.read_to_string(&mut markdown)
            .map_err(|_| draft_storage_error())?;
        Ok(markdown)
    }

    fn atomic_replace_if_hash(
        &self,
        path: &Path,
        bytes: &[u8],
        operation_id: Uuid,
        expected_hash: &str,
    ) -> Result<AnchoredReplace, AppError> {
        let parent = path.parent().ok_or_else(draft_storage_error)?;
        let attempt_id = Uuid::new_v4();
        let temp = parent.join(format!(".okhub-{operation_id}-{attempt_id}.tmp"));
        let result = (|| {
            self.write_new(&temp, bytes)?;
            let disk_markdown = self.read_existing(path)?;
            let disk_hash = content_hash(disk_markdown.as_bytes());
            if disk_hash != expected_hash {
                return Ok(AnchoredReplace::Conflict {
                    disk_hash,
                    disk_markdown,
                });
            }
            self.root
                .rename(&temp, &self.root, path)
                .map_err(|_| invalid_document_error())?;
            self.root
                .open_dir(parent)
                .and_then(|directory| directory.into_std_file().sync_all())
                .map_err(|_| draft_storage_error())?;
            Ok(AnchoredReplace::Replaced)
        })();
        if !matches!(&result, Ok(AnchoredReplace::Replaced)) {
            let _ = self.root.remove_file(&temp);
        }
        result
    }

    fn read_dir(&self, path: &Path) -> Result<cap_std::fs::ReadDir, AppError> {
        self.root
            .read_dir(path)
            .map_err(|_| invalid_document_error())
    }

    fn remove_file(&self, path: &Path) -> Result<(), AppError> {
        self.root
            .remove_file(path)
            .map_err(|_| invalid_document_error())
    }
}

impl DraftManager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            mutations: Arc::new(Mutex::new(())),
        }
    }

    pub fn create_change(
        &self,
        source_repository_root: &Path,
        workspace_id: Uuid,
        author_login: &str,
        title: &str,
        change_id: Uuid,
        document_roots: Vec<String>,
    ) -> Result<DraftSummary, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        require_v4(change_id)?;
        let repository = Repository::open(source_repository_root).map_err(|_| draft_git_error())?;
        let head = repository.head().map_err(|_| draft_git_error())?;
        let commit = head.peel_to_commit().map_err(|_| draft_git_error())?;
        let base_commit = commit.id().to_string();
        let author = normalize_author(author_login);
        let short_id = &change_id.simple().to_string()[..8];
        let title_prefix = title.chars().take(40).collect::<String>();
        let slug = normalize_document_file_name(&format!("{title_prefix}.md"))
            .unwrap_or_else(|_| "change.md".to_owned())
            .trim_end_matches(".md")
            .to_owned();
        let branch = format!("draft/{author}/{short_id}-{slug}");
        let workspace_root = self.workspace_root(workspace_id);
        let worktree_path = workspace_root.join("worktrees").join(change_id.to_string());
        let metadata_path = self.metadata_path(workspace_id, change_id);
        if worktree_path.exists() || metadata_path.exists() {
            return Err(draft_conflict_error());
        }
        fs::create_dir_all(worktree_path.parent().expect("worktree parent"))
            .map_err(|_| draft_storage_error())?;
        fs::create_dir_all(metadata_path.parent().expect("metadata parent"))
            .map_err(|_| draft_storage_error())?;

        let branch_ref = repository
            .branch(&branch, &commit, false)
            .map_err(|_| draft_conflict_error())?
            .into_reference();
        let mut options = WorktreeAddOptions::new();
        options.reference(Some(&branch_ref));
        let worktree_name = format!("okhub-{}", change_id.simple());
        if repository
            .worktree(&worktree_name, &worktree_path, Some(&options))
            .is_err()
        {
            if let Ok(mut reference) = repository.find_reference(&format!("refs/heads/{branch}")) {
                let _ = reference.delete();
            }
            let _ = fs::remove_dir_all(&worktree_path);
            return Err(draft_git_error());
        }
        let now = now_unix_ms();
        let summary = DraftSummary {
            workspace_id,
            change_id,
            author_login: author_login.to_owned(),
            base_commit,
            branch: branch.clone(),
            created_at_unix_ms: now,
            last_opened_at_unix_ms: now,
        };
        let record = DraftRecord {
            summary: summary.clone(),
            source_repository_root: source_repository_root.to_path_buf(),
            worktree_path: worktree_path.clone(),
            document_roots,
            documents: Vec::new(),
            last_document_id: None,
        };
        if let Err(error) = self.write_record(&record) {
            rollback_created_change(
                &repository,
                &worktree_name,
                &worktree_path,
                &branch,
                &metadata_path,
            );
            return Err(error);
        }
        if let Err(error) = self.set_active(workspace_id, change_id) {
            rollback_created_change(
                &repository,
                &worktree_name,
                &worktree_path,
                &branch,
                &metadata_path,
            );
            return Err(error);
        }
        Ok(summary)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_document(
        &self,
        workspace_id: Uuid,
        change_id: Uuid,
        folder: &str,
        file_name: &str,
        title: &str,
        template: &NewDocumentTemplate,
        document_id: Uuid,
    ) -> Result<CreatedDocument, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        require_v4(document_id)?;
        let mut record = self.load_record(workspace_id, change_id)?;
        let validation = validate_document_target(
            &record.worktree_path,
            &record.document_roots,
            folder,
            file_name,
        )?;
        if validation.has_collision {
            return Err(draft_conflict_error());
        }
        let worktree = AnchoredWorktree::open(&record.worktree_path)?;
        let markdown = render_new_document(template, title, document_id)?;
        let previous_record = record.clone();
        record.documents.push(DraftDocumentRecord {
            document_id,
            path: validation.relative_path.clone(),
        });
        record.last_document_id = Some(document_id);
        record.summary.last_opened_at_unix_ms = now_unix_ms();
        self.write_record(&record)?;

        let relative_path = Path::new(&validation.relative_path);
        let parent = relative_path.parent().ok_or_else(draft_storage_error)?;
        worktree.create_dir_all(parent).map_err(|_| {
            let _ = self.write_record(&previous_record);
            draft_storage_error()
        })?;
        if let Err(error) = worktree.write_new(relative_path, markdown.as_bytes()) {
            let _ = self.write_record(&previous_record);
            return Err(error);
        }
        remove_empty_folder_markers(&worktree, &record.document_roots, parent);
        Ok(CreatedDocument {
            change_id,
            document_id,
            path: validation.relative_path,
            content_hash: content_hash(markdown.as_bytes()),
            markdown,
            draft: record.summary,
        })
    }

    pub fn add_existing_document(
        &self,
        workspace_id: Uuid,
        change_id: Uuid,
        path: &str,
        title: &str,
        generated_document_id: Uuid,
    ) -> Result<CreatedDocument, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        require_v4(generated_document_id)?;
        if self.active_change_id(workspace_id)? != Some(change_id) {
            return Err(invalid_document_error());
        }
        let mut record = self.load_record(workspace_id, change_id)?;
        let target = safe_existing_document_relative(&record, path)?;
        let worktree = AnchoredWorktree::open(&record.worktree_path)?;
        let disk_markdown = worktree.read_existing(&target)?;

        if let Some(existing) = record
            .documents
            .iter()
            .find(|document| document.path == path)
        {
            return Ok(CreatedDocument {
                change_id,
                document_id: existing.document_id,
                path: existing.path.clone(),
                content_hash: content_hash(disk_markdown.as_bytes()),
                markdown: disk_markdown,
                draft: record.summary,
            });
        }

        let file_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(invalid_document_error)?;
        let (document_id, markdown) = ensure_existing_document_identity(
            &disk_markdown,
            file_name,
            title,
            generated_document_id,
        )?;
        let previous_record = record.clone();
        record.documents.push(DraftDocumentRecord {
            document_id,
            path: path.to_owned(),
        });
        record.last_document_id = Some(document_id);
        record.summary.last_opened_at_unix_ms = now_unix_ms();
        self.write_record(&record)?;

        if markdown != disk_markdown {
            let expected_hash = content_hash(disk_markdown.as_bytes());
            match worktree.atomic_replace_if_hash(
                &target,
                markdown.as_bytes(),
                document_id,
                &expected_hash,
            ) {
                Ok(AnchoredReplace::Replaced) => {}
                Ok(AnchoredReplace::Conflict { .. }) => {
                    let _ = self.write_record(&previous_record);
                    return Err(draft_conflict_error());
                }
                Err(error) => {
                    let _ = self.write_record(&previous_record);
                    return Err(error);
                }
            }
        }

        Ok(CreatedDocument {
            change_id,
            document_id,
            path: path.to_owned(),
            content_hash: content_hash(markdown.as_bytes()),
            markdown,
            draft: record.summary,
        })
    }

    pub fn save_document(
        &self,
        workspace_id: Uuid,
        change_id: Uuid,
        document_id: Uuid,
        path: &str,
        expected_hash: &str,
        markdown: &str,
    ) -> Result<SaveDocumentResult, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        if self.active_change_id(workspace_id)? != Some(change_id) {
            return Err(invalid_document_error());
        }
        let mut record = self.load_record(workspace_id, change_id)?;
        if !record
            .documents
            .iter()
            .any(|document| document.document_id == document_id && document.path == path)
        {
            return Err(invalid_document_error());
        }
        record.last_document_id = Some(document_id);
        record.summary.last_opened_at_unix_ms = now_unix_ms();
        self.write_record(&record)?;
        let worktree = AnchoredWorktree::open(&record.worktree_path)?;
        let target = safe_draft_document_relative(&record, path)?;
        let disk_markdown = worktree.read_existing(&target)?;
        let disk_hash = content_hash(disk_markdown.as_bytes());
        let journal = RecoveryJournal {
            change_id,
            document_id,
            path: path.to_owned(),
            expected_hash: expected_hash.to_owned(),
            markdown: markdown.to_owned(),
        };
        self.write_journal(&record, &journal)?;
        if disk_hash != expected_hash {
            return Ok(SaveDocumentResult::Conflict(DocumentConflict {
                change_id,
                document_id,
                path: path.to_owned(),
                disk_hash,
                disk_markdown,
                hub_markdown: markdown.to_owned(),
            }));
        }
        match worktree.atomic_replace_if_hash(
            &target,
            markdown.as_bytes(),
            document_id,
            expected_hash,
        )? {
            AnchoredReplace::Replaced => {}
            AnchoredReplace::Conflict {
                disk_hash,
                disk_markdown,
            } => {
                return Ok(SaveDocumentResult::Conflict(DocumentConflict {
                    change_id,
                    document_id,
                    path: path.to_owned(),
                    disk_hash,
                    disk_markdown,
                    hub_markdown: markdown.to_owned(),
                }));
            }
        }
        self.remove_journal(&record, document_id)?;
        Ok(SaveDocumentResult::Saved(SavedDocument {
            change_id,
            document_id,
            path: path.to_owned(),
            content_hash: content_hash(markdown.as_bytes()),
        }))
    }

    pub fn add_team_template(
        &self,
        workspace_id: Uuid,
        change_id: Uuid,
        file_name: &str,
        label: &str,
        description: Option<&str>,
        source: &NewDocumentTemplate,
    ) -> Result<String, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        let record = self.load_record(workspace_id, change_id)?;
        let file_name = normalize_document_file_name(file_name)?;
        let label = label.trim();
        if label.is_empty() {
            return Err(invalid_document_error());
        }
        let worktree = AnchoredWorktree::open(&record.worktree_path)?;
        let templates_root = Path::new(".okf/templates");
        worktree.create_dir_all(templates_root)?;
        let collision_key: String = file_name.nfc().flat_map(char::to_lowercase).collect();
        let collision = worktree
            .read_dir(templates_root)?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .any(|name| {
                name.nfc().flat_map(char::to_lowercase).collect::<String>() == collision_key
            });
        if collision {
            return Err(draft_conflict_error());
        }
        let frontmatter = TeamTemplateFile {
            label,
            description: description.filter(|value| !value.trim().is_empty()),
            type_key: source.type_key.as_deref(),
            defaults: &source.defaults,
        };
        let yaml = serde_yaml_ng::to_string(&frontmatter).map_err(|_| draft_storage_error())?;
        let markdown = format!("---\n{yaml}---\n{}", source.body);
        worktree.write_new(&templates_root.join(&file_name), markdown.as_bytes())?;
        Ok(format!(".okf/templates/{file_name}"))
    }

    pub fn list_changes(&self, workspace_id: Uuid) -> Result<Vec<DraftSummary>, AppError> {
        let metadata = self.workspace_root(workspace_id).join("metadata");
        if !metadata.exists() {
            return Ok(Vec::new());
        }
        let mut summaries = fs::read_dir(metadata)
            .map_err(|_| draft_storage_error())?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "json")
            })
            .filter_map(|entry| self.read_record(&entry.path()).ok())
            .filter(|record| record.worktree_path.is_dir())
            .map(|record| record.summary)
            .collect::<Vec<_>>();
        summaries.sort_by_key(|summary| std::cmp::Reverse(summary.last_opened_at_unix_ms));
        Ok(summaries)
    }

    pub fn active_worktree(&self, workspace_id: Uuid) -> Result<PathBuf, AppError> {
        let change_id = self
            .active_change_id(workspace_id)?
            .ok_or_else(draft_storage_error)?;
        let record = self.load_record(workspace_id, change_id)?;
        if !record.worktree_path.is_dir() {
            return Err(draft_storage_error());
        }
        Ok(record.worktree_path)
    }

    pub fn active_change(&self, workspace_id: Uuid) -> Result<Option<DraftSummary>, AppError> {
        let Some(change_id) = self.active_change_id(workspace_id)? else {
            return Ok(None);
        };
        let record = self.load_record(workspace_id, change_id)?;
        if !record.worktree_path.is_dir() {
            return Err(draft_storage_error());
        }
        Ok(Some(record.summary))
    }

    pub fn switch_change(
        &self,
        workspace_id: Uuid,
        change_id: Uuid,
    ) -> Result<DraftSummary, AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        let mut record = self.load_record(workspace_id, change_id)?;
        if !record.worktree_path.is_dir() {
            return Err(draft_storage_error());
        }
        record.summary.last_opened_at_unix_ms = now_unix_ms();
        self.write_record(&record)?;
        self.set_active(workspace_id, change_id)?;
        Ok(record.summary)
    }

    pub fn close_active(&self, workspace_id: Uuid) -> Result<(), AppError> {
        let _mutation = self.mutations.lock().map_err(|_| draft_storage_error())?;
        let active = self.workspace_root(workspace_id).join("active.json");
        if active.exists() {
            fs::remove_file(active).map_err(|_| draft_storage_error())?;
        }
        Ok(())
    }

    pub fn discard_empty_change(&self, workspace_id: Uuid, change_id: Uuid) {
        let Ok(_mutation) = self.mutations.lock() else {
            return;
        };
        let Ok(record) = self.load_record(workspace_id, change_id) else {
            return;
        };
        if !record.documents.is_empty() {
            return;
        }
        let Ok(repository) = Repository::open(&record.source_repository_root) else {
            return;
        };
        let worktree_name = format!("okhub-{}", change_id.simple());
        let metadata_path = self.metadata_path(record.summary.workspace_id, change_id);
        rollback_created_change(
            &repository,
            &worktree_name,
            &record.worktree_path,
            &record.summary.branch,
            &metadata_path,
        );
        let active = self
            .workspace_root(record.summary.workspace_id)
            .join("active.json");
        if active.exists() {
            let _ = fs::remove_file(active);
        }
    }

    pub fn recovery_journal_exists(&self, change_id: Uuid, document_id: Uuid) -> bool {
        self.find_record(change_id)
            .map(|record| self.journal_path(&record, document_id).exists())
            .unwrap_or(false)
    }

    pub fn active_recovery(
        &self,
        workspace_id: Uuid,
    ) -> Result<Option<RecoveredDocument>, AppError> {
        let Some(change_id) = self.active_change_id(workspace_id)? else {
            return Ok(None);
        };
        let record = self.load_record(workspace_id, change_id)?;
        let worktree = AnchoredWorktree::open(&record.worktree_path)?;
        let journal_root = self
            .workspace_root(workspace_id)
            .join("journals")
            .join(change_id.to_string());
        let mut journals = if journal_root.is_dir() {
            fs::read_dir(journal_root)
                .map_err(|_| draft_storage_error())?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|value| value == "json"))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        journals.sort();
        if let Some(path) = journals.first() {
            let journal: RecoveryJournal =
                serde_json::from_slice(&fs::read(path).map_err(|_| draft_storage_error())?)
                    .map_err(|_| draft_storage_error())?;
            if !record.documents.iter().any(|document| {
                document.document_id == journal.document_id && document.path == journal.path
            }) {
                return Err(invalid_document_error());
            }
            let target = safe_draft_document_relative(&record, &journal.path)?;
            let disk_markdown = worktree.read_existing(&target)?;
            let disk_hash = content_hash(disk_markdown.as_bytes());
            let conflict = (disk_hash != journal.expected_hash).then(|| {
                SaveDocumentResult::Conflict(DocumentConflict {
                    change_id,
                    document_id: journal.document_id,
                    path: journal.path.clone(),
                    disk_hash: disk_hash.clone(),
                    disk_markdown,
                    hub_markdown: journal.markdown.clone(),
                })
            });
            return Ok(Some(RecoveredDocument {
                document: CreatedDocument {
                    change_id,
                    document_id: journal.document_id,
                    path: journal.path,
                    markdown: journal.markdown,
                    content_hash: disk_hash,
                    draft: record.summary,
                },
                conflict,
                has_unsaved_recovery: true,
            }));
        }

        let Some(document_id) = record.last_document_id else {
            return Ok(None);
        };
        let document = record
            .documents
            .iter()
            .find(|document| document.document_id == document_id)
            .ok_or_else(invalid_document_error)?;
        let target = safe_draft_document_relative(&record, &document.path)?;
        let markdown = worktree.read_existing(&target)?;
        Ok(Some(RecoveredDocument {
            document: CreatedDocument {
                change_id,
                document_id,
                path: document.path.clone(),
                content_hash: content_hash(markdown.as_bytes()),
                markdown,
                draft: record.summary,
            },
            conflict: None,
            has_unsaved_recovery: false,
        }))
    }

    fn workspace_root(&self, workspace_id: Uuid) -> PathBuf {
        self.root.join(workspace_id.to_string())
    }

    fn metadata_path(&self, workspace_id: Uuid, change_id: Uuid) -> PathBuf {
        self.workspace_root(workspace_id)
            .join("metadata")
            .join(format!("{change_id}.json"))
    }

    fn write_record(&self, record: &DraftRecord) -> Result<(), AppError> {
        let path = self.metadata_path(record.summary.workspace_id, record.summary.change_id);
        write_json_atomic(&path, record, record.summary.change_id)
    }

    fn read_record(&self, path: &Path) -> Result<DraftRecord, AppError> {
        serde_json::from_slice(&fs::read(path).map_err(|_| draft_storage_error())?)
            .map_err(|_| draft_storage_error())
    }

    fn load_record(&self, workspace_id: Uuid, change_id: Uuid) -> Result<DraftRecord, AppError> {
        self.read_record(&self.metadata_path(workspace_id, change_id))
    }

    fn find_record(&self, change_id: Uuid) -> Result<DraftRecord, AppError> {
        if !self.root.exists() {
            return Err(draft_storage_error());
        }
        for workspace in fs::read_dir(&self.root).map_err(|_| draft_storage_error())? {
            let workspace = workspace.map_err(|_| draft_storage_error())?;
            let path = workspace
                .path()
                .join("metadata")
                .join(format!("{change_id}.json"));
            if path.is_file() {
                return self.read_record(&path);
            }
        }
        Err(draft_storage_error())
    }

    fn set_active(&self, workspace_id: Uuid, change_id: Uuid) -> Result<(), AppError> {
        let path = self.workspace_root(workspace_id).join("active.json");
        write_json_atomic(&path, &change_id, change_id)
    }

    fn active_change_id(&self, workspace_id: Uuid) -> Result<Option<Uuid>, AppError> {
        let active_path = self.workspace_root(workspace_id).join("active.json");
        if !active_path.exists() {
            return Ok(None);
        }
        serde_json::from_slice(&fs::read(active_path).map_err(|_| draft_storage_error())?)
            .map(Some)
            .map_err(|_| draft_storage_error())
    }

    fn journal_path(&self, record: &DraftRecord, document_id: Uuid) -> PathBuf {
        self.workspace_root(record.summary.workspace_id)
            .join("journals")
            .join(record.summary.change_id.to_string())
            .join(format!("{document_id}.json"))
    }

    fn write_journal(
        &self,
        record: &DraftRecord,
        journal: &RecoveryJournal,
    ) -> Result<(), AppError> {
        write_json_atomic(
            &self.journal_path(record, journal.document_id),
            journal,
            journal.document_id,
        )
    }

    fn remove_journal(&self, record: &DraftRecord, document_id: Uuid) -> Result<(), AppError> {
        let path = self.journal_path(record, document_id);
        if path.exists() {
            fs::remove_file(path).map_err(|_| draft_storage_error())?;
        }
        Ok(())
    }
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options.open(path).map_err(|_| draft_conflict_error())?;
    file.write_all(bytes).map_err(|_| draft_storage_error())?;
    file.sync_all().map_err(|_| draft_storage_error())
}

fn rollback_created_change(
    repository: &Repository,
    worktree_name: &str,
    worktree_path: &Path,
    branch: &str,
    metadata_path: &Path,
) {
    if let Ok(worktree) = repository.find_worktree(worktree_name) {
        let mut options = WorktreePruneOptions::new();
        options.valid(true).working_tree(true).locked(true);
        let _ = worktree.prune(Some(&mut options));
    }
    let _ = fs::remove_dir_all(worktree_path);
    if let Ok(mut reference) = repository.find_reference(&format!("refs/heads/{branch}")) {
        let _ = reference.delete();
    }
    let _ = fs::remove_file(metadata_path);
}

fn atomic_replace(path: &Path, bytes: &[u8], operation_id: Uuid) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(draft_storage_error)?;
    let attempt_id = Uuid::new_v4();
    let temp = parent.join(format!(".okhub-{operation_id}-{attempt_id}.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options.open(&temp).map_err(|_| draft_storage_error())?;
    let result = (|| {
        file.write_all(bytes).map_err(|_| draft_storage_error())?;
        file.sync_all().map_err(|_| draft_storage_error())?;
        replace_file(&temp, path)?;
        sync_parent_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, target: &Path) -> Result<(), AppError> {
    fs::rename(source, target).map_err(|_| draft_storage_error())
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(draft_storage_error())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn sync_parent_directory(parent: &Path) -> Result<(), AppError> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| draft_storage_error())
}

#[cfg(target_os = "windows")]
fn sync_parent_directory(_parent: &Path) -> Result<(), AppError> {
    Ok(())
}

fn write_json_atomic(
    path: &Path,
    value: &impl Serialize,
    operation_id: Uuid,
) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| draft_storage_error())?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| draft_storage_error())?;
    if path.exists() {
        atomic_replace(path, &bytes, operation_id)
    } else {
        write_new_file(path, &bytes)
    }
}

fn safe_draft_document_relative(record: &DraftRecord, path: &str) -> Result<PathBuf, AppError> {
    safe_existing_document_relative(record, path)
}

fn safe_existing_document_relative(record: &DraftRecord, path: &str) -> Result<PathBuf, AppError> {
    let relative = PathBuf::from(path);
    if path.is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        || relative
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
        || relative.to_string_lossy().replace('\\', "/") != path
    {
        return Err(invalid_document_error());
    }
    let allowed = record.document_roots.iter().any(|root| {
        let root = Path::new(root);
        relative.starts_with(root)
            && root
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)))
    });
    if !allowed {
        return Err(invalid_document_error());
    }
    Ok(relative)
}

fn ensure_existing_document_identity(
    markdown: &str,
    file_name: &str,
    title: &str,
    generated_document_id: Uuid,
) -> Result<(Uuid, String), AppError> {
    let parsed = parse_document(markdown, file_name);
    if let Some(document_id) = parsed.document_id {
        return Ok((document_id, markdown.to_owned()));
    }
    match parsed.frontmatter_status {
        FrontmatterStatus::Invalid { .. } => Err(invalid_document_error()),
        FrontmatterStatus::Missing => {
            let title = title.trim();
            if title.is_empty() {
                return Err(invalid_document_error());
            }
            let yaml = serde_yaml_ng::to_string(&ExistingDocumentFrontmatter {
                okf_hub_id: generated_document_id,
                title,
            })
            .map_err(|_| draft_storage_error())?;
            Ok((generated_document_id, format!("---\n{yaml}---\n{markdown}")))
        }
        FrontmatterStatus::Valid => {
            let line_end = if markdown.starts_with("---\r\n") {
                "\r\n"
            } else if markdown.starts_with("---\n") {
                "\n"
            } else {
                return Err(invalid_document_error());
            };
            let opening_len = 3 + line_end.len();
            let frontmatter_end = markdown[opening_len..]
                .find(&format!("{line_end}---"))
                .or_else(|| markdown[opening_len..].find(&format!("{line_end}...")))
                .ok_or_else(invalid_document_error)?;
            let frontmatter = &markdown[opening_len..opening_len + frontmatter_end];
            if frontmatter.lines().any(|line| {
                line.split_once(':')
                    .is_some_and(|(key, _)| key.trim() == "okf_hub_id")
            }) {
                return Err(invalid_document_error());
            }
            Ok((
                generated_document_id,
                format!(
                    "---{line_end}okf_hub_id: {generated_document_id}{line_end}{}",
                    &markdown[opening_len..]
                ),
            ))
        }
    }
}

fn remove_empty_folder_markers(worktree: &AnchoredWorktree, roots: &[String], start: &Path) {
    for root in roots {
        let root = Path::new(root);
        if !start.starts_with(root) {
            continue;
        }
        let mut current = Some(start);
        while let Some(directory) = current {
            if !directory.starts_with(root) {
                break;
            }
            let marker = directory.join(".gitkeep");
            let _ = worktree.remove_file(&marker);
            if directory == root {
                break;
            }
            current = directory.parent();
        }
    }
}

fn normalize_author(author: &str) -> String {
    let normalized = author
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .flat_map(char::to_lowercase)
        .collect::<String>();
    if normalized.is_empty() {
        "user".to_owned()
    } else {
        normalized
    }
}

fn content_hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn require_v4(id: Uuid) -> Result<(), AppError> {
    if id.get_version() == Some(uuid::Version::Random) {
        Ok(())
    } else {
        Err(draft_conflict_error())
    }
}

fn draft_git_error() -> AppError {
    AppError::new(
        ErrorCode::DocumentSessionConflict,
        "문서 Draft용 Git worktree를 준비할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn draft_storage_error() -> AppError {
    AppError::new(
        ErrorCode::DocumentIndexUnavailable,
        "문서 Draft를 로컬에 저장할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn draft_conflict_error() -> AppError {
    AppError::new(
        ErrorCode::DocumentSessionConflict,
        "같은 문서 Draft 또는 파일이 이미 존재합니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn invalid_document_error() -> AppError {
    AppError::new(
        ErrorCode::DocumentPathInvalid,
        "문서가 현재 Draft에 속하지 않습니다.",
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Barrier};
    use std::thread;

    use git2::{IndexAddOption, Repository, RepositoryInitOptions, Signature};
    use tempfile::TempDir;
    use uuid::Uuid;

    use crate::documents::authoring::built_in_templates;

    use super::{DraftManager, SaveDocumentResult};

    struct Fixture {
        repository: TempDir,
        storage: TempDir,
        workspace_id: Uuid,
    }

    impl Fixture {
        fn new() -> Self {
            let repository = tempfile::tempdir().unwrap();
            let storage = tempfile::tempdir().unwrap();
            fs::create_dir_all(repository.path().join("docs/api")).unwrap();
            fs::write(repository.path().join("docs/.gitkeep"), "").unwrap();
            fs::write(repository.path().join("docs/README.md"), "# Existing\n").unwrap();
            let mut options = RepositoryInitOptions::new();
            options.initial_head("main");
            let git = Repository::init_opts(repository.path(), &options).unwrap();
            let mut index = git.index().unwrap();
            index
                .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
                .unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = git.find_tree(tree_id).unwrap();
            let signature = Signature::now("OkHub Test", "test@example.com").unwrap();
            git.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
                .unwrap();
            drop(tree);
            drop(git);
            Self {
                repository,
                storage,
                workspace_id: Uuid::new_v4(),
            }
        }

        fn manager(&self) -> DraftManager {
            DraftManager::new(self.storage.path().to_path_buf())
        }
    }

    #[test]
    fn creating_a_change_makes_an_isolated_branch_and_resumable_worktree() {
        let fixture = Fixture::new();
        let change_id = Uuid::parse_str("269482aa-2c25-4a64-9006-c64ff075b9e5").unwrap();

        let draft = fixture
            .manager()
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "KANCHOEUN",
                "지도 API 계약",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();

        assert_eq!(draft.change_id, change_id);
        assert_eq!(draft.branch, "draft/kanchoeun/269482aa-지도-api-계약");
        assert_eq!(draft.author_login, "KANCHOEUN");
        assert!(!draft.base_commit.is_empty());
        let worktree = fixture
            .manager()
            .active_worktree(fixture.workspace_id)
            .unwrap();
        assert!(worktree.join("docs/README.md").is_file());
        let serialized = serde_json::to_string(&draft).unwrap();
        assert!(!serialized.contains(worktree.to_str().unwrap()));

        let restored = fixture
            .manager()
            .list_changes(fixture.workspace_id)
            .unwrap();
        assert_eq!(restored, vec![draft.clone()]);
        assert_eq!(
            fixture
                .manager()
                .active_change(fixture.workspace_id)
                .unwrap(),
            Some(draft)
        );
    }

    #[test]
    fn opening_an_existing_document_registers_it_and_adds_a_stable_id() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::parse_str("269482aa-2c25-4a64-9006-c64ff075b9e5").unwrap();
        let document_id = Uuid::parse_str("80a44162-92c6-4f2c-9b77-ef5c42a52e5a").unwrap();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "KANCHOEUN",
                "Existing",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();

        let opened = manager
            .add_existing_document(
                fixture.workspace_id,
                change_id,
                "docs/README.md",
                "Existing",
                document_id,
            )
            .unwrap();

        assert_eq!(opened.document_id, document_id);
        assert_eq!(opened.path, "docs/README.md");
        assert_eq!(
            opened.markdown,
            format!("---\nokf_hub_id: {document_id}\ntitle: Existing\n---\n# Existing\n")
        );
        assert_eq!(
            fs::read_to_string(
                manager
                    .active_worktree(fixture.workspace_id)
                    .unwrap()
                    .join("docs/README.md"),
            )
            .unwrap(),
            opened.markdown,
        );
        assert_eq!(
            manager
                .active_recovery(fixture.workspace_id)
                .unwrap()
                .unwrap()
                .document,
            opened,
        );
    }

    #[test]
    fn reopening_a_registered_existing_document_is_idempotent() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        let document_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "KANCHOEUN",
                "Existing",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let first = manager
            .add_existing_document(
                fixture.workspace_id,
                change_id,
                "docs/README.md",
                "Existing",
                document_id,
            )
            .unwrap();

        let reopened = manager
            .add_existing_document(
                fixture.workspace_id,
                change_id,
                "docs/README.md",
                "Ignored",
                Uuid::new_v4(),
            )
            .unwrap();

        assert_eq!(reopened.document_id, first.document_id);
        assert_eq!(reopened.markdown, first.markdown);
    }

    #[test]
    fn creating_a_change_uses_a_bounded_branch_slug_for_a_long_title() {
        let fixture = Fixture::new();
        let change_id = Uuid::parse_str("df78f996-37cc-489d-9348-14f7a8071e93").unwrap();
        let title = "아주 긴 문서 제목 ".repeat(40);

        let draft = fixture
            .manager()
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                &title,
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();

        assert!(draft.branch.starts_with("draft/hyeeun/df78f996-"));
        assert!(draft.branch.len() < 200);
    }

    #[test]
    fn adding_a_document_writes_frontmatter_and_removes_the_empty_folder_marker() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "지도 검색",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let template = built_in_templates()
            .into_iter()
            .find(|item| item.id == "builtin:api_contract")
            .unwrap();
        let document_id = Uuid::new_v4();

        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs/api",
                "지도 검색 API.md",
                "지도 검색 API",
                &template,
                document_id,
            )
            .unwrap();

        assert_eq!(created.path, "docs/api/지도-검색-api.md");
        assert_eq!(created.document_id, document_id);
        let worktree = manager.active_worktree(fixture.workspace_id).unwrap();
        let source = fs::read_to_string(worktree.join(&created.path)).unwrap();
        assert!(source.contains(&format!("okf_hub_id: {document_id}")));
        assert!(source.contains("title: 지도 검색 API"));
        assert!(!worktree.join("docs/.gitkeep").exists());
    }

    #[cfg(unix)]
    #[test]
    fn metadata_failure_happens_before_a_new_document_file_is_written() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "원자적 생성",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let metadata_dir = manager
            .workspace_root(fixture.workspace_id)
            .join("metadata");
        fs::set_permissions(&metadata_dir, fs::Permissions::from_mode(0o500)).unwrap();
        let template = built_in_templates()
            .into_iter()
            .find(|item| item.id == "builtin:blank")
            .unwrap();

        let result = manager.add_document(
            fixture.workspace_id,
            change_id,
            "docs/api",
            "atomic.md",
            "원자적 생성",
            &template,
            Uuid::new_v4(),
        );

        fs::set_permissions(&metadata_dir, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert!(!manager
            .active_worktree(fixture.workspace_id)
            .unwrap()
            .join("docs/api/atomic.md")
            .exists());
    }

    #[test]
    fn duplicating_a_builtin_template_creates_a_git_shared_team_template() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "팀 API 템플릿",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let source = built_in_templates()
            .into_iter()
            .find(|template| template.id == "builtin:api_contract")
            .unwrap();

        let relative = manager
            .add_team_template(
                fixture.workspace_id,
                change_id,
                "Mockly API.md",
                "Mockly API 계약",
                Some("Mockly 전용 계약"),
                &source,
            )
            .unwrap();

        assert_eq!(relative, ".okf/templates/mockly-api.md");
        let worktree = manager.active_worktree(fixture.workspace_id).unwrap();
        let markdown = fs::read_to_string(worktree.join(relative)).unwrap();
        assert!(markdown.contains("label: Mockly API 계약"));
        assert!(markdown.contains("type: api_contract"));
        assert!(markdown.contains("# {{title}}"));
        assert!(manager
            .add_team_template(
                fixture.workspace_id,
                change_id,
                "MOCKLY API.md",
                "duplicate",
                None,
                &source,
            )
            .is_err());
    }

    #[test]
    fn save_uses_compare_and_swap_and_preserves_a_recovery_journal_on_conflict() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "저장 충돌",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs",
                "충돌.md",
                "충돌",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();
        let worktree = manager.active_worktree(fixture.workspace_id).unwrap();
        fs::write(worktree.join(&created.path), "external edit\n").unwrap();

        let result = manager
            .save_document(
                fixture.workspace_id,
                change_id,
                document_id,
                &created.path,
                &created.content_hash,
                "hub edit\n",
            )
            .unwrap();

        let SaveDocumentResult::Conflict(conflict) = result else {
            panic!("expected conflict");
        };
        assert_eq!(conflict.disk_markdown, "external edit\n");
        assert_eq!(conflict.hub_markdown, "hub edit\n");
        assert_eq!(
            fs::read_to_string(worktree.join(&created.path)).unwrap(),
            "external edit\n"
        );
        assert!(manager.recovery_journal_exists(change_id, document_id));
        let recovered = manager
            .active_recovery(fixture.workspace_id)
            .unwrap()
            .unwrap();
        assert!(recovered.has_unsaved_recovery);
        assert_eq!(recovered.document.markdown, "hub edit\n");
        let SaveDocumentResult::Conflict(recovered_conflict) = recovered.conflict.unwrap() else {
            panic!("expected recovered conflict");
        };
        assert_eq!(recovered_conflict.disk_markdown, "external edit\n");
    }

    #[test]
    fn successful_atomic_save_removes_the_recovery_journal() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "저장 성공",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs",
                "저장.md",
                "저장",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();

        let result = manager
            .save_document(
                fixture.workspace_id,
                change_id,
                document_id,
                &created.path,
                &created.content_hash,
                &format!("---\nokf_hub_id: {document_id}\ntitle: 저장\n---\n# 저장\n\n수정\n"),
            )
            .unwrap();

        let SaveDocumentResult::Saved(saved) = result else {
            panic!("expected save");
        };
        assert_ne!(saved.content_hash, created.content_hash);
        assert!(!manager.recovery_journal_exists(change_id, document_id));
        let reopened = manager
            .active_recovery(fixture.workspace_id)
            .unwrap()
            .unwrap();
        assert!(!reopened.has_unsaved_recovery);
        assert_eq!(reopened.document.document_id, document_id);
        assert_eq!(
            reopened.document.markdown,
            fs::read_to_string(
                manager
                    .active_worktree(fixture.workspace_id)
                    .unwrap()
                    .join(&created.path),
            )
            .unwrap()
        );
    }

    #[test]
    fn stale_temp_file_from_a_crash_does_not_block_the_next_save() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "재시도",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs",
                "재시도.md",
                "재시도",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();
        let worktree = manager.active_worktree(fixture.workspace_id).unwrap();
        let parent = worktree.join(&created.path).parent().unwrap().to_path_buf();
        fs::write(parent.join(format!(".okhub-{document_id}.tmp")), "stale").unwrap();

        let result = manager
            .save_document(
                fixture.workspace_id,
                change_id,
                document_id,
                &created.path,
                &created.content_hash,
                "# retried\n",
            )
            .unwrap();

        assert!(matches!(result, SaveDocumentResult::Saved(_)));
    }

    #[test]
    fn concurrent_saves_with_the_same_expected_hash_have_one_winner() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "동시 저장",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs",
                "동시-저장.md",
                "동시 저장",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let workspace_id = fixture.workspace_id;

        let handles = ["first", "second"].map(|label| {
            let manager = manager.clone();
            let barrier = Arc::clone(&barrier);
            let path = created.path.clone();
            let expected_hash = created.content_hash.clone();
            let markdown = format!("# {label}\n\n{}", "content\n".repeat(250_000));
            thread::spawn(move || {
                barrier.wait();
                manager
                    .save_document(
                        workspace_id,
                        change_id,
                        document_id,
                        &path,
                        &expected_hash,
                        &markdown,
                    )
                    .unwrap()
            })
        });

        let results = handles.map(|handle| handle.join().unwrap());
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, SaveDocumentResult::Saved(_)))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, SaveDocumentResult::Conflict(_)))
                .count(),
            1
        );
    }

    #[test]
    fn save_is_scoped_to_the_active_change_in_the_requested_workspace() {
        let fixture = Fixture::new();
        let manager = fixture.manager();
        let first_change = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "첫 작업",
                first_change,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                first_change,
                "docs",
                "첫-문서.md",
                "첫 문서",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();
        let second_change = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "둘째 작업",
                second_change,
                vec!["docs".to_owned()],
            )
            .unwrap();

        assert!(manager
            .save_document(
                fixture.workspace_id,
                first_change,
                document_id,
                &created.path,
                &created.content_hash,
                "inactive edit\n",
            )
            .is_err());
        assert!(manager
            .save_document(
                Uuid::new_v4(),
                first_change,
                document_id,
                &created.path,
                &created.content_hash,
                "other workspace edit\n",
            )
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn save_rejects_a_document_replaced_by_an_external_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = tempfile::tempdir().unwrap();
        let manager = fixture.manager();
        let change_id = Uuid::new_v4();
        manager
            .create_change(
                fixture.repository.path(),
                fixture.workspace_id,
                "hyeeun",
                "symlink",
                change_id,
                vec!["docs".to_owned()],
            )
            .unwrap();
        let document_id = Uuid::new_v4();
        let created = manager
            .add_document(
                fixture.workspace_id,
                change_id,
                "docs",
                "symlink.md",
                "symlink",
                &built_in_templates()[0],
                document_id,
            )
            .unwrap();
        let worktree = manager.active_worktree(fixture.workspace_id).unwrap();
        let target = worktree.join(&created.path);
        let external = outside.path().join("secret.md");
        fs::write(&external, "external secret\n").unwrap();
        fs::remove_file(&target).unwrap();
        symlink(&external, &target).unwrap();

        let error = manager
            .save_document(
                fixture.workspace_id,
                change_id,
                document_id,
                &created.path,
                &created.content_hash,
                "replacement\n",
            )
            .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::DocumentPathInvalid);
        assert_eq!(fs::read_to_string(external).unwrap(), "external secret\n");
    }

    #[cfg(unix)]
    #[test]
    fn anchored_worktree_never_follows_a_swapped_parent_symlink_when_creating() {
        use std::os::unix::fs::symlink;

        let worktree = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(worktree.path().join("docs")).unwrap();
        let anchored = super::AnchoredWorktree::open(worktree.path()).unwrap();
        fs::rename(
            worktree.path().join("docs"),
            worktree.path().join("docs-original"),
        )
        .unwrap();
        symlink(outside.path(), worktree.path().join("docs")).unwrap();

        assert!(anchored
            .write_new(Path::new("docs/new.md"), b"outside must stay untouched")
            .is_err());
        assert!(!outside.path().join("new.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_worktree_never_follows_a_swapped_parent_symlink_when_replacing() {
        use std::os::unix::fs::symlink;

        let worktree = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(worktree.path().join("docs")).unwrap();
        fs::write(worktree.path().join("docs/existing.md"), "inside\n").unwrap();
        fs::write(outside.path().join("existing.md"), "outside\n").unwrap();
        let anchored = super::AnchoredWorktree::open(worktree.path()).unwrap();
        fs::rename(
            worktree.path().join("docs"),
            worktree.path().join("docs-original"),
        )
        .unwrap();
        symlink(outside.path(), worktree.path().join("docs")).unwrap();

        assert!(anchored
            .atomic_replace_if_hash(
                Path::new("docs/existing.md"),
                b"replacement\n",
                Uuid::new_v4(),
                &super::content_hash(b"inside\n"),
            )
            .is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("existing.md")).unwrap(),
            "outside\n"
        );
    }

    #[test]
    fn anchored_replace_rechecks_the_expected_hash_after_preparing_the_temp_file() {
        let worktree = tempfile::tempdir().unwrap();
        fs::create_dir(worktree.path().join("docs")).unwrap();
        fs::write(worktree.path().join("docs/existing.md"), "original\n").unwrap();
        let anchored = super::AnchoredWorktree::open(worktree.path()).unwrap();
        let expected_hash = super::content_hash(b"original\n");
        fs::write(worktree.path().join("docs/existing.md"), "external edit\n").unwrap();

        let result = anchored
            .atomic_replace_if_hash(
                Path::new("docs/existing.md"),
                b"hub edit\n",
                Uuid::new_v4(),
                &expected_hash,
            )
            .unwrap();

        assert!(matches!(result, super::AnchoredReplace::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(worktree.path().join("docs/existing.md")).unwrap(),
            "external edit\n"
        );
    }
}
