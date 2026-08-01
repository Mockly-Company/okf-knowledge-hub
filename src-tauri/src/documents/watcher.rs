use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

pub(crate) const WATCH_COALESCE_WINDOW: std::time::Duration = std::time::Duration::from_millis(150);

#[derive(Debug)]
pub(crate) enum WatcherMessage {
    Paths(Vec<PathBuf>),
    Rescan,
    BackendError,
}

pub(crate) trait WatcherGuard: Send {}

impl<T: Send> WatcherGuard for T {}

pub(crate) type WatcherFactory = dyn Fn(
        &Path,
        &[String],
        mpsc::UnboundedSender<WatcherMessage>,
    ) -> Result<Box<dyn WatcherGuard>, notify::Error>
    + Send
    + Sync;

struct DocumentWatcher {
    _watcher: RecommendedWatcher,
}

impl DocumentWatcher {
    pub(crate) fn start(
        repository_root: &Path,
        roots: &[String],
        sender: mpsc::UnboundedSender<WatcherMessage>,
    ) -> Result<Self, notify::Error> {
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            dispatch_notify_result(&sender, result);
        })?;
        for root in roots {
            watcher.watch(&repository_root.join(root), RecursiveMode::Recursive)?;
        }
        Ok(Self { _watcher: watcher })
    }
}

pub(crate) fn dispatch_notify_result(
    sender: &mpsc::UnboundedSender<WatcherMessage>,
    result: notify::Result<Event>,
) {
    if let Some(message) = watcher_message(result) {
        let _ = sender.send(message);
    }
}

fn watcher_message(result: notify::Result<Event>) -> Option<WatcherMessage> {
    let event = match result {
        Ok(event) => event,
        Err(_) => return Some(WatcherMessage::BackendError),
    };
    if event.need_rescan() {
        return Some(WatcherMessage::Rescan);
    }
    let mutating = matches!(
        event.kind,
        EventKind::Any
            | EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Modify(ModifyKind::Other)
            | EventKind::Remove(_)
    );
    if !mutating {
        return None;
    }
    if event.paths.is_empty() {
        Some(WatcherMessage::Rescan)
    } else {
        Some(WatcherMessage::Paths(event.paths))
    }
}

pub(crate) fn native_watcher_factory(
    repository_root: &Path,
    roots: &[String],
    sender: mpsc::UnboundedSender<WatcherMessage>,
) -> Result<Box<dyn WatcherGuard>, notify::Error> {
    DocumentWatcher::start(repository_root, roots, sender)
        .map(|watcher| Box::new(watcher) as Box<dyn WatcherGuard>)
}

