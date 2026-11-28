//! Request-scoped workspace selection. Never mutates the desktop selection.
use super::{AutomationProjectSummary, AutomationRuntime};
use crate::error::AppError;
use crate::settings::model::DocsRepository;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Internal read adapter; this does not add a tool or change the launch target.
pub async fn inspect_shared_workspace_definition(
    github: &crate::github::GithubService,
    source: &crate::workspace::shared::WorkspaceSourceRef,
    commit: Option<&str>,
) -> Result<crate::workspace::shared::SharedWorkspaceLookup, AppError> {
    crate::workspace::shared_read::read_shared_workspace(github, source, commit).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct McpWorkspaceSummary {
    pub id: String,
    pub title: String,
    pub docs_repository: Option<DocsRepository>,
    pub projects: Vec<AutomationProjectSummary>,
    pub default_project_id: Option<String>,
    pub local_path: Option<PathBuf>,
    pub local_available: bool,
}

pub(super) struct ResolvedMcpTarget {
    pub workspace: McpWorkspaceSummary,
    pub project: Option<AutomationProjectSummary>,
    pub fingerprint: String,
}

pub(super) struct McpWorkspaceCatalog<'a> {
    runtime: &'a AutomationRuntime,
}

impl<'a> McpWorkspaceCatalog<'a> {
    pub fn new(runtime: &'a AutomationRuntime) -> Self {
        Self { runtime }
    }
    pub fn list(&self) -> Result<Vec<McpWorkspaceSummary>, AppError> {
        use crate::settings::service::LocalSettingsService;
        let settings = LocalSettingsService::new(super::JsonFileSettingsStore::new(
            self.runtime.app_data_dir.join("settings.json"),
        ));
        let registered = settings.load_hub_workspaces()?;
        let mut list = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for ws in registered {
            if !seen.insert(ws.id.clone()) {
                return Err(super::mcp_sdk::error("중복 workspace ID입니다."));
            }
            let local_path = ws
                .docs_repository
                .as_ref()
                .map(|repo| {
                    crate::repository::managed::managed_clone_dir(
                        &self.runtime.app_data_dir,
                        &repo.full_name,
                    )
                })
                .transpose()?
                .filter(|path| path.exists());
            if let Some(root) = &local_path {
                validate_local_root(root, &self.runtime.app_data_dir)?;
            }
            let mut projects: Vec<AutomationProjectSummary> = ws
                .project
                .as_ref()
                .map(|p| AutomationProjectSummary {
                    id: p.id.clone(),
                    owner: p.owner.clone(),
                    number: p.number,
                    title: p.title.clone(),
                    scope: p.scope,
                })
                .into_iter()
                .collect();
            let mut default_project_id = ws.project.as_ref().map(|p| p.id.clone());
            if let Some(cfg) = read_config(local_path.as_deref())? {
                if let Some(github) = cfg.github {
                    for p in github.all_projects() {
                        if let Some(existing) = projects.iter().find(|existing| existing.id == p.id)
                        {
                            if existing.owner != p.owner || existing.number != p.number {
                                return Err(super::mcp_sdk::error(
                                    "Project ID와 연결 정보가 일치하지 않습니다.",
                                ));
                            }
                        } else {
                            projects.push(AutomationProjectSummary {
                                id: p.id,
                                owner: p.owner,
                                number: p.number,
                                title: String::new(),
                                scope: p.scope.unwrap_or(
                                    crate::project_board::ProjectOwnerScope::Organization,
                                ),
                            });
                        }
                    }
                    if let Some(id) = github.active_project_id {
                        if !projects.iter().any(|p| p.id == id) {
                            return Err(super::mcp_sdk::error(
                                "설정된 기본 Project가 연결 목록에 없습니다.",
                            ));
                        }
                        default_project_id = Some(id);
                    }
                }
            }
            if default_project_id.is_none() && projects.len() == 1 {
                default_project_id = Some(projects[0].id.clone());
            }
            list.push(McpWorkspaceSummary {
                id: ws.id,
                title: ws.title,
                docs_repository: ws.docs_repository,
                projects,
                default_project_id,
                local_available: local_path.is_some(),
                local_path,
            });
        }
        if self.runtime.mcp_workspace_id.starts_with("launch:") {
            let project = self.runtime.active_project.clone();
            list.push(McpWorkspaceSummary {
                id: self.runtime.mcp_workspace_id.clone(),
                title: self
                    .runtime
                    .ai_context
                    .workspace_title
                    .clone()
                    .unwrap_or_else(|| "시작 시 지정한 workspace".into()),
                docs_repository: self
                    .runtime
                    .ai_context
                    .docs_repository_full_name
                    .as_ref()
                    .map(|name| DocsRepository {
                        repository_id: String::new(),
                        full_name: name.clone(),
                    }),
                default_project_id: project.as_ref().map(|p| p.id.clone()),
                projects: project.into_iter().collect(),
                local_path: self.runtime.workspace_dir.clone(),
                local_available: self
                    .runtime
                    .workspace_dir
                    .as_ref()
                    .is_some_and(|p| p.exists()),
            });
        }
        Ok(list)
    }
    pub fn resolve(
        &self,
        workspace_id: Option<&str>,
        project_id: Option<&str>,
    ) -> Result<ResolvedMcpTarget, AppError> {
        let id = workspace_id.unwrap_or(&self.runtime.mcp_workspace_id);
        let workspace = self
            .list()?
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| super::mcp_sdk::error("등록되지 않았거나 제거된 workspace입니다."))?;
        let selected = project_id.or(workspace.default_project_id.as_deref());
        let project = selected
            .map(|id| {
                workspace
                    .projects
                    .iter()
                    .find(|p| p.id == id)
                    .cloned()
                    .ok_or_else(|| {
                        super::mcp_sdk::error("workspace에 연결되지 않은 Project입니다.")
                    })
            })
            .transpose()?;
        let config = read_config(workspace.local_path.as_deref())?;
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(
                    &json!({"workspace":workspace,"project":project,"config":config})
                )
                .map_err(|e| super::mcp_sdk::error(e.to_string()))?
            )
        );
        Ok(ResolvedMcpTarget {
            workspace,
            project,
            fingerprint,
        })
    }
}

