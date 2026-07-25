pub mod auth;
pub mod commands;
pub mod error;
pub mod github;
pub mod repository;
pub mod settings;
pub mod state;
pub mod workspace;

pub const APP_TITLE: &str = "OkHub";

fn github_client_id() -> String {
    let runtime = std::env::var("OKHUB_GITHUB_CLIENT_ID").ok();
    select_github_client_id(runtime.as_deref(), option_env!("OKHUB_GITHUB_CLIENT_ID"))
}

fn select_github_client_id(runtime: Option<&str>, compiled: Option<&str>) -> String {
    runtime
        .and_then(non_empty_trimmed)
        .or_else(|| compiled.and_then(non_empty_trimmed))
        .unwrap_or_default()
        .to_owned()
}

fn non_empty_trimmed(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;

            let store = tauri_plugin_store::StoreBuilder::new(
                app,
                settings::store_adapter::SETTINGS_FILE_NAME,
            )
            .disable_auto_save()
            .build()?;
            let local_settings = settings::service::LocalSettingsService::new(
                settings::store_adapter::TauriLocalSettingsStore::new(store),
            );
            let credentials = auth::keyring_store::KeyringCredentialStore::new()
                .map_err(|_| std::io::Error::other("failed to initialize credential storage"))?;
            let auth_jobs = state::JobRegistry::default();
            let auth = auth::service::AuthService::new(
                github_client_id(),
                auth::reqwest_api::ReqwestDeviceFlowApi::new(),
                credentials,
                auth::ports::SystemClock,
                auth::ports::TokioDelay,
                commands::auth::LifecycleAuthEventSink::new(
                    commands::auth::TauriAuthEventSink::new(app.handle().clone()),
                    auth_jobs.clone(),
                ),
            );
            app.manage(state::AppServices::with_auth_jobs(
                local_settings,
                auth,
                auth_jobs,
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::get_auth_state,
            commands::auth::begin_github_auth,
            commands::auth::cancel_github_auth,
            commands::auth::logout_github,
            commands::workspace::list_github_repositories,
            commands::workspace::inspect_existing_clone,
            commands::workspace::clone_repository,
            commands::workspace::cancel_repository_clone,
            commands::workspace::inspect_workspace,
            commands::workspace::connect_workspace,
            commands::workspace::preview_workspace_initialization,
            commands::workspace::initialize_workspace,
            commands::workspace::get_current_workspace,
            settings::commands::get_display_density,
            settings::commands::set_display_density,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OkHub");
}

#[cfg(test)]
mod tests {
    use super::{select_github_client_id, APP_TITLE};

    #[test]
    fn application_title_matches_product_name() {
        assert_eq!(APP_TITLE, "OkHub");
    }

    #[test]
    fn runtime_client_id_overrides_the_compiled_public_client_id() {
        assert_eq!(
            select_github_client_id(Some(" runtime-id "), Some("compiled-id")),
            "runtime-id"
        );
        assert_eq!(
            select_github_client_id(None, Some(" compiled-id ")),
            "compiled-id"
        );
        assert_eq!(select_github_client_id(Some("  "), None), "");
    }
}
