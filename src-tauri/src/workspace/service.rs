use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;
use uuid::{Uuid, Variant, Version};

use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::workspace::model::{
    DocumentRoot, DocumentsConfig, WorkspaceConfigV1, WorkspaceDocument, WorkspaceIdentity,
};
use crate::workspace::validation::{
    validate_workspace, WorkspaceDiagnostic as ValidationDiagnostic,
    WorkspaceDiagnosticCode as ValidationDiagnosticCode,
};

pub struct WorkspaceService;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkspaceInspection {
    Ready {
        summary: WorkspaceSummary,
    },
    InitializationRequired,
    Invalid {
        diagnostics: Vec<WorkspaceDiagnostic>,
    },
    UnsupportedVersion {
        found_version: u64,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: Uuid,
    pub name: String,
    pub document_roots: Vec<String>,
    pub repository_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceDiagnosticCode {
    WorkspaceYamlInvalid,
    WorkspaceStructureInvalid,
    SchemaVersionInvalid,
    WorkspaceTypeInvalid,
    WorkspaceIdMissing,
    WorkspaceIdTypeInvalid,
    WorkspaceIdNotV4,
    WorkspaceNameMissing,
    WorkspaceNameTypeInvalid,
    WorkspaceNameEmpty,
    DocumentsTypeInvalid,
    DocumentRootsMissing,
    DocumentRootsTypeInvalid,
    DocumentRootTypeInvalid,
    DocumentRootPathMissing,
    DocumentRootPathTypeInvalid,
    DocumentRootEmpty,
    DocumentRootOutsideRepository,
    RepositoriesTypeInvalid,
    RepositoryTypeInvalid,
    DuplicateRepositoryKey,
    DuplicateRepositoryLabel,
    RepositoryKeyMissing,
    RepositoryKeyTypeInvalid,
    RepositoryKeyEmpty,
    RepositoryKeyInvalid,
    RepositoryLabelMissing,
    RepositoryLabelTypeInvalid,
    RepositoryGithubMissing,
    RepositoryGithubTypeInvalid,
    RepositoryGithubIdMissing,
    RepositoryGithubIdTypeInvalid,
    RepositoryGithubFullNameMissing,
    RepositoryGithubFullNameTypeInvalid,
    GithubTypeInvalid,
    GithubProjectTypeInvalid,
    GithubProjectIdMissing,
    GithubProjectIdTypeInvalid,
    GithubProjectOwnerMissing,
    GithubProjectOwnerTypeInvalid,
    GithubProjectNumberMissing,
    GithubProjectNumberTypeInvalid,
    UnknownRepositoryKey,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiagnostic {
    pub code: WorkspaceDiagnosticCode,
    pub path: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InitializationPreview {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub workspace_name: String,
    pub repository_fingerprint: String,
    pub branch: String,
    pub commit_message: String,
    pub strategy: InitializationStrategy,
    pub files: Vec<PreviewFile>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RepositoryPopulation {
    Empty { default_branch: String },
    ExistingContent { default_branch: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InitializationStrategy {
    DirectPush,
    DraftPullRequest { base_branch: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub content: String,
    pub overwrites_existing: bool,
}

#[derive(Debug, Default)]
pub struct PreviewRegistry {
    previews: Mutex<HashMap<Uuid, InitializationPreview>>,
}

impl PreviewRegistry {
    pub fn insert(&self, preview: InitializationPreview) -> Result<(), AppError> {
        let mut previews = self
            .previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match previews.entry(preview.id) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(preview);
                Ok(())
            }
            std::collections::hash_map::Entry::Occupied(entry) => Err(AppError::new(
                ErrorCode::WorkspaceChangedSincePreview,
                "같은 ID의 초기화 미리보기가 이미 등록되어 있습니다.",
            )
            .with_detail("previewId", entry.key().to_string())),
        }
    }

    pub fn get(&self, id: Uuid) -> Option<InitializationPreview> {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&id)
            .cloned()
    }

    pub fn remove(&self, id: Uuid) -> Option<InitializationPreview> {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&id)
    }

    pub fn clear(&self) {
        self.previews
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }
}

impl WorkspaceService {
    pub fn inspect(repository_path: &Path) -> Result<WorkspaceInspection, AppError> {
        let repository_root = canonical_repository_root(repository_path)?;
        let workspace_path = repository_root.join(".okf/workspace.yml");
        let metadata = match fs::symlink_metadata(&workspace_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(WorkspaceInspection::InitializationRequired);
            }
            Err(error) => return Err(workspace_io_error(&workspace_path, error)),
        };

        if !metadata.is_file() && !metadata.file_type().is_symlink() {
            return Ok(WorkspaceInspection::Invalid {
                diagnostics: vec![diagnostic(
                    WorkspaceDiagnosticCode::WorkspaceYamlInvalid,
                    ".okf/workspace.yml",
                    "워크스페이스 설정 경로가 일반 파일이 아닙니다.",
                )],
            });
        }

        let canonical_workspace_path = match workspace_path.canonicalize() {
            Ok(path) if path.starts_with(&repository_root) => path,
            Ok(_) => {
                return Ok(WorkspaceInspection::Invalid {
                    diagnostics: vec![diagnostic(
                        WorkspaceDiagnosticCode::DocumentRootOutsideRepository,
                        ".okf/workspace.yml",
                        "워크스페이스 설정은 저장소 내부에 있어야 합니다.",
                    )],
                });
            }
            Err(error) => return Err(workspace_io_error(&workspace_path, error)),
        };

        let source = fs::read_to_string(&canonical_workspace_path)
            .map_err(|error| workspace_io_error(&workspace_path, error))?;
        let value: Value = match serde_yaml_ng::from_str(&source) {
            Ok(value) => value,
            Err(error) => {
                return Ok(WorkspaceInspection::Invalid {
                    diagnostics: vec![diagnostic(
                        WorkspaceDiagnosticCode::WorkspaceYamlInvalid,
                        ".okf/workspace.yml",
                        error.to_string(),
                    )],
                });
            }
        };

        match schema_version(&value) {
            Some(version) if version > 1 => {
                return Ok(WorkspaceInspection::UnsupportedVersion {
                    found_version: version,
                });
            }
            Some(1) => {}
            _ => {
                return Ok(WorkspaceInspection::Invalid {
                    diagnostics: vec![diagnostic(
                        WorkspaceDiagnosticCode::SchemaVersionInvalid,
                        "schema_version",
                        "schema_version은 정수 1이어야 합니다.",
                    )],
                });
            }
        }

        let document = match WorkspaceDocument::parse(&source) {
            Ok(document) => document,
            Err(error) => {
                let mut diagnostics = vec![diagnostic(
                    WorkspaceDiagnosticCode::WorkspaceStructureInvalid,
                    ".okf/workspace.yml",
                    error.message,
                )];
                diagnostics.extend(structural_diagnostics(&value));
                inspect_raw_document_references(&repository_root, &value, &mut diagnostics)?;
                return Ok(WorkspaceInspection::Invalid { diagnostics });
            }
        };

        let mut diagnostics = validate_workspace(&document.config)
            .into_iter()
            .map(WorkspaceDiagnostic::from)
            .collect::<Vec<_>>();
        inspect_document_references(&repository_root, &document.config, &mut diagnostics)?;

        if diagnostics.is_empty() {
            Ok(WorkspaceInspection::Ready {
                summary: WorkspaceSummary::from(&document.config),
            })
        } else {
            Ok(WorkspaceInspection::Invalid { diagnostics })
        }
    }

    pub fn create_initialization_preview(
        repository_path: &Path,
        workspace_name: &str,
        repository_fingerprint: &str,
        population: RepositoryPopulation,
    ) -> Result<InitializationPreview, AppError> {
        let repository_root = canonical_repository_root(repository_path)?;
        if workspace_name.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::WorkspaceInvalid,
                "워크스페이스 이름은 비어 있을 수 없습니다.",
            ));
        }

        let workspace_id = Uuid::new_v4();

        // Task 7 must repeat this same containment check immediately before
        // creating files, because parents can change after preview creation.
        for path in [
            ".okf/workspace.yml",
            ".okf/templates/.gitkeep",
            "docs/.gitkeep",
        ] {
            validate_preview_path(&repository_root, path)?;
        }

        let workspace_content = generated_workspace_content(workspace_id, workspace_name)?;
        let mut files = Vec::new();

        push_missing_file(
            &repository_root,
            ".okf/workspace.yml",
            workspace_content,
            &mut files,
        )?;
        push_marker_for_empty_directory(
            &repository_root,
            ".okf/templates",
            ".okf/templates/.gitkeep",
            &mut files,
        )?;
        push_marker_for_empty_directory(&repository_root, "docs", "docs/.gitkeep", &mut files)?;

        let (branch, strategy) = match population {
            RepositoryPopulation::Empty { default_branch } => {
                (default_branch, InitializationStrategy::DirectPush)
            }
            RepositoryPopulation::ExistingContent { default_branch } => (
                "okf/init-workspace".into(),
                InitializationStrategy::DraftPullRequest {
                    base_branch: default_branch,
                },
            ),
        };

        Ok(InitializationPreview {
            id: Uuid::new_v4(),
            workspace_id,
            workspace_name: workspace_name.to_owned(),
            repository_fingerprint: repository_fingerprint.to_owned(),
            branch,
            commit_message: "chore: initialize OkHub workspace".into(),
            strategy,
            files,
        })
    }

