//! Reads the same configured rule files as the desktop app, without creating them.
use super::AutomationRuntime;
use std::io::Read;
use std::path::Path;

const LIMIT: u64 = 200 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSource {
    pub kind: String,
    pub source: String,
    pub truncated: bool,
}

fn read_file(path: &Path, boundary: &Path) -> Result<(String, bool), String> {
    let root = boundary
        .canonicalize()
        .map_err(|_| "규칙 루트 폴더를 읽을 수 없습니다.".to_owned())?;
    let target = path
        .canonicalize()
        .map_err(|_| "규칙 파일 경로를 읽을 수 없습니다.".to_owned())?;
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "규칙 루트 밖 파일은 읽을 수 없습니다.".to_owned())?;
    super::mcp_sources::relative_git_path(relative).map_err(|e| e.message)?;
    let file = std::fs::File::open(target).map_err(|_| "규칙 파일을 열 수 없습니다.".to_owned())?;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "규칙 파일을 읽을 수 없습니다.".to_owned())?;
    let truncated = bytes.len() > LIMIT as usize;
    bytes.truncate(LIMIT as usize);
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

pub(super) fn read_rules(runtime: &AutomationRuntime) -> (String, Vec<RuleSource>, Vec<String>) {
    let mut sources = Vec::new();
    let mut warnings = Vec::new();
    let app_path = runtime.app_data_dir.join("okhub/AGENTS.md");
    let app_exists = match app_path.try_exists() {
        Ok(exists) => exists,
        Err(_) => {
            warnings.push("앱 규칙 파일의 존재 여부를 확인할 수 없습니다.".into());
            false
        }
    };
    let app_rules = if app_exists {
        match read_file(&app_path, &runtime.app_data_dir) {
            Ok((content, truncated)) => {
                sources.push(RuleSource {
                    kind: "app".into(),
                    source: app_path.display().to_string(),
                    truncated,
                });
                if truncated {
                    warnings.push("앱 공통 규칙이 크기 제한으로 잘렸습니다.".into());
                }
                content
            }
            Err(e) => {
                warnings.push(e);
                String::new()
            }
        }
    } else if warnings.is_empty() {
        sources.push(RuleSource {
            kind: "app".into(),
            source: "builtin:settings/agents_md_template.md".into(),
            truncated: false,
        });
        include_str!("../settings/agents_md_template.md").to_owned()
    } else {
        String::new()
    };
    let mut project_rules = None;
    if let Some(workspace) = &runtime.workspace_dir {
        for relative in [".okf/AGENTS.md", "AGENTS.md"] {
            let path = workspace.join(relative);
            match path.try_exists() {
                Ok(true) => {}
                Ok(false) => continue,
                Err(_) => {
                    warnings.push("프로젝트 규칙 파일의 존재 여부를 확인할 수 없습니다.".into());
                    break;
                }
            }
            match read_file(&path, workspace) {
                Ok((content, truncated)) => {
                    sources.push(RuleSource {
                        kind: "project".into(),
                        source: path.display().to_string(),
                        truncated,
                    });
                    if truncated {
                        warnings.push("프로젝트 규칙이 크기 제한으로 잘렸습니다.".into());
                    }
                    project_rules = Some(content);
                }
                Err(e) => warnings.push(e),
            }
            break;
        }
    }
    if let Some((rules, source)) = &runtime.mcp_remote_rules {
        project_rules = Some(rules.clone());
        sources.push(RuleSource {
            kind: "project".into(),
            source: source.clone(),
            truncated: false,
        });
    }
    let fixed = crate::settings::ai_runner::active_context_rules(&runtime.ai_context);
    (
        crate::settings::ai_runner::compose_rules(&app_rules, &fixed, project_rules.as_deref()),
        sources,
        warnings,
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn project_rules_cannot_read_credentials_through_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        std::fs::create_dir_all(workspace.join(".okf")).unwrap();
        std::fs::write(workspace.join(".env"), "credential-content-must-not-leak").unwrap();
        std::os::unix::fs::symlink("../.env", workspace.join(".okf/AGENTS.md")).unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().join("app")),
            workspace_dir: Some(workspace),
            ..Default::default()
        })
        .unwrap();
        let (rules, _, warnings) = read_rules(&runtime);
        assert!(!rules.contains("credential-content-must-not-leak"));
        assert!(!warnings.is_empty());
        assert!(super::super::mcp_write::prepare(
            &runtime,
            "okhub_board_manage",
            &serde_json::json!({"action":"create","requestId":"blocked","title":"A"})
        )
        .await
        .is_err());
    }
}
