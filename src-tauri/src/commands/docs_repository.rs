//! 프로젝트별 문서 저장소를 앱 데이터 폴더에 연결하고 전환한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::repository::managed::managed_clone_dir;
use crate::settings::model::{DocsRepository, KnowledgeRepository};
use crate::state::AppServices;
use crate::workspace::service::{WorkspaceInspection, WorkspaceService};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDocsRepository {
    /// clone 명령에 넘길 부모 폴더. 화면에 보여 주지 않는다.
    pub parent_directory: PathBuf,
    pub already_cloned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDocsRepository {
    pub full_name: String,
    pub okf: bool,
}

pub(crate) fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path().app_data_dir().map_err(|_| {
        AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "로컬 설정을 읽을 수 없습니다.",
        )
        .with_recovery(RecoveryAction::Retry)
    })
}

/// 앱 폴더의 clone 위치를 알려 준다. 같은 원격을 가리키는 clone이 있으면 다시 받지 않는다.
#[tauri::command]
pub fn prepare_docs_repository(
    app: AppHandle,
    full_name: String,
) -> CommandResult<PreparedDocsRepository> {
    prepare_docs_repository_inner(&app_data_dir(&app)?, &full_name)
}

pub(crate) fn prepare_docs_repository_inner(
    app_data: &Path,
    full_name: &str,
) -> CommandResult<PreparedDocsRepository> {
    let target = managed_clone_dir(app_data, full_name)?;
    let parent_directory = target
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| app_data.to_path_buf());
    Ok(PreparedDocsRepository {
        parent_directory,
        already_cloned: clone_matches(&target, full_name),
    })
}

/// `origin`이 같은 GitHub 저장소를 가리키는 clone인지 확인한다.
pub(crate) fn clone_matches(directory: &Path, full_name: &str) -> bool {
    let Ok(repository) = git2::Repository::open(directory) else {
        return false;
    };
    let Ok(origin) = repository.find_remote("origin") else {
        return false;
    };
    origin.url().is_some_and(|url| {
        let normalized = url.trim_end_matches('/').trim_end_matches(".git");
        normalized.eq_ignore_ascii_case(&format!("https://github.com/{full_name}"))
    })
}

/// clone이 끝난 저장소를 프로젝트의 문서 저장소로 기억한다. 활성 프로젝트면 바로 전환한다.
#[tauri::command]
pub fn connect_project_docs_repository(
    app: AppHandle,
    state: State<'_, AppServices>,
    project_id: String,
    repository_id: String,
    full_name: String,
) -> CommandResult<ConnectedDocsRepository> {
    connect_project_docs_repository_inner(
        &state,
        &app_data_dir(&app)?,
        &project_id,
        &repository_id,
        &full_name,
    )
}