    pub fn validate_preview_paths(
        repository_path: &Path,
        files: &[PreviewFile],
    ) -> Result<(), AppError> {
        let repository_root = canonical_repository_root(repository_path)?;
        for file in files {
            validate_preview_path(&repository_root, &file.path)?;
        }
        Ok(())
    }

    pub(crate) fn validate_generated_initialization_preview(
        preview: &InitializationPreview,
    ) -> Result<(), AppError> {
        if preview.id.get_version_num() != 4
            || preview.workspace_id.get_version_num() != 4
            || preview.workspace_name.trim().is_empty()
            || preview.commit_message != "chore: initialize OkHub workspace"
            || preview.files.is_empty()
        {
            return Err(invalid_generated_preview());
        }
        let workspace_content =
            generated_workspace_content(preview.workspace_id, &preview.workspace_name)?;
        let mut seen = std::collections::HashSet::new();
        for file in &preview.files {
            let expected_content = match file.path.as_str() {
                ".okf/workspace.yml" => workspace_content.as_str(),
                ".okf/templates/.gitkeep" | "docs/.gitkeep" => "",
                _ => return Err(invalid_generated_preview()),
            };
            if file.overwrites_existing
                || file.content != expected_content
                || !seen.insert(file.path.as_str())
            {
                return Err(invalid_generated_preview());
            }
        }
        if !seen.contains(".okf/workspace.yml") {
            return Err(invalid_generated_preview());
        }
        Ok(())
    }
}

