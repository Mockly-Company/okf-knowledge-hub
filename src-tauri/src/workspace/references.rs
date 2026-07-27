use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_yaml_ng::Value;

use crate::error::AppError;
use crate::workspace::model::WorkspaceConfigV1;

use super::contract::{WorkspaceDiagnostic, WorkspaceDiagnosticCode};
use super::diagnostics::diagnostic;
use super::path_safety::{is_outside_repository_path, workspace_io_error};

pub(super) fn inspect_document_references(
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

pub(super) fn inspect_raw_document_references(
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
            let portable_path = relative_path.to_string_lossy().replace('\\', "/");
            diagnostics.push(WorkspaceDiagnostic {
                code: WorkspaceDiagnosticCode::UnknownRepositoryKey,
                path: format!("{portable_path}:{reference_path}"),
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