pub(crate) fn connect_project_docs_repository_inner(
    services: &AppServices,
    app_data: &Path,
    project_id: &str,
    repository_id: &str,
    full_name: &str,
) -> CommandResult<ConnectedDocsRepository> {
    let directory = managed_clone_dir(app_data, full_name)?;
    if !clone_matches(&directory, full_name) {
        return Err(AppError::new(
            ErrorCode::CloneFailed,
            "문서 저장소를 아직 받지 못했습니다. 다시 시도해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    let settings = &services.local_settings;
    settings.set_docs_repository(
        project_id,
        DocsRepository {
            repository_id: repository_id.to_owned(),
            full_name: full_name.to_owned(),
        },
    )?;
    let okf = matches!(
        WorkspaceService::inspect(&directory),
        Ok(WorkspaceInspection::Ready { .. })
    );
    let is_active = settings
        .load_active_project()?
        .is_some_and(|project| project.id == project_id);
    if is_active {
        settings.set_current_for_repository(
            &directory,
            KnowledgeRepository {
                id: repository_id.to_owned(),
                full_name: full_name.to_owned(),
            },
        )?;
    }
    Ok(ConnectedDocsRepository {
        full_name: full_name.to_owned(),
        okf,
    })
}

/// 활성 프로젝트의 문서 저장소로 현재 워크스페이스를 맞춘다. clone이 없으면 연결을 끊는다.
pub(crate) fn switch_current_to_project(
    services: &AppServices,
    app_data: &Path,
    project_id: &str,
) -> CommandResult<Option<DocsRepository>> {
    let settings = &services.local_settings;
    let Some(repository) = settings.docs_repository_for(project_id)? else {
        settings.clear_current()?;
        return Ok(None);
    };
    let directory = managed_clone_dir(app_data, &repository.full_name)?;
    if !clone_matches(&directory, &repository.full_name) {
        settings.clear_current()?;
        return Ok(None);
    }
    settings.set_current_for_repository(
        &directory,
        KnowledgeRepository {
            id: repository.repository_id.clone(),
            full_name: repository.full_name.clone(),
        },
    )?;
    Ok(Some(repository))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use crate::error::AppError;
    use crate::project_board::ProjectOwnerScope;
    use crate::repository::managed::managed_clone_dir;
    use crate::settings::model::LinkedProject;
    use crate::settings::service::{LocalSettingsService, LocalSettingsStore};
    use crate::state::AppServices;

    use super::{connect_project_docs_repository_inner, prepare_docs_repository_inner};
    use crate::commands::project_board::set_active_project_inner;

    #[derive(Clone, Default)]
    struct MemoryStore(Arc<Mutex<HashMap<String, String>>>);

    impl LocalSettingsStore for MemoryStore {
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

    fn services_with_projects(ids: &[&str]) -> AppServices {
        let settings = LocalSettingsService::new(MemoryStore::default());
        for (index, id) in ids.iter().enumerate() {
            settings
                .link_project(LinkedProject {
                    id: (*id).to_owned(),
                    owner: "Mockly-Company".to_owned(),
                    number: index as u64 + 1,
                    title: format!("보드 {id}"),
                    scope: ProjectOwnerScope::Organization,
                })
                .unwrap();
        }
        AppServices::new(settings)
    }

    /// 앱 폴더에 clone이 끝난 것처럼 git 저장소를 만든다.
    fn fake_clone(app_data: &Path, full_name: &str) {
        let directory = managed_clone_dir(app_data, full_name).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        let repository = git2::Repository::init(&directory).unwrap();
        repository
            .remote("origin", &format!("https://github.com/{full_name}.git"))
            .unwrap();
        std::fs::write(directory.join("README.md"), "# 문서\n").unwrap();
    }

    #[test]
    fn connect_saves_mapping_for_the_given_project_not_the_active_one() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        fake_clone(app_data.path(), "o/b-docs");

        let connected = connect_project_docs_repository_inner(
            &services,
            app_data.path(),
            "b",
            "R_b",
            "o/b-docs",
        )
        .unwrap();

        assert_eq!(connected.full_name, "o/b-docs");
        assert!(!connected.okf);
        let settings = &services.local_settings;
        assert!(settings.docs_repository_for("b").unwrap().is_some());
        assert_eq!(settings.docs_repository_for("a").unwrap(), None);
        assert_eq!(settings.load_current().unwrap(), None);
    }

    #[test]
    fn connecting_the_active_project_switches_the_current_workspace() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a"]);
        fake_clone(app_data.path(), "o/a-docs");

        connect_project_docs_repository_inner(&services, app_data.path(), "a", "R_a", "o/a-docs")
            .unwrap();

        let current = services.local_settings.load_current().unwrap().unwrap();
        assert_eq!(
            current.path,
            managed_clone_dir(app_data.path(), "o/a-docs")
                .unwrap()
                .canonicalize()
                .unwrap()
        );
    }

    #[test]
    fn activating_a_project_switches_the_current_workspace() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        for (id, name) in [("a", "o/a-docs"), ("b", "o/b-docs")] {
            fake_clone(app_data.path(), name);
            connect_project_docs_repository_inner(&services, app_data.path(), id, "R", name)
                .unwrap();
        }

        let result = set_active_project_inner(&services, app_data.path(), "b").unwrap();

        assert_eq!(result.docs_repository.unwrap().full_name, "o/b-docs");
        let current = services.local_settings.load_current().unwrap().unwrap();
        assert!(current.path.ends_with("b-docs"));
    }

    #[test]
    fn activating_a_project_whose_clone_is_gone_reports_missing_docs() {
        let app_data = tempfile::tempdir().unwrap();
        let services = services_with_projects(&["a", "b"]);
        fake_clone(app_data.path(), "o/b-docs");
        connect_project_docs_repository_inner(&services, app_data.path(), "b", "R_b", "o/b-docs")
            .unwrap();
        std::fs::remove_dir_all(managed_clone_dir(app_data.path(), "o/b-docs").unwrap()).unwrap();

        let result = set_active_project_inner(&services, app_data.path(), "b").unwrap();

        assert_eq!(result.docs_repository, None);
        assert_eq!(services.local_settings.load_current().unwrap(), None);
    }

    #[test]
    fn prepare_reports_an_existing_clone_only_for_the_same_remote() {
        let app_data = tempfile::tempdir().unwrap();
        fake_clone(app_data.path(), "o/docs");

        let same = prepare_docs_repository_inner(app_data.path(), "o/docs").unwrap();
        assert!(same.already_cloned);
        assert_eq!(
            same.parent_directory,
            managed_clone_dir(app_data.path(), "o/docs")
                .unwrap()
                .parent()
                .unwrap()
        );

        let other = managed_clone_dir(app_data.path(), "o/other").unwrap();
        std::fs::create_dir_all(&other).unwrap();
        git2::Repository::init(&other)
            .unwrap()
            .remote("origin", "https://github.com/someone/else.git")
            .unwrap();
        assert!(
            !prepare_docs_repository_inner(app_data.path(), "o/other")
                .unwrap()
                .already_cloned
        );
        assert!(
            !prepare_docs_repository_inner(app_data.path(), "o/missing")
                .unwrap()
                .already_cloned
        );
    }
}