fn generated_workspace_content(
    workspace_id: Uuid,
    workspace_name: &str,
) -> Result<String, AppError> {
    let config = WorkspaceConfigV1 {
        schema_version: 1,
        workspace: WorkspaceIdentity {
            id: workspace_id,
            name: workspace_name.to_owned(),
            extra: Default::default(),
        },
        documents: DocumentsConfig {
            roots: vec![DocumentRoot {
                path: "docs".into(),
                extra: Default::default(),
            }],
            extra: Default::default(),
        },
        repositories: Vec::new(),
        github: None,
        extra: Default::default(),
    };
    WorkspaceDocument { config }.to_yaml()
}

fn invalid_generated_preview() -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "초기화 복구 정보가 생성 가능한 seed 문서와 일치하지 않습니다.",
    )
}

fn validate_preview_path(repository_root: &Path, relative_path: &str) -> Result<(), AppError> {
    if relative_path.is_empty() || is_outside_repository_path(relative_path) {
        return Err(unsafe_preview_path_error(
            relative_path,
            "초기화 파일 경로는 저장소 내부의 상대 경로여야 합니다.",
        ));
    }

    let components = Path::new(relative_path).components().collect::<Vec<_>>();
    let mut resolved = repository_root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        let std::path::Component::Normal(component) = component else {
            return Err(unsafe_preview_path_error(
                relative_path,
                "초기화 파일 경로에는 일반 경로 구성 요소만 사용할 수 있습니다.",
            ));
        };
        resolved.push(component);
        match fs::symlink_metadata(&resolved) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(workspace_io_error(&resolved, error)),
        }
        let canonical = resolved
            .canonicalize()
            .map_err(|error| workspace_io_error(&resolved, error))?;
        if !canonical.starts_with(repository_root) {
            return Err(unsafe_preview_path_error(
                relative_path,
                "초기화 파일의 기존 경로 구성 요소가 저장소 밖을 가리킵니다.",
            ));
        }
        let canonical_metadata =
            fs::metadata(&canonical).map_err(|error| workspace_io_error(&canonical, error))?;
        if index + 1 < components.len() && !canonical_metadata.is_dir() {
            return Err(unsafe_preview_path_error(
                relative_path,
                "초기화 파일의 상위 경로가 디렉터리가 아닙니다.",
            ));
        }
        resolved = canonical;
    }

    Ok(())
}

fn unsafe_preview_path_error(path: &str, message: &str) -> AppError {
    AppError::new(ErrorCode::WorkspaceInvalid, message)
        .with_recovery(RecoveryAction::OpenWorkspaceFile)
        .with_detail("path", path)
}

fn push_missing_file(
    repository_root: &Path,
    relative_path: &str,
    content: String,
    files: &mut Vec<PreviewFile>,
) -> Result<(), AppError> {
    let target = repository_root.join(relative_path);
    match fs::symlink_metadata(&target) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            files.push(PreviewFile {
                path: relative_path.into(),
                content,
                overwrites_existing: false,
            });
            Ok(())
        }
        Err(error) => Err(workspace_io_error(&target, error)),
    }
}

fn push_marker_for_empty_directory(
    repository_root: &Path,
    relative_directory: &str,
    marker_path: &str,
    files: &mut Vec<PreviewFile>,
) -> Result<(), AppError> {
    let directory = repository_root.join(relative_directory);
    let needs_marker = match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => false,
        Ok(_) => !directory_contains_trackable_file(&directory)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => return Err(workspace_io_error(&directory, error)),
    };

    if needs_marker {
        push_missing_file(repository_root, marker_path, String::new(), files)?;
    }
    Ok(())
}

fn directory_contains_trackable_file(directory: &Path) -> Result<bool, AppError> {
    for entry in fs::read_dir(directory).map_err(|error| workspace_io_error(directory, error))? {
        let entry = entry.map_err(|error| workspace_io_error(directory, error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| workspace_io_error(&path, error))?;
        if file_type.is_file() || file_type.is_symlink() {
            return Ok(true);
        }
        if file_type.is_dir() && directory_contains_trackable_file(&path)? {
            return Ok(true);
        }
    }
    Ok(false)
}

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

fn canonical_repository_root(repository_path: &Path) -> Result<PathBuf, AppError> {
    repository_path
        .canonicalize()
        .map_err(|error| workspace_io_error(repository_path, error))
}

fn workspace_io_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::new(
        ErrorCode::WorkspaceInvalid,
        "워크스페이스 파일을 읽을 수 없습니다.",
    )
    .with_recovery(RecoveryAction::OpenWorkspaceFile)
    .with_detail("path", path.display().to_string())
    .with_detail("reason", error.to_string())
}

fn schema_version(value: &Value) -> Option<u64> {
    value.get("schema_version").and_then(Value::as_u64)
}

