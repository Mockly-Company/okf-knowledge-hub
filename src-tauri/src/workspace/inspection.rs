use std::fs;
use std::path::Path;

use serde_yaml_ng::Value;

use crate::error::AppError;
use crate::workspace::model::WorkspaceDocument;
use crate::workspace::validation::validate_workspace;

use super::contract::{
    WorkspaceDiagnostic, WorkspaceDiagnosticCode, WorkspaceInspection, WorkspaceSummary,
};
use super::diagnostics::{diagnostic, schema_version, structural_diagnostics};
use super::path_safety::{canonical_repository_root, workspace_io_error};
use super::references::{inspect_document_references, inspect_raw_document_references};

pub(super) fn inspect(repository_path: &Path) -> Result<WorkspaceInspection, AppError> {
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
