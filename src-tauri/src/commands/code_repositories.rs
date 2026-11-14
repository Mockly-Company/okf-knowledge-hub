use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::settings::ai_runner::shell_path;
use crate::settings::model::CurrentWorkspaceStatus;
use crate::settings::service::LocalSettingsService;
use crate::state::AppServices;
use crate::workspace::model::{LinkedRepository, WorkspaceConfigV1};

const MAX_CODE_PREVIEW_BYTES: u64 = 256 * 1024;
const MAX_CODE_PREVIEW_LINES: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCodeRepositoryStatus {
    pub key: String,
    pub label: String,
    pub full_name: String,
    pub local_path: Option<String>,
    /// `"manual"` | `"auto_detected"` | `"unmapped"`
    pub mapping_source: String,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeRepositoryFilePreview {
    pub repository_key: String,
    pub repository_full_name: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
    pub content: String,
}

pub(crate) fn load_workspace_linked_repositories(workspace_root: &Path) -> Vec<LinkedRepository> {
    std::fs::read_to_string(workspace_root.join(".okf/workspace.yml"))
        .ok()
        .and_then(|raw| serde_yaml_ng::from_str::<WorkspaceConfigV1>(&raw).ok())
        .map(|manifest| manifest.repositories)
        .unwrap_or_default()
}

pub(crate) fn resolve_code_repositories_for_workspace(
    settings: &LocalSettingsService,
    workspace_root: &Path,
) -> CommandResult<Vec<WorkspaceCodeRepositoryStatus>> {
    let mapped = settings.load_code_repository_paths()?;
    let parent_dir = workspace_root.parent();
    let repositories = load_workspace_linked_repositories(workspace_root);

    Ok(repositories
        .into_iter()
        .map(|repo| resolve_single_code_repo(&repo, &mapped, parent_dir))
        .collect())
}

fn resolve_single_code_repo(
    repo: &LinkedRepository,
    mapped: &std::collections::BTreeMap<String, PathBuf>,
    parent_dir: Option<&Path>,
) -> WorkspaceCodeRepositoryStatus {
    let lookup_key = repo.github.full_name.trim().to_ascii_lowercase();
    if let Some(manual_path) = mapped.get(&lookup_key) {
        let exists = manual_path.join(".git").exists();
        return WorkspaceCodeRepositoryStatus {
            key: repo.key.clone(),
            label: repo.label.clone(),
            full_name: repo.github.full_name.clone(),
            local_path: Some(shell_path(manual_path).display().to_string()),
            mapping_source: "manual".to_owned(),
            exists,
        };
    }

    let short_name = repo
        .github
        .full_name
        .split('/')
        .next_back()
        .unwrap_or(&repo.key);
    if let Some(sibling) = parent_dir
        .map(|parent| parent.join(short_name))
        .filter(|candidate| candidate.join(".git").exists())
    {
        return WorkspaceCodeRepositoryStatus {
            key: repo.key.clone(),
            label: repo.label.clone(),
            full_name: repo.github.full_name.clone(),
            local_path: Some(shell_path(&sibling).display().to_string()),
            mapping_source: "auto_detected".to_owned(),
            exists: true,
        };
    }

    WorkspaceCodeRepositoryStatus {
        key: repo.key.clone(),
        label: repo.label.clone(),
        full_name: repo.github.full_name.clone(),
        local_path: None,
        mapping_source: "unmapped".to_owned(),
        exists: false,
    }
}

fn connected_docs_root(settings: &LocalSettingsService) -> CommandResult<PathBuf> {
    let current = settings.load_current()?.ok_or_else(|| {
        AppError::new(
            ErrorCode::WorkspaceMissing,
            "연결된 문서 워크스페이스가 없습니다.",
        )
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
    })?;
    if current.status != CurrentWorkspaceStatus::Connected {
        return Err(AppError::new(
            ErrorCode::WorkspaceInvalid,
            "현재 문서 워크스페이스를 사용할 수 없습니다.",
        ));
    }
    Ok(current.path)
}

pub(crate) fn list_workspace_code_repositories_inner(
    services: &AppServices,
) -> CommandResult<Vec<WorkspaceCodeRepositoryStatus>> {
    let Some(current) = services.local_settings.load_current()? else {
        return Ok(Vec::new());
    };
    if current.status != CurrentWorkspaceStatus::Connected {
        return Ok(Vec::new());
    }
    resolve_code_repositories_for_workspace(&services.local_settings, &current.path)
}

pub(crate) fn set_code_repository_local_path_inner(
    services: &AppServices,
    full_name: &str,
    local_path: &Path,
) -> CommandResult<WorkspaceCodeRepositoryStatus> {
    let saved = services
        .local_settings
        .set_code_repository_local_path(full_name, local_path)?;
    let trimmed = full_name.trim();
    if let Ok(docs_root) = connected_docs_root(&services.local_settings) {
        if let Some(found) =
            resolve_code_repositories_for_workspace(&services.local_settings, &docs_root)?
                .into_iter()
                .find(|item| item.full_name.eq_ignore_ascii_case(trimmed))
        {
            return Ok(found);
        }
    }
    let short = trimmed.split('/').next_back().unwrap_or(trimmed).to_owned();
    Ok(WorkspaceCodeRepositoryStatus {
        key: short.clone(),
        label: short,
        full_name: trimmed.to_owned(),
        local_path: Some(saved.display().to_string()),
        mapping_source: "manual".to_owned(),
        exists: true,
    })
}

pub(crate) fn clear_code_repository_local_path_inner(
    services: &AppServices,
    full_name: &str,
) -> CommandResult<()> {
    services
        .local_settings
        .clear_code_repository_local_path(full_name)
}

fn sanitize_relative_code_path(raw: &str) -> CommandResult<String> {
    let normalized = raw.trim().replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::new(
            ErrorCode::DocumentPathInvalid,
            "확인할 코드 파일 경로가 비어 있습니다.",
        ));
    }
    let mut clean_parts = Vec::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(part) => {
                let text = part.to_str().ok_or_else(|| {
                    AppError::new(
                        ErrorCode::DocumentPathInvalid,
                        "유효하지 않은 코드 파일 경로입니다.",
                    )
                })?;
                if text.eq_ignore_ascii_case(".git") {
                    return Err(AppError::new(
                        ErrorCode::DocumentPathInvalid,
                        ".git 내부 파일은 읽을 수 없습니다.",
                    ));
                }
                clean_parts.push(text);
            }
            _ => {
                return Err(AppError::new(
                    ErrorCode::DocumentPathInvalid,
                    "코드 저장소 바깥 경로는 읽을 수 없습니다.",
                ));
            }
        }
    }
    if clean_parts.is_empty() {
        return Err(AppError::new(
            ErrorCode::DocumentPathInvalid,
            "유효하지 않은 코드 파일 경로입니다.",
        ));
    }
    Ok(clean_parts.join("/"))
}

