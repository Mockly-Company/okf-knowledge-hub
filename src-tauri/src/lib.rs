pub const APP_TITLE: &str = "OkHub";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
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