pub(super) fn launch_id(
    path: &Option<PathBuf>,
    context: &crate::settings::ai_runner::ActiveWorkspaceAiContext,
) -> String {
    let value = json!({"path":path,"repository":context.docs_repository_full_name,"project":context.project.as_ref().map(|p|json!({"id":p.id,"owner":p.owner,"number":p.number}))});
    format!("launch:{:x}", Sha256::digest(value.to_string().as_bytes()))
}

fn validate_local_root(root: &std::path::Path, app_data: &std::path::Path) -> Result<(), AppError> {
    let canonical = root
        .canonicalize()
        .map_err(|_| super::mcp_sdk::error("로컬 문서 clone을 읽을 수 없습니다."))?;
    let boundary = app_data
        .join("repos")
        .canonicalize()
        .map_err(|_| super::mcp_sdk::error("관리 clone 루트를 확인할 수 없습니다."))?;
    if !canonical.starts_with(boundary) {
        return Err(super::mcp_sdk::error("관리 clone 밖 경로입니다."));
    }
    let repo = git2::Repository::open(&canonical)
        .map_err(|_| super::mcp_sdk::error("연결된 로컬 경로가 Git 저장소가 아닙니다."))?;
    if repo.workdir().and_then(|p| p.canonicalize().ok()).as_ref() != Some(&canonical) {
        return Err(super::mcp_sdk::error("문서 clone의 Git 루트가 다릅니다."));
    }
    Ok(())
}