pub(crate) fn read_code_repository_file_inner(
    services: &AppServices,
    repository_selector: &str,
    file_path: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> CommandResult<CodeRepositoryFilePreview> {
    let docs_root = connected_docs_root(&services.local_settings)?;
    let selector = repository_selector.trim();
    let repos = resolve_code_repositories_for_workspace(&services.local_settings, &docs_root)?;
    let target_repo = if selector.is_empty() && repos.len() == 1 {
        &repos[0]
    } else {
        repos
            .iter()
            .find(|repo| {
                repo.key.eq_ignore_ascii_case(selector)
                    || repo.full_name.eq_ignore_ascii_case(selector)
                    || repo
                        .full_name
                        .split('/')
                        .next_back()
                        .is_some_and(|short| short.eq_ignore_ascii_case(selector))
            })
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::WorkspaceInvalid,
                    "연결된 코드 저장소에서 요청한 저장소를 찾지 못했습니다.",
                )
            })?
    };

    let Some(local_root_raw) = target_repo.local_path.as_deref() else {
        return Err(AppError::new(
            ErrorCode::WorkspaceMissing,
            "해당 코드 저장소의 로컬 폴더 경로가 아직 연결되지 않았습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory));
    };

    let canonical_root = Path::new(local_root_raw).canonicalize().map_err(|_| {
        AppError::new(
            ErrorCode::WorkspaceMissing,
            "연결된 코드 저장소의 로컬 폴더를 찾을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory)
    })?;

    let clean_rel = sanitize_relative_code_path(file_path)?;
    let candidate = canonical_root.join(&clean_rel);
    let canonical_file = candidate.canonicalize().map_err(|_| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "코드 저장소에서 해당 파일을 찾을 수 없습니다.",
        )
    })?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err(AppError::new(
            ErrorCode::DocumentPathInvalid,
            "코드 저장소 바깥 파일은 읽을 수 없습니다.",
        ));
    }

    let metadata = std::fs::metadata(&canonical_file).map_err(|_| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "코드 파일 정보를 읽을 수 없습니다.",
        )
    })?;
    if !metadata.is_file() {
        return Err(AppError::new(
            ErrorCode::DocumentPathInvalid,
            "디렉터리는 미리보기할 수 없습니다.",
        ));
    }
    if metadata.len() > MAX_CODE_PREVIEW_BYTES {
        return Err(AppError::new(
            ErrorCode::DocumentPathInvalid,
            "256KB를 초과하는 파일은 인앱 미리보기를 지원하지 않습니다.",
        ));
    }

    let bytes = std::fs::read(&canonical_file).map_err(|_| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "코드 파일을 읽을 수 없습니다.",
        )
    })?;
    let text = String::from_utf8(bytes).map_err(|_| {
        AppError::new(
            ErrorCode::DocumentPathInvalid,
            "텍스트(UTF-8) 코드 파일만 미리보기할 수 있습니다.",
        )
    })?;

    let all_lines: Vec<&str> = text.lines().collect();
    let total_lines = all_lines.len();
    if total_lines == 0 {
        return Ok(CodeRepositoryFilePreview {
            repository_key: target_repo.key.clone(),
            repository_full_name: target_repo.full_name.clone(),
            file_path: clean_rel,
            start_line: 1,
            end_line: 1,
            total_lines: 0,
            content: String::new(),
        });
    }

    let start = start_line.unwrap_or(1).clamp(1, total_lines);
    let default_end = start
        .saturating_add(MAX_CODE_PREVIEW_LINES - 1)
        .min(total_lines);
    let end = end_line
        .unwrap_or(default_end)
        .max(start)
        .min(start.saturating_add(MAX_CODE_PREVIEW_LINES - 1))
        .min(total_lines);

    let slice = all_lines[start - 1..end].join("\n");
    Ok(CodeRepositoryFilePreview {
        repository_key: target_repo.key.clone(),
        repository_full_name: target_repo.full_name.clone(),
        file_path: clean_rel,
        start_line: start,
        end_line: end,
        total_lines,
        content: slice,
    })
}

