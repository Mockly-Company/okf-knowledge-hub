use std::path::Path;

use tauri::State;

use crate::error::{AppError, CommandResult, ErrorCode, RecoveryAction};
use crate::settings::model::DisplayDensity;
use crate::state::AppServices;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct WorkspaceForProject {
    pub path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedWorkspaceItem {
    pub project_id: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct RememberedWorkspaceList {
    pub items: Vec<RememberedWorkspaceItem>,
}

#[tauri::command]
pub fn get_display_density(state: State<'_, AppServices>) -> CommandResult<DisplayDensity> {
    get_display_density_inner(&state)
}

#[tauri::command]
pub fn set_display_density(
    state: State<'_, AppServices>,
    density: DisplayDensity,
) -> CommandResult<()> {
    set_display_density_inner(&state, density)
}

fn get_display_density_inner(services: &AppServices) -> CommandResult<DisplayDensity> {
    services.local_settings.load_display_density()
}

fn set_display_density_inner(services: &AppServices, density: DisplayDensity) -> CommandResult<()> {
    services.local_settings.set_display_density(density)
}

#[tauri::command]
pub fn get_workspace_for_project(
    state: State<'_, AppServices>,
    project_id: String,
) -> CommandResult<WorkspaceForProject> {
    if project_id.trim().is_empty() {
        return Ok(WorkspaceForProject { path: None });
    }
    let path = state
        .local_settings
        .get_workspace_for_project(project_id.trim())?
        .and_then(|path| path.to_str().map(str::to_owned));
    Ok(WorkspaceForProject { path })
}

#[tauri::command]
pub fn set_workspace_for_project(
    state: State<'_, AppServices>,
    project_id: String,
    path: String,
) -> CommandResult<()> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "프로젝트를 지정해 주세요.",
        )
        .with_recovery(RecoveryAction::Retry));
    }
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "선택한 폴더가 존재하지 않습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory));
    }
    // 디렉터리 존재 여부까지만 검사한다. workspace.yml 유무는 검사하지 않는다.
    let candidate = Path::new(path);
    if !candidate.is_dir() && candidate.canonicalize().is_err() {
        return Err(AppError::new(
            ErrorCode::LocalSettingsUnavailable,
            "선택한 폴더가 존재하지 않습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory)
        .with_detail("path", path.to_owned()));
    }
    state
        .local_settings
        .set_workspace_for_project(project_id, candidate)?;
    Ok(())
}

#[tauri::command]
pub fn list_remembered_workspaces(
    state: State<'_, AppServices>,
) -> CommandResult<RememberedWorkspaceList> {
    let mut items: Vec<RememberedWorkspaceItem> = state
        .local_settings
        .list_remembered_workspaces()?
        .into_iter()
        .map(|(project_id, path)| RememberedWorkspaceItem {
            project_id,
            path: path.display().to_string(),
        })
        .collect();
    items.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    Ok(RememberedWorkspaceList { items })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::error::AppError;
    use crate::settings::model::DisplayDensity;
    use crate::settings::service::{
        LocalSettingsService, LocalSettingsStore, CURRENT_WORKSPACE_PATH_KEY,
    };
    use crate::state::AppServices;

    #[derive(Clone, Default)]
    struct MemoryStore(Arc<Mutex<HashMap<String, String>>>);

    impl MemoryStore {
        fn with_workspace(path: &str) -> Self {
            Self(Arc::new(Mutex::new(HashMap::from([(
                CURRENT_WORKSPACE_PATH_KEY.into(),
                path.into(),
            )]))))
        }

        fn value(&self, key: &str) -> Option<String> {
            self.0.lock().unwrap().get(key).cloned()
        }
    }

    impl LocalSettingsStore for MemoryStore {
        fn read(&self, key: &str) -> Result<Option<String>, AppError> {
            Ok(self.value(key))
        }

        fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[test]
    fn density_commands_round_trip_through_the_managed_settings_service() {
        let store = MemoryStore::with_workspace("/workspace/current");
        let services = AppServices::new(LocalSettingsService::new(store.clone()));

        set_display_density_inner(&services, DisplayDensity::Compact).unwrap();

        assert_eq!(
            get_display_density_inner(&services).unwrap(),
            DisplayDensity::Compact
        );
        assert_eq!(
            store.value(CURRENT_WORKSPACE_PATH_KEY).as_deref(),
            Some("/workspace/current")
        );
    }
}
