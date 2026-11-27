//! GitHub-backed, read-only workspace definition lookup.
use super::model::{GithubProjectRef, GithubRepositoryRef, WorkspaceDocument};
use super::shared::*;
use crate::{
    error::{AppError, ErrorCode},
    github::GithubService,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

fn invalid(message: &str) -> AppError {
    AppError::new(ErrorCode::WorkspaceInvalid, message)
}
fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn split_repo(name: &str) -> Result<(&str, &str), AppError> {
    let (owner, repo) = name
        .split_once('/')
        .ok_or_else(|| invalid("저장소는 owner/repository 형식이어야 합니다."))?;
    if !valid_component(owner) || !valid_component(repo) {
        return Err(invalid("잘못된 저장소 경로입니다."));
    }
    Ok((owner, repo))
}
fn valid_sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn identity_matches(detail: &Value, expected: &str) -> bool {
    !expected.is_empty()
        && (detail["node_id"].as_str() == Some(expected)
            || detail["id"]
                .as_u64()
                .is_some_and(|id| id.to_string() == expected))
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn unavailable(provenance: Option<WorkspaceProvenance>, error: AppError) -> SharedWorkspaceLookup {
    SharedWorkspaceLookup::Unavailable { provenance, error }
}

fn file_failure(
    provenance: WorkspaceProvenance,
    path: &str,
    error: AppError,
) -> SharedWorkspaceLookup {
    if error.code == ErrorCode::WorkspaceInvalid {
        SharedWorkspaceLookup::Invalid {
            provenance,
            diagnostics: vec![SharedDiagnostic {
                path: path.into(),
                message: error.message,
            }],
        }
    } else {
        unavailable(Some(provenance), error)
    }
}

fn semantic_diagnostics(config: &super::model::WorkspaceConfigV1) -> Vec<SharedDiagnostic> {
    let mut result: Vec<_> = super::validation::validate_workspace(config)
        .into_iter()
        .map(|d| SharedDiagnostic {
            path: d.path,
            message: d.message,
        })
        .collect();
    let mut add = |path: String, message: &str| {
        result.push(SharedDiagnostic {
            path,
            message: message.into(),
        })
    };
    let mut ids = BTreeMap::new();
    let mut names = BTreeMap::new();
    for (path, repo) in config
        .documents
        .repository
        .iter()
        .map(|r| ("documents.repository".to_owned(), r))
        .chain(
            config
                .documents
                .repositories
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    (
                        format!("documents.repositories[{i}].repository"),
                        &r.repository,
                    )
                }),
        )
        .chain(
            config
                .repositories
                .iter()
                .enumerate()
                .map(|(i, r)| (format!("repositories[{i}].github"), &r.github)),
        )
    {
        if repo.id.trim().is_empty() || split_repo(&repo.full_name).is_err() {
            add(
                path.clone(),
                "저장소 ID와 owner/repository를 확인해 주세요.",
            );
        }
        let name = repo.full_name.to_ascii_lowercase();
        if ids
            .insert(repo.id.clone(), name.clone())
            .is_some_and(|previous| previous != name)
            || names
                .insert(name, repo.id.clone())
                .is_some_and(|previous| previous != repo.id)
        {
            add(path, "동일 저장소 이름 또는 ID의 연결 정보가 충돌합니다.");
        }
    }
    for (i, repo) in config.repositories.iter().enumerate() {
        let roles: Vec<_> = repo.roles.iter().map(|r| format!("{r:?}")).collect();
        if roles.iter().collect::<std::collections::HashSet<_>>().len() != roles.len() {
            add(format!("repositories[{i}].roles"), "역할이 중복되었습니다.");
        }
    }
    if let Some(github) = &config.github {
        for (i, p) in github.projects.iter().enumerate() {
            if github.projects[..i].iter().any(|previous| {
                previous.id == p.id
                    || (previous.owner.eq_ignore_ascii_case(&p.owner)
                        && previous.number == p.number
                        && previous.scope == p.scope)
            }) {
                add(
                    format!("github.projects[{i}]"),
                    "동일 Project를 projects 목록에 중복 선언할 수 없습니다.",
                );
            }
        }
        let mut projects = BTreeMap::new();
        let mut locations = BTreeMap::new();
        let mut scopes = BTreeMap::new();
        for (i, p) in github
            .projects
            .iter()
            .chain(github.project.iter())
            .enumerate()
        {
            if p.number == 0 || !valid_component(&p.owner) {
                add(
                    format!("github.projects[{i}]"),
                    "Project 소유자와 번호를 확인해 주세요.",
                );
            }
            if let Some(Some(previous)) = scopes.insert(p.id.clone(), p.scope) {
                if p.scope.is_some_and(|current| current != previous) {
                    add(
                        format!("github.projects[{i}].scope"),
                        "Project 소유자 유형이 충돌합니다.",
                    );
                }
            }
            let location = (p.owner.to_ascii_lowercase(), p.number);
            if projects
                .insert(p.id.clone(), location.clone())
                .is_some_and(|old| old != location)
                || locations
                    .insert(location, p.id.clone())
                    .is_some_and(|old| old != p.id)
            {
                add(
                    format!("github.projects[{i}]"),
                    "Project ID와 소유자·번호가 충돌합니다.",
                );
            }
        }
    }
    result
}

