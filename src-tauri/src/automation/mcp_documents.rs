//! Repository-qualified document scopes shared by MCP list/search/direct reads.
use super::{mcp_sources, AutomationRuntime};
use crate::{
    error::AppError,
    workspace::model::{DocumentRepository, DocumentRoot, GithubRepositoryRef},
};
use std::path::PathBuf;

impl AutomationRuntime {
    pub(super) fn document_scopes(&self) -> Result<Vec<DocumentRepository>, AppError> {
        if let Some(scopes) = &self.mcp_document_scopes {
            return Ok(scopes.clone());
        }
        let name = self
            .ai_context
            .docs_repository_full_name
            .clone()
            .unwrap_or_else(|| "local/workspace".into());
        let source = GithubRepositoryRef {
            id: format!("source:{name}"),
            full_name: name,
            extra: Default::default(),
        };
        if let Some(config) = super::mcp_workspace::read_config(self.workspace_dir.as_deref())? {
            if !crate::workspace::validation::validate_workspace(&config).is_empty() {
                return Err(super::mcp_sdk::error("문서 범위 설정이 잘못되었습니다."));
            }
            let scopes = config.documents.resolved_repositories(&source);
            validate_scopes(&scopes)?;
            return Ok(scopes);
        }
        Ok(vec![DocumentRepository {
            repository: source,
            roots: self
                .document_roots()?
                .into_iter()
                .map(|path| DocumentRoot {
                    path,
                    exclude: vec![],
                    extra: Default::default(),
                })
                .collect(),
            extra: Default::default(),
        }])
    }

    pub(super) fn document_scope(
        &self,
        requested: Option<&str>,
    ) -> Result<DocumentRepository, AppError> {
        let scopes = self.document_scopes()?;
        match requested {
            Some(repo) => scopes
                .into_iter()
                .find(|scope| scope.repository.full_name.eq_ignore_ascii_case(repo))
                .ok_or_else(|| {
                    super::mcp_sdk::error("워크스페이스에 설정된 문서 저장소가 아닙니다.")
                }),
            None if scopes.len() == 1 => Ok(scopes.into_iter().next().unwrap()),
            None => Err(super::mcp_sdk::error(
                "여러 문서 저장소가 있습니다. 목록에서 반환한 repository를 함께 지정하세요.",
            )),
        }
    }

    pub(super) fn local_document_root(
        &self,
        scope: &DocumentRepository,
    ) -> Result<PathBuf, AppError> {
        if self
            .ai_context
            .docs_repository_full_name
            .as_ref()
            .is_none_or(|name| name.eq_ignore_ascii_case(&scope.repository.full_name))
        {
            return Ok(self.require_workspace_dir()?.to_path_buf());
        }
        let settings = crate::settings::service::LocalSettingsService::new(
            super::JsonFileSettingsStore::new(self.app_data_dir.join(super::SETTINGS_FILE_NAME)),
        );
        let path = match settings.code_repository_local_path(&scope.repository.full_name)? {
            Some(path) => path,
            None => crate::repository::managed::managed_clone_dir(
                &self.app_data_dir,
                &scope.repository.full_name,
            )?,
        };
        let repository=git2::Repository::open(&path).map_err(|_|super::mcp_sdk::error("문서 저장소의 로컬 복제본이 없습니다. 확정본 조회를 사용하거나 저장소를 연결하세요.").with_detail("repository",&scope.repository.full_name))?;
        let path = path
            .canonicalize()
            .map_err(|e| super::mcp_sdk::error(e.to_string()))?;
        if repository
            .workdir()
            .and_then(|root| root.canonicalize().ok())
            .as_ref()
            != Some(&path)
        {
            return Err(super::mcp_sdk::error(
                "문서 복제본의 Git 루트가 등록 경로와 다릅니다.",
            ));
        }
        let origin = repository
            .find_remote("origin")
            .map_err(|_| super::mcp_sdk::error("문서 복제본의 origin이 없습니다."))?;
        let origin_url = origin.url().unwrap_or_default();
        let origin_path = origin_url
            .strip_prefix("https://github.com/")
            .or_else(|| origin_url.strip_prefix("git@github.com:"))
            .or_else(|| origin_url.strip_prefix("ssh://git@github.com/"));
        if !origin_path.is_some_and(|name| {
            let name = name.strip_suffix('/').unwrap_or(name);
            name.strip_suffix(".git")
                .unwrap_or(name)
                .eq_ignore_ascii_case(&scope.repository.full_name)
        }) {
            return Err(super::mcp_sdk::error(
                "문서 복제본의 origin이 설정과 다릅니다.",
            ));
        }
        Ok(path)
    }
}

