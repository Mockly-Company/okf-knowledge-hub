pub mod auth;
pub mod error;
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
            let auth = auth::service::AuthService::new(
                github_client_id(),
                auth::reqwest_api::ReqwestDeviceFlowApi::new(),
                credentials,
                auth::ports::SystemClock,
                auth::ports::TokioDelay,
                auth::ports::NoopAuthEvents,
            );
            app.manage(state::AppServices::with_auth(local_settings, auth));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