async fn read_blob(
    github: &GithubService,
    owner: &str,
    repo: &str,
    entry: &Value,
) -> Result<String, AppError> {
    if entry["type"] != "blob" || !matches!(entry["mode"].as_str(), Some("100644" | "100755")) {
        return Err(invalid("설정과 규칙은 Git 추적 일반 파일이어야 합니다."));
    }
    let size = entry["size"]
        .as_u64()
        .ok_or_else(|| invalid("파일 크기 정보가 없습니다."))?;
    if size > SHARED_FILE_LIMIT {
        return Err(invalid("설정 또는 규칙이 200 KiB 제한을 초과했습니다."));
    }
    let sha = entry["sha"]
        .as_str()
        .filter(|s| valid_component(s))
        .ok_or_else(|| invalid("Git blob 식별자가 잘못되었습니다."))?;
    let blob = github
        .automation_get(&["repos", owner, repo, "git", "blobs", sha], &[])
        .await?;
    if blob["encoding"] != "base64" {
        return Err(invalid("지원하지 않는 Git blob 인코딩입니다."));
    }
    let content = blob["content"]
        .as_str()
        .ok_or_else(|| invalid("파일 본문을 읽지 못했습니다."))?;
    // Limit the encoded value too; metadata alone is not a memory/content bound.
    if content.len() > SHARED_FILE_LIMIT as usize * 4 {
        return Err(invalid("인코딩된 파일 크기가 제한을 초과했습니다."));
    }
    let compact = content
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect::<String>();
    if compact.len() > ((SHARED_FILE_LIMIT as usize + 2) / 3 * 4) {
        return Err(invalid("파일 크기가 제한을 초과했습니다."));
    }
    let bytes = STANDARD
        .decode(compact)
        .map_err(|_| invalid("파일 인코딩이 잘못되었습니다."))?;
    if bytes.len() > SHARED_FILE_LIMIT as usize || bytes.len() != size as usize {
        return Err(invalid("파일 크기와 Git 메타데이터가 일치하지 않습니다."));
    }
    String::from_utf8(bytes).map_err(|_| invalid("파일은 UTF-8 텍스트여야 합니다."))
}

