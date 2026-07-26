use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::settings::model::{
    CurrentWorkspace, DisplayDensity, KnowledgeRepository, PendingInitializationContext,
};
use crate::workspace::service::{WorkspaceInspection, WorkspaceService};

pub const CURRENT_WORKSPACE_PATH_KEY: &str = "current-workspace-path";
pub const DISPLAY_DENSITY_KEY: &str = "display-density";
pub const PENDING_INITIALIZATION_KEY: &str = "pending-initialization-context";
const INVALIDATED_PENDING_INITIALIZATION: &str = r#"{"state":"invalidated"}"#;

pub trait LocalSettingsStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<String>, AppError>;
    fn write(&self, key: &str, value: &str) -> Result<(), AppError>;
    fn remove(&self, key: &str) -> Result<(), AppError>;
}

trait WorkspaceInspector: Send + Sync {
    fn inspect(&self, path: &Path) -> Result<WorkspaceInspection, AppError>;
}

struct FileWorkspaceInspector;

impl WorkspaceInspector for FileWorkspaceInspector {
    fn inspect(&self, path: &Path) -> Result<WorkspaceInspection, AppError> {
        WorkspaceService::inspect(path)
    }
}

trait CanonicalPathResolver: Send + Sync {
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, AppError>;
}

struct FileCanonicalPathResolver;

impl CanonicalPathResolver for FileCanonicalPathResolver {
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, AppError> {
        path.canonicalize()
            .map_err(|error| local_path_error(path, error))
    }
}

#[derive(Clone)]
pub struct LocalSettingsService {
    store: Arc<dyn LocalSettingsStore>,
    workspace_inspector: Arc<dyn WorkspaceInspector>,
    path_resolver: Arc<dyn CanonicalPathResolver>,
}

impl LocalSettingsService {
    pub fn new(store: impl LocalSettingsStore + 'static) -> Self {
        Self {
            store: Arc::new(store),
            workspace_inspector: Arc::new(FileWorkspaceInspector),
            path_resolver: Arc::new(FileCanonicalPathResolver),
        }
    }

    #[cfg(test)]
    fn with_boundaries(
        store: impl LocalSettingsStore + 'static,
        workspace_inspector: impl WorkspaceInspector + 'static,
        path_resolver: impl CanonicalPathResolver + 'static,
    ) -> Self {
        Self {
            store: Arc::new(store),
            workspace_inspector: Arc::new(workspace_inspector),
            path_resolver: Arc::new(path_resolver),
        }
    }

    pub fn load_current(&self) -> Result<Option<CurrentWorkspace>, AppError> {
        let Some(raw_connection) = self.store.read(CURRENT_WORKSPACE_PATH_KEY)? else {
            return Ok(None);
        };
        let stored = StoredCurrentWorkspace::decode(&raw_connection);
        let saved_path = stored.path;
        let repository = stored.repository.filter(|repository| {
            !repository.id.trim().is_empty()
                && valid_repository_full_name(&repository.full_name)
        });
        let canonical_path = match self.path_resolver.canonicalize(&saved_path) {
            Ok(path) => path,
            Err(_) => return Ok(Some(CurrentWorkspace::recovery_required(saved_path))),
        };
        let inspection = match self.workspace_inspector.inspect(&canonical_path) {
            Ok(inspection) => inspection,
            Err(_) => return Ok(Some(CurrentWorkspace::recovery_required(saved_path))),
        };

        match inspection {
            WorkspaceInspection::Ready { summary } => Ok(Some(
                repository
                    .map(|repository| {
                        CurrentWorkspace::connected_to_repository(
                            canonical_path.clone(),
                            summary.clone(),
                            repository,
                        )
                    })
                    .unwrap_or_else(|| CurrentWorkspace::connected(canonical_path, summary)),
            )),
            WorkspaceInspection::InitializationRequired
            | WorkspaceInspection::Invalid { .. }
            | WorkspaceInspection::UnsupportedVersion { .. } => {
                Ok(Some(CurrentWorkspace::recovery_required(saved_path)))
            }
        }
    }

