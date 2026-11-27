use super::AutomationRuntime;
use crate::error::AppError;
use serde_json::{json, Value};

pub(super) fn is_planning(path: &str, markdown: &str) -> bool {
    let metadata = crate::documents::frontmatter::parse_document(markdown, path);
    if matches!(
        metadata.frontmatter_status,
        crate::documents::contract::FrontmatterStatus::Invalid { .. }
    ) {
        return false;
    }
    match metadata.doc_type {
        Some(kind) => kind.eq_ignore_ascii_case("Product Spec"),
        None => {
            let filename = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
            filename == "prd.md" || filename.ends_with("-prd.md")
        }
    }
}

pub(super) fn safe_path(path: &str) -> Result<(), AppError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path.contains(':')
    {
        return Err(super::mcp_sdk::error("허용되지 않은 저장소 경로입니다."));
    }
    for part in path.split('/') {
        let name = part.to_ascii_lowercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || [
                ".git",
                ".ssh",
                ".aws",
                ".npmrc",
                ".netrc",
                ".pypirc",
                ".git-credentials",
            ]
            .contains(&name.as_str())
            || name.starts_with(".env")
            || name.starts_with("id_rsa")
            || name.starts_with("id_ed25519")
            || name.contains("credentials")
            || name.ends_with(".pem")
            || name.ends_with(".key")
            || name.ends_with(".p12")
            || name.ends_with(".pfx")
        {
            return Err(super::mcp_sdk::error(
                "저장소 밖 경로 또는 자격증명 파일은 읽을 수 없습니다.",
            ));
        }
    }
    Ok(())
}

pub(super) fn require_sha(sha: &str) -> Result<(), AppError> {
    if !matches!(sha.len(), 40 | 64) || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(super::mcp_sdk::error(
            "브랜치 이름 대신 전체 커밋 SHA를 지정하세요.",
        ));
    }
    Ok(())
}

pub(super) fn relative_git_path(path: &std::path::Path) -> Result<String, AppError> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => parts.push(
                part.to_str()
                    .ok_or_else(|| super::mcp_sdk::error("UTF-8 경로만 읽을 수 있습니다."))?,
            ),
            _ => return Err(super::mcp_sdk::error("상대 경로만 읽을 수 있습니다.")),
        }
    }
    let path = parts.join("/");
    safe_path(&path)?;
    Ok(path)
}

pub(super) fn allowed_repo(
    runtime: &AutomationRuntime,
    requested: Option<&str>,
    code_only: bool,
) -> Result<String, AppError> {
    let context = runtime.active_context_summary();
    let mut allowed: Vec<String> = context
        .code_repositories
        .into_iter()
        .map(|r| r.full_name)
        .collect();
    if !code_only {
        allowed.extend(
            runtime
                .document_scopes()?
                .into_iter()
                .map(|s| s.repository.full_name),
        );
        allowed.sort();
        allowed.dedup();
    }
    let repo = requested
        .map(str::to_owned)
        .or_else(|| {
            if allowed.len() == 1 {
                allowed.first().cloned()
            } else {
                None
            }
        })
        .ok_or_else(|| super::mcp_sdk::error("설정된 대상 저장소를 지정하세요."))?;
    if !allowed.iter().any(|r| r.eq_ignore_ascii_case(&repo))
        || repo.split('/').count() != 2
        || repo
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(super::mcp_sdk::error(
            "프로젝트에 설정되지 않은 저장소입니다.",
        ));
    }
    Ok(allowed
        .iter()
        .find(|r| r.eq_ignore_ascii_case(&repo))
        .unwrap()
        .to_ascii_lowercase())
}

pub(super) async fn snapshot(
    github: &crate::github::GithubService,
    repo: &str,
    commit: Option<&str>,
) -> Result<String, AppError> {
    if let Some(sha) = commit {
        require_sha(sha)?;
        return Ok(sha.to_owned());
    }
    let parts: Vec<_> = repo.split('/').collect();
    let detail = github
        .automation_get(&["repos", parts[0], parts[1]], &[])
        .await?;
    let branch = detail["default_branch"]
        .as_str()
        .ok_or_else(|| super::mcp_sdk::error("기본 브랜치를 찾을 수 없습니다."))?;
    let value = github
        .automation_get(&["repos", parts[0], parts[1], "commits", branch], &[])
        .await?;
    let sha = value["sha"]
        .as_str()
        .ok_or_else(|| super::mcp_sdk::error("기준 커밋 조회 실패"))?;
    require_sha(sha)?;
    Ok(sha.to_owned())
}

async fn tree(
    github: &crate::github::GithubService,
    repo: &str,
    sha: &str,
) -> Result<Vec<Value>, AppError> {
    Ok(raw_tree(github, repo, sha)
        .await?
        .into_iter()
        .filter(|e| e["type"] == "blob" && matches!(e["mode"].as_str(), Some("100644" | "100755")))
        .collect())
}

async fn raw_tree(
    github: &crate::github::GithubService,
    repo: &str,
    sha: &str,
) -> Result<Vec<Value>, AppError> {
    let p: Vec<_> = repo.split('/').collect();
    let value = github
        .automation_get(
            &["repos", p[0], p[1], "git", "trees", sha],
            &[("recursive", "1".into())],
        )
        .await
        .map_err(|error| {
            error
                .with_detail("repository", repo)
                .with_detail("commit", sha)
        })?;
    if value["truncated"] == true {
        return Err(super::mcp_sdk::error(
            "저장소 트리가 잘려 전체 조회를 완료할 수 없습니다.",
        ));
    }
    Ok(value["tree"]
        .as_array()
        .ok_or_else(|| super::mcp_sdk::error("저장소 트리 형식 오류"))?
        .to_vec())
}

