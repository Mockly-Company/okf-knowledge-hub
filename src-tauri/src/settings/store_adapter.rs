use std::sync::{Arc, Mutex};

use tauri::Runtime;
use tauri_plugin_store::Store;

use crate::error::{AppError, ErrorCode, RecoveryAction};
use crate::settings::service::{LocalSettingsStore, DISPLAY_DENSITY_KEY};

pub const SETTINGS_FILE_NAME: &str = "settings.json";

trait SettingsStoreBackend: Send + Sync {
    fn get(&self, key: &str) -> Option<serde_json::Value>;
    fn set(&self, key: &str, value: serde_json::Value);
    fn delete(&self, key: &str);
    fn save(&self) -> Result<(), tauri_plugin_store::Error>;
}

impl<R: Runtime> SettingsStoreBackend for Store<R> {
    fn get(&self, key: &str) -> Option<serde_json::Value> {
        Store::get(self, key)
    }

    fn set(&self, key: &str, value: serde_json::Value) {
        Store::set(self, key, value);
    }

    fn delete(&self, key: &str) {
        Store::delete(self, key);
    }

    fn save(&self) -> Result<(), tauri_plugin_store::Error> {
        Store::save(self)
    }
}

pub struct TauriLocalSettingsStore {
    store: Arc<dyn SettingsStoreBackend>,
    transaction: Mutex<()>,
}

impl TauriLocalSettingsStore {
    pub fn new<R: Runtime>(store: Arc<Store<R>>) -> Self {
        Self::from_backend(store)
    }

    fn from_backend(store: Arc<dyn SettingsStoreBackend>) -> Self {
        Self {
            store,
            transaction: Mutex::new(()),
        }
    }

    fn restore_cached_value(&self, key: &str, previous: Option<serde_json::Value>) {
        match previous {
            Some(value) => self.store.set(key, value),
            None => self.store.delete(key),
        }
    }
}

impl LocalSettingsStore for TauriLocalSettingsStore {
    fn read(&self, key: &str) -> Result<Option<String>, AppError> {
        let _transaction = self
            .transaction
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match self.store.get(key) {
            None => Ok(None),
            Some(serde_json::Value::String(value)) => Ok(Some(value)),
            Some(_) if key == DISPLAY_DENSITY_KEY => Ok(None),
            Some(_) => Err(settings_error(
                "read",
                "로컬 설정의 현재 워크스페이스 경로 형식이 올바르지 않습니다.",
                None,
            )),
        }
    }

    fn write(&self, key: &str, value: &str) -> Result<(), AppError> {
        let _transaction = self
            .transaction
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous = self.store.get(key);
        self.store.set(key, serde_json::Value::String(value.into()));
        if let Err(error) = self.store.save() {
            self.restore_cached_value(key, previous);
            return Err(settings_error(
                "write",
                "현재 워크스페이스 경로를 로컬 설정에 저장할 수 없습니다.",
                Some(error),
            ));
        }
        Ok(())
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        let _transaction = self
            .transaction
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous = self.store.get(key);
        self.store.delete(key);
        if let Err(error) = self.store.save() {
            self.restore_cached_value(key, previous);
            return Err(settings_error(
                "remove",
                "현재 워크스페이스 연결을 로컬 설정에서 지울 수 없습니다.",
                Some(error),
            ));
        }
        Ok(())
    }
}