pub async fn resolve_shared_workspace(
    github: &GithubService,
    source: &WorkspaceSourceRef,
    commit: Option<&str>,
) -> Result<SharedWorkspaceLookup, AppError> {
    let (owner, repo) = split_repo(&source.full_name)?;
    if source.repository_id.trim().is_empty() || commit.is_some_and(|s| !valid_sha(s)) {
        return Err(invalid("저장소 ID와 40자리 커밋 SHA를 확인해 주세요."));
    }
    let detail = match github.automation_get(&["repos", owner, repo], &[]).await {
        Ok(v) => v,
        Err(e) => return Ok(unavailable(None, e)),
    };
    if !identity_matches(&detail, &source.repository_id) {
        return Ok(unavailable(
            None,
            invalid("기준 저장소 신원이 일치하지 않습니다."),
        ));
    }
    let canonical = detail["full_name"]
        .as_str()
        .ok_or_else(|| invalid("저장소 이름 정보가 없습니다."))?;
    let (owner, repo) = split_repo(canonical)?;
    let canonical_source = WorkspaceSourceRef {
        repository_id: detail["node_id"]
            .as_str()
            .unwrap_or(&source.repository_id)
            .into(),
        full_name: canonical.into(),
    };
    let branch = match detail["default_branch"].as_str().filter(|s| !s.is_empty()) {
        Some(v) => v.to_owned(),
        None => {
            return Ok(unavailable(
                None,
                invalid("저장소의 기본 브랜치 응답이 없거나 잘못되었습니다."),
            ))
        }
    };
    let sha = if let Some(sha) = commit {
        let sha = sha.to_ascii_lowercase();
        match github
            .automation_get(&["repos", owner, repo, "commits", &sha], &[])
            .await
        {
            Ok(value) if value["sha"].as_str() == Some(sha.as_str()) => sha,
            Ok(_) => {
                return Ok(unavailable(
                    None,
                    invalid("요청한 커밋 SHA와 원격 커밋이 일치하지 않습니다."),
                ))
            }
            Err(e) => return Ok(unavailable(None, e)),
        }
    } else {
        match github
            .automation_get(&["repos", owner, repo, "commits", &branch], &[])
            .await
        {
            Ok(value) => value["sha"]
                .as_str()
                .filter(|s| valid_sha(s))
                .ok_or_else(|| invalid("기본 브랜치의 커밋을 확인할 수 없습니다."))?
                .to_ascii_lowercase(),
            Err(e) if e.details.get("reason").map(String::as_str) == Some("empty_repository") => {
                return Ok(SharedWorkspaceLookup::EmptyRepository {
                    source: canonical_source,
                })
            }
            Err(e) => return Ok(unavailable(None, e)),
        }
    };
    let provenance = WorkspaceProvenance {
        source: canonical_source.clone(),
        branch,
        commit: sha.clone(),
        path: SHARED_CONFIG_PATH.into(),
        fetched_at_unix: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        freshness: "live",
        source_is_fork: detail["fork"] == true,
    };
    let tree = match github
        .automation_get(
            &["repos", owner, repo, "git", "trees", &sha],
            &[("recursive", "1".into())],
        )
        .await
    {
        Ok(v) => v,
        Err(e) => return Ok(unavailable(Some(provenance), e)),
    };
    if tree["truncated"].as_bool() != Some(false) {
        return Ok(unavailable(
            Some(provenance),
            invalid("원격 트리가 잘려 설정 유무를 확정할 수 없습니다."),
        ));
    }
    let entries = tree["tree"]
        .as_array()
        .ok_or_else(|| invalid("Git 트리 응답이 잘못되었습니다."))?;
    if entries
        .iter()
        .any(|e| e["path"] == ".okf" && e["type"] != "tree")
    {
        return Ok(unavailable(Some(provenance), invalid(".okf는 Git 디렉터리여야 합니다. 링크나 일반 파일은 설정 디렉터리로 사용할 수 없습니다.")));
    }
    let Some(entry) = entries.iter().find(|e| e["path"] == SHARED_CONFIG_PATH) else {
        return Ok(SharedWorkspaceLookup::Missing { provenance });
    };
    let text = match read_blob(github, owner, repo, entry).await {
        Ok(v) => v,
        Err(e) => return Ok(file_failure(provenance, SHARED_CONFIG_PATH, e)),
    };
    let config = match WorkspaceDocument::parse(&text) {
        Ok(doc) => doc.config,
        Err(_) => {
            return Ok(SharedWorkspaceLookup::Invalid {
                provenance,
                diagnostics: vec![SharedDiagnostic {
                    path: SHARED_CONFIG_PATH.into(),
                    message: "설정 YAML의 형식과 schema_version을 확인해 주세요.".into(),
                }],
            })
        }
    };
    let diagnostics = semantic_diagnostics(&config);
    if !diagnostics.is_empty() {
        return Ok(SharedWorkspaceLookup::Invalid {
            provenance,
            diagnostics,
        });
    }
    let mut rules = None;
    for path in [".okf/AGENTS.md", "AGENTS.md"] {
        if let Some(entry) = entries.iter().find(|e| e["path"] == path) {
            let text = match read_blob(github, owner, repo, entry).await {
                Ok(v) => v,
                Err(e) => return Ok(file_failure(provenance, path, e)),
            };
            rules = Some(SharedRules {
                path: path.into(),
                text,
                url: format!("https://github.com/{canonical}/blob/{sha}/{path}"),
            });
            break;
        }
    }
    let inferred = config.documents.repository.is_none() && !config.documents.roots.is_empty();
    let source_reference = GithubRepositoryRef {
        id: canonical_source.repository_id.clone(),
        full_name: canonical.into(),
        extra: Default::default(),
    };
    let mut document_repositories = config.documents.resolved_repositories(&source_reference);
    let mut document_ids = std::collections::HashSet::new();
    let mut document_names = std::collections::HashSet::new();
    for (index, documents) in document_repositories.iter_mut().enumerate() {
        if !document_ids.insert(documents.repository.id.clone())
            || !document_names.insert(documents.repository.full_name.to_ascii_lowercase())
        {
            return Ok(SharedWorkspaceLookup::Invalid {
                provenance,
                diagnostics: vec![SharedDiagnostic {
                    path: format!("documentRepositories[{index}].repository"),
                    message: "문서 저장소는 중복으로 연결할 수 없습니다.".into(),
                }],
            });
        }
        documents.extra.clear();
        documents.repository.extra.clear();
        for root in &mut documents.roots {
            root.extra.clear();
        }
    }
    let primary = document_repositories
        .first()
        .ok_or_else(|| invalid("문서 저장소와 루트가 필요합니다."))?;
    let docs = primary.repository.clone();
    let primary_roots: Vec<String> = primary.roots.iter().map(|root| root.path.clone()).collect();
    let mut codes = config.repositories.clone();
    for c in &mut codes {
        c.extra.clear();
        c.github.extra.clear();
    }
    let mut projects = config
        .github
        .as_ref()
        .map(|g| g.all_projects())
        .unwrap_or_default();
    for p in &mut projects {
        p.extra.clear();
    }
    let default_project = config
        .github
        .as_ref()
        .and_then(|g| {
            g.active_project_id
                .clone()
                .or_else(|| g.project.as_ref().map(|p| p.id.clone()))
        })
        .or_else(|| {
            if projects.len() == 1 {
                Some(projects[0].id.clone())
            } else {
                None
            }
        });
    let mut access = Vec::new();
    let mut seen: BTreeMap<String, (String, Option<AppError>)> = BTreeMap::new();
    seen.insert(
        canonical.to_ascii_lowercase(),
        (canonical_source.repository_id.clone(), None),
    );
    for r in document_repositories
        .iter()
        .map(|d| &d.repository)
        .chain(codes.iter().map(|c| &c.github))
    {
        if let Some((previous, previous_error)) = seen.get(&r.full_name.to_ascii_lowercase()) {
            if previous != &r.id
                && !(r.full_name.eq_ignore_ascii_case(canonical)
                    && identity_matches(&detail, &r.id))
            {
                return Ok(SharedWorkspaceLookup::Invalid {
                    provenance,
                    diagnostics: vec![SharedDiagnostic {
                        path: "repositories".into(),
                        message: "동일 저장소 이름의 ID가 충돌합니다.".into(),
                    }],
                });
            }
            access.push(WorkspaceTargetAccess {
                target: r.full_name.clone(),
                available: previous_error.is_none(),
                error: previous_error.clone(),
            });
            continue;
        }
        let (o, n) = split_repo(&r.full_name)?;
        let outcome = read_repository_content_access(github, o, n, &r.id).await;
        seen.insert(
            r.full_name.to_ascii_lowercase(),
            (r.id.clone(), outcome.as_ref().err().cloned()),
        );
        access.push(WorkspaceTargetAccess {
            target: r.full_name.clone(),
            available: outcome.is_ok(),
            error: outcome.err(),
        });
    }
    for p in &projects {
        let outcome = read_project(github, p).await;
        access.push(WorkspaceTargetAccess {
            target: format!("project:{}", p.id),
            available: outcome.is_ok(),
            error: outcome.err(),
        });
    }
    let target_fingerprint=digest(&serde_json::to_vec(&json!({"id":config.workspace.id,"documents":document_repositories,"code":codes,"projects":projects,"defaultProjectId":default_project})).map_err(|_|invalid("연결 정보 직렬화 실패"))?);
    let config_fingerprint = digest(
        &serde_json::to_vec(
            &json!({"config":text,"rules":rules.as_ref().map(|r|(&r.path,&r.text))}),
        )
        .map_err(|_| invalid("설정 지문 생성 실패"))?,
    );
    let warnings = if provenance.source_is_fork {
        vec![
            "fork의 설정에 원래 팀 대상이 남아 있을 수 있습니다. 등록 전에 연결 대상을 확인하세요."
                .into(),
        ]
    } else {
        vec![]
    };
    Ok(SharedWorkspaceLookup::Found {
        workspace: Box::new(ResolvedSharedWorkspace {
            id: config.workspace.id,
            name: config.workspace.name,
            source_repository: canonical_source,
            docs_repository: docs,
            docs_repository_inferred: inferred,
            document_roots: primary_roots,
            document_repositories,
            code_repositories: codes,
            projects,
            default_project_id: default_project,
            provenance,
            config_fingerprint,
            target_fingerprint,
            rules,
            target_access: access,
            warnings,
            registration_required: true,
        }),
    })
}