async fn text(
    github: &crate::github::GithubService,
    repo: &str,
    sha: &str,
    path: &str,
) -> Result<String, AppError> {
    safe_path(path)?;
    let p: Vec<_> = repo.split('/').collect();
    let mut segments = vec!["repos", p[0], p[1], "contents"];
    segments.extend(path.split('/'));
    let file = github
        .automation_get(&segments, &[("ref", sha.to_owned())])
        .await
        .map_err(|error| {
            error
                .with_detail("repository", repo)
                .with_detail("path", path)
                .with_detail("commit", sha)
        })?;
    let malformed = || {
        AppError::new(
            crate::error::ErrorCode::GithubUnavailable,
            "GitHub 파일 응답 형식을 해석할 수 없습니다.",
        )
        .with_detail("reason", "invalid_response")
    };
    if file["encoding"]
        .as_str()
        .is_none_or(|encoding| !encoding.eq_ignore_ascii_case("base64"))
    {
        return Err(malformed());
    }
    let compact: String = file["content"]
        .as_str()
        .ok_or_else(malformed)?
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(compact)
        .map_err(|_| malformed())?;
    let value = String::from_utf8(bytes).map_err(|_| {
        super::mcp_sdk::error("UTF-8 텍스트 파일이 아니므로 읽을 수 없습니다.")
            .with_detail("reason", "not_text")
    })?;
    if value.len() > 1024 * 1024 || value.contains('\0') {
        return Err(super::mcp_sdk::error(
            "바이너리 또는 1MiB를 넘는 파일입니다.",
        ));
    }
    Ok(value)
}