fn structural_diagnostics(value: &Value) -> Vec<WorkspaceDiagnostic> {
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

fn inspect_document_references(
    repository_root: &Path,
    config: &WorkspaceConfigV1,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) -> Result<(), AppError> {
    let known_keys = config
        .repositories
        .iter()
        .map(|repository| repository.key.clone())
        .collect::<HashSet<_>>();
    inspect_reference_roots(
        repository_root,
        config
            .documents
            .roots
            .iter()
            .enumerate()
            .map(|(index, root)| (index, root.path.as_str())),
        &known_keys,
        diagnostics,
    )
}

fn inspect_raw_document_references(
    repository_root: &Path,
    value: &Value,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) -> Result<(), AppError> {
    let known_keys = value
        .get("repositories")
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(|repository| repository.get("key").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    let roots = value
        .get("documents")
        .and_then(|documents| documents.get("roots"))
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, root)| {
            root.get("path")
                .and_then(Value::as_str)
                .map(|path| (index, path))
        });

    inspect_reference_roots(repository_root, roots, &known_keys, diagnostics)
}

fn inspect_reference_roots<'a>(
    repository_root: &Path,
    roots: impl IntoIterator<Item = (usize, &'a str)>,
    known_keys: &HashSet<String>,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) -> Result<(), AppError> {
    let mut scanned_files = HashSet::new();

    for (index, root) in roots {
        if root.trim().is_empty() || is_outside_repository_path(root) {
            continue;
        }

        let root_path = repository_root.join(root);
        let metadata = match fs::symlink_metadata(&root_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(workspace_io_error(&root_path, error)),
        };
        if !metadata.is_dir() && !metadata.file_type().is_symlink() {
            continue;
        }

        let canonical_root = root_path
            .canonicalize()
            .map_err(|error| workspace_io_error(&root_path, error))?;
        if !canonical_root.starts_with(repository_root) {
            diagnostics.push(diagnostic(
                WorkspaceDiagnosticCode::DocumentRootOutsideRepository,
                format!("documents.roots[{index}].path"),
                "문서 루트와 심볼릭 링크 대상은 저장소 내부에 있어야 합니다.",
            ));
            continue;
        }
        if !fs::metadata(&canonical_root)
            .map_err(|error| workspace_io_error(&canonical_root, error))?
            .is_dir()
        {
            continue;
        }
        scan_directory(
            repository_root,
            &canonical_root,
            known_keys,
            &mut scanned_files,
            diagnostics,
        )?;
    }

    Ok(())
}

fn scan_directory(
    repository_root: &Path,
    directory: &Path,
    known_keys: &HashSet<String>,
    scanned_files: &mut HashSet<PathBuf>,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) -> Result<(), AppError> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| workspace_io_error(directory, error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| workspace_io_error(directory, error))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| workspace_io_error(&path, error))?;
        if file_type.is_symlink() {
            continue;
        }
        let canonical_path = path
            .canonicalize()
            .map_err(|error| workspace_io_error(&path, error))?;
        if !canonical_path.starts_with(repository_root) {
            continue;
        }
        if file_type.is_dir() {
            scan_directory(
                repository_root,
                &canonical_path,
                known_keys,
                scanned_files,
                diagnostics,
            )?;
        } else if file_type.is_file()
            && is_reference_document(&canonical_path)
            && scanned_files.insert(canonical_path.clone())
        {
            scan_reference_file(repository_root, &canonical_path, known_keys, diagnostics)?;
        }
    }

    Ok(())
}

fn scan_reference_file(
    repository_root: &Path,
    path: &Path,
    known_keys: &HashSet<String>,
    diagnostics: &mut Vec<WorkspaceDiagnostic>,
) -> Result<(), AppError> {
    let source = fs::read_to_string(path).map_err(|error| workspace_io_error(path, error))?;
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let yaml_source = if matches!(extension.as_str(), "md" | "markdown") {
        let Some(front_matter) = markdown_front_matter(&source) else {
            return Ok(());
        };
        front_matter
    } else {
        source.as_str()
    };
    let Ok(document) = serde_yaml_ng::from_str::<Value>(yaml_source) else {
        return Ok(());
    };

    let mut references = Vec::new();
    collect_code_link_references(&document, "", &mut references);
    for (reference_path, repository_key) in references {
        if !known_keys.contains(repository_key.as_str()) {
            let relative_path = path.strip_prefix(repository_root).unwrap_or(path);
            diagnostics.push(WorkspaceDiagnostic {
                code: WorkspaceDiagnosticCode::UnknownRepositoryKey,
                path: format!("{}:{reference_path}", relative_path.display()),
                message: format!("알 수 없는 저장소 key를 참조합니다: {repository_key}"),
                value: Some(repository_key),
            });
        }
    }
    Ok(())
}

fn markdown_front_matter(source: &str) -> Option<&str> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let first_line_end = source.find('\n')?;
    if source[..first_line_end].trim_end_matches('\r').trim() != "---" {
        return None;
    }

    let body_start = first_line_end + 1;
    let mut offset = body_start;
    for line in source[body_start..].split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']).trim();
        if matches!(content, "---" | "...") {
            return Some(&source[body_start..offset]);
        }
        offset += line.len();
    }
    None
}