pub(super) fn validate_scopes(scopes: &[DocumentRepository]) -> Result<(), AppError> {
    let mut names = std::collections::HashSet::new();
    for scope in scopes {
        crate::repository::managed::managed_clone_dir(
            std::path::Path::new("."),
            &scope.repository.full_name,
        )?;
        if !names.insert(scope.repository.full_name.to_ascii_lowercase()) {
            return Err(super::mcp_sdk::error("문서 저장소가 중복되었습니다."));
        }
        for root in &scope.roots {
            if root.path != "." {
                mcp_sources::safe_path(root.path.trim_end_matches('/'))?;
            }
        }
    }
    Ok(())
}

pub(super) fn local_relative(
    scope: &DocumentRepository,
    root: &std::path::Path,
    path: &str,
) -> Result<String, AppError> {
    mcp_sources::safe_path(path)?;
    if !scope.includes_path(path) {
        return Err(super::mcp_sdk::error(
            "문서 조회 범위에서 제외된 경로입니다.",
        ));
    }
    let root = root
        .canonicalize()
        .map_err(|e| super::mcp_sdk::error(e.to_string()))?;
    let file = root
        .join(path)
        .canonicalize()
        .map_err(|e| super::mcp_sdk::error(e.to_string()))?;
    let relative = file
        .strip_prefix(&root)
        .map_err(|_| super::mcp_sdk::error("문서 저장소 밖 경로입니다."))?;
    let relative = mcp_sources::relative_git_path(relative)?;
    mcp_sources::safe_path(&relative)?;
    if !scope.includes_path(&relative) {
        return Err(
            super::mcp_sdk::error("제외 폴더를 가리키는 문서 별칭은 읽을 수 없습니다.")
                .with_detail("reason", "excluded_document_alias"),
        );
    }
    Ok(relative)
}

pub(super) async fn verify_identity(
    github: &crate::github::GithubService,
    scope: &DocumentRepository,
) -> Result<(), AppError> {
    if scope.repository.id.starts_with("source:") {
        return Ok(());
    }
    let parts: Vec<_> = scope.repository.full_name.split('/').collect();
    let detail = github
        .automation_get(&["repos", parts[0], parts[1]], &[])
        .await?;
    if detail["node_id"].as_str() != Some(scope.repository.id.as_str())
        && detail["id"].as_u64().map(|id| id.to_string()).as_deref()
            != Some(scope.repository.id.as_str())
    {
        return Err(
            super::mcp_sdk::error("문서 저장소의 GitHub ID가 설정과 다릅니다.")
                .with_detail("repository", &scope.repository.full_name),
        );
    }
    Ok(())
}

pub(super) async fn snapshot(
    github: &crate::github::GithubService,
    scope: &DocumentRepository,
    pinned: Option<&str>,
) -> Result<(String, String), AppError> {
    let repo = &scope.repository.full_name;
    let parts: Vec<_> = repo.split('/').collect();
    let detail = github
        .automation_get(&["repos", parts[0], parts[1]], &[])
        .await?;
    if !scope.repository.id.starts_with("source:")
        && detail["node_id"].as_str() != Some(scope.repository.id.as_str())
        && detail["id"].as_u64().map(|id| id.to_string()).as_deref()
            != Some(scope.repository.id.as_str())
    {
        return Err(
            super::mcp_sdk::error("문서 저장소의 GitHub ID가 설정과 다릅니다.")
                .with_detail("repository", repo),
        );
    }
    let branch = detail["default_branch"]
        .as_str()
        .ok_or_else(|| super::mcp_sdk::error("문서 저장소 기본 브랜치가 없습니다."))?;
    let head = github
        .automation_get(&["repos", parts[0], parts[1], "commits", branch], &[])
        .await?;
    let current = head["sha"]
        .as_str()
        .ok_or_else(|| super::mcp_sdk::error("문서 저장소 기준 커밋이 없습니다."))?;
    mcp_sources::require_sha(current)?;
    let selected = pinned.unwrap_or(current);
    mcp_sources::require_sha(selected)?;
    if selected != current {
        let comparison = github
            .automation_get(
                &[
                    "repos",
                    parts[0],
                    parts[1],
                    "compare",
                    &format!("{selected}...{current}"),
                ],
                &[],
            )
            .await?;
        if !matches!(comparison["status"].as_str(), Some("ahead" | "identical")) {
            return Err(super::mcp_sdk::error(
                "목록 커밋이 문서 저장소 기본 브랜치의 확정 이력이 아닙니다.",
            ));
        }
    }
    Ok((current.into(), selected.into()))
}