fn page(args: &Value) -> (usize, usize) {
    (
        args["offset"].as_u64().unwrap_or(0).min(1_000_000) as usize,
        args["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize,
    )
}

fn file_url(repository: &str, commit: &str, path: &str) -> String {
    let mut url = url::Url::parse("https://github.com/").expect("constant GitHub URL");
    {
        let mut segments = url
            .path_segments_mut()
            .expect("HTTPS URL supports path segments");
        for part in repository.split('/') {
            segments.push(part);
        }
        segments.push("blob");
        segments.push(commit);
        for part in path.split('/') {
            segments.push(part);
        }
    }
    url.to_string()
}

fn matches_doc(path: &str, markdown: &str, args: &Value) -> bool {
    let metadata = crate::documents::frontmatter::parse_document(markdown, path);
    let kind_matches = match args["type"].as_str() {
        Some(kind) if kind.eq_ignore_ascii_case("Product Spec") => is_planning(path, markdown),
        Some(kind) => metadata
            .doc_type
            .as_deref()
            .is_some_and(|t| t.eq_ignore_ascii_case(kind)),
        None => true,
    };
    let query = args["query"].as_str().unwrap_or_default().to_lowercase();
    kind_matches
        && (query.is_empty()
            || format!("{path}\n{}\n{markdown}", metadata.title)
                .to_lowercase()
                .contains(&query))
}

pub(super) fn doc_list_options(args: &Value) -> Result<Value, AppError> {
    let mut value = args.clone();
    let mode = args["mode"]
        .as_str()
        .unwrap_or(if args["published"] == false {
            "documents"
        } else {
            "planning"
        });
    if !matches!(mode, "planning" | "documents") {
        return Err(super::mcp_sdk::error(
            "문서 mode는 planning 또는 documents여야 합니다.",
        ));
    }
    if mode == "planning" {
        if args["type"]
            .as_str()
            .is_some_and(|t| !t.eq_ignore_ascii_case("Product Spec"))
        {
            return Err(super::mcp_sdk::error(
                "다른 문서 타입은 mode=documents로 조회하세요.",
            ));
        }
        value["type"] = json!("Product Spec");
    }
    value["mode"] = json!(mode);
    if value.get("published").is_none() {
        value["published"] = json!(true);
    }
    if value.get("sort").is_none() {
        value["sort"] = json!(if value["published"] == true {
            "updated_desc"
        } else {
            "path"
        });
    }
    Ok(value)
}

pub(super) async fn list_docs(
    runtime: &AutomationRuntime,
    args: &Value,
) -> Result<Value, AppError> {
    let options = doc_list_options(args)?;
    let mut value = list_docs_inner(runtime, &options).await?;
    value["mode"] = options["mode"].clone();
    value["sort"] = options["sort"].clone();
    value["sortBasis"] = json!(if options["sort"] == "path" {
        "path"
    } else if options["published"] == true {
        "git_last_changed"
    } else {
        "local_mtime"
    });
    Ok(value)
}

pub(super) fn in_document_roots(path: &str, roots: &[String]) -> bool {
    roots
        .iter()
        .any(|root| root == "." || path.starts_with(&format!("{}/", root.trim_end_matches('/'))))
}

async fn list_docs_inner(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    let (offset, limit) = page(args);
    if args["published"] != true {
        if args.get("commit").is_some() {
            return Err(super::mcp_sdk::error(
                "commit은 원격 확정본 목록에만 사용할 수 있습니다.",
            ));
        }
        let mut items = Vec::new();
        let scopes = runtime.document_scopes()?;
        for scope in scopes.iter().filter(|scope| {
            args["repository"]
                .as_str()
                .is_none_or(|repo| scope.repository.full_name.eq_ignore_ascii_case(repo))
        }) {
            let root = runtime.local_document_root(scope)?;
            let entries = super::doc_validator::list_scoped_workspace_docs(&root, scope)?;
            for entry in entries {
                if !scope.includes_path(&entry.path) {
                    continue;
                }
                if let Err(error) = super::mcp_documents::local_relative(scope, &root, &entry.path)
                {
                    if error
                        .details
                        .get("reason")
                        .is_some_and(|reason| reason == "excluded_document_alias")
                    {
                        continue;
                    }
                    return Err(error);
                }
                let doc =
                    super::doc_validator::read_scoped_workspace_doc(&root, &entry.path, scope)?;
                if !matches_doc(&entry.path, &doc.markdown, args) {
                    continue;
                }
                let mut value = serde_json::to_value(&entry)
                    .map_err(|e| super::mcp_sdk::error(e.to_string()))?;
                value["published"] = json!(false);
                value["repository"] = json!(scope.repository.full_name);
                let modified = std::fs::metadata(root.join(&entry.path))
                    .and_then(|metadata| metadata.modified())
                    .map_err(|_| {
                        super::mcp_sdk::error("로컬 문서 수정 시점을 확인할 수 없습니다.")
                    })?;
                value["localModifiedAtUnixMs"] = json!(modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|_| super::mcp_sdk::error("로컬 문서 시점이 잘못되었습니다."))?
                    .as_millis() as u64);
                items.push(value);
            }
        }
        if let Some(repo) = args["repository"].as_str() {
            runtime.document_scope(Some(repo))?;
        }
        items.sort_by(|a, b| {
            if args["sort"] == "updated_desc" {
                b["localModifiedAtUnixMs"]
                    .as_u64()
                    .cmp(&a["localModifiedAtUnixMs"].as_u64())
                    .then(a["path"].as_str().cmp(&b["path"].as_str()))
            } else {
                a["path"].as_str().cmp(&b["path"].as_str())
            }
        });
        let total = items.len();
        return Ok(
            json!({"items":items.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total,"nextOffset":if offset+limit < total {Some(offset+limit)} else {None},"published":false,"sort":"path"}),
        );
    }
    let mut scopes = runtime.document_scopes()?;
    if let Some(repo) = args["repository"].as_str() {
        scopes = vec![runtime.document_scope(Some(repo))?];
    }
    let scope_value:Vec<_>=scopes.iter().map(|s|json!({"repository":s.repository.full_name,"roots":s.roots.iter().map(|r|json!({"path":r.path,"exclude":r.exclude})).collect::<Vec<_>>() })).collect();
    use sha2::Digest;
    let scope_fingerprint = format!(
        "{:x}",
        sha2::Sha256::digest(
            serde_json::to_vec(&scope_value).map_err(|e| super::mcp_sdk::error(e.to_string()))?
        )
    );
    if args["documentScopeFingerprint"]
        .as_str()
        .is_some_and(|expected| expected != scope_fingerprint)
    {
        return Err(super::mcp_sdk::error(
            "문서 저장소나 제외 범위가 변경됐습니다. 목록을 처음부터 다시 조회하세요.",
        ));
    }
    if scopes.len() > 1 && args["commit"].is_string() {
        return Err(super::mcp_sdk::error(
            "여러 저장소의 후속 조회에는 repositoryCommits를 사용하세요.",
        ));
    }
    let pinned = args
        .get("repositoryCommits")
        .filter(|value| !value.is_null());
    if let Some(pinned) = pinned {
        let pinned = pinned.as_object().ok_or_else(|| {
            super::mcp_sdk::error("repositoryCommits는 저장소별 커밋 객체여야 합니다.")
        })?;
        if pinned.len() != scopes.len()
            || scopes.iter().any(|scope| {
                !pinned
                    .get(&scope.repository.full_name)
                    .is_some_and(|v| v.is_string())
            })
        {
            return Err(super::mcp_sdk::error(
                "기준 커밋의 저장소 목록이 현재 문서 범위와 다릅니다.",
            ));
        }
    }
    let github = runtime.build_github_service()?;
    let mut commits = serde_json::Map::new();
    let mut current_commits = serde_json::Map::new();
    let mut items = Vec::new();
    for scope in &scopes {
        let repo = &scope.repository.full_name;
        let selected = pinned
            .and_then(|map| map[repo].as_str())
            .or_else(|| args["commit"].as_str());
        let (current_sha, sha) = super::mcp_documents::snapshot(&github, scope, selected)
            .await
            .map_err(|error| error.with_detail("repository", repo))?;
        commits.insert(repo.clone(), json!(sha));
        current_commits.insert(repo.clone(), json!(current_sha));
        for entry in tree(&github, repo, &sha).await? {
            let Some(path) = entry["path"].as_str() else {
                continue;
            };
            if !path.ends_with(".md") || !scope.includes_path(path) {
                continue;
            }
            if entry["size"].as_u64().is_none_or(|size| size > 1024 * 1024) {
                return Err(super::mcp_sdk::error(
                    "문서 크기 제한 또는 메타데이터 오류로 전체 조회를 완료할 수 없습니다.",
                )
                .with_detail("repository", repo));
            }
            let markdown = text(&github, repo, &sha, path).await?;
            if !matches_doc(path, &markdown, args) {
                continue;
            }
            let parts: Vec<_> = repo.split('/').collect();
            let history = github
                .automation_get(
                    &["repos", parts[0], parts[1], "commits"],
                    &[
                        ("sha", sha.clone()),
                        ("path", path.to_owned()),
                        ("per_page", "1".into()),
                    ],
                )
                .await?;
            let last = history
                .as_array()
                .and_then(|a| a.first())
                .ok_or_else(|| super::mcp_sdk::error("문서 변경 커밋 조회 실패"))?;
            let metadata = crate::documents::frontmatter::parse_document(&markdown, path);
            items.push(json!({"path":path,"title":metadata.title,"type":metadata.doc_type,"published":true,"repository":repo,"commit":sha,"lastChangedCommit":last["sha"],"updatedAt":last["commit"]["committer"]["date"],"url":file_url(repo,&sha,path)}));
        }
    }
    items.sort_by(|a, b| {
        let identity = || {
            a["repository"]
                .as_str()
                .cmp(&b["repository"].as_str())
                .then(a["path"].as_str().cmp(&b["path"].as_str()))
        };
        if args["sort"] == "path" {
            identity()
        } else {
            b["updatedAt"]
                .as_str()
                .cmp(&a["updatedAt"].as_str())
                .then_with(identity)
        }
    });
    let total = items.len();
    let single = scopes.len() == 1;
    let repo = scopes
        .first()
        .map(|s| s.repository.full_name.clone())
        .unwrap_or_default();
    Ok(
        json!({"items":items.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total,"nextOffset":if offset+limit<total {Some(offset+limit)} else {None},"commit":if single{commits[&repo].clone()}else{Value::Null},"currentDefaultCommit":if single{current_commits[&repo].clone()}else{Value::Null},"repository":if single{json!(repo)}else{Value::Null},"repositoryCommits":commits,"currentDefaultCommits":current_commits,"documentScopeFingerprint":scope_fingerprint,"documentScopes":scope_value,"published":true}),
    )
}

