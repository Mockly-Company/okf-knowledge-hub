use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use notify::{Config, Event, PollWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

pub(crate) const WATCH_COALESCE_WINDOW: std::time::Duration = std::time::Duration::from_millis(150);

#[derive(Debug)]
pub(crate) enum WatcherMessage {
    Paths(Vec<PathBuf>),
    BackendError,
}

pub(crate) struct DocumentWatcher {
    _watcher: PollWatcher,
}

impl DocumentWatcher {
    pub(crate) fn start(
        repository_root: &Path,
        roots: &[String],
        sender: mpsc::UnboundedSender<WatcherMessage>,
    ) -> Result<Self, notify::Error> {
        let callback_sender = sender;
        let mut watcher = PollWatcher::new(
            move |result: notify::Result<Event>| {
                let message = match result {
                    Ok(event) => WatcherMessage::Paths(event.paths),
                    Err(_) => WatcherMessage::BackendError,
                };
                let _ = callback_sender.send(message);
            },
            Config::default()
                .with_poll_interval(std::time::Duration::from_millis(250))
                .with_compare_contents(true),
        )?;
        for root in roots {
            watcher.watch(&repository_root.join(root), RecursiveMode::Recursive)?;
        }
        Ok(Self { _watcher: watcher })
    }
}

pub(crate) fn affected_markdown_paths(
    repository_root: &Path,
    roots: &[String],
    paths: &[PathBuf],
) -> Vec<String> {
    let normalized_roots = roots
        .iter()
        .filter_map(|root| normalize_relative(Path::new(root)))
        .collect::<Vec<_>>();
    paths
        .iter()
        .filter_map(|path| {
            let relative = if path.is_absolute() {
                path.strip_prefix(repository_root).ok()?
            } else {
                path.as_path()
            };
            let relative = normalize_relative(relative)?;
            if relative
                .components()
                .any(|component| component.as_os_str() == ".git")
                || !relative
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                || !normalized_roots
                    .iter()
                    .any(|root| relative.starts_with(root))
            {
                return None;
            }
            Some(relative.to_string_lossy().replace('\\', "/"))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn normalize_relative(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(component) => normalized.push(component),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::affected_markdown_paths;

    #[test]
    fn rename_produces_delete_and_add_paths() {
        let repository = Path::new("/workspace");
        let paths = affected_markdown_paths(
            repository,
            &["docs".to_owned()],
            &[
                PathBuf::from("/workspace/docs/old.md"),
                PathBuf::from("/workspace/docs/new.md"),
            ],
        );

        assert_eq!(paths, ["docs/new.md", "docs/old.md"]);
    }

    #[test]
    fn watcher_event_outside_configured_roots_is_ignored() {
        let repository = Path::new("/workspace");
        let paths = affected_markdown_paths(
            repository,
            &["docs".to_owned()],
            &[
                PathBuf::from("/workspace/outside/ignored.md"),
                PathBuf::from("/workspace/docs/kept.md"),
                PathBuf::from("/workspace/docs/not-markdown.txt"),
            ],
        );

        assert_eq!(paths, ["docs/kept.md"]);
    }
}
