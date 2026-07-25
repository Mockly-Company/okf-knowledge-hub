pub mod error;
pub mod settings;
pub mod state;
pub mod workspace;

pub const APP_TITLE: &str = "OkHub";

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
            app.manage(state::AppServices::new(local_settings));
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
    use super::APP_TITLE;

    #[test]
    fn application_title_matches_product_name() {
        assert_eq!(APP_TITLE, "OkHub");
    }
}