pub(super) async fn read_doc(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    let path = args["path"]
        .as_str()
        .ok_or_else(|| super::mcp_sdk::error("문서 경로가 필요합니다."))?;
    safe_path(path)?;
    let scope = runtime.document_scope(args["repository"].as_str())?;
    if !path.ends_with(".md") || !scope.includes_path(path) {
        return Err(
            super::mcp_sdk::error("설정된 문서 범위 밖이거나 제외된 Markdown 경로입니다.")
                .with_detail("repository", &scope.repository.full_name),
        );
    }
    if let Some(commit) = args["commit"].as_str() {
        require_sha(commit)?;
        let repo = scope.repository.full_name.clone();
        let github = runtime.build_github_service()?;
        super::mcp_documents::verify_identity(&github, &scope).await?;
        let entries = raw_tree(&github, &repo, commit).await?;
        let document_error = |code, message: &str, reason| {
            AppError::new(code, message)
                .with_detail("reason", reason)
                .with_detail("repository", &repo)
                .with_detail("path", path)
                .with_detail("commit", commit)
        };
        let entry = entries.iter().find(|e| e["path"] == path).ok_or_else(|| {
            document_error(
                crate::error::ErrorCode::DocumentNotFound,
                "지정한 커밋에 요청한 문서가 없습니다. 문서 경로와 커밋 SHA를 확인해 주세요.",
                "document_missing_at_commit",
            )
        })?;
        if entry["type"] != "blob" || !matches!(entry["mode"].as_str(), Some("100644" | "100755")) {
            return Err(document_error(
                crate::error::ErrorCode::DocumentPathInvalid,
                "이 문서는 Git 추적 일반 파일이 아닙니다. 심볼릭 링크·디렉터리는 읽을 수 없습니다.",
                "not_regular_file",
            ));
        }
        let size = entry["size"].as_u64().ok_or_else(|| {
            document_error(
                crate::error::ErrorCode::GithubUnavailable,
                "GitHub 응답에서 문서 크기를 확인할 수 없습니다.",
                "invalid_response",
            )
        })?;
        if size > 1024 * 1024 {
            return Err(document_error(
                crate::error::ErrorCode::DocumentAssetTooLarge,
                "문서가 1MiB 읽기 제한을 초과했습니다.",
                "file_too_large",
            ));
        }
        let markdown = text(&github, &repo, commit, path).await?;
        return Ok(
            json!({"path":path,"repository":repo,"commit":commit,"markdown":markdown,"source":"remote_commit","url":file_url(&repo,commit,path)}),
        );
    }
    let root = runtime.local_document_root(&scope)?;
    super::mcp_documents::local_relative(&scope, &root, path)?;
    let mut value = serde_json::to_value(super::doc_validator::read_scoped_workspace_doc(
        &root, path, &scope,
    )?)
    .map_err(|e| super::mcp_sdk::error(e.to_string()))?;
    value["repository"] = json!(scope.repository.full_name);
    value["published"] = json!(false);
    value["source"] = json!("local_draft");
    Ok(value)
}

pub(super) async fn context(runtime: &AutomationRuntime, args: &Value) -> Result<Value, AppError> {
    if args["number"].as_u64().is_none() && !args["document"].is_object() {
        return Err(super::mcp_sdk::error("Issue 또는 기준 문서가 필요합니다."));
    }
    let github = runtime.build_github_service()?;
    let mut result = json!({"context":runtime.active_context_summary(),"scope":"requested_evidence_only","verificationPerformed":false,"warnings":[]});
    if let Some(number) = args["number"].as_u64() {
        if number == 0 {
            return Err(super::mcp_sdk::error("Issue 번호는 양수여야 합니다."));
        }
        let resolved = if let Some(repo) = args["repository"].as_str() {
            repo.to_owned()
        } else {
            super::mcp_board::resolve_issue_repository(runtime, number).await?
        };
        let repo = allowed_repo(runtime, Some(&resolved), false)?;
        let p: Vec<_> = repo.split('/').collect();
        let issue = github
            .automation_get(&["repos", p[0], p[1], "issues", &number.to_string()], &[])
            .await?;
        result["issue"] = json!({"repository":repo,"number":number,"title":issue["title"],"body":issue["body"],"state":issue["state"],"updatedAt":issue["updated_at"],"url":issue["html_url"]});
        let paths = super::context_pack::extract_referenced_doc_paths(
            issue["body"].as_str().unwrap_or_default(),
        );
        if !paths.is_empty() {
            let docs_repo = runtime
                .active_context_summary()
                .docs_repository_full_name
                .ok_or_else(|| super::mcp_sdk::error("관련 문서 저장소 미설정"))?;
            let docs_repo = allowed_repo(runtime, Some(&docs_repo), false)?;
            let sha = snapshot(&github, &docs_repo, None).await?;
            let mut docs = Vec::new();
            for path in paths.iter().take(5) {
                match read_doc(
                    runtime,
                    &json!({"repository":docs_repo,"path":path,"commit":sha}),
                )
                .await
                {
                    Ok(doc) => docs.push(doc),
                    Err(e) => result["warnings"]
                        .as_array_mut()
                        .unwrap()
                        .push(json!({"source":"linked_document","path":path,"error":e.message})),
                }
            }
            result["linkedDocuments"] =
                json!({"items":docs,"commit":sha,"truncated":paths.len()>5});
        }
        // Linked PRs are read from the Issue's closing references, not inferred from text mentions.
        let linked = linked_prs(&github, &repo, number).await;
        match linked {
            Ok(v) => result["pullRequests"] = v,
            Err(e) => result["warnings"]
                .as_array_mut()
                .unwrap()
                .push(json!({"source":"linked_pull_requests","error":e.message})),
        }
    }
    if args["document"].is_object() {
        let doc = &args["document"];
        if doc
            .as_object()
            .unwrap()
            .keys()
            .any(|k| k != "path" && k != "commit" && k != "repository")
            || !doc["commit"].is_string()
        {
            return Err(super::mcp_sdk::error(
                "문서에는 path와 commit이 필요합니다.",
            ));
        }
        result["document"] = read_doc(runtime, doc).await?;
    }
    if args["code"].is_object() {
        result["code"] = code_evidence(runtime, &github, &args["code"]).await?;
    }
    Ok(result)
}