pub(super) fn read_config(
    root: Option<&std::path::Path>,
) -> Result<Option<crate::workspace::model::WorkspaceConfigV1>, AppError> {
    let Some(root) = root else { return Ok(None) };
    let path = root.join(".okf/workspace.yml");
    if !path
        .try_exists()
        .map_err(|_| super::mcp_sdk::error("workspace 설정에 접근할 수 없습니다."))?
    {
        return Ok(None);
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| super::mcp_sdk::error("workspace 설정 경로를 읽을 수 없습니다."))?;
    if !canonical.starts_with(
        root.canonicalize()
            .map_err(|_| super::mcp_sdk::error("workspace 루트 오류"))?,
    ) || std::fs::symlink_metadata(&path)
        .map_err(|e| super::mcp_sdk::error(e.to_string()))?
        .file_type()
        .is_symlink()
    {
        return Err(super::mcp_sdk::error(
            "workspace 밖 설정이나 심볼릭 링크는 사용할 수 없습니다.",
        ));
    }
    let source = std::fs::read_to_string(path).map_err(|e| super::mcp_sdk::error(e.to_string()))?;
    crate::workspace::model::WorkspaceDocument::parse(&source).map(|doc| Some(doc.config))
}

impl AutomationRuntime {
    pub(super) fn select_mcp_project(&mut self, id: Option<&str>) -> Result<(), AppError> {
        if let Some(id) = id {
            let selected = self
                .mcp_projects
                .iter()
                .find(|p| p.id == id)
                .cloned()
                .ok_or_else(|| super::mcp_sdk::error("workspace에 연결되지 않은 Project입니다."))?;
            if self.active_project.as_ref().is_none_or(|p| p.id != id) {
                self.mcp_target_fingerprint = format!(
                    "{:x}",
                    Sha256::digest(
                        format!("{}:project:{id}", self.mcp_target_fingerprint).as_bytes()
                    )
                );
            }
            self.active_project = Some(selected);
        }
        self.ai_context.project = self.active_project.as_ref().map(|p| {
            crate::settings::ai_runner::ActiveProjectRuleInfo {
                id: p.id.clone(),
                owner: p.owner.clone(),
                number: p.number,
                title: p.title.clone(),
                scope: match p.scope {
                    crate::project_board::ProjectOwnerScope::Organization => "organization",
                    crate::project_board::ProjectOwnerScope::User => "user",
                }
                .into(),
            }
        });
        Ok(())
    }
    pub(super) async fn hydrate_mcp_remote_config(
        &mut self,
        target: &ResolvedMcpTarget,
    ) -> Result<(), AppError> {
        if self.workspace_dir.is_some() || target.workspace.id.starts_with("launch:") {
            return Ok(());
        }
        let Some(repo) = &target.workspace.docs_repository else {
            return Ok(());
        };
        let github = self.build_github_service()?;
        let p: Vec<_> = repo.full_name.split('/').collect();
        let detail = github.automation_get(&["repos", p[0], p[1]], &[]).await?;
        if !repository_id_matches(&detail, &repo.repository_id) {
            return Err(super::mcp_sdk::error(
                "원격 workspace 저장소 신원이 달라졌습니다.",
            ));
        }
        let branch = detail["default_branch"]
            .as_str()
            .ok_or_else(|| super::mcp_sdk::error("원격 기본 브랜치를 확인할 수 없습니다."))?;
        let commit = github
            .automation_get(&["repos", p[0], p[1], "commits", branch], &[])
            .await?;
        let sha = commit["sha"]
            .as_str()
            .ok_or_else(|| super::mcp_sdk::error("원격 설정 커밋 누락"))?;
        super::mcp_sources::require_sha(sha)?;
        let tree = github
            .automation_get(
                &["repos", p[0], p[1], "git", "trees", sha],
                &[("recursive", "1".into())],
            )
            .await?;
        if tree["truncated"] == true {
            return Err(super::mcp_sdk::error(
                "원격 설정 트리가 잘려 범위를 확정할 수 없습니다.",
            ));
        }
        let entries = tree["tree"]
            .as_array()
            .ok_or_else(|| super::mcp_sdk::error("원격 설정 트리 누락"))?;
        let regular = |path: &str| -> Result<bool, AppError> {
            if let Some(entry) = entries.iter().find(|e| e["path"] == path) {
                if entry["type"] != "blob"
                    || !matches!(entry["mode"].as_str(), Some("100644" | "100755"))
                {
                    return Err(super::mcp_sdk::error(
                        "원격 설정·규칙은 Git 추적 일반 파일이어야 합니다.",
                    ));
                }
                if entry["size"].as_u64().is_some_and(|size| size > 200 * 1024) {
                    return Err(super::mcp_sdk::error(
                        "원격 설정·규칙이 크기 제한을 초과했습니다.",
                    ));
                }
                Ok(true)
            } else {
                Ok(false)
            }
        };
        if regular(".okf/workspace.yml")? {
            let source = github
                .read_repository_text_file_at_ref(&repo.full_name, ".okf/workspace.yml", sha)
                .await?
                .ok_or_else(|| super::mcp_sdk::error("원격 workspace 설정 읽기 실패"))?;
            if source.len() > 200 * 1024 {
                return Err(super::mcp_sdk::error("원격 workspace 설정 크기 초과"));
            }
            let cfg = crate::workspace::model::WorkspaceDocument::parse(&source)?.config;
            if !crate::workspace::validation::validate_workspace(&cfg).is_empty() {
                return Err(super::mcp_sdk::error(
                    "원격 문서 범위 설정이 잘못되었습니다.",
                ));
            }
            let scopes = cfg.documents.resolved_repositories(
                &crate::workspace::model::GithubRepositoryRef {
                    id: repo.repository_id.clone(),
                    full_name: repo.full_name.clone(),
                    extra: Default::default(),
                },
            );
            super::mcp_documents::validate_scopes(&scopes)?;
            self.ai_context.assignees = cfg.assignees.clone();
            self.mcp_document_roots = Some(
                scopes
                    .first()
                    .map(|s| s.roots.iter().map(|r| r.path.clone()).collect())
                    .unwrap_or_default(),
            );
            self.mcp_document_scopes = Some(scopes);
            let mut repositories = Vec::new();
            for linked in cfg.repositories {
                crate::repository::managed::managed_clone_dir(
                    &self.app_data_dir,
                    &linked.github.full_name,
                )?;
                repositories.push(crate::settings::ai_runner::LinkedCodeRepoRuleInfo {
                    key: linked.key,
                    label: linked.label,
                    full_name: linked.github.full_name,
                    local_path: None,
                });
            }
            self.ai_context.code_repositories = repositories;
            if let Some(github) = cfg.github {
                for p in github.all_projects() {
                    if let Some(existing) = self
                        .mcp_projects
                        .iter()
                        .find(|existing| existing.id == p.id)
                    {
                        if existing.owner != p.owner || existing.number != p.number {
                            return Err(super::mcp_sdk::error(
                                "원격 Project ID와 연결 신원이 다릅니다.",
                            ));
                        }
                    } else {
                        self.mcp_projects.push(AutomationProjectSummary {
                            id: p.id,
                            owner: p.owner,
                            number: p.number,
                            title: String::new(),
                            scope: p
                                .scope
                                .unwrap_or(crate::project_board::ProjectOwnerScope::Organization),
                        });
                    }
                }
                if let Some(id) = github.active_project_id {
                    self.select_mcp_project(Some(&id))?;
                } else if self.active_project.is_none() && self.mcp_projects.len() == 1 {
                    self.active_project = Some(self.mcp_projects[0].clone());
                }
            }
        }
        for path in [".okf/AGENTS.md", "AGENTS.md"] {
            if regular(path)? {
                let rules = github
                    .read_repository_text_file_at_ref(&repo.full_name, path, sha)
                    .await?
                    .ok_or_else(|| super::mcp_sdk::error("원격 작업 규칙 읽기 실패"))?;
                if rules.len() > 200 * 1024 {
                    return Err(super::mcp_sdk::error("원격 작업 규칙 크기 초과"));
                }
                self.mcp_remote_rules = Some((
                    rules,
                    format!("https://github.com/{}/blob/{sha}/{path}", repo.full_name),
                ));
                break;
            }
        }
        self.mcp_target_fingerprint = format!(
            "{:x}",
            Sha256::digest(format!("{}:{sha}", target.fingerprint).as_bytes())
        );
        Ok(())
    }
    pub(super) fn for_mcp_target(&self, target: &ResolvedMcpTarget) -> Result<Self, AppError> {
        if target.workspace.id == self.mcp_workspace_id
            && target.workspace.id.starts_with("launch:")
        {
            return Ok(Self {
                mcp_projects: target.workspace.projects.clone(),
                mcp_document_roots: self.mcp_document_roots.clone(),
                mcp_document_scopes: self.mcp_document_scopes.clone(),
                mcp_remote_rules: self.mcp_remote_rules.clone(),
                mcp_target_fingerprint: target.fingerprint.clone(),
                mcp_workspace_id: self.mcp_workspace_id.clone(),
                app_data_dir: self.app_data_dir.clone(),
                workspace_dir: self.workspace_dir.clone(),
                docs_root_rel: self.docs_root_rel.clone(),
                active_project: target.project.clone(),
                ai_context: self.ai_context.clone(),
                connected_workspaces: self.connected_workspaces.clone(),
                #[cfg(test)]
                test_github: self.test_github.clone(),
            });
        }
        let settings = crate::settings::service::LocalSettingsService::new(
            super::JsonFileSettingsStore::new(self.app_data_dir.join("settings.json")),
        );
        let cfg = read_config(target.workspace.local_path.as_deref())?;
        let docs_root_rel = cfg
            .as_ref()
            .and_then(|cfg| cfg.documents.roots.first())
            .map(|r| r.path.clone())
            .unwrap_or_else(|| "docs".into());
        let repositories = if let Some(root) = &target.workspace.local_path {
            crate::commands::code_repositories::resolve_code_repositories_for_workspace(
                &settings, root,
            )?
        } else {
            Vec::new()
        };
        let ai_context = crate::settings::ai_runner::ActiveWorkspaceAiContext {
            workspace_title: Some(target.workspace.title.clone()),
            docs_repository_full_name: target
                .workspace
                .docs_repository
                .as_ref()
                .map(|r| r.full_name.clone()),
            project: target.project.as_ref().map(|p| {
                crate::settings::ai_runner::ActiveProjectRuleInfo {
                    id: p.id.clone(),
                    owner: p.owner.clone(),
                    number: p.number,
                    title: p.title.clone(),
                    scope: match p.scope {
                        crate::project_board::ProjectOwnerScope::Organization => "organization",
                        crate::project_board::ProjectOwnerScope::User => "user",
                    }
                    .into(),
                }
            }),
            code_repositories: repositories
                .into_iter()
                .map(|r| crate::settings::ai_runner::LinkedCodeRepoRuleInfo {
                    key: r.key,
                    label: r.label,
                    full_name: r.full_name,
                    local_path: r.local_path,
                })
                .collect(),
            current_user_login: None,
            assignees: cfg.as_ref().and_then(|config| config.assignees.clone()),
        };
        Ok(Self {
            mcp_projects: target.workspace.projects.clone(),
            mcp_document_scopes: cfg.as_ref().map(|c| {
                c.documents
                    .resolved_repositories(&crate::workspace::model::GithubRepositoryRef {
                        id: target
                            .workspace
                            .docs_repository
                            .as_ref()
                            .map(|r| r.repository_id.clone())
                            .unwrap_or_default(),
                        full_name: target
                            .workspace
                            .docs_repository
                            .as_ref()
                            .map(|r| r.full_name.clone())
                            .unwrap_or_default(),
                        extra: Default::default(),
                    })
            }),
            mcp_document_roots: cfg
                .map(|c| c.documents.roots.into_iter().map(|r| r.path).collect()),
            mcp_remote_rules: None,
            mcp_target_fingerprint: target.fingerprint.clone(),
            mcp_workspace_id: target.workspace.id.clone(),
            app_data_dir: self.app_data_dir.clone(),
            workspace_dir: target.workspace.local_path.clone(),
            docs_root_rel,
            active_project: target.project.clone(),
            ai_context,
            connected_workspaces: self.connected_workspaces.clone(),
            #[cfg(test)]
            test_github: self.test_github.clone(),
        })
    }