async fn read_project(github: &GithubService, p: &GithubProjectRef) -> Result<(), AppError> {
    use crate::project_board::ProjectOwnerScope;
    let scope = p.scope.unwrap_or(ProjectOwnerScope::Organization);
    let resolved = match github.resolve_project(scope, &p.owner, p.number).await {
        Ok(value) => value,
        Err(error)
            if p.scope.is_none()
                && error.details.get("reason").map(String::as_str) == Some("project_not_found") =>
        {
            github
                .resolve_project(ProjectOwnerScope::User, &p.owner, p.number)
                .await?
        }
        Err(error) => return Err(error),
    };
    if resolved.id != p.id {
        return Err(invalid("Project ID와 소유자·번호가 일치하지 않습니다."));
    }
    Ok(())
}

async fn read_repository_content_access(
    github: &GithubService,
    owner: &str,
    repo: &str,
    id: &str,
) -> Result<(), AppError> {
    let detail = github.automation_get(&["repos", owner, repo], &[]).await?;
    if !identity_matches(&detail, id) {
        return Err(invalid("연결 저장소 신원이 일치하지 않습니다."));
    }
    let branch = detail["default_branch"]
        .as_str()
        .filter(|b| !b.is_empty())
        .ok_or_else(|| invalid("연결 저장소의 기본 브랜치를 확인할 수 없습니다."))?;
    // Get a commit requires Contents:read; repository metadata alone does not.
    let commit = github
        .automation_get(&["repos", owner, repo, "commits", branch], &[])
        .await?;
    if !commit["sha"].as_str().is_some_and(valid_sha) {
        return Err(invalid(
            "연결 저장소의 콘텐츠 조회 결과를 확인할 수 없습니다.",
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "shared_source_tests.rs"]
mod tests;
