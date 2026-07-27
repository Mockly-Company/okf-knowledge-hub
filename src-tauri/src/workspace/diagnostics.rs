use std::collections::HashSet;

use serde_yaml_ng::Value;
use uuid::{Uuid, Variant, Version};

use crate::workspace::model::WorkspaceConfigV1;
use crate::workspace::validation::{
    WorkspaceDiagnostic as ValidationDiagnostic,
    WorkspaceDiagnosticCode as ValidationDiagnosticCode,
};

use super::contract::{WorkspaceDiagnostic, WorkspaceDiagnosticCode, WorkspaceSummary};
use super::path_safety::is_outside_repository_path;

impl From<ValidationDiagnostic> for WorkspaceDiagnostic {
    fn from(item: ValidationDiagnostic) -> Self {
        Self {
            code: match item.code {
                ValidationDiagnosticCode::WorkspaceIdNotV4 => {
                    WorkspaceDiagnosticCode::WorkspaceIdNotV4
                }
                ValidationDiagnosticCode::WorkspaceNameEmpty => {
                    WorkspaceDiagnosticCode::WorkspaceNameEmpty
                }
                ValidationDiagnosticCode::DocumentRootsMissing => {
                    WorkspaceDiagnosticCode::DocumentRootsMissing
                }
                ValidationDiagnosticCode::DocumentRootEmpty => {
                    WorkspaceDiagnosticCode::DocumentRootEmpty
                }
                ValidationDiagnosticCode::DocumentRootOutsideRepository => {
                    WorkspaceDiagnosticCode::DocumentRootOutsideRepository
                }
                ValidationDiagnosticCode::DuplicateRepositoryKey => {
                    WorkspaceDiagnosticCode::DuplicateRepositoryKey
                }
                ValidationDiagnosticCode::DuplicateRepositoryLabel => {
                    WorkspaceDiagnosticCode::DuplicateRepositoryLabel
                }
                ValidationDiagnosticCode::RepositoryKeyEmpty => {
                    WorkspaceDiagnosticCode::RepositoryKeyEmpty
                }
                ValidationDiagnosticCode::RepositoryKeyInvalid => {
                    WorkspaceDiagnosticCode::RepositoryKeyInvalid
                }
                ValidationDiagnosticCode::RepositoryGithubIdMissing => {
                    WorkspaceDiagnosticCode::RepositoryGithubIdMissing
                }
                ValidationDiagnosticCode::GithubProjectIdMissing => {
                    WorkspaceDiagnosticCode::GithubProjectIdMissing
                }
            },
            path: item.path,
            message: item.message,
            value: None,
        }
    }
}

impl From<&WorkspaceConfigV1> for WorkspaceSummary {
    fn from(config: &WorkspaceConfigV1) -> Self {
        Self {
            id: config.workspace.id,
            name: config.workspace.name.clone(),
            schema_version: config.schema_version,
            document_roots: config
                .documents
                .roots
                .iter()
                .map(|root| root.path.clone())
                .collect(),
            repository_count: config.repositories.len(),
        }
    }
}

pub(super) fn schema_version(value: &Value) -> Option<u64> {
    value.get("schema_version").and_then(Value::as_u64)
}

pub(super) fn structural_diagnostics(value: &Value) -> Vec<WorkspaceDiagnostic> {
    let mut diagnostics = Vec::new();
    diagnose_workspace_fields(value.get("workspace"), &mut diagnostics);
    diagnose_document_fields(value.get("documents"), &mut diagnostics);
    diagnose_repository_fields(value.get("repositories"), &mut diagnostics);
    diagnose_project_fields(value.get("github"), &mut diagnostics);

    diagnostics
}

fn diagnose_workspace_fields(
    workspace: Option<&Value>,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) {
    let Some(workspace) = workspace else {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceIdMissing,
            "workspace.id",
            "workspace.id가 필요합니다.",
        ));
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceNameMissing,
            "workspace.name",
            "workspace.name이 필요합니다.",
        ));
        return;
    };
    if !workspace.is_mapping() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceTypeInvalid,
            "workspace",
            "workspace는 객체여야 합니다.",
        ));
        return;
    }

    match workspace.get("id") {
        None => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceIdMissing,
            "workspace.id",
            "workspace.id가 필요합니다.",
        )),
        Some(Value::String(id)) => {
            let parsed = Uuid::parse_str(id).ok();
            if parsed.is_none_or(|id| {
                id.get_version() != Some(Version::Random) || id.get_variant() != Variant::RFC4122
            }) {
                diagnostics.push(diagnostic(
                    WorkspaceDiagnosticCode::WorkspaceIdNotV4,
                    "workspace.id",
                    "workspace.id는 UUID v4여야 합니다.",
                ));
            }
        }
        Some(_) => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceIdTypeInvalid,
            "workspace.id",
            "workspace.id는 문자열이어야 합니다.",
        )),
    }

    match workspace.get("name") {
        None => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceNameMissing,
            "workspace.name",
            "workspace.name이 필요합니다.",
        )),
        Some(Value::String(name)) if name.trim().is_empty() => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceNameEmpty,
            "workspace.name",
            "workspace.name은 비어 있을 수 없습니다.",
        )),
        Some(Value::String(_)) => {}
        Some(_) => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::WorkspaceNameTypeInvalid,
            "workspace.name",
            "workspace.name은 문자열이어야 합니다.",
        )),
    }
}