pub(super) async fn linked_prs(
    github: &crate::github::GithubService,
    repo: &str,
    number: u64,
) -> Result<Value, AppError> {
    let p: Vec<_> = repo.split('/').collect();
    let data = github.graphql_value("query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id closed updatedAt closedByPullRequestsReferences(first:100,includeClosedPrs:true){nodes{number url merged mergedAt headRefOid baseRefName repository{nameWithOwner}} pageInfo{hasNextPage}}}}}",json!({"owner":p[0],"name":p[1],"number":number})).await?;
    let issue = &data["repository"]["issue"];
    if issue.is_null() {
        return Err(super::mcp_sdk::error("Issue 연결 PR을 조회할 수 없습니다."));
    }
    Ok(
        json!({"items":issue["closedByPullRequestsReferences"]["nodes"],"truncated":issue["closedByPullRequestsReferences"]["pageInfo"]["hasNextPage"],"issueNodeId":issue["id"],"closed":issue["closed"],"updatedAt":issue["updatedAt"]}),
    )
}

async fn code_evidence(
    runtime: &AutomationRuntime,
    github: &crate::github::GithubService,
    args: &Value,
) -> Result<Value, AppError> {
    if args.as_object().unwrap().keys().any(|k| {
        ![
            "repository",
            "commit",
            "path",
            "query",
            "pullRequest",
            "offset",
            "limit",
        ]
        .contains(&k.as_str())
    }) {
        return Err(super::mcp_sdk::error("허용되지 않은 코드 조회 입력입니다."));
    }
    let repo = allowed_repo(runtime, args["repository"].as_str(), true)?;
    let (offset, limit) = page(args);
    if let Some(number) = args["pullRequest"].as_u64() {
        let pr = github.get_pull_request(&repo, number).await?;
        if let Some(commit) = args["commit"].as_str() {
            if commit != pr.head_sha {
                return Err(super::mcp_sdk::error(
                    "PR head 커밋이 요청 기준과 달라졌습니다.",
                ));
            }
        }
        let p: Vec<_> = repo.split('/').collect();
        let files = github
            .automation_get(
                &["repos", p[0], p[1], "pulls", &number.to_string(), "files"],
                &[
                    ("per_page", "100".into()),
                    ("page", (offset / 100 + 1).to_string()),
                ],
            )
            .await?;
        let mut items = Vec::new();
        let all = files
            .as_array()
            .ok_or_else(|| super::mcp_sdk::error("PR 파일 응답 형식 오류"))?;
        for file in all.iter().skip(offset % 100).take(limit) {
            let path = file["filename"].as_str().unwrap_or_default();
            if safe_path(path).is_err()
                || file["previous_filename"]
                    .as_str()
                    .is_some_and(|p| safe_path(p).is_err())
            {
                continue;
            }
            items.push(json!({"path":path,"status":file["status"],"patch":file["patch"],"patchMayBeIncomplete":true,"url":format!("https://github.com/{repo}/blob/{}/{path}",pr.head_sha)}));
        }
        let checks = github
            .automation_get(
                &["repos", p[0], p[1], "commits", &pr.head_sha, "check-runs"],
                &[("per_page", "100".into())],
            )
            .await;
        let checks = match checks {
            Ok(v) => json!({"commit":pr.head_sha,"data":v}),
            Err(e) => json!({"commit":pr.head_sha,"error":e.message}),
        };
        let after = github.get_pull_request(&repo, number).await?;
        if after.head_sha != pr.head_sha {
            return Err(super::mcp_sdk::error(
                "조회 중 PR head가 변경되었습니다. 다시 조회하세요.",
            ));
        }
        let consumed = all.len().saturating_sub(offset % 100).min(limit);
        return Ok(
            json!({"repository":repo,"commit":pr.head_sha,"pullRequest":number,"items":items,"checks":checks,"nextOffset":if all.len()==100 || offset%100+consumed<all.len(){Some(offset+consumed)}else{None},"scope":"pull_request_diff","diffMayBeIncomplete":true}),
        );
    }
    let sha = snapshot(github, &repo, args["commit"].as_str()).await?;
    let entries = tree(github, &repo, &sha).await?;
    let path = args["path"].as_str();
    if let Some(path) = path {
        safe_path(path)?;
    }
    let filtered: Vec<_> = entries
        .iter()
        .filter(|e| {
            let Some(p) = e["path"].as_str() else {
                return false;
            };
            safe_path(p).is_ok()
                && path.is_none_or(|wanted| p == wanted || p.starts_with(&format!("{wanted}/")))
        })
        .collect();
    if let Some(path) = path.filter(|wanted| filtered.iter().any(|e| e["path"] == *wanted)) {
        if filtered
            .iter()
            .find(|e| e["path"] == path)
            .and_then(|e| e["size"].as_u64())
            .is_none_or(|size| size > 1024 * 1024)
        {
            return Err(super::mcp_sdk::error("파일 크기 제한을 초과했습니다."));
        }
        let markdown = text(github, &repo, &sha, path).await?;
        let lines: Vec<_> = markdown.lines().collect();
        if let Some(query) = args["query"].as_str() {
            let matches: Vec<_> = lines
                .iter()
                .enumerate()
                .skip(offset)
                .filter(|(_, line)| line.contains(query))
                .take(limit + 1)
                .collect();
            let next = if matches.len() > limit {
                matches.get(limit - 1).map(|(i, _)| i + 1)
            } else {
                None
            };
            return Ok(
                json!({"repository":repo,"commit":sha,"path":path,"matches":matches.iter().take(limit).map(|(i,line)|json!({"line":i+1,"text":line.chars().take(1000).collect::<String>(),"textTruncated":line.chars().count()>1000})).collect::<Vec<_>>(),"nextOffset":next,"scope":"file_text_search"}),
            );
        }
        return Ok(
            json!({"repository":repo,"commit":sha,"path":path,"startLine":offset+1,"content":lines.iter().skip(offset).take(limit).copied().collect::<Vec<_>>().join("\n"),"totalLines":lines.len(),"nextOffset":if offset+limit<lines.len(){Some(offset+limit)}else{None},"url":format!("https://github.com/{repo}/blob/{sha}/{path}"),"scope":"file_excerpt"}),
        );
    }
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for entry in filtered.iter().skip(offset).take(limit) {
        let path = entry["path"].as_str().unwrap();
        if let Some(query) = args["query"].as_str() {
            if entry["size"].as_u64().unwrap_or(u64::MAX) > 1024 * 1024 {
                errors.push(json!({"path":path,"error":"file_too_large"}));
                continue;
            }
            match text(github, &repo, &sha, path).await {
                Ok(source) => {
                    let found: Vec<_> = source
                        .lines()
                        .enumerate()
                        .filter(|(_, l)| l.contains(query))
                        .take(11)
                        .collect();
                    let matches: Vec<_> = found.iter().take(10).map(|(i,l)|json!({"line":i+1,"text":l.chars().take(1000).collect::<String>(),"textTruncated":l.chars().count()>1000})).collect();
                    if !matches.is_empty() {
                        items.push(
                            json!({"path":path,"matches":matches,"matchesMayBeTruncated":found.len()>10}),
                        );
                    }
                }
                Err(e) => errors
                    .push(json!({"path":path,"error":e.message,"code":e.code,"details":e.details})),
            }
        } else {
            items.push(json!({"path":path,"size":entry["size"]}));
        }
    }
    Ok(
        json!({"repository":repo,"commit":sha,"items":items,"errors":errors,"scannedFiles":filtered.len().saturating_sub(offset).min(limit),"totalFiles":filtered.len(),"nextOffset":if offset+limit<filtered.len(){Some(offset+limit)}else{None},"scope":if args["query"].is_string(){"paged_text_search"}else{"file_list"}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::automation_test_support::fixture;

    #[tokio::test]
    async fn mcp_read_error_missing_document_is_distinct_from_size_and_file_type() {
        for (entry, code, reason) in [
            (None, "document_not_found", "document_missing_at_commit"),
            (
                Some(json!({"path":"docs/prd.md","type":"blob","mode":"100644","size":1048577})),
                "document_asset_too_large",
                "file_too_large",
            ),
            (
                Some(json!({"path":"docs/prd.md","type":"blob","mode":"120000","size":10})),
                "document_path_invalid",
                "not_regular_file",
            ),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let (github, _) = fixture(vec![(
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":entry.into_iter().collect::<Vec<_>>(),"truncated":false}),
            )]);
            let e = read_doc(
                &configured_runtime(dir.path(), github),
                &json!({"path":"docs/prd.md","commit":"a".repeat(40)}),
            )
            .await
            .unwrap_err();
            let public = serde_json::to_value(e).unwrap();
            assert_eq!(public["code"], code);
            assert_eq!(public["details"]["reason"], reason);
            assert_eq!(public["details"]["path"], "docs/prd.md");
            assert_eq!(public["details"]["commit"], "a".repeat(40));
        }
    }

    #[tokio::test]
    async fn mcp_read_error_partial_code_search_keeps_permission_category() {
        let dir = tempfile::tempdir().unwrap();
        let (github, _) = crate::github::automation_test_support::fixture_http(vec![
            (
                "/repos/acme/api/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                200,
                json!({"tree":[{"path":"src/a.rs","type":"blob","mode":"100644","size":30}],"truncated":false}),
            ),
            (
                "/repos/acme/api/contents/src/a.rs",
                403,
                json!({"message":"Forbidden"}),
            ),
        ]);
        let runtime = configured_runtime(dir.path(), github);
        let result = code_evidence(
            &runtime,
            &runtime.build_github_service().unwrap(),
            &json!({"repository":"acme/api","commit":"a".repeat(40),"path":"src","query":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["errors"][0]["code"], "github_permission_denied");
        assert_eq!(
            result["errors"][0]["details"]["reason"],
            "permission_denied"
        );
    }

    fn configured_runtime(
        dir: &std::path::Path,
        github: crate::github::GithubService,
    ) -> AutomationRuntime {
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.join("settings")),
            workspace_dir: Some(dir.to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        runtime.ai_context.code_repositories.push(
            crate::settings::ai_runner::LinkedCodeRepoRuleInfo {
                key: "backend".into(),
                label: "Backend".into(),
                full_name: "acme/api".into(),
                local_path: None,
            },
        );
        runtime
    }

    #[tokio::test]
    async fn single_file_search_reports_shortened_lines() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let source = format!("match{}", "x".repeat(1100));
        let (github, _) = fixture(vec![
            (
                "/repos/acme/api/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"path":"src/a.ts","type":"blob","mode":"100644","size":source.len()}],"truncated":false}),
            ),
            (
                "/repos/acme/api/contents/src/a.ts",
                json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(source)}),
            ),
        ]);
        let runtime = configured_runtime(dir.path(), github);
        let result=code_evidence(&runtime,&runtime.build_github_service().unwrap(),&json!({"repository":"acme/api","commit":"a".repeat(40),"path":"src/a.ts","query":"match"})).await.unwrap();
        assert_eq!(result["matches"][0]["textTruncated"], true);
        assert!(result["nextOffset"].is_null());
    }

    #[tokio::test]
    async fn document_only_context_reads_pinned_code_without_an_issue() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let document = "# API\nPOST /login";
        let implementation = "export function login() {\nreturn response;\n}";
        let (github, requests) = fixture(vec![
            (
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"path":"docs/api.md","type":"blob","mode":"100644","size":document.len()}],"truncated":false}),
            ),
            (
                "/repos/acme/docs/contents/docs/api.md",
                json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(document)}),
            ),
            (
                "/repos/acme/api/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"path":"src/login.ts","type":"blob","mode":"100644","size":implementation.len()}],"truncated":false}),
            ),
            (
                "/repos/acme/api/contents/src/login.ts",
                json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(implementation)}),
            ),
        ]);
        let runtime = configured_runtime(dir.path(), github);
        let result=context(&runtime,&json!({"document":{"path":"docs/api.md","commit":"a".repeat(40)},"code":{"repository":"acme/api","commit":"a".repeat(40),"path":"src/login.ts","offset":1,"limit":1}})).await.unwrap();
        assert_eq!(result["document"]["markdown"], document);
        assert_eq!(result["code"]["content"], "return response;");
        assert_eq!(result["code"]["startLine"], 2);
        assert_eq!(result["code"]["nextOffset"], 2);
        assert_eq!(result["verificationPerformed"], false);
        assert!(requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(url, _)| url.contains("/contents/"))
            .all(|(url, _)| url.contains(&format!("ref={}", "a".repeat(40)))));
    }

    #[tokio::test]
    async fn pr_file_pagination_does_not_skip_at_hundred_file_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let sha = "a".repeat(40);
        let pr = json!({"number":3,"title":"Feature","html_url":"https://github.com/acme/api/pull/3","user":{"login":"dev"},"head":{"ref":"feature","sha":sha},"base":{"ref":"main","sha":"b".repeat(40)}});
        let files:Vec<_>=(0..100).map(|i|json!({"filename":format!("src/file{i}.ts"),"status":"modified","patch":"+updated"})).collect();
        let (github, _) = fixture(vec![
            ("/repos/acme/api/pulls/3", pr.clone()),
            ("/repos/acme/api/pulls/3/files", json!(files)),
            (
                "/repos/acme/api/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs",
                json!({"total_count":0,"check_runs":[]}),
            ),
            ("/repos/acme/api/pulls/3", pr),
        ]);
        let runtime = configured_runtime(dir.path(), github.clone());
        let result = code_evidence(
            &runtime,
            &github,
            &json!({"repository":"acme/api","pullRequest":3,"offset":90,"limit":30}),
        )
        .await
        .unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 10);
        assert_eq!(result["nextOffset"], 100);
    }

    #[tokio::test]
    async fn continuation_uses_prior_published_commit_after_default_branch_moves() {
        let dir = tempfile::tempdir().unwrap();
        let prior = "a".repeat(40);
        let latest = "b".repeat(40);
        let (github,_)=fixture(vec![("/repos/acme/docs",json!({"default_branch":"main"})),("/repos/acme/docs/commits/main",json!({"sha":latest})),("/repos/acme/docs/compare/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",json!({"status":"ahead"})),("/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",json!({"tree":[],"truncated":false}))]);
        let runtime = configured_runtime(dir.path(), github);
        let result = list_docs(
            &runtime,
            &json!({"published":true,"commit":prior,"offset":5}),
        )
        .await
        .unwrap();
        assert_eq!(result["commit"], prior);
        assert_eq!(result["currentDefaultCommit"], latest);
    }

    #[tokio::test]
    async fn partial_graphql_mutation_errors_are_ambiguous_not_safe_to_replay() {
        let (github, _) = fixture(vec![(
            "/graphql",
            json!({"data":{"createIssue":{"issue":{"id":"I"}}},"errors":[{"type":"FORBIDDEN","message":"some result field forbidden"}]}),
        )]);
        let result = github
            .graphql_value(
                "mutation { createIssue(input:{repositoryId:\"R\",title:\"A\"}){issue{id}} }",
                json!({}),
            )
            .await
            .unwrap_err();
        assert_eq!(result.code, crate::error::ErrorCode::GithubUnavailable);
        assert_eq!(
            result.details.get("mutationOutcome").map(String::as_str),
            Some("unknown")
        );
    }

    #[tokio::test]
    async fn published_list_and_read_keep_the_default_branch_snapshot() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        let sha = "a".repeat(40);
        let markdown = "---\ntype: Product Spec\n---\n# Approved";
        let file = json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode(markdown)});
        let (github, requests) = fixture(vec![
            ("/repos/acme/docs", json!({"default_branch":"main"})),
            ("/repos/acme/docs/commits/main", json!({"sha":sha})),
            (
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"type":"blob","mode":"100644","path":"docs/spec.md","size":50}],"truncated":false}),
            ),
            ("/repos/acme/docs/contents/docs/spec.md", file.clone()),
            (
                "/repos/acme/docs/commits",
                json!([{"sha":"b".repeat(40),"commit":{"committer":{"date":"2026-11-19T00:00:00Z"}}}]),
            ),
            (
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"type":"blob","mode":"100644","path":"docs/spec.md","size":50}],"truncated":false}),
            ),
            ("/repos/acme/docs/contents/docs/spec.md", file),
        ]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().join("settings")),
            workspace_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        let list = list_docs(&runtime, &json!({"published":true,"type":"Product Spec"}))
            .await
            .unwrap();
        assert_eq!(list["commit"], sha);
        assert_eq!(list["items"][0]["lastChangedCommit"], "b".repeat(40));
        let doc = read_doc(
            &runtime,
            &json!({"path":"docs/spec.md","commit":list["commit"]}),
        )
        .await
        .unwrap();
        assert_eq!(doc["markdown"], markdown);
        let requests = requests.lock().unwrap();
        assert!(requests
            .iter()
            .filter(|(url, _)| url.contains("/contents/"))
            .all(|(url, _)| url.contains(&format!("ref={sha}"))));
    }
    #[test]
    fn planning_type_and_legacy_names_do_not_override_explicit_or_invalid_frontmatter() {
        assert!(is_planning(
            "docs/a.md",
            "---\ntype: Product Spec\n---\n# A"
        ));
        assert!(is_planning("docs/prd.md", "# Legacy"));
        assert!(is_planning("docs/login-prd.md", "# Legacy"));
        assert!(!is_planning(
            "docs/prd.md",
            "---\ntype: API Spec\n---\n# API"
        ));
        assert!(!is_planning("docs/prd.md", "---\ntype: [broken\n---\n"));
        assert!(!is_planning("docs/notes.md", "# Product Spec"));
    }

    #[tokio::test]
    async fn omitted_doc_options_read_remote_planning_not_local_drafts() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("docs/draft-prd.md"), "# Local draft").unwrap();
        let (github, requests) = fixture(vec![
            ("/repos/acme/docs", json!({"default_branch":"main"})),
            (
                "/repos/acme/docs/commits/main",
                json!({"sha":"a".repeat(40)}),
            ),
            (
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[],"truncated":false}),
            ),
        ]);
        let runtime = configured_runtime(dir.path(), github);
        let result = list_docs(&runtime, &json!({})).await.unwrap();
        assert_eq!(result["published"], true);
        assert_eq!(result["items"], json!([]));
        assert_eq!(result["commit"], "a".repeat(40));
        assert_eq!(requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn planning_mode_rejects_another_type_but_explicit_local_keeps_all_types() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        std::fs::write(
            dir.path().join("docs/api.md"),
            "---\ntype: API Spec\n---\n# API",
        )
        .unwrap();
        let (github, _) = fixture(vec![]);
        let runtime = configured_runtime(dir.path(), github);
        assert!(
            list_docs(&runtime, &json!({"mode":"planning","type":"API Spec"}))
                .await
                .is_err()
        );
        let local = list_docs(&runtime, &json!({"published":false}))
            .await
            .unwrap();
        assert_eq!(local["items"].as_array().unwrap().len(), 1);
        assert_eq!(local["published"], false);
    }

    #[tokio::test]
    async fn repository_root_document_scope_can_read_a_pinned_root_markdown_file() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let (github, _) = fixture(vec![
            (
                "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                json!({"tree":[{"path":"prd.md","type":"blob","mode":"100644","size":10}],"truncated":false}),
            ),
            (
                "/repos/acme/docs/contents/prd.md",
                json!({"encoding":"base64","content":base64::engine::general_purpose::STANDARD.encode("# Product")}),
            ),
        ]);
        let mut runtime = configured_runtime(dir.path(), github);
        runtime.mcp_document_roots = Some(vec![".".into()]);
        let doc = read_doc(&runtime, &json!({"path":"prd.md","commit":"a".repeat(40)}))
            .await
            .unwrap();
        assert_eq!(doc["markdown"], "# Product");
    }

    #[test]
    fn paths_cannot_escape_or_read_credentials() {
        for path in [
            "../secret",
            "/etc/passwd",
            "src/../../secret",
            "a\\..\\secret",
            ".env",
            "config/.env.production",
            "keys/id_rsa",
            "cert.pem",
            ".git/config",
            "config/credentials.json",
            ".npmrc",
            ".netrc",
        ] {
            assert!(safe_path(path).is_err(), "{path}");
        }
        assert!(safe_path("src/api/login.ts").is_ok());
        assert!(safe_path("docs/api.md").is_ok());
        assert_eq!(
            relative_git_path(std::path::Path::new("docs/api.md")).unwrap(),
            "docs/api.md"
        );
        #[cfg(unix)]
        assert!(relative_git_path(std::path::Path::new("docs\\outside.md")).is_err());
        #[cfg(windows)]
        assert_eq!(
            relative_git_path(std::path::Path::new("docs\\api.md")).unwrap(),
            "docs/api.md"
        );
    }

    #[tokio::test]
    async fn document_scope_is_markdown_under_configured_roots_and_repo_case_is_canonical() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("docs")).unwrap();
        std::fs::write(dir.path().join("README.md"), "outside docs").unwrap();
        std::fs::write(dir.path().join("docs/config.txt"), "not markdown").unwrap();
        let runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().join("settings")),
            workspace_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        assert!(read_doc(&runtime, &json!({"path":"README.md"}))
            .await
            .is_err());
        assert!(read_doc(&runtime, &json!({"path":"docs/config.txt"}))
            .await
            .is_err());
        assert_eq!(
            allowed_repo(&runtime, Some("ACME/DOCS"), false).unwrap(),
            "acme/docs"
        );
    }

    #[tokio::test]
    async fn remote_document_read_rejects_symlinks_before_content_access() {
        let dir = tempfile::tempdir().unwrap();
        let (github, requests) = fixture(vec![(
            "/repos/acme/docs/git/trees/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            json!({"tree":[{"path":"docs/spec.md","mode":"120000","type":"blob","size":20}],"truncated":false}),
        )]);
        let mut runtime = AutomationRuntime::load(&super::super::AutomationOverrides {
            app_data_dir: Some(dir.path().join("settings")),
            workspace_dir: Some(dir.path().to_path_buf()),
            docs_repo: Some("acme/docs".into()),
            ..Default::default()
        })
        .unwrap();
        runtime.test_github = Some(github);
        assert!(read_doc(
            &runtime,
            &json!({"path":"docs/spec.md","commit":"a".repeat(40)})
        )
        .await
        .is_err());
        assert_eq!(requests.lock().unwrap().len(), 1);
    }
}
