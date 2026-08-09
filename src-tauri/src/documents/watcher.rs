use std::path::Path;

use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

pub(crate) const WATCH_COALESCE_WINDOW: std::time::Duration = std::time::Duration::from_millis(150);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatcherMessage {
    RepositoryChanged,
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
    match result {
        Ok(event) if is_repository_change(&event.kind) || event.need_rescan() => {
            Some(WatcherMessage::RepositoryChanged)
        }
        Ok(_) => None,
        Err(_) => Some(WatcherMessage::BackendError),
    }
}

fn is_repository_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any
            | EventKind::Create(_)
            | EventKind::Modify(
                ModifyKind::Any | ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Other
            )
            | EventKind::Remove(_)
    )
}

pub(crate) fn native_watcher_factory(
    repository_root: &Path,
    roots: &[String],
    sender: mpsc::UnboundedSender<WatcherMessage>,
) -> Result<Box<dyn WatcherGuard>, notify::Error> {
    DocumentWatcher::start(repository_root, roots, sender)
        .map(|watcher| Box::new(watcher) as Box<dyn WatcherGuard>)
}

#[cfg(test)]
mod tests {
    use notify::event::{
        AccessKind, AccessMode, CreateKind, DataChange, Flag, MetadataKind, ModifyKind, RemoveKind,
        RenameMode,
    };
    use notify::{Event, EventKind};

    use super::{watcher_message, WatcherMessage};

    fn event(kind: EventKind, path: &str) -> Event {
        Event::new(kind).add_path(path.into())
    }

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
                watcher_message(Ok(event(kind, "docs/guide.md"))).is_none(),
                "{kind:?} should not trigger a document refresh"
            );
        }
    }

    #[test]
    fn file_and_directory_changes_become_one_repository_changed_signal() {
        for event in [
            event(EventKind::Create(CreateKind::File), "docs/new.md"),
            event(
                EventKind::Modify(ModifyKind::Data(DataChange::Any)),
                "docs/api.md",
            ),
            event(EventKind::Remove(RemoveKind::Folder), "docs/legacy"),
            event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
                "docs/moved",
            ),
        ] {
            assert!(matches!(
                watcher_message(Ok(event)),
                Some(WatcherMessage::RepositoryChanged)
            ));
        }
    }

    #[test]
    fn any_and_rescan_events_become_repository_changed_signal() {
        let rescan = Event::new(EventKind::Access(AccessKind::Open(AccessMode::Read)))
            .set_flag(Flag::Rescan);

        for event in [Event::new(EventKind::Any), rescan] {
            assert!(matches!(
                watcher_message(Ok(event)),
                Some(WatcherMessage::RepositoryChanged)
            ));
        }
    }

    #[test]
    fn watcher_backend_error_remains_distinct() {
        assert!(matches!(
            watcher_message(Err(notify::Error::generic("watch failed"))),
            Some(WatcherMessage::BackendError)
        ));
    }
}