    pub(super) async fn verify_mcp_repository(
        &self,
        target: &ResolvedMcpTarget,
    ) -> Result<(), AppError> {
        let Some(expected) = target
            .workspace
            .docs_repository
            .as_ref()
            .filter(|r| !r.repository_id.is_empty())
        else {
            return Ok(());
        };
        let github = self.build_github_service()?;
        let parts: Vec<_> = expected.full_name.split('/').collect();
        if parts.len() != 2 {
            return Err(super::mcp_sdk::error("문서 저장소 이름이 잘못되었습니다."));
        }
        let actual = github
            .automation_get(&["repos", parts[0], parts[1]], &[])
            .await?;
        if !repository_id_matches(&actual, &expected.repository_id) {
            return Err(super::mcp_sdk::error(
                "등록된 문서 저장소 ID가 현재 GitHub 저장소와 다릅니다.",
            ));
        }
        let origin = if let Some(path) = &self.workspace_dir {
            let repo = git2::Repository::open(path)
                .map_err(|_| super::mcp_sdk::error("로컬 Git 저장소를 확인할 수 없습니다."))?;
            let remote = repo
                .find_remote("origin")
                .map_err(|_| super::mcp_sdk::error("로컬 clone의 origin이 없습니다."))?;
            Some(origin_repository(
                remote
                    .url()
                    .ok_or_else(|| super::mcp_sdk::error("origin 주소 누락"))?,
            )?)
        } else {
            None
        };
        if let Some(origin) = origin {
            if !origin.eq_ignore_ascii_case(&expected.full_name)
                && !actual["full_name"]
                    .as_str()
                    .is_some_and(|name| origin.eq_ignore_ascii_case(name))
            {
                let parts: Vec<_> = origin.split('/').collect();
                let original = github
                    .automation_get(&["repos", parts[0], parts[1]], &[])
                    .await?;
                if !repository_id_matches(&original, &expected.repository_id) {
                    return Err(super::mcp_sdk::error(
                        "로컬 문서 clone의 origin이 등록된 저장소와 다릅니다.",
                    ));
                }
            }
        }
        Ok(())
    }
}