    pub fn set_current(&self, repository_path: &Path) -> Result<CurrentWorkspace, AppError> {
        let inspected_summary = ready_summary(self.workspace_inspector.as_ref(), repository_path)?;
        let canonical_path = self.path_resolver.canonicalize(repository_path)?;

        // Inspect the exact path that will be persisted. This avoids accepting a
        // different target if a symlink changes between inspection and storage.
        let summary = match self.workspace_inspector.inspect(&canonical_path)? {
            WorkspaceInspection::Ready { summary } => summary,
            inspection => return Err(workspace_not_ready_error(inspection)),
        };
        if summary.id != inspected_summary.id {
            return Err(AppError::new(
                ErrorCode::WorkspaceInvalid,
                "검증 중 워크스페이스 경로가 변경되었습니다.",
            )
            .with_recovery(RecoveryAction::Retry));
        }
        let encoded_path = canonical_path.to_str().ok_or_else(|| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "현재 워크스페이스 경로를 로컬 설정에 저장할 수 없습니다.",
            )
            .with_recovery(RecoveryAction::ChooseAnotherDirectory)
        })?;

        self.store.write(CURRENT_WORKSPACE_PATH_KEY, encoded_path)?;

        Ok(CurrentWorkspace::connected(canonical_path, summary))
    }

    pub fn set_current_for_repository(
        &self,
        repository_path: &Path,
        repository: KnowledgeRepository,
    ) -> Result<CurrentWorkspace, AppError> {
        if repository.id.trim().is_empty()
            || !valid_repository_full_name(&repository.full_name)
        {
            return Err(AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "현재 지식 저장소 정보를 로컬 설정에 저장할 수 없습니다.",
            ));
        }
        let inspected_summary = ready_summary(self.workspace_inspector.as_ref(), repository_path)?;
        let canonical_path = self.path_resolver.canonicalize(repository_path)?;
        let summary = match self.workspace_inspector.inspect(&canonical_path)? {
            WorkspaceInspection::Ready { summary } => summary,
            inspection => return Err(workspace_not_ready_error(inspection)),
        };
        if summary.id != inspected_summary.id {
            return Err(AppError::new(
                ErrorCode::WorkspaceInvalid,
                "검증 중 워크스페이스 경로가 변경되었습니다.",
            )
            .with_recovery(RecoveryAction::Retry));
        }
        let encoded = serde_json::to_string(&StoredCurrentWorkspace {
            path: canonical_path.clone(),
            repository: Some(repository.clone()),
        })
        .map_err(|_| {
            AppError::new(
                ErrorCode::LocalSettingsUnavailable,
                "현재 워크스페이스 연결을 로컬 설정에 저장할 수 없습니다.",
            )
        })?;
        self.store.write(CURRENT_WORKSPACE_PATH_KEY, &encoded)?;

        Ok(CurrentWorkspace::connected_to_repository(
            canonical_path,
            summary,
            repository,
        ))
    }

    pub fn clear_current(&self) -> Result<(), AppError> {
        self.store.remove(CURRENT_WORKSPACE_PATH_KEY)
    }

    pub fn load_display_density(&self) -> Result<DisplayDensity, AppError> {
        let value = self.store.read(DISPLAY_DENSITY_KEY)?;
        Ok(DisplayDensity::from_stored(value.as_deref()))
    }

    pub fn set_display_density(&self, density: DisplayDensity) -> Result<(), AppError> {
        self.store.write(DISPLAY_DENSITY_KEY, density.as_stored())
    }

    pub fn load_pending_initialization(
        &self,
    ) -> Result<Option<PendingInitializationContext>, AppError> {
        let Some(encoded) = self.store.read(PENDING_INITIALIZATION_KEY)? else {
            return Ok(None);
        };
        if encoded == INVALIDATED_PENDING_INITIALIZATION {
            return Ok(None);
        }
        let context: PendingInitializationContext =
            serde_json::from_str(&encoded).map_err(|_| pending_initialization_error())?;
        validate_pending_initialization(&context)?;
        Ok(Some(context))
    }

    pub fn set_pending_initialization(
        &self,
        context: &PendingInitializationContext,
    ) -> Result<(), AppError> {
        validate_pending_initialization(context)?;
        let encoded = serde_json::to_string(context).map_err(|_| pending_initialization_error())?;
        self.store.write(PENDING_INITIALIZATION_KEY, &encoded)
    }

    pub fn clear_pending_initialization(&self) -> Result<(), AppError> {
        self.store.remove(PENDING_INITIALIZATION_KEY)
    }

    pub fn invalidate_pending_initialization(&self) -> Result<(), AppError> {
        self.store.write(
            PENDING_INITIALIZATION_KEY,
            INVALIDATED_PENDING_INITIALIZATION,
        )
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCurrentWorkspace {
    path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    repository: Option<KnowledgeRepository>,
}

impl StoredCurrentWorkspace {
    fn decode(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_else(|_| Self {
            path: PathBuf::from(raw),
            repository: None,
        })
    }
}

fn validate_pending_initialization(context: &PendingInitializationContext) -> Result<(), AppError> {
    if !context.root.is_absolute()
        || context.repository_id.trim().is_empty()
        || !valid_repository_full_name(&context.repository_full_name)
        || context.author_id == 0
        || context.author_login.trim().is_empty()
        || context.created_at_unix <= 0
        || context.expires_at_unix <= context.created_at_unix
        || context
            .completed_result
            .as_ref()
            .is_some_and(|result| result.root != context.root)
    {
        return Err(pending_initialization_error());
    }
    Ok(())
}

fn valid_repository_full_name(full_name: &str) -> bool {
    let mut parts = full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let repository = parts.next().unwrap_or_default();
    !owner.is_empty()
        && !repository.is_empty()
        && parts.next().is_none()
        && owner.trim() == owner
        && repository.trim() == repository
        && !owner.chars().any(char::is_whitespace)
        && !repository.chars().any(char::is_whitespace)
}

fn pending_initialization_error() -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "저장된 워크스페이스 초기화 복구 정보를 사용할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::Retry)
}