fn collect_code_link_references(value: &Value, path: &str, references: &mut Vec<(String, String)>) {
    match value {
        Value::Mapping(mapping) => {
            for (key, child) in mapping {
                let Some(key) = key.as_str() else {
                    continue;
                };
                let child_path = join_yaml_path(path, key);
                if key == "code_links" {
                    collect_repository_fields(child, &child_path, references);
                } else {
                    collect_code_link_references(child, &child_path, references);
                }
            }
        }
        Value::Sequence(items) => {
            for (index, child) in items.iter().enumerate() {
                collect_code_link_references(child, &format!("{path}[{index}]"), references);
            }
        }
        _ => {}
    }
}

fn collect_repository_fields(value: &Value, path: &str, references: &mut Vec<(String, String)>) {
    match value {
        Value::Mapping(mapping) => {
            for (key, child) in mapping {
                let Some(key) = key.as_str() else {
                    continue;
                };
                let child_path = join_yaml_path(path, key);
                if key == "repository" {
                    if let Some(repository) = child.as_str() {
                        references.push((child_path, repository.to_owned()));
                    }
                } else {
                    collect_repository_fields(child, &child_path, references);
                }
            }
        }
        Value::Sequence(items) => {
            for (index, child) in items.iter().enumerate() {
                collect_repository_fields(child, &format!("{path}[{index}]"), references);
            }
        }
        _ => {}
    }
}

fn join_yaml_path(parent: &str, key: &str) -> String {
    if parent.is_empty() {
        key.to_owned()
    } else {
        format!("{parent}.{key}")
    }
}

fn is_reference_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "yml" | "yaml"
            )
        })
}

fn is_outside_repository_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let bytes = normalized.as_bytes();
    normalized.starts_with('/')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || normalized.split('/').any(|component| component == "..")
}

fn is_valid_repository_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    matches!(bytes.first(), Some(b'a'..=b'z'))
        && bytes[1..]
            .iter()
            .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