pub(crate) fn affected_markdown_paths(
    repository_root: &Path,
    roots: &[String],
    paths: &[PathBuf],
) -> Vec<String> {
    let Some(repository) = normalize_path(repository_root) else {
        return Vec::new();
    };
    let case_insensitive = repository.root.is_case_insensitive();
    let normalized_roots = roots
        .iter()
        .filter_map(|root| {
            let root = normalize_path(Path::new(root))?;
            matches!(&root.root, PortableRoot::Relative).then_some(root.components)
        })
        .collect::<Vec<_>>();
    paths
        .iter()
        .filter_map(|path| {
            let path = normalize_path(path)?;
            let relative = if matches!(&path.root, PortableRoot::Relative) {
                path.components
            } else {
                if path.root != repository.root
                    || !components_start_with(
                        &path.components,
                        &repository.components,
                        case_insensitive,
                    )
                {
                    return None;
                }
                path.components[repository.components.len()..].to_vec()
            };
            if relative
                .iter()
                .any(|component| component.eq_ignore_ascii_case(".git"))
                || !relative.last().is_some_and(|file_name| {
                    file_name
                        .rsplit_once('.')
                        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("md"))
                })
                || !normalized_roots
                    .iter()
                    .any(|root| components_start_with(&relative, root, case_insensitive))
            {
                return None;
            }
            Some(relative.join("/"))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(crate) fn relative_paths_match(repository_root: &Path, left: &str, right: &str) -> bool {
    let Some(repository) = normalize_path(repository_root) else {
        return false;
    };
    let Some(left) = normalize_path(Path::new(left)) else {
        return false;
    };
    let Some(right) = normalize_path(Path::new(right)) else {
        return false;
    };
    if !matches!(&left.root, PortableRoot::Relative)
        || !matches!(&right.root, PortableRoot::Relative)
        || left.components.len() != right.components.len()
    {
        return false;
    }
    components_start_with(
        &left.components,
        &right.components,
        repository.root.is_case_insensitive(),
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PortableRoot {
    Relative,
    Unix,
    Drive(u8),
    Unc(String, String),
}

impl PortableRoot {
    fn is_case_insensitive(&self) -> bool {
        matches!(self, Self::Drive(_) | Self::Unc(_, _))
    }
}

struct PortablePath {
    root: PortableRoot,
    components: Vec<String>,
}

fn normalize_path(path: &Path) -> Option<PortablePath> {
    let mut portable = path.to_string_lossy().replace('\\', "/");
    if portable
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/UNC/"))
    {
        portable = format!("//{}", &portable[8..]);
    } else if portable
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/"))
    {
        portable = portable[4..].to_owned();
    }
    let bytes = portable.as_bytes();
    let (root, remainder) = if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && bytes[2] == b'/'
    {
        (
            PortableRoot::Drive(bytes[0].to_ascii_uppercase()),
            &portable[3..],
        )
    } else if let Some(network_path) = portable.strip_prefix("//") {
        let mut parts = network_path.splitn(3, '/');
        let server = parts.next()?;
        let share = parts.next()?;
        if server.is_empty() || share.is_empty() {
            return None;
        }
        (
            PortableRoot::Unc(server.to_ascii_lowercase(), share.to_ascii_lowercase()),
            parts.next().unwrap_or_default(),
        )
    } else if portable.starts_with('/') {
        (PortableRoot::Unix, portable.trim_start_matches('/'))
    } else if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return None;
    } else {
        (PortableRoot::Relative, portable.as_str())
    };
    let mut components = Vec::new();
    for component in remainder.split('/') {
        match component {
            "" | "." => {}
            ".." => return None,
            component => components.push(component.to_owned()),
        }
    }
    Some(PortablePath { root, components })
}

fn components_start_with(path: &[String], root: &[String], case_insensitive: bool) -> bool {
    path.len() >= root.len()
        && path.iter().zip(root).all(|(path, root)| {
            if case_insensitive {
                path.eq_ignore_ascii_case(root)
            } else {
                path == root
            }
        })
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use notify::event::{
        AccessKind, AccessMode, CreateKind, DataChange, Flag, MetadataKind, ModifyKind, RemoveKind,
        RenameMode,
    };
    use notify::{Event, EventKind};

    use super::{affected_markdown_paths, watcher_message, WatcherMessage};

    #[test]
    fn native_events_ignore_access_and_metadata_noise() {
        let ignored = [
            EventKind::Access(AccessKind::Open(AccessMode::Read)),
            EventKind::Access(AccessKind::Close(AccessMode::Read)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
            EventKind::Other,
        ];

        for kind in ignored {
            assert!(
                watcher_message(Ok(Event::new(kind).add_path(PathBuf::from("docs/guide.md"))))
                    .is_none(),
                "{kind:?} should not trigger a document refresh"
            );
        }
    }

    #[test]
    fn native_events_forward_catalog_mutations_and_preserve_rename_order() {
        let path = PathBuf::from("docs/guide.md");
        let forwarded = [
            EventKind::Any,
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Any),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            EventKind::Modify(ModifyKind::Other),
            EventKind::Remove(RemoveKind::File),
        ];

        for kind in forwarded {
            let Some(WatcherMessage::Paths(paths)) =
                watcher_message(Ok(Event::new(kind).add_path(path.clone())))
            else {
                panic!("{kind:?} should trigger a document refresh");
            };
            assert_eq!(paths, [path.clone()]);
        }

        let old_path = PathBuf::from("docs/old.md");
        let new_path = PathBuf::from("docs/new.md");
        let Some(WatcherMessage::Paths(paths)) = watcher_message(Ok(Event::new(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
        )
        .add_path(old_path.clone())
        .add_path(new_path.clone()))) else {
            panic!("rename should trigger a document refresh");
        };
        assert_eq!(paths, [old_path, new_path]);
    }

    #[test]
    fn native_events_prioritize_rescan_and_keep_backend_errors_safe() {
        let rescan = Event::new(EventKind::Access(AccessKind::Open(AccessMode::Read)))
            .set_flag(Flag::Rescan);
        assert!(matches!(
            watcher_message(Ok(rescan)),
            Some(WatcherMessage::Rescan)
        ));
        assert!(matches!(
            watcher_message(Ok(Event::new(EventKind::Create(CreateKind::File)))),
            Some(WatcherMessage::Rescan)
        ));
        assert!(matches!(
            watcher_message(Err(notify::Error::generic("injected watcher failure"))),
            Some(WatcherMessage::BackendError)
        ));
    }

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

    #[test]
    fn watcher_paths_normalize_windows_separators_and_roots_on_every_platform() {
        let repository = Path::new(r"C:\workspace");
        let paths = affected_markdown_paths(
            repository,
            &[r"docs\guides".to_owned()],
            &[
                PathBuf::from(r"C:\workspace\docs\guides\kept.MD"),
                PathBuf::from(r"C:\workspace\docs\guides\.git\hidden.md"),
                PathBuf::from(r"C:\workspace\docs\outside.md"),
                PathBuf::from(r"D:\workspace\docs\guides\other.md"),
                PathBuf::from(r"docs\guides\relative.md"),
            ],
        );

        assert_eq!(paths, ["docs/guides/kept.MD", "docs/guides/relative.md"]);
    }

    #[test]
    fn watcher_paths_match_windows_verbatim_and_unc_roots_on_every_platform() {
        let verbatim = affected_markdown_paths(
            Path::new(r"\\?\C:\Workspace"),
            &["docs".to_owned()],
            &[PathBuf::from(r"c:\workspace\Docs\verbatim.md")],
        );
        let unc = affected_markdown_paths(
            Path::new(r"\\server\Share\Workspace"),
            &["docs".to_owned()],
            &[PathBuf::from(r"\\SERVER\share\workspace\docs\network.md")],
        );

        assert_eq!(verbatim, ["Docs/verbatim.md"]);
        assert_eq!(unc, ["docs/network.md"]);
    }
}