fn ready_summary(
    inspector: &dyn WorkspaceInspector,
    repository_path: &Path,
) -> Result<crate::workspace::service::WorkspaceSummary, AppError> {
    match inspector.inspect(repository_path)? {
        WorkspaceInspection::Ready { summary } => Ok(summary),
        inspection => Err(workspace_not_ready_error(inspection)),
    }
}

fn workspace_not_ready_error(inspection: WorkspaceInspection) -> AppError {
    match inspection {
        WorkspaceInspection::Ready { .. } => unreachable!("ready workspaces are handled above"),
        WorkspaceInspection::InitializationRequired => AppError::new(
            ErrorCode::WorkspaceMissing,
            "선택한 저장소에 .okf/workspace.yml이 없습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile),
        WorkspaceInspection::Invalid { .. } => AppError::new(
            ErrorCode::WorkspaceInvalid,
            "선택한 저장소의 워크스페이스 설정이 유효하지 않습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile),
        WorkspaceInspection::UnsupportedVersion { found_version } => AppError::new(
            ErrorCode::WorkspaceVersionUnsupported,
            "현재 버전의 OkHub에서 이 워크스페이스를 열 수 없습니다.",
        )
        .with_recovery(RecoveryAction::UpdateOkhub)
        .with_detail("foundVersion", found_version.to_string()),
    }
}

fn local_path_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::new(
        ErrorCode::LocalSettingsUnavailable,
        "현재 워크스페이스 경로를 확인할 수 없습니다.",
    )
    .with_recovery(RecoveryAction::ChooseAnotherDirectory)
    .with_detail("path", path.display().to_string())
    .with_detail("reason", error.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use tempfile::TempDir;
    use uuid::Uuid;

    use super::*;
    use crate::error::AppError;
    use crate::settings::model::{
        CurrentWorkspaceStatus, DisplayDensity, PendingInitializationContext,
    };
    use crate::workspace::service::{WorkspaceInspection, WorkspaceSummary};

    const UNKNOWN_KEY: &str = "future-setting";

    #[derive(Clone, Default)]
    struct MemoryLocalSettingsStore {
        values: Arc<Mutex<BTreeMap<String, String>>>,
    }

    impl MemoryLocalSettingsStore {
        fn with_values(values: impl IntoIterator<Item = (&'static str, String)>) -> Self {
            Self {
                values: Arc::new(Mutex::new(
                    values
                        .into_iter()
                        .map(|(key, value)| (key.to_owned(), value))
                        .collect(),
                )),
            }
        }

        fn raw(&self, key: &str) -> Option<String> {
            self.values.lock().unwrap().get(key).cloned()
        }
    }

    impl LocalSettingsStore for MemoryLocalSettingsStore {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.raw(key))
        }

        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn ready_workspace(name: &str) -> TempDir {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        fs::create_dir_all(directory.path().join("docs")).unwrap();
        fs::write(
            directory.path().join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: {name}\ndocuments:\n  roots:\n    - path: docs\nrepositories: []\n",
                Uuid::new_v4()
            ),
        )
        .unwrap();
        directory
    }

    #[test]
    fn one_token_free_pending_initialization_context_round_trips_and_clears() {
        let store = MemoryLocalSettingsStore::default();
        let service = LocalSettingsService::new(store.clone());
        let context = PendingInitializationContext {
            preview_id: Uuid::new_v4(),
            root: PathBuf::from("/tmp/mockly-knowledge"),
            repository_id: "R_kgDOMockly".into(),
            repository_full_name: "Mockly-Company/mockly-knowledge".into(),
            author_id: 42,
            author_login: "hyeeun".into(),
            created_at_unix: 1_000,
            expires_at_unix: 1_900,
            completed_result: None,
        };

        service.set_pending_initialization(&context).unwrap();
        assert_eq!(
            service.load_pending_initialization().unwrap(),
            Some(context)
        );
        let raw = store.raw(PENDING_INITIALIZATION_KEY).unwrap();
        assert!(!raw.contains("token"));
        assert!(!raw.contains("https_url"));

        service.clear_pending_initialization().unwrap();
        assert_eq!(service.load_pending_initialization().unwrap(), None);
    }

    #[test]
    fn pending_initialization_rejects_invalid_account_repository_and_completion_identity() {
        let service = LocalSettingsService::new(MemoryLocalSettingsStore::default());
        let base = PendingInitializationContext {
            preview_id: Uuid::new_v4(),
            root: PathBuf::from("/tmp/mockly-knowledge"),
            repository_id: "R_kgDOMockly".into(),
            repository_full_name: "Mockly-Company/mockly-knowledge".into(),
            author_id: 42,
            author_login: "hyeeun".into(),
            created_at_unix: 1_000,
            expires_at_unix: 1_900,
            completed_result: None,
        };

        let mut zero_author = base.clone();
        zero_author.author_id = 0;
        assert!(service.set_pending_initialization(&zero_author).is_err());

        for full_name in ["mockly", "/knowledge", "mockly/", "a/b/c", "a /b"] {
            let mut invalid_repository = base.clone();
            invalid_repository.repository_full_name = full_name.into();
            assert!(service
                .set_pending_initialization(&invalid_repository)
                .is_err());
        }

        let mut mismatched_completion = base;
        mismatched_completion.completed_result =
            Some(crate::repository::model::InitializationResult {
                root: PathBuf::from("/tmp/different-repository"),
                branch: "okf/init-workspace".into(),
                commit_oid: "abc123".into(),
                commit_message: "chore: initialize OkHub workspace".into(),
                pushed: true,
                draft_pull_request_url: None,
            });
        assert!(service
            .set_pending_initialization(&mismatched_completion)
            .is_err());
    }

    #[test]
    fn setting_a_new_workspace_replaces_only_the_current_path() {
        let first = ready_workspace("First");
        let second = ready_workspace("Second");
        let store = MemoryLocalSettingsStore::with_values([
            (DISPLAY_DENSITY_KEY, "compact".into()),
            (UNKNOWN_KEY, "keep-me".into()),
        ]);
        let service = LocalSettingsService::new(store.clone());

        service.set_current(first.path()).unwrap();
        service.set_current(second.path()).unwrap();

        let current = service.load_current().unwrap().unwrap();
        assert_eq!(current.path, second.path().canonicalize().unwrap());
        assert_eq!(current.status, CurrentWorkspaceStatus::Connected);
        assert_eq!(store.raw(DISPLAY_DENSITY_KEY).as_deref(), Some("compact"));
        assert_eq!(store.raw(UNKNOWN_KEY).as_deref(), Some("keep-me"));
    }

    #[test]
    fn loading_a_workspace_restores_its_github_repository_identity() {
        let workspace = ready_workspace("Mockly");
        let canonical_path = workspace.path().canonicalize().unwrap();
        let raw_path = canonical_path.display().to_string();
        let connection = serde_json::json!({
            "path": raw_path,
            "repository": {
                "id": "R_kgDOExample",
                "fullName": "Mockly-Company/mockly-knowledge"
            }
        });
        let store = MemoryLocalSettingsStore::with_values([(
            CURRENT_WORKSPACE_PATH_KEY,
            connection.to_string(),
        )]);
        let service = LocalSettingsService::new(store);

        let current = service.load_current().unwrap().unwrap();
        let serialized = serde_json::to_value(current).unwrap();

        assert_eq!(
            serialized["repository"],
            serde_json::json!({
                "id": "R_kgDOExample",
                "fullName": "Mockly-Company/mockly-knowledge"
            })
        );
    }

    #[test]
    fn malformed_saved_repository_identity_is_not_exposed() {
        let workspace = ready_workspace("Mockly");
        let connection = serde_json::json!({
            "path": workspace.path().canonicalize().unwrap(),
            "repository": {
                "id": "",
                "fullName": "not-a-full-name"
            }
        });
        let store = MemoryLocalSettingsStore::with_values([(
            CURRENT_WORKSPACE_PATH_KEY,
            connection.to_string(),
        )]);
        let service = LocalSettingsService::new(store);

        let current = service.load_current().unwrap().unwrap();

        assert!(current.repository.is_none());
    }

    #[test]
    fn setting_a_workspace_persists_repository_identity_with_its_canonical_path() {
        let workspace = ready_workspace("Mockly");
        let store = MemoryLocalSettingsStore::default();
        let service = LocalSettingsService::new(store.clone());

        let current = service
            .set_current_for_repository(
                workspace.path(),
                KnowledgeRepository {
                    id: "R_kgDOExample".into(),
                    full_name: "Mockly-Company/mockly-knowledge".into(),
                },
            )
            .unwrap();

        assert_eq!(
            current.repository.unwrap().full_name,
            "Mockly-Company/mockly-knowledge"
        );
        let stored: serde_json::Value =
            serde_json::from_str(&store.raw(CURRENT_WORKSPACE_PATH_KEY).unwrap()).unwrap();
        assert_eq!(
            stored,
            serde_json::json!({
                "path": workspace.path().canonicalize().unwrap(),
                "repository": {
                    "id": "R_kgDOExample",
                    "fullName": "Mockly-Company/mockly-knowledge"
                }
            })
        );
    }

    #[test]
    fn a_missing_saved_folder_requires_recovery_without_deleting_the_raw_value() {
        let missing = PathBuf::from("/definitely/missing/okhub-workspace");
        let raw = missing.display().to_string();
        let store = MemoryLocalSettingsStore::with_values([
            (CURRENT_WORKSPACE_PATH_KEY, raw.clone()),
            (DISPLAY_DENSITY_KEY, "default".into()),
        ]);
        let service = LocalSettingsService::new(store.clone());

        let current = service.load_current().unwrap().unwrap();

        assert_eq!(current.status, CurrentWorkspaceStatus::RecoveryRequired);
        assert_eq!(current.path, missing);
        assert_eq!(store.raw(CURRENT_WORKSPACE_PATH_KEY), Some(raw));
        assert_eq!(store.raw(DISPLAY_DENSITY_KEY).as_deref(), Some("default"));
    }

    #[test]
    fn an_invalid_saved_workspace_requires_recovery_without_rewriting_it() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join(".okf")).unwrap();
        fs::write(
            directory.path().join(".okf/workspace.yml"),
            "schema_version: 1\nworkspace: invalid\n",
        )
        .unwrap();
        let raw = directory.path().display().to_string();
        let store =
            MemoryLocalSettingsStore::with_values([(CURRENT_WORKSPACE_PATH_KEY, raw.clone())]);
        let service = LocalSettingsService::new(store.clone());

        let current = service.load_current().unwrap().unwrap();

        assert_eq!(current.status, CurrentWorkspaceStatus::RecoveryRequired);
        assert_eq!(store.raw(CURRENT_WORKSPACE_PATH_KEY), Some(raw));
    }

    #[test]
    fn invalid_candidate_does_not_replace_the_current_workspace() {
        let ready = ready_workspace("Ready");
        let invalid = tempfile::tempdir().unwrap();
        let store = MemoryLocalSettingsStore::default();
        let service = LocalSettingsService::new(store.clone());
        service.set_current(ready.path()).unwrap();
        let saved = store.raw(CURRENT_WORKSPACE_PATH_KEY);

        assert!(service.set_current(invalid.path()).is_err());
        assert_eq!(store.raw(CURRENT_WORKSPACE_PATH_KEY), saved);
    }

    #[test]
    fn clearing_the_workspace_preserves_other_settings() {
        let store = MemoryLocalSettingsStore::with_values([
            (CURRENT_WORKSPACE_PATH_KEY, "/workspace".into()),
            (DISPLAY_DENSITY_KEY, "compact".into()),
            (UNKNOWN_KEY, "keep-me".into()),
        ]);
        let service = LocalSettingsService::new(store.clone());

        service.clear_current().unwrap();

        assert_eq!(store.raw(CURRENT_WORKSPACE_PATH_KEY), None);
        assert_eq!(store.raw(DISPLAY_DENSITY_KEY).as_deref(), Some("compact"));
        assert_eq!(store.raw(UNKNOWN_KEY).as_deref(), Some("keep-me"));
    }

    #[test]
    fn no_saved_path_is_disconnected() {
        let service = LocalSettingsService::new(MemoryLocalSettingsStore::default());

        assert!(service.load_current().unwrap().is_none());
    }

    #[test]
    fn display_density_round_trip_preserves_the_current_workspace_and_unknown_keys() {
        let store = MemoryLocalSettingsStore::with_values([
            (CURRENT_WORKSPACE_PATH_KEY, "/workspace/current".into()),
            (DISPLAY_DENSITY_KEY, "default".into()),
            (UNKNOWN_KEY, "keep-me".into()),
        ]);
        let service = LocalSettingsService::new(store.clone());

        service
            .set_display_density(DisplayDensity::Compact)
            .unwrap();

        assert_eq!(
            service.load_display_density().unwrap(),
            DisplayDensity::Compact
        );
        assert_eq!(
            store.raw(CURRENT_WORKSPACE_PATH_KEY).as_deref(),
            Some("/workspace/current")
        );
        assert_eq!(store.raw(UNKNOWN_KEY).as_deref(), Some("keep-me"));
    }

    #[test]
    fn unsupported_saved_density_falls_back_without_rewriting_the_raw_value() {
        let store =
            MemoryLocalSettingsStore::with_values([(DISPLAY_DENSITY_KEY, "comfortable".into())]);
        let service = LocalSettingsService::new(store.clone());

        assert_eq!(
            service.load_display_density().unwrap(),
            DisplayDensity::Default
        );
        assert_eq!(
            store.raw(DISPLAY_DENSITY_KEY).as_deref(),
            Some("comfortable")
        );
    }

    struct RetargetingPathResolver {
        first_target: PathBuf,
        later_target: PathBuf,
        calls: Arc<AtomicUsize>,
    }

    impl CanonicalPathResolver for RetargetingPathResolver {
        fn canonicalize(&self, _path: &Path) -> Result<PathBuf, AppError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(if call == 0 {
                self.first_target.clone()
            } else {
                self.later_target.clone()
            })
        }
    }

    struct RecordingInspector {
        expected_path: PathBuf,
        inspected_paths: Arc<Mutex<Vec<PathBuf>>>,
        summary: WorkspaceSummary,
    }

    impl WorkspaceInspector for RecordingInspector {
        fn inspect(&self, path: &Path) -> Result<WorkspaceInspection, AppError> {
            self.inspected_paths
                .lock()
                .unwrap()
                .push(path.to_path_buf());
            assert_eq!(path, self.expected_path);
            Ok(WorkspaceInspection::Ready {
                summary: self.summary.clone(),
            })
        }
    }

    #[test]
    fn load_uses_one_canonical_target_even_if_the_saved_alias_would_retarget() {
        let raw_path = "/saved/workspace-alias";
        let first_target = PathBuf::from("/canonical/workspace-a");
        let later_target = PathBuf::from("/canonical/workspace-b");
        let calls = Arc::new(AtomicUsize::new(0));
        let inspected_paths = Arc::new(Mutex::new(Vec::new()));
        let workspace_id = Uuid::new_v4();
        let store =
            MemoryLocalSettingsStore::with_values([(CURRENT_WORKSPACE_PATH_KEY, raw_path.into())]);
        let service = LocalSettingsService::with_boundaries(
            store.clone(),
            RecordingInspector {
                expected_path: first_target.clone(),
                inspected_paths: inspected_paths.clone(),
                summary: WorkspaceSummary {
                    id: workspace_id,
                    name: "Workspace A".into(),
                    schema_version: 1,
                    document_roots: vec!["docs".into()],
                    repository_count: 0,
                },
            },
            RetargetingPathResolver {
                first_target: first_target.clone(),
                later_target,
                calls: calls.clone(),
            },
        );

        let current = service.load_current().unwrap().unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(*inspected_paths.lock().unwrap(), vec![first_target.clone()]);
        assert_eq!(current.path, first_target);
        assert_eq!(current.status, CurrentWorkspaceStatus::Connected);
        assert_eq!(current.summary.unwrap().id, workspace_id);
        assert_eq!(
            store.raw(CURRENT_WORKSPACE_PATH_KEY).as_deref(),
            Some(raw_path)
        );
    }

    #[cfg(unix)]
    #[test]
    fn setting_a_symlinked_ready_workspace_persists_the_canonical_path() {
        use std::os::unix::fs::symlink;

        let ready = ready_workspace("Canonical");
        let parent = tempfile::tempdir().unwrap();
        let linked = parent.path().join("linked-workspace");
        symlink(ready.path(), &linked).unwrap();
        let store = MemoryLocalSettingsStore::default();
        let service = LocalSettingsService::new(store.clone());

        service.set_current(&linked).unwrap();

        assert_eq!(
            store.raw(CURRENT_WORKSPACE_PATH_KEY),
            Some(ready.path().canonicalize().unwrap().display().to_string())
        );
    }
}