fn diagnose_document_fields(documents: Option<&Value>, diagnostics: &mut Vec<WorkspaceDiagnostic>) {
    let Some(documents) = documents else {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentRootsMissing,
            "documents.roots",
            "documents.roots가 필요합니다.",
        ));
        return;
    };
    if !documents.is_mapping() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentsTypeInvalid,
            "documents",
            "documents는 객체여야 합니다.",
        ));
        return;
    }

    let roots = match documents.get("roots") {
        None => {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootsMissing,
                "documents.roots",
                "documents.roots가 필요합니다.",
            ));
            return;
        }
        Some(Value::Sequence(roots)) => roots,
        Some(_) => {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootsTypeInvalid,
                "documents.roots",
                "documents.roots는 배열이어야 합니다.",
            ));
            return;
        }
    };
    if roots.is_empty() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::DocumentRootsMissing,
            "documents.roots",
            "documents.roots에는 하나 이상의 문서 루트가 필요합니다.",
        ));
    }
    for (index, root) in roots.iter().enumerate() {
        let base = format!("documents.roots[{index}]");
        if !root.is_mapping() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootTypeInvalid,
                base,
                "문서 루트는 객체여야 합니다.",
            ));
            continue;
        }
        match root.get("path") {
            None => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootPathMissing,
                format!("{base}.path"),
                "문서 루트 path가 필요합니다.",
            )),
            Some(Value::String(path)) if path.trim().is_empty() => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootEmpty,
                format!("{base}.path"),
                "문서 루트 경로는 비어 있을 수 없습니다.",
            )),
            Some(Value::String(path)) if is_outside_repository_path(path) => {
                diagnostics.push(diagnostic(
                    WorkspaceDiagnosticCode::DocumentRootOutsideRepository,
                    format!("{base}.path"),
                    "문서 루트는 저장소 내부의 상대 경로여야 합니다.",
                ));
            }
            Some(Value::String(_)) => {}
            Some(_) => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootPathTypeInvalid,
                format!("{base}.path"),
                "문서 루트 path는 문자열이어야 합니다.",
            )),
        }
    }
}

fn diagnose_repository_fields(
    repositories: Option<&Value>,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) {
    let Some(repositories) = repositories else {
        return;
    };
    let Value::Sequence(repositories) = repositories else {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::RepositoriesTypeInvalid,
            "repositories",
            "repositories는 배열이어야 합니다.",
        ));
        return;
    };

    let mut repository_keys = HashSet::new();
    let mut repository_labels = HashSet::new();
    for (index, repository) in repositories.iter().enumerate() {
        let base = format!("repositories[{index}]");
        if !repository.is_mapping() {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryTypeInvalid,
                base,
                "repository 항목은 객체여야 합니다.",
            ));
            continue;
        }

        match repository.get("key") {
            None => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryKeyMissing,
                format!("{base}.key"),
                "저장소 key가 필요합니다.",
            )),
            Some(Value::String(key)) => {
                if key.trim().is_empty() {
                    diagnostics.push(diagnostic(
                        WorkspaceDiagnosticCode::RepositoryKeyEmpty,
                        format!("{base}.key"),
                        "저장소 key는 비어 있을 수 없습니다.",
                    ));
                } else if !is_valid_repository_key(key) {
                    diagnostics.push(diagnostic(
                        WorkspaceDiagnosticCode::RepositoryKeyInvalid,
                        format!("{base}.key"),
                        "저장소 key는 소문자로 시작하고 소문자, 숫자, _, -만 사용할 수 있습니다.",
                    ));
                }
                if !repository_keys.insert(key) {
                    diagnostics.push(diagnostic(
                        WorkspaceDiagnosticCode::DuplicateRepositoryKey,
                        format!("{base}.key"),
                        "저장소 key는 워크스페이스 안에서 고유해야 합니다.",
                    ));
                }
            }
            Some(_) => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryKeyTypeInvalid,
                format!("{base}.key"),
                "저장소 key는 문자열이어야 합니다.",
            )),
        }

        match repository.get("label") {
            None => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryLabelMissing,
                format!("{base}.label"),
                "저장소 label이 필요합니다.",
            )),
            Some(Value::String(label)) => {
                if !repository_labels.insert(label) {
                    diagnostics.push(diagnostic(
                        WorkspaceDiagnosticCode::DuplicateRepositoryLabel,
                        format!("{base}.label"),
                        "저장소 label은 워크스페이스 안에서 고유해야 합니다.",
                    ));
                }
            }
            Some(_) => diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::RepositoryLabelTypeInvalid,
                format!("{base}.label"),
                "저장소 label은 문자열이어야 합니다.",
            )),
        }

        diagnose_repository_github_fields(repository.get("github"), &base, diagnostics);
    }
}