#[tauri::command]
pub fn list_workspace_code_repositories(
    state: State<'_, AppServices>,
) -> CommandResult<Vec<WorkspaceCodeRepositoryStatus>> {
    list_workspace_code_repositories_inner(&state)
}

#[tauri::command]
pub fn set_code_repository_local_path(
    state: State<'_, AppServices>,
    full_name: String,
    local_path: String,
) -> CommandResult<WorkspaceCodeRepositoryStatus> {
    set_code_repository_local_path_inner(&state, &full_name, Path::new(local_path.trim()))
}

#[tauri::command]
pub fn clear_code_repository_local_path(
    state: State<'_, AppServices>,
    full_name: String,
) -> CommandResult<()> {
    clear_code_repository_local_path_inner(&state, &full_name)
}

#[tauri::command]
pub fn read_code_repository_file(
    state: State<'_, AppServices>,
    repository: String,
    file_path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> CommandResult<CodeRepositoryFilePreview> {
    read_code_repository_file_inner(&state, &repository, &file_path, start_line, end_line)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::settings::model::KnowledgeRepository;
    use crate::settings::service::LocalSettingsStore;

    #[derive(Clone, Default)]
    struct TestStore(Arc<Mutex<HashMap<String, String>>>);

    impl LocalSettingsStore for TestStore {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }
        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.0
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn resolves_sibling_auto_detection_manual_override_and_safe_code_preview() {
        let parent = tempfile::tempdir().unwrap();
        let docs_dir = parent.path().join("acme-docs");
        let sibling_code_dir = parent.path().join("acme-app");
        let custom_code_dir = tempfile::tempdir().unwrap();

        std::fs::create_dir_all(docs_dir.join(".okf")).unwrap();
        std::fs::create_dir_all(docs_dir.join("docs")).unwrap();
        std::fs::write(
            docs_dir.join(".okf/workspace.yml"),
            format!(
                "schema_version: 1\nworkspace:\n  id: {}\n  name: Acme\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: app\n    label: Acme App\n    github:\n      id: R_1\n      full_name: Acme-Org/acme-app\n",
                uuid::Uuid::new_v4()
            ),
        )
        .unwrap();

        std::fs::create_dir_all(sibling_code_dir.join(".git")).unwrap();
        std::fs::create_dir_all(sibling_code_dir.join("src")).unwrap();
        std::fs::write(
            sibling_code_dir.join("src/lib.rs"),
            "fn line1() {}\nfn line2() {}\nfn line3() {}\n",
        )
        .unwrap();

        std::fs::create_dir_all(custom_code_dir.path().join(".git")).unwrap();
        std::fs::create_dir_all(custom_code_dir.path().join("src")).unwrap();
        std::fs::write(
            custom_code_dir.path().join("src/lib.rs"),
            "pub fn custom_repo() -> bool { true }\n",
        )
        .unwrap();

        let settings = LocalSettingsService::new(TestStore::default());
        settings
            .set_current_for_repository(
                &docs_dir,
                KnowledgeRepository {
                    id: "R_DOCS".to_owned(),
                    full_name: "Acme-Org/acme-docs".to_owned(),
                },
            )
            .unwrap();
        let services = AppServices::new(settings);

        let initial = list_workspace_code_repositories_inner(&services).unwrap();
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].mapping_source, "auto_detected");
        assert!(initial[0].exists);

        let preview =
            read_code_repository_file_inner(&services, "app", "src/lib.rs", Some(2), Some(3))
                .unwrap();
        assert_eq!(preview.start_line, 2);
        assert_eq!(preview.end_line, 3);
        assert_eq!(preview.total_lines, 3);
        assert_eq!(preview.content, "fn line2() {}\nfn line3() {}");

        let traversal = read_code_repository_file_inner(
            &services,
            "app",
            "../acme-docs/.okf/workspace.yml",
            None,
            None,
        );
        assert!(traversal.is_err());

        let git_secret =
            read_code_repository_file_inner(&services, "app", ".git/config", None, None);
        assert!(git_secret.is_err());

        let overridden = set_code_repository_local_path_inner(
            &services,
            "Acme-Org/acme-app",
            custom_code_dir.path(),
        )
        .unwrap();
        assert_eq!(overridden.mapping_source, "manual");

        let custom_preview = read_code_repository_file_inner(
            &services,
            "Acme-Org/acme-app",
            "src/lib.rs",
            None,
            None,
        )
        .unwrap();
        assert!(custom_preview.content.contains("custom_repo"));

        clear_code_repository_local_path_inner(&services, "Acme-Org/acme-app").unwrap();
        let reverted = list_workspace_code_repositories_inner(&services).unwrap();
        assert_eq!(reverted[0].mapping_source, "auto_detected");
    }
}
