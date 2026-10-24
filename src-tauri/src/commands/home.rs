use crate::{
    error::{AppError, CommandResult, ErrorCode},
    home::{self, Preferences, Snapshot},
    state::AppServices,
    workspace::model::WorkspaceDocument,
};
use sha2::{Digest, Sha256};
use tauri::State;
struct Context {
    scope: String,
    repositories: Vec<String>,
    project_id: Option<String>,
    login: String,
}
async fn context(services: &AppServices) -> Result<Context, AppError> {
    let github = services.github.as_ref().ok_or_else(home::unavailable)?;
    let user = github.current_user().await?;
    let workspace = services
        .local_settings
        .load_connected_document_workspace()?;
    let path = workspace
        .repository_root
        .join(".okf/workspace.yml")
        .canonicalize()
        .map_err(|_| home::unavailable())?;
    if !path.starts_with(&workspace.repository_root)
        || std::fs::metadata(&path)
            .map_err(|_| home::unavailable())?
            .len()
            > 2 * 1024 * 1024
    {
        return Err(home::unavailable());
    }
    let yaml = std::fs::read_to_string(path).map_err(|_| home::unavailable())?;
    let config = WorkspaceDocument::parse(&yaml)?.config;
    if config.workspace.id != workspace.workspace_id {
        return Err(home::unavailable());
    }
    let mut repositories = vec![workspace.repository_full_name];
    repositories.extend(config.repositories.into_iter().map(|r| r.github.full_name));
    repositories.sort();
    repositories.dedup();
    if repositories.len() > 50 || repositories.iter().any(|r| !home::valid_repository(r)) {
        return Err(home::unavailable());
    }
    let scope = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}:{}:{}:{}",
                user.id,
                workspace.workspace_id,
                workspace.repository_root.display(),
                yaml
            )
            .as_bytes()
        )
    );
    Ok(Context {
        scope,
        repositories,
        project_id: config.github.and_then(|g| g.project).map(|p| p.id),
        login: user.login,
    })
}
#[tauri::command]
pub async fn load_home(services: State<'_, AppServices>) -> CommandResult<Snapshot> {
    let _lease = services.authenticated_commands.read().await;
    let ctx = context(&services).await?;
    let prefs = services.local_settings.load_home_preferences(&ctx.scope)?;
    let project_id = prefs
        .as_ref()
        .map(|p| p.project_id.clone())
        .or(ctx.project_id);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| home::unavailable())?
        .as_millis() as u64;
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        home::load(
            services
                .github
                .as_ref()
                .ok_or_else(home::unavailable)?
                .as_ref(),
            ctx.scope,
            &ctx.login,
            &ctx.repositories,
            project_id.as_deref(),
            prefs,
            now,
        ),
    )
    .await
    .map_err(|_| home::unavailable())
}
#[tauri::command]
pub async fn configure_home(
    services: State<'_, AppServices>,
    scope_key: String,
    preferences: Preferences,
) -> CommandResult<()> {
    let _lease = services.authenticated_commands.read().await;
    let ctx = context(&services).await?;
    if scope_key != ctx.scope {
        return Err(AppError::new(
            ErrorCode::WorkspaceChangedSincePreview,
            "계정 또는 워크스페이스가 변경되었습니다. 홈을 다시 불러와 주세요.",
        ));
    }
    if ctx.project_id.as_deref() != Some(preferences.project_id.as_str()) {
        return Err(home::unavailable());
    }
    let project = home::project(
        services
            .github
            .as_ref()
            .ok_or_else(home::unavailable)?
            .as_ref(),
        &preferences.project_id,
    )
    .await?;
    home::validate_preferences(&project, &preferences)?;
    services
        .local_settings
        .save_home_preferences(&ctx.scope, &preferences)
}

#[tauri::command]
pub async fn open_home_github_url(app: tauri::AppHandle, url: String) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    if !home::valid_resource_url(&url) {
        return Err(home::unavailable());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| home::unavailable())
}