fn diagnose_repository_github_fields(
    github: Option<&Value>,
    repository_base: &str,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) {
    let Some(github) = github else {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::RepositoryGithubMissing,
            format!("{repository_base}.github"),
            "저장소 github 객체가 필요합니다.",
        ));
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::RepositoryGithubIdMissing,
            format!("{repository_base}.github.id"),
            "GitHub 저장소 Node ID가 필요합니다.",
        ));
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing,
            format!("{repository_base}.github.full_name"),
            "GitHub 저장소 full_name이 필요합니다.",
        ));
        return;
    };
    if !github.is_mapping() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::RepositoryGithubTypeInvalid,
            format!("{repository_base}.github"),
            "저장소 github는 객체여야 합니다.",
        ));
        return;
    }

    diagnose_required_string(
        github.get("id"),
        WorkspaceDiagnosticCode::RepositoryGithubIdMissing,
        WorkspaceDiagnosticCode::RepositoryGithubIdTypeInvalid,
        format!("{repository_base}.github.id"),
        "GitHub 저장소 Node ID가 필요합니다.",
        "GitHub 저장소 Node ID는 문자열이어야 합니다.",
        true,
        diagnostics,
    );
    diagnose_required_string(
        github.get("full_name"),
        WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing,
        WorkspaceDiagnosticCode::RepositoryGithubFullNameTypeInvalid,
        format!("{repository_base}.github.full_name"),
        "GitHub 저장소 full_name이 필요합니다.",
        "GitHub 저장소 full_name은 문자열이어야 합니다.",
        false,
        diagnostics,
    );
}

fn diagnose_project_fields(github: Option<&Value>, diagnostics: &mut Vec<WorkspaceDiagnostic>) {
    let Some(github) = github else {
        return;
    };
    if github.is_null() {
        return;
    }
    if !github.is_mapping() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::GithubTypeInvalid,
            "github",
            "github는 객체여야 합니다.",
        ));
        return;
    }
    let Some(project) = github.get("project") else {
        return;
    };
    if project.is_null() {
        return;
    }
    if !project.is_mapping() {
        diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::GithubProjectTypeInvalid,
            "github.project",
            "github.project는 객체여야 합니다.",
        ));
        return;
    }

    diagnose_required_string(
        project.get("id"),
        WorkspaceDiagnosticCode::GithubProjectIdMissing,
        WorkspaceDiagnosticCode::GithubProjectIdTypeInvalid,
        "github.project.id",
        "GitHub Project Node ID가 필요합니다.",
        "GitHub Project Node ID는 문자열이어야 합니다.",
        true,
        diagnostics,
    );
    diagnose_required_string(
        project.get("owner"),
        WorkspaceDiagnosticCode::GithubProjectOwnerMissing,
        WorkspaceDiagnosticCode::GithubProjectOwnerTypeInvalid,
        "github.project.owner",
        "GitHub Project owner가 필요합니다.",
        "GitHub Project owner는 문자열이어야 합니다.",
        false,
        diagnostics,
    );
    match project.get("number") {
        None => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::GithubProjectNumberMissing,
            "github.project.number",
            "GitHub Project number가 필요합니다.",
        )),
        Some(number) if number.as_u64().is_some() => {}
        Some(_) => diagnostics.push(diagnostic(
            WorkspaceDiagnosticCode::GithubProjectNumberTypeInvalid,
            "github.project.number",
            "GitHub Project number는 0 이상의 정수여야 합니다.",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn diagnose_required_string(
    value: Option<&Value>,
    missing_code: WorkspaceDiagnosticCode,
    type_code: WorkspaceDiagnosticCode,
    path: impl Into<String>,
    missing_message: &str,
    type_message: &str,
    empty_is_missing: bool,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) {
    let path = path.into();
    match value {
        None => diagnostics.push(diagnostic(missing_code, path, missing_message)),
        Some(Value::String(value)) if empty_is_missing && value.trim().is_empty() => {
            diagnostics.push(diagnostic(missing_code, path, missing_message));
        }
        Some(Value::String(_)) => {}
        Some(_) => diagnostics.push(diagnostic(type_code, path, type_message)),
    }
}

fn is_valid_repository_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    matches!(bytes.first(), Some(b'a'..=b'z'))
        && bytes[1..]
            .iter()
            .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

pub(super) fn diagnostic(
    code: WorkspaceDiagnosticCode,
    path: impl Into<String>,
    message: impl Into<String>,
) -> WorkspaceDiagnostic {
    WorkspaceDiagnostic {
        code,
        path: path.into(),
        message: message.into(),
        value: None,
    }
}
