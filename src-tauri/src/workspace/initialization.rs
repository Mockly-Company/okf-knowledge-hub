use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::workspace::model::{
    DocumentRoot, DocumentsConfig, WorkspaceConfigV1, WorkspaceDocument, WorkspaceIdentity,
};

use super::contract::{
    InitializationPreview, InitializationStrategy, PreviewFile, RepositoryPopulation,
};
use super::path_safety::{
    canonical_repository_root, is_outside_repository_path, workspace_io_error,
};

pub(super) fn create_initialization_preview(
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

pub(super) fn validate_preview_paths(
    repository_path: &Path,
    files: &[PreviewFile],
) -> Result<(), AppError> {
    let repository_root = canonical_repository_root(repository_path)?;
    for file in files {
        validate_preview_path(&repository_root, &file.path)?;
    }
    Ok(())
}

pub(super) fn validate_generated_initialization_preview(
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
