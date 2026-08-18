use serde::Serialize;

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub mode: &'static str,
    pub branch: &'static str,
    pub commit: &'static str,
    pub dirty: bool,
    pub credential_backend: &'static str,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    build_info(cfg!(debug_assertions), std::env::consts::OS)
}

fn build_info(debug_build: bool, target_os: &str) -> BuildInfo {
    BuildInfo {
        mode: if debug_build {
            "development"
        } else {
            "release"
        },
        branch: env!("OKHUB_BUILD_BRANCH"),
        commit: env!("OKHUB_BUILD_COMMIT"),
        dirty: env!("OKHUB_BUILD_DIRTY") == "true",
        credential_backend: credential_backend_label(target_os, debug_build),
    }
}

fn credential_backend_label(target_os: &str, debug_build: bool) -> &'static str {
    match (target_os, debug_build) {
        ("macos", true) => "file-keychain",
        ("macos", false) => "data-protection-keychain",
        ("windows", _) => "credential-manager",
        _ => "unsupported",
    }
}

pub(crate) fn window_title() -> String {
    if cfg!(debug_assertions) {
        let info = get_build_info();
        let dirty = if info.dirty { "*" } else { "" };
        format!("OkHub Dev · {}@{}{}", info.branch, info.commit, dirty)
    } else {
        "OkHub".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::build_info;

    #[test]
    fn debug_build_exposes_safe_provenance_and_file_keychain() {
        let info = build_info(true, "macos");
        assert_eq!(info.mode, "development");
        assert!(!info.branch.is_empty());
        assert!(!info.commit.is_empty());
        assert_eq!(info.credential_backend, "file-keychain");
    }

    #[test]
    fn release_build_reports_the_distribution_credential_backend() {
        let info = build_info(false, "macos");
        assert_eq!(info.mode, "release");
        assert_eq!(info.credential_backend, "data-protection-keychain");
        assert_eq!(
            build_info(true, "windows").credential_backend,
            "credential-manager"
        );
    }
}
