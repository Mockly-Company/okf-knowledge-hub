use crate::error::{AppError, CommandResult, ErrorCode};
use crate::state::AppServices;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

fn invalid_url() -> AppError {
    AppError::new(
        ErrorCode::GithubUnavailable,
        "허용된 GitHub 링크를 열 수 없습니다.",
    )
}

fn validate_pull_request_url(url: &str, repository_full_name: &str) -> CommandResult<()> {
    let Some((owner, name)) = repository_full_name.split_once('/') else {
        return Err(invalid_url());
    };
    if owner.is_empty()
        || name.is_empty()
        || name == "."
        || name == ".."
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(invalid_url());
    }
    let prefix = format!("https://github.com/{repository_full_name}/pull/");
    let Some(number) = url.strip_prefix(&prefix) else {
        return Err(invalid_url());
    };
    if number.is_empty()
        || !number.bytes().all(|b| b.is_ascii_digit())
        || !matches!(number.parse::<u64>(), Ok(n) if n > 0)
    {
        return Err(invalid_url());
    }
    Ok(())
}

#[tauri::command]
pub async fn open_github_pull_request(
    app: AppHandle,
    state: State<'_, AppServices>,
    url: String,
    repository_full_name: String,
) -> CommandResult<()> {
    let _access = state.acquire_authenticated_command().await?;
    validate_pull_request_url(&url, &repository_full_name)?;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|_| invalid_url())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unapproved_pull_request_targets() {
        let repository = "Mockly-Company/mockly-knowledge";
        for url in [
            "http://github.com/Mockly-Company/mockly-knowledge/pull/1",
            "https://evil.test/Mockly-Company/mockly-knowledge/pull/1",
            "https://github.com/other/repo/pull/1",
            "https://github.com/Mockly-Company/mockly-knowledge/pull/0",
            "https://github.com/Mockly-Company/mockly-knowledge/pull/1?redirect=evil",
            "https://user@github.com/Mockly-Company/mockly-knowledge/pull/1",
            "https://github.com/Mockly-Company/mockly-knowledge/pull/1#fragment",
            "https://github.com/Mockly-Company/mockly-knowledge/pull/%31",
        ] {
            assert!(validate_pull_request_url(url, repository).is_err(), "{url}");
        }
        assert!(validate_pull_request_url(
            "https://github.com/Mockly-Company/mockly-knowledge/pull/12",
            repository
        )
        .is_ok());
        assert!(
            validate_pull_request_url("https://github.com/owner/../pull/1", "owner/..").is_err()
        );
    }
}