fn diagnostic(
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    use super::*;

    fn workspace_with(source: &str) -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
        std::fs::write(directory.path().join(".okf/workspace.yml"), source).unwrap();
        directory
    }

    fn valid_workspace(document_root: &str, repository_key: &str) -> String {
        format!(
            "schema_version: 1\nworkspace:\n  id: \"89bf04ef-df57-4a76-b10a-b33107d8a6c2\"\n  name: \"Mockly\"\ndocuments:\n  roots:\n    - path: \"{document_root}\"\nrepositories:\n  - key: \"{repository_key}\"\n    label: \"Mockly backend\"\n    github:\n      id: \"R_backend\"\n      full_name: \"Mockly/backend\"\n"
        )
    }

    fn files_below(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, directory: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
            let mut entries = std::fs::read_dir(directory)
                .unwrap()
                .map(|entry| entry.unwrap())
                .collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let path = entry.path();
                let file_type = entry.file_type().unwrap();
                if file_type.is_dir() {
                    visit(root, &path, files);
                } else if file_type.is_file() {
                    files.insert(
                        path.strip_prefix(root).unwrap().to_path_buf(),
                        std::fs::read(path).unwrap(),
                    );
                }
            }
        }

        let mut files = BTreeMap::new();
        visit(root, root, &mut files);
        files
    }

    #[test]
    fn missing_workspace_returns_initialization_required_without_writing_files() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("existing")).unwrap();

        let result = WorkspaceService::inspect(directory.path()).unwrap();

        assert_eq!(result, WorkspaceInspection::InitializationRequired);
        assert!(!directory.path().join(".okf").exists());
    }

    #[test]
    fn malformed_but_parseable_workspace_reports_every_feasible_diagnostic_and_stays_unchanged() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: not-a-uuid\n  name: \"  \"\ndocuments:\n  roots: []\nrepositories: []\n",
        );
        let before = files_below(directory.path());

        let result = WorkspaceService::inspect(directory.path()).unwrap();

        let WorkspaceInspection::Invalid { diagnostics } = result else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();
        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdNotV4));
        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameEmpty));
        assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootsMissing));
        assert_eq!(files_below(directory.path()), before);
    }

    #[test]
    fn partial_workspace_reports_feasible_root_repository_and_project_diagnostics_together() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace: {}\ndocuments:\n  roots:\n    - path: ../outside\nrepositories:\n  - key: Backend!\n    label: Duplicate\n    github: {}\n  - key: Backend!\n    label: Duplicate\n    github: {}\ngithub:\n  project: {}\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdMissing));
        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameMissing));
        assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
        assert_eq!(
            codes
                .iter()
                .filter(|code| **code == WorkspaceDiagnosticCode::RepositoryKeyInvalid)
                .count(),
            2
        );
        assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryKey));
        assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryLabel));
        assert_eq!(
            codes
                .iter()
                .filter(|code| **code == WorkspaceDiagnosticCode::RepositoryGithubIdMissing)
                .count(),
            2
        );
        assert!(codes.contains(&WorkspaceDiagnosticCode::GithubProjectIdMissing));
    }

    #[test]
    fn typed_structure_failure_remains_visible_with_semantic_and_missing_field_diagnostics() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: \"  \"\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: backend\n    github:\n      id: R_backend\n      full_name: Mockly/backend\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceStructureInvalid));
        assert!(codes.contains(&WorkspaceDiagnosticCode::WorkspaceNameEmpty));
        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryLabelMissing));
    }

    #[test]
    fn partial_workspace_distinguishes_missing_and_wrong_type_required_fields() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 42\ndocuments:\n  roots:\n    - path: 42\n    - {}\nrepositories:\n  - key: 42\n    github:\n      id: 42\n  - key: backend\n    label: 42\n    github: wrong-type\ngithub:\n  project:\n    id: 42\n    number: \"3\"\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        for expected in [
            WorkspaceDiagnosticCode::WorkspaceStructureInvalid,
            WorkspaceDiagnosticCode::WorkspaceIdTypeInvalid,
            WorkspaceDiagnosticCode::WorkspaceNameMissing,
            WorkspaceDiagnosticCode::DocumentRootPathTypeInvalid,
            WorkspaceDiagnosticCode::DocumentRootPathMissing,
            WorkspaceDiagnosticCode::RepositoryKeyTypeInvalid,
            WorkspaceDiagnosticCode::RepositoryLabelMissing,
            WorkspaceDiagnosticCode::RepositoryGithubIdTypeInvalid,
            WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing,
            WorkspaceDiagnosticCode::RepositoryLabelTypeInvalid,
            WorkspaceDiagnosticCode::RepositoryGithubTypeInvalid,
            WorkspaceDiagnosticCode::GithubProjectIdTypeInvalid,
            WorkspaceDiagnosticCode::GithubProjectOwnerMissing,
            WorkspaceDiagnosticCode::GithubProjectNumberTypeInvalid,
        ] {
            assert!(
                codes.contains(&expected),
                "missing diagnostic: {expected:?}"
            );
        }
        assert!(!codes.contains(&WorkspaceDiagnosticCode::WorkspaceIdNotV4));
        assert!(!codes.contains(&WorkspaceDiagnosticCode::DocumentRootEmpty));
        assert!(!codes.contains(&WorkspaceDiagnosticCode::RepositoryKeyEmpty));
    }

    #[test]
    fn wrong_type_document_roots_is_not_reported_as_missing() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: Mockly\ndocuments:\n  roots: wrong-type\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootsTypeInvalid));
        assert!(!codes.contains(&WorkspaceDiagnosticCode::DocumentRootsMissing));
    }

    #[test]
    fn missing_repository_github_reports_each_required_nested_field() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: Mockly\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: backend\n    label: Backend\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubMissing));
        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubIdMissing));
        assert!(codes.contains(&WorkspaceDiagnosticCode::RepositoryGithubFullNameMissing));
    }

    #[test]
    fn remaining_required_fields_report_precise_missing_and_type_diagnostics() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace:\n  id: 89bf04ef-df57-4a76-b10a-b33107d8a6c2\n  name: 42\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - label: Backend\n    github:\n      id: R_backend\n      full_name: 42\ngithub:\n  project:\n    id: P_project\n    owner: 42\n",
        );

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };
        let codes = diagnostics.iter().map(|item| item.code).collect::<Vec<_>>();

        for expected in [
            WorkspaceDiagnosticCode::WorkspaceNameTypeInvalid,
            WorkspaceDiagnosticCode::RepositoryKeyMissing,
            WorkspaceDiagnosticCode::RepositoryGithubFullNameTypeInvalid,
            WorkspaceDiagnosticCode::GithubProjectOwnerTypeInvalid,
            WorkspaceDiagnosticCode::GithubProjectNumberMissing,
        ] {
            assert!(
                codes.contains(&expected),
                "missing diagnostic: {expected:?}"
            );
        }
    }

    #[test]
    fn partial_workspace_still_reports_feasible_document_reference_diagnostics() {
        let directory = workspace_with(
            "schema_version: 1\nworkspace: {}\ndocuments:\n  roots:\n    - path: docs\nrepositories:\n  - key: frontend\n    label: Frontend\n    github:\n      id: R_frontend\n      full_name: Mockly/frontend\n",
        );
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join("docs/backend.md"),
            include_str!("fixtures/document-with-backend-ref.md"),
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected invalid inspection");
        };

        assert!(diagnostics.iter().any(|item| {
            item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
                && item.value.as_deref() == Some("backend")
        }));
    }

    #[test]
    fn newer_workspace_version_has_a_distinct_inspection_state() {
        let directory = workspace_with("schema_version: 2\nworkspace: {}\n");

        assert_eq!(
            WorkspaceService::inspect(directory.path()).unwrap(),
            WorkspaceInspection::UnsupportedVersion { found_version: 2 }
        );
    }

    #[test]
    fn oversized_newer_workspace_version_preserves_the_actual_found_value() {
        let directory = workspace_with("schema_version: 4294967296\n");

        let WorkspaceInspection::UnsupportedVersion { found_version } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected unsupported version");
        };

        assert_eq!(found_version, 4_294_967_296);
    }

    #[test]
    fn scans_references_only_in_configured_document_roots() {
        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::create_dir_all(directory.path().join("unconfigured")).unwrap();
        std::fs::write(
            directory.path().join("docs/backend.md"),
            include_str!("fixtures/document-with-backend-ref.md"),
        )
        .unwrap();
        std::fs::write(
            directory.path().join("unconfigured/ignored.yml"),
            "repository: \"also-unknown\"\n",
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected unknown repository reference");
        };
        let references = diagnostics
            .iter()
            .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
            .collect::<Vec<_>>();

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].value.as_deref(), Some("backend"));
        assert!(references[0].path.starts_with("docs/backend.md:"));
    }

    #[test]
    fn markdown_reference_scan_uses_front_matter_and_ignores_body_examples() {
        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join("docs/guide.md"),
            "---\ncode_links: [{ \"repository\": backend, path: src/lib.rs }]\n---\n\nExample only:\n```yaml\ncode_links:\n  - repository: retired\n```\n",
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected front-matter reference diagnostic");
        };
        let values = diagnostics
            .iter()
            .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
            .filter_map(|item| item.value.as_deref())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["backend"]);
    }

    #[test]
    fn yaml_reference_scan_handles_flow_maps_and_ignores_unrelated_repository_fields() {
        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join("docs/links.yaml"),
            "metadata: { repository: retired }\ncode_links: [{ \"repository\": mobile, path: src/mobile.rs }]\n",
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected flow-map reference diagnostic");
        };
        let values = diagnostics
            .iter()
            .filter(|item| item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey)
            .filter_map(|item| item.value.as_deref())
            .collect::<Vec<_>>();

        assert_eq!(values, vec!["mobile"]);
    }

    #[test]
    fn traversal_document_roots_are_rejected_without_scanning_outside_the_repository() {
        let parent = tempfile::tempdir().unwrap();
        let repository = parent.path().join("repository");
        std::fs::create_dir_all(repository.join(".okf")).unwrap();
        std::fs::write(
            repository.join(".okf/workspace.yml"),
            valid_workspace("../outside", "frontend"),
        )
        .unwrap();
        std::fs::create_dir_all(parent.path().join("outside")).unwrap();
        std::fs::write(
            parent.path().join("outside/secret.md"),
            "repository: \"outside-secret\"\n",
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(&repository).unwrap()
        else {
            panic!("expected invalid document root");
        };

        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
        assert!(!diagnostics.iter().any(|item| {
            item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
                && item.value.as_deref() == Some("outside-secret")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escapes_are_not_scanned_for_repository_references() {
        use std::os::unix::fs::symlink;

        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            outside.path().join("secret.yml"),
            "repository: \"outside-secret\"\n",
        )
        .unwrap();
        symlink(outside.path(), directory.path().join("docs/linked-outside")).unwrap();

        let result = WorkspaceService::inspect(directory.path()).unwrap();

        assert!(matches!(result, WorkspaceInspection::Ready { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn contained_symlink_document_root_is_scanned() {
        use std::os::unix::fs::symlink;

        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        std::fs::create_dir_all(directory.path().join("actual-docs")).unwrap();
        std::fs::write(
            directory.path().join("actual-docs/backend.yml"),
            "code_links: [{ repository: backend, path: src/backend.rs }]\n",
        )
        .unwrap();
        symlink(
            directory.path().join("actual-docs"),
            directory.path().join("docs"),
        )
        .unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected contained symlink root to be scanned");
        };

        assert!(diagnostics.iter().any(|item| {
            item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
                && item.value.as_deref() == Some("backend")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn escaping_symlink_document_root_is_rejected_without_scanning_target() {
        use std::os::unix::fs::symlink;

        let directory = workspace_with(&valid_workspace("docs", "frontend"));
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(
            outside.path().join("backend.yml"),
            "code_links: [{ repository: outside-secret, path: secret }]\n",
        )
        .unwrap();
        symlink(outside.path(), directory.path().join("docs")).unwrap();

        let WorkspaceInspection::Invalid { diagnostics } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected escaping root diagnostic");
        };

        assert!(diagnostics
            .iter()
            .any(|item| item.code == WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
        assert!(!diagnostics.iter().any(|item| {
            item.code == WorkspaceDiagnosticCode::UnknownRepositoryKey
                && item.value.as_deref() == Some("outside-secret")
        }));
    }

    #[test]
    fn valid_workspace_returns_a_summary_without_changing_files() {
        let directory = workspace_with(&valid_workspace("docs", "backend"));
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(
            directory.path().join("docs/backend.md"),
            include_str!("fixtures/document-with-backend-ref.md"),
        )
        .unwrap();
        let before = files_below(directory.path());

        let WorkspaceInspection::Ready { summary } =
            WorkspaceService::inspect(directory.path()).unwrap()
        else {
            panic!("expected ready workspace");
        };

        assert_eq!(summary.name, "Mockly");
        assert_eq!(summary.document_roots, vec!["docs"]);
        assert_eq!(summary.repository_count, 1);
        assert_eq!(files_below(directory.path()), before);
    }

    #[test]
    fn preview_contains_only_missing_seed_files_and_does_not_write_them() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(directory.path().join("docs/existing.md"), "# Existing").unwrap();
        let before = files_below(directory.path());

        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "head:abc123;status:clean",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();

        assert_eq!(preview.repository_fingerprint, "head:abc123;status:clean");
        assert_eq!(preview.branch, "okf/init-workspace");
        assert_eq!(
            preview.strategy,
            InitializationStrategy::DraftPullRequest {
                base_branch: "main".into()
            }
        );
        assert!(preview
            .files
            .iter()
            .any(|file| file.path == ".okf/workspace.yml"));
        assert!(preview
            .files
            .iter()
            .any(|file| file.path == ".okf/templates/.gitkeep"));
        assert!(!preview
            .files
            .iter()
            .any(|file| file.path == "docs/.gitkeep"));
        assert!(preview.files.iter().all(|file| !file.overwrites_existing));
        assert_eq!(files_below(directory.path()), before);
        assert!(!directory.path().join(".okf").exists());
    }

    #[cfg(unix)]
    #[test]
    fn preview_rejects_a_missing_target_below_an_escaping_parent_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), directory.path().join(".okf")).unwrap();
        let before = files_below(outside.path());

        let error = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "head:abc123;status:clean",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceInvalid);
        assert_eq!(files_below(outside.path()), before);
        assert!(!outside.path().join("workspace.yml").exists());
    }

    #[cfg(unix)]
    #[test]
    fn preview_allows_a_missing_target_below_a_contained_parent_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("metadata")).unwrap();
        symlink(
            directory.path().join("metadata"),
            directory.path().join(".okf"),
        )
        .unwrap();

        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "head:abc123;status:clean",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();

        assert!(preview
            .files
            .iter()
            .any(|file| file.path == ".okf/workspace.yml"));
        assert!(!directory.path().join("metadata/workspace.yml").exists());
    }

    #[cfg(unix)]
    #[test]
    fn execution_recheck_rejects_a_parent_symlink_added_after_preview_creation() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "head:abc123;status:clean",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();
        symlink(outside.path(), directory.path().join(".okf")).unwrap();

        let error =
            WorkspaceService::validate_preview_paths(directory.path(), &preview.files).unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceInvalid);
        assert!(files_below(outside.path()).is_empty());
    }

    #[test]
    fn preview_workspace_yaml_uses_one_generated_id_and_minimal_v1_defaults() {
        let directory = tempfile::tempdir().unwrap();

        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "empty-repository",
            RepositoryPopulation::Empty {
                default_branch: "trunk".into(),
            },
        )
        .unwrap();
        let workspace_file = preview
            .files
            .iter()
            .find(|file| file.path == ".okf/workspace.yml")
            .unwrap();
        let parsed = WorkspaceDocument::parse(&workspace_file.content).unwrap();

        assert_eq!(preview.workspace_id, parsed.config.workspace.id);
        assert_eq!(parsed.config.workspace.name, "Mockly");
        assert_eq!(parsed.config.documents.roots[0].path, "docs");
        assert!(parsed.config.repositories.is_empty());
        assert!(parsed.config.github.is_none());
        assert_eq!(preview.branch, "trunk");
        assert_eq!(preview.strategy, InitializationStrategy::DirectPush);
        assert_eq!(preview.commit_message, "chore: initialize OkHub workspace");
    }

    #[test]
    fn preview_skips_every_seed_path_that_already_has_content() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join(".okf/templates")).unwrap();
        std::fs::create_dir_all(directory.path().join("docs")).unwrap();
        std::fs::write(directory.path().join(".okf/workspace.yml"), "user-owned").unwrap();
        std::fs::write(
            directory.path().join(".okf/templates/template.md"),
            "template",
        )
        .unwrap();
        std::fs::write(directory.path().join("docs/readme.md"), "document").unwrap();
        let before = files_below(directory.path());

        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "unchanged",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();

        assert!(preview.files.is_empty());
        assert_eq!(files_below(directory.path()), before);
    }

    #[test]
    fn preview_adds_markers_when_seed_roots_contain_only_nested_empty_directories() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("docs/empty/nested")).unwrap();
        std::fs::create_dir_all(directory.path().join(".okf/templates/empty/nested")).unwrap();

        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "unchanged",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();

        assert!(preview
            .files
            .iter()
            .any(|file| file.path == "docs/.gitkeep"));
        assert!(preview
            .files
            .iter()
            .any(|file| file.path == ".okf/templates/.gitkeep"));
    }

    #[test]
    fn registry_returns_immutable_preview_snapshots_by_id_across_threads() {
        use std::sync::Arc;

        let directory = tempfile::tempdir().unwrap();
        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "head:abc123;status:clean",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();
        let preview_id = preview.id;
        let registry = Arc::new(PreviewRegistry::default());
        registry.insert(preview.clone()).unwrap();

        let worker_registry = Arc::clone(&registry);
        let mut retrieved = std::thread::spawn(move || worker_registry.get(preview_id).unwrap())
            .join()
            .unwrap();
        retrieved.workspace_name = "mutated copy".into();

        assert_eq!(registry.get(preview_id).unwrap(), preview);
        assert!(registry.get(Uuid::new_v4()).is_none());
    }

    #[test]
    fn registry_rejects_duplicate_ids_without_replacing_the_approved_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let preview = WorkspaceService::create_initialization_preview(
            directory.path(),
            "Mockly",
            "approved-fingerprint",
            RepositoryPopulation::ExistingContent {
                default_branch: "main".into(),
            },
        )
        .unwrap();
        let mut replacement = preview.clone();
        replacement.repository_fingerprint = "attacker-controlled".into();
        replacement.files.clear();
        let registry = PreviewRegistry::default();
        registry.insert(preview.clone()).unwrap();

        let error = registry.insert(replacement).unwrap_err();

        assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
        assert_eq!(registry.get(preview.id).unwrap(), preview);
    }
}