fn settings_error(
    operation: &str,
    message: &str,
    source: Option<tauri_plugin_store::Error>,
) -> AppError {
    let error = AppError::new(ErrorCode::LocalSettingsUnavailable, message)
        .with_recovery(RecoveryAction::Retry)
        .with_detail("operation", operation);
    match source {
        Some(source) => error.with_detail("reason", source.to_string()),
        None => error,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;

    use super::*;
    use crate::settings::service::{CURRENT_WORKSPACE_PATH_KEY, DISPLAY_DENSITY_KEY};

    #[derive(Default)]
    struct EquivalentSettingsStore {
        values: Mutex<HashMap<String, serde_json::Value>>,
        saved_snapshots: Mutex<Vec<HashMap<String, serde_json::Value>>>,
        fail_next_save: AtomicBool,
        mutation_count: AtomicUsize,
        first_mutation_entered: Mutex<Option<Arc<Barrier>>>,
        release_first_mutation: Mutex<Option<Arc<Barrier>>>,
    }

    impl EquivalentSettingsStore {
        fn with_values(
            values: impl IntoIterator<Item = (&'static str, serde_json::Value)>,
        ) -> Self {
            Self {
                values: Mutex::new(
                    values
                        .into_iter()
                        .map(|(key, value)| (key.to_owned(), value))
                        .collect(),
                ),
                ..Self::default()
            }
        }

        fn coordinate_first_mutation(&self) -> (Arc<Barrier>, Arc<Barrier>) {
            let entered = Arc::new(Barrier::new(2));
            let release = Arc::new(Barrier::new(2));
            *self.first_mutation_entered.lock().unwrap() = Some(entered.clone());
            *self.release_first_mutation.lock().unwrap() = Some(release.clone());
            (entered, release)
        }

        fn value(&self, key: &str) -> Option<serde_json::Value> {
            self.values.lock().unwrap().get(key).cloned()
        }

        fn saved_workspace_values(&self) -> Vec<Option<String>> {
            self.saved_snapshots
                .lock()
                .unwrap()
                .iter()
                .map(|snapshot| {
                    snapshot
                        .get(CURRENT_WORKSPACE_PATH_KEY)
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                })
                .collect()
        }

        fn pause_first_mutation(&self) {
            if self.mutation_count.fetch_add(1, Ordering::SeqCst) == 0 {
                let entered = self.first_mutation_entered.lock().unwrap().clone();
                let release = self.release_first_mutation.lock().unwrap().clone();
                if let (Some(entered), Some(release)) = (entered, release) {
                    entered.wait();
                    release.wait();
                }
            }
        }
    }

    impl SettingsStoreBackend for EquivalentSettingsStore {
        fn get(&self, key: &str) -> Option<serde_json::Value> {
            self.value(key)
        }

        fn set(&self, key: &str, value: serde_json::Value) {
            self.values.lock().unwrap().insert(key.to_owned(), value);
            self.pause_first_mutation();
        }

        fn delete(&self, key: &str) {
            self.values.lock().unwrap().remove(key);
            self.pause_first_mutation();
        }

        fn save(&self) -> Result<(), tauri_plugin_store::Error> {
            if self.fail_next_save.swap(false, Ordering::SeqCst) {
                return Err(tauri_plugin_store::Error::Serialize(
                    "planned save failure".into(),
                ));
            }
            self.saved_snapshots
                .lock()
                .unwrap()
                .push(self.values.lock().unwrap().clone());
            Ok(())
        }
    }

    fn concurrent_adapter(
        initial_workspace: Option<&str>,
    ) -> (Arc<TauriLocalSettingsStore>, Arc<EquivalentSettingsStore>) {
        let mut values = vec![
            ("display-density", serde_json::json!("compact")),
            ("future-setting", serde_json::json!({ "enabled": true })),
        ];
        if let Some(path) = initial_workspace {
            values.push((CURRENT_WORKSPACE_PATH_KEY, serde_json::json!(path)));
        }
        let backend = Arc::new(EquivalentSettingsStore::with_values(values));
        let adapter = Arc::new(TauriLocalSettingsStore::from_backend(backend.clone()));
        (adapter, backend)
    }

    #[test]
    fn concurrent_set_operations_save_each_completed_value_in_order() {
        let (adapter, backend) = concurrent_adapter(None);
        let (entered, release) = backend.coordinate_first_mutation();
        let first_adapter = adapter.clone();
        let first = thread::spawn(move || {
            first_adapter
                .write(CURRENT_WORKSPACE_PATH_KEY, "/workspace/a")
                .unwrap();
        });
        entered.wait();
        let second_adapter = adapter.clone();
        let second = thread::spawn(move || {
            second_adapter
                .write(CURRENT_WORKSPACE_PATH_KEY, "/workspace/b")
                .unwrap();
        });
        release.wait();
        first.join().unwrap();
        second.join().unwrap();

        assert_eq!(
            backend.saved_workspace_values(),
            vec![Some("/workspace/a".into()), Some("/workspace/b".into())]
        );
        assert_eq!(
            backend.value("display-density"),
            Some(serde_json::json!("compact"))
        );
        assert_eq!(
            backend.value("future-setting"),
            Some(serde_json::json!({ "enabled": true }))
        );
    }

    #[test]
    fn concurrent_set_then_clear_saves_complete_transactions() {
        let (adapter, backend) = concurrent_adapter(Some("/workspace/old"));
        let (entered, release) = backend.coordinate_first_mutation();
        let set_adapter = adapter.clone();
        let set = thread::spawn(move || {
            set_adapter
                .write(CURRENT_WORKSPACE_PATH_KEY, "/workspace/new")
                .unwrap();
        });
        entered.wait();
        let clear_adapter = adapter.clone();
        let clear = thread::spawn(move || {
            clear_adapter.remove(CURRENT_WORKSPACE_PATH_KEY).unwrap();
        });
        release.wait();
        set.join().unwrap();
        clear.join().unwrap();

        assert_eq!(
            backend.saved_workspace_values(),
            vec![Some("/workspace/new".into()), None]
        );
        assert_eq!(backend.value(CURRENT_WORKSPACE_PATH_KEY), None);
    }

    #[test]
    fn failed_write_save_restores_the_previous_cached_value() {
        let (adapter, backend) = concurrent_adapter(Some("/workspace/old"));
        backend.fail_next_save.store(true, Ordering::SeqCst);

        let error = adapter
            .write(CURRENT_WORKSPACE_PATH_KEY, "/workspace/new")
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            backend.value(CURRENT_WORKSPACE_PATH_KEY),
            Some(serde_json::json!("/workspace/old"))
        );
        assert_eq!(
            backend.value("display-density"),
            Some(serde_json::json!("compact"))
        );
    }

    #[test]
    fn failed_remove_save_restores_the_previous_cached_value() {
        let (adapter, backend) = concurrent_adapter(Some("/workspace/old"));
        backend.fail_next_save.store(true, Ordering::SeqCst);

        let error = adapter.remove(CURRENT_WORKSPACE_PATH_KEY).unwrap_err();

        assert_eq!(error.code, ErrorCode::LocalSettingsUnavailable);
        assert_eq!(
            backend.value(CURRENT_WORKSPACE_PATH_KEY),
            Some(serde_json::json!("/workspace/old"))
        );
        assert_eq!(
            backend.value("future-setting"),
            Some(serde_json::json!({ "enabled": true }))
        );
    }

    #[test]
    fn unsupported_density_json_falls_back_without_rewriting_the_cached_value() {
        let (adapter, backend) = concurrent_adapter(Some("/workspace/current"));
        backend.values.lock().unwrap().insert(
            DISPLAY_DENSITY_KEY.into(),
            serde_json::json!({ "unexpected": true }),
        );

        assert_eq!(adapter.read(DISPLAY_DENSITY_KEY).unwrap(), None);
        assert_eq!(
            backend.value(DISPLAY_DENSITY_KEY),
            Some(serde_json::json!({ "unexpected": true }))
        );
        assert_eq!(
            backend.value(CURRENT_WORKSPACE_PATH_KEY),
            Some(serde_json::json!("/workspace/current"))
        );
    }
}