fn repository_id_matches(value: &serde_json::Value, expected: &str) -> bool {
    value["node_id"].as_str() == Some(expected)
        || value["id"]
            .as_u64()
            .is_some_and(|id| id.to_string() == expected)
}

pub(super) fn origin_repository(origin: &str) -> Result<String, AppError> {
    let path = if let Some(path) = origin.strip_prefix("git@github.com:") {
        path.to_owned()
    } else {
        let url = url::Url::parse(origin)
            .map_err(|_| super::mcp_sdk::error("지원하지 않는 Git origin입니다."))?;
        if url.host_str() != Some("github.com")
            || !matches!(url.scheme(), "https" | "ssh")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(super::mcp_sdk::error("GitHub origin만 사용할 수 있습니다."));
        }
        url.path().trim_start_matches('/').to_owned()
    };
    let name = path.strip_suffix(".git").unwrap_or(&path);
    crate::repository::managed::managed_clone_dir(std::path::Path::new("."), name)?;
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::{AutomationOverrides, JsonFileSettingsStore};
    use crate::settings::service::{
        LocalSettingsStore, ACTIVE_HUB_WORKSPACE_KEY, HUB_WORKSPACES_KEY,
    };
    use serde_json::json;

    fn fixture(dir: &std::path::Path) -> AutomationRuntime {
        let store = JsonFileSettingsStore::new(dir.join("settings.json"));
        store.write(HUB_WORKSPACES_KEY, &json!([
            {"id":"A","title":"Alpha","docsRepository":{"repositoryId":"11","fullName":"acme/alpha"}},
            {"id":"B","title":"Beta","docsRepository":{"repositoryId":"22","fullName":"acme/beta"},"project":{"id":"P2","owner":"acme","number":2,"title":"Beta board","scope":"organization"}}
        ]).to_string()).unwrap();
        store.write(ACTIVE_HUB_WORKSPACE_KEY, "A").unwrap();
        AutomationRuntime::load(&AutomationOverrides {
            app_data_dir: Some(dir.to_path_buf()),
            ..Default::default()
        })
        .unwrap()
    }

    #[test]
    fn lists_registered_workspaces_without_requiring_local_clones() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = fixture(dir.path());
        let list = McpWorkspaceCatalog::new(&runtime).list().unwrap();
        assert_eq!(
            list.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
            ["A", "B"]
        );
        assert!(list.iter().all(|w| !w.local_available));
        assert_eq!(list[1].projects[0].id, "P2");
    }

    #[test]
    fn selecting_b_does_not_mutate_settings_or_default_a() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = fixture(dir.path());
        let before = std::fs::read(dir.path().join("settings.json")).unwrap();
        let catalog = McpWorkspaceCatalog::new(&runtime);
        assert_eq!(catalog.resolve(Some("B"), None).unwrap().workspace.id, "B");
        assert_eq!(catalog.resolve(None, None).unwrap().workspace.id, "A");
        assert_eq!(
            std::fs::read(dir.path().join("settings.json")).unwrap(),
            before
        );
    }

    #[test]
    fn unknown_workspace_and_foreign_project_do_not_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = fixture(dir.path());
        let catalog = McpWorkspaceCatalog::new(&runtime);
        assert!(catalog.resolve(Some("missing"), None).is_err());
        assert!(catalog.resolve(Some("A"), Some("P2")).is_err());
    }

    #[test]
    fn corrupted_registry_is_not_an_empty_or_default_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = fixture(dir.path());
        JsonFileSettingsStore::new(dir.path().join("settings.json"))
            .write(HUB_WORKSPACES_KEY, "broken")
            .unwrap();
        assert!(McpWorkspaceCatalog::new(&runtime).list().is_err());
    }

    #[test]
    fn selected_runtime_does_not_borrow_default_workspace_files_or_project() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = fixture(dir.path());
        let catalog = McpWorkspaceCatalog::new(&runtime);
        let selected = runtime
            .for_mcp_target(&catalog.resolve(Some("B"), None).unwrap())
            .unwrap();
        assert_eq!(
            selected.ai_context.docs_repository_full_name.as_deref(),
            Some("acme/beta")
        );
        assert_eq!(selected.active_project.as_ref().unwrap().id, "P2");
        assert!(selected.workspace_dir.is_none());
        assert!(selected.ai_context.code_repositories.is_empty());
        assert_eq!(
            runtime.ai_context.docs_repository_full_name.as_deref(),
            Some("acme/alpha")
        );
    }

    #[tokio::test]
    async fn repository_identity_must_match_even_if_the_name_is_unchanged() {
        for (actual, allowed) in [(22, true), (99, false)] {
            let dir = tempfile::tempdir().unwrap();
            let mut runtime = fixture(dir.path());
            let (github, _) = crate::github::automation_test_support::fixture(vec![(
                "/repos/acme/beta",
                json!({"id":actual,"full_name":"acme/beta"}),
            )]);
            runtime.test_github = Some(github);
            let target = McpWorkspaceCatalog::new(&runtime)
                .resolve(Some("B"), None)
                .unwrap();
            assert_eq!(
                runtime
                    .for_mcp_target(&target)
                    .unwrap()
                    .verify_mcp_repository(&target)
                    .await
                    .is_ok(),
                allowed
            );
        }
    }

    #[tokio::test]
    async fn local_clone_origin_must_resolve_to_the_registered_repository_id() {
        for (origin_name, origin_id, allowed) in
            [("evil/other", 99, false), ("acme/old-beta", 22, true)]
        {
            let dir = tempfile::tempdir().unwrap();
            let mut runtime = fixture(dir.path());
            let path = dir.path().join("repos/acme/beta");
            std::fs::create_dir_all(&path).unwrap();
            let repo = git2::Repository::init(&path).unwrap();
            repo.remote("origin", &format!("https://github.com/{origin_name}.git"))
                .unwrap();
            let origin_path = format!("/repos/{origin_name}");
            let (github, _) = crate::github::automation_test_support::fixture(vec![
                ("/repos/acme/beta", json!({"id":22,"full_name":"acme/beta"})),
                (
                    Box::leak(origin_path.into_boxed_str()),
                    json!({"id":origin_id,"full_name":origin_name}),
                ),
            ]);
            runtime.test_github = Some(github);
            let target = McpWorkspaceCatalog::new(&runtime)
                .resolve(Some("B"), None)
                .unwrap();
            let result = runtime
                .for_mcp_target(&target)
                .unwrap()
                .verify_mcp_repository(&target)
                .await;
            assert_eq!(result.is_ok(), allowed, "origin={origin_name}");
        }
    }

    #[tokio::test]
    async fn a_workspace_without_a_clone_can_load_remote_roots_code_repositories_and_rules() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let mut runtime = fixture(dir.path());
        let config="schema_version: 1\nworkspace:\n  id: d5b90530-6041-47e3-a348-2bff3642d5fb\n  name: Beta\ndocuments:\n  roots:\n    - key: docs\n      path: knowledge\nrepositories:\n  - key: backend\n    label: Backend\n    github:\n      id: R_api\n      full_name: acme/api\n";
        let file = |content: &str| json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(content)});
        let config=format!("{config}github:\n  projects:\n    - id: P3\n      owner: acme\n      number: 3\n      scope: organization\n");
        let (github, _) = crate::github::automation_test_support::fixture(vec![
            (
                "/repos/acme/beta",
                json!({"id":22,"full_name":"acme/beta","default_branch":"main"}),
            ),
            (
                "/repos/acme/beta/commits/main",
                json!({"sha":"a".repeat(40)}),
            ),
            (
                "/repos/acme/beta/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"path":".okf/workspace.yml","mode":"100644","type":"blob"},{"path":".okf/AGENTS.md","mode":"100644","type":"blob"}],"truncated":false}),
            ),
            (
                "/repos/acme/beta/contents/.okf/workspace.yml",
                file(&config),
            ),
            (
                "/repos/acme/beta/contents/.okf/AGENTS.md",
                file("Confirm all changes."),
            ),
        ]);
        runtime.test_github = Some(github);
        let target = McpWorkspaceCatalog::new(&runtime)
            .resolve(Some("B"), None)
            .unwrap();
        let mut selected = runtime.for_mcp_target(&target).unwrap();
        selected.hydrate_mcp_remote_config(&target).await.unwrap();
        assert_eq!(selected.document_roots().unwrap(), ["knowledge"]);
        assert_eq!(
            selected.ai_context.code_repositories[0].full_name,
            "acme/api"
        );
        assert!(selected
            .active_context_summary()
            .rules
            .contains("Confirm all changes."));
        assert!(selected.workspace_dir.is_none());
        assert!(selected.list_docs().is_err());
        selected.select_mcp_project(Some("P3")).unwrap();
        assert_eq!(selected.active_project.as_ref().unwrap().number, 3);
        assert!(selected.select_mcp_project(Some("P999")).is_err());
    }
}
