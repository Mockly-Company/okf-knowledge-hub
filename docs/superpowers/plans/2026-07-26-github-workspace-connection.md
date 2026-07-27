# GitHub Authentication and OKF Workspace Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete first-run flow that authenticates with GitHub, connects or clones one OKF knowledge repository, validates or initializes `.okf/workspace.yml`, and opens the connected workspace safely.

**Architecture:** React owns presentation and a pure connection state machine. Narrow Tauri commands delegate authentication, GitHub API, Git, workspace validation, and local settings to focused Rust services; only the Rust layer sees raw tokens. Team-shared configuration lives in the selected knowledge repository while the current absolute path stays in device-local settings.

**Tech Stack:** Tauri 2, Rust 1.88.0, React 19, TypeScript 5, Vitest 4, reqwest 0.12.28, git2 0.19, keyring 3.6.3, serde_yaml_ng 0.10, UUID v4, Tauri Dialog and Opener plugins

## Global Constraints

- Execute this plan from a new worktree and branch `feat/github-workspace-connection` after Foundation PR #1 is merged into `main`.
- Bring commit `52bae2f` and this plan onto that branch if they are not already present after the merge.
- Preserve the user's unrelated dirty documentation changes in `/Users/hyeeun/Documents/okf-knowledge-hub`; never build this feature in that checkout.
- Keep `rust-version = "1.88.0"`, Node `>=22.12.0`, pnpm `10.0.0`, Tauri `2`, React `19`, and the existing macOS/Windows CI matrix. This minimum matches the Foundation lock graph.
- The GitHub App is public, owned by `Mockly-Company`, uses Device Flow, enables expiring user access tokens, and has no Client Secret or private key in the desktop binary.
- Raw access and refresh tokens never cross the Tauri boundary and never appear in logs, command arguments, remote URLs, YAML, or `settings.json`.
- Store tokens in macOS Keychain or Windows Credential Store; store only the current knowledge-repository absolute path in device-local settings.
- `.okf/workspace.yml` belongs to the selected OKF knowledge repository, never to the reusable Hub application repository on behalf of another project.
- The app opens one current workspace at a time and provides no recent-workspace list.
- Never overwrite an existing path, delete an incomplete clone automatically, rewrite invalid YAML automatically, or force-push.
- Initialization must show an immutable preview and receive explicit confirmation before creating files, commits, pushes, or a Draft PR.
- Use TDD for every task and create one focused commit after its full test command passes; request commit approval at execution time as required by local repository rules.
- Use the copy, spacing, color tokens, Pretendard typography, Lucide icons, and Default/Compact density behavior already established by the Foundation phase.

## External Configuration Required for Real GitHub Smoke Tests

Before Task 5's real-device smoke test, register the public GitHub App under `Mockly-Company` with Device Flow and expiring user access tokens enabled. Grant repository Metadata read, Contents read/write, and Pull requests read/write permissions. Supply its public Client ID through `OKHUB_GITHUB_CLIENT_ID`; the release workflow embeds that public value, while local and self-hosted builds can override it with the same variable. The automated unit suite uses a deterministic test Client ID and does not require GitHub credentials.

## File Structure

### Rust application core

- `src-tauri/src/error.rs` — serializable public error codes and recovery actions.
- `src-tauri/src/state.rs` — `AppServices`, active auth jobs, and initialization preview registry.
- `src-tauri/src/auth/model.rs` — public device-flow state and private token model.
- `src-tauri/src/auth/ports.rs` — credential, device-flow API, clock, and cancellation boundaries.
- `src-tauri/src/auth/service.rs` — device authorization, polling, token refresh, and logout.
- `src-tauri/src/auth/keyring_store.rs` — macOS Keychain and Windows Credential Store adapter.
- `src-tauri/src/github/model.rs` — user, repository page, repository detail, and Draft PR DTOs.
- `src-tauri/src/github/client.rs` — GitHub REST and OAuth HTTP adapter.
- `src-tauri/src/workspace/model.rs` — `.okf/workspace.yml` v1 types and unknown-field storage.
- `src-tauri/src/workspace/validation.rs` — schema, path, identity, and repository-reference diagnostics.
- `src-tauri/src/workspace/service.rs` — inspect config and create immutable initialization previews.
- `src-tauri/src/repository/model.rs` — local repository snapshot, clone request, and initialization result.
- `src-tauri/src/repository/service.rs` — safe connect, clone, fingerprint, commit, and push orchestration.
- `src-tauri/src/repository/git2_adapter.rs` — libgit2 implementation with in-memory credentials.
- `src-tauri/src/settings/model.rs` — current workspace path DTO.
- `src-tauri/src/settings/service.rs` — validated current-workspace read/write/clear behavior.
- `src-tauri/src/commands/auth.rs` — authentication commands and status events.
- `src-tauri/src/commands/workspace.rs` — repository, folder, workspace, preview, and initialization commands.
- `src-tauri/src/lib.rs` — plugin setup, managed state, and command registration only.

### React feature

- `src/features/workspace-connection/types.ts` — Tauri-shaped public DTOs and connection state.
- `src/features/workspace-connection/WorkspaceConnectionGateway.ts` — UI-facing async port.
- `src/features/workspace-connection/connection-reducer.ts` — pure transitions and invalidation rules.
- `src/features/workspace-connection/WorkspaceConnectionProvider.tsx` — async orchestration and replacement mode.
- `src/features/workspace-connection/WorkspaceGate.tsx` — connected workspace versus first-run routing.
- `src/features/workspace-connection/WorkspaceConnectionPage.tsx` — three-step shell and initialization confirmation.
- `src/features/workspace-connection/components/GitHubLoginStep.tsx` — Device Flow UI.
- `src/features/workspace-connection/components/RepositorySelectionStep.tsx` — repository paging, refresh, and selection.
- `src/features/workspace-connection/components/LocalConnectionStep.tsx` — existing clone/new clone choice.
- `src/features/workspace-connection/components/InitializationPreview.tsx` — exact files, branch strategy, confirm/cancel.
- `src/features/workspace-connection/components/ConnectionError.tsx` — diagnostic and recovery-action renderer.
- `src/infrastructure/workspace/TauriWorkspaceConnectionGateway.ts` — invoke/event/dialog/opener adapter.
- `src/infrastructure/workspace/UnavailableWorkspaceConnectionGateway.ts` — browser-only actionable unavailable result.
- `src/infrastructure/workspace/createWorkspaceConnectionGateway.ts` — runtime adapter selection.
- `src/test/FakeWorkspaceConnectionGateway.ts` — deterministic component-test adapter.
- `src/pages/SettingsPage.tsx` — workspace status and safe replacement entry point.
- `src/app/App.tsx`, `src/app/AppRoutes.tsx` — dependency injection and workspace gate.

---

### Task 1: Establish Rust error and service boundaries

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/error.rs`

**Interfaces:**
- Produces: `AppError`, `ErrorCode`, `RecoveryAction`, `CommandResult<T>`, and `AppServices` used by every later Rust task.
- Consumes: the existing Tauri builder and store plugin from Foundation.

- [ ] **Step 1: Add a failing serialization test for the public error envelope**

Add this test to `src-tauri/src/error.rs` before defining the types:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_error_contains_code_message_and_recovery_without_secrets() {
        let error = AppError::new(
            ErrorCode::RepositoryPathConflict,
            "선택한 위치에 같은 이름의 폴더가 있습니다.",
        )
        .with_recovery(RecoveryAction::ChooseAnotherDirectory)
        .with_detail("path", "/workspace/mockly-knowledge");

        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], "repository_path_conflict");
        assert_eq!(json["recovery"], "choose_another_directory");
        assert_eq!(json["details"]["path"], "/workspace/mockly-knowledge");
        assert!(json.to_string().find("token").is_none());
    }
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml error::tests::public_error_contains_code_message_and_recovery_without_secrets`

Expected: compilation fails because `AppError`, `ErrorCode`, and `RecoveryAction` do not exist.

- [ ] **Step 3: Add dependencies and implement the shared public contract**

Add these compatible dependency lines and regenerate `Cargo.lock`:

```toml
async-trait = "0.1"
git2 = { version = "0.19", default-features = false, features = ["https", "vendored-libgit2", "vendored-openssl"] }
indexmap = { version = "2", features = ["serde"] }
keyring = { version = "3.6.3", default-features = false }
reqwest = { version = "0.12.28", default-features = false, features = ["json", "rustls-tls"] }
secrecy = "0.8"
serde_yaml_ng = "0.10.0"
sha2 = "0.10"
thiserror = "1"
tokio-util = "0.7"
url = "2"
uuid = { version = "1", features = ["v4", "serde"] }

[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "3.6.3", default-features = false, features = ["apple-native"] }

[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "3.6.3", default-features = false, features = ["windows-native"] }

[dev-dependencies]
tempfile = "3"
```

Implement the stable envelope in `error.rs`:

```rust
use std::collections::BTreeMap;
use serde::Serialize;

pub type CommandResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AuthenticationExpired,
    AuthenticationDenied,
    ReauthenticationRequired,
    CredentialStoreUnavailable,
    GithubPermissionDenied,
    GithubUnavailable,
    RepositoryPathConflict,
    RepositoryRemoteMismatch,
    RepositoryDirty,
    CloneFailed,
    WorkspaceMissing,
    WorkspaceInvalid,
    WorkspaceVersionUnsupported,
    WorkspaceChangedSincePreview,
    PushFailed,
    DraftPullRequestFailed,
    LocalSettingsUnavailable,
    DesktopOnly,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    RestartLogin,
    ReinstallGithubApp,
    ChooseAnotherDirectory,
    ConnectExistingClone,
    CleanWorkingTree,
    OpenWorkspaceFile,
    UpdateOkhub,
    Retry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub recovery: Option<RecoveryAction>,
    pub details: BTreeMap<String, String>,
}
```

Create `state.rs` with an initially empty service container so later tasks add one dependency at a time:

```rust
#[derive(Default)]
pub struct AppServices;
```

Expose `mod error; mod state;` from `lib.rs`, manage `AppServices::default()`, and keep `run()` limited to composition.

- [ ] **Step 4: Run format, unit tests, and minimum-version compilation**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0; the error serialization test passes on macOS and Windows-compatible conditional dependencies resolve.

- [ ] **Step 5: Commit the boundary**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/error.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: add workspace connection service boundaries"
```

### Task 2: Parse and validate `.okf/workspace.yml` v1

**Files:**
- Create: `src-tauri/src/workspace/mod.rs`
- Create: `src-tauri/src/workspace/model.rs`
- Create: `src-tauri/src/workspace/validation.rs`
- Create: `src-tauri/src/workspace/fixtures/valid-workspace.yml`
- Create: `src-tauri/src/workspace/fixtures/unknown-fields.yml`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/workspace/model.rs`
- Test: `src-tauri/src/workspace/validation.rs`

**Interfaces:**
- Produces: `WorkspaceConfigV1`, `WorkspaceDocument::parse`, `validate_workspace`, and `WorkspaceDiagnostic`.
- Consumes: `ErrorCode::WorkspaceInvalid` and `ErrorCode::WorkspaceVersionUnsupported` from Task 1.

- [ ] **Step 1: Write failing parsing and unknown-field preservation tests**

```rust
#[test]
fn parses_v1_and_preserves_unknown_top_level_fields() {
    let source = include_str!("fixtures/unknown-fields.yml");
    let document = WorkspaceDocument::parse(source).unwrap();

    assert_eq!(document.config.workspace.name, "Mockly");
    assert_eq!(document.config.repositories[0].key, "backend");
    assert!(document.config.extra.contains_key("extensions"));

    let serialized = document.to_yaml().unwrap();
    let reparsed = WorkspaceDocument::parse(&serialized).unwrap();
    assert!(reparsed.config.extra.contains_key("extensions"));
}

#[test]
fn reports_a_newer_schema_without_deserializing_it_as_v1() {
    let error = WorkspaceDocument::parse("schema_version: 2\n").unwrap_err();
    assert_eq!(error.code, ErrorCode::WorkspaceVersionUnsupported);
    assert_eq!(error.details["foundVersion"], "2");
}
```

The `unknown-fields.yml` fixture must contain a valid v1 document plus:

```yaml
extensions:
  mockly:
    owner: platform-team
```

- [ ] **Step 2: Run the workspace model tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::model::tests`

Expected: compilation fails because the workspace module and types are absent.

- [ ] **Step 3: Implement the exact v1 types and version gate**

Use `IndexMap<String, serde_yaml_ng::Value>` with `#[serde(flatten)]` on each object that Hub may rewrite. The public model must be:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConfigV1 {
    pub schema_version: u32,
    pub workspace: WorkspaceIdentity,
    pub documents: DocumentsConfig,
    #[serde(default)]
    pub repositories: Vec<LinkedRepository>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<GithubWorkspaceConfig>,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceIdentity {
    pub id: Uuid,
    pub name: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DocumentRoot {
    pub path: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkedRepository {
    pub key: String,
    pub label: String,
    pub github: GithubRepositoryRef,
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}
```

Define the remaining `DocumentsConfig`, `GithubRepositoryRef`, `GithubWorkspaceConfig`, and `GithubProjectRef` fields exactly as section 8 of the approved spec. Parse `schema_version` into a small probe value first; return `WorkspaceVersionUnsupported` before deserializing a value greater than `1`.

- [ ] **Step 4: Write failing validation tests for every v1 invariant**

```rust
#[test]
fn rejects_paths_outside_the_repository_and_duplicate_repository_identity() {
    let mut config = valid_workspace();
    config.documents.roots[0].path = "../outside".into();
    config.repositories.push(config.repositories[0].clone());

    let codes = validate_workspace(&config)
        .into_iter()
        .map(|item| item.code)
        .collect::<Vec<_>>();

    assert!(codes.contains(&WorkspaceDiagnosticCode::DocumentRootOutsideRepository));
    assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryKey));
    assert!(codes.contains(&WorkspaceDiagnosticCode::DuplicateRepositoryLabel));
}
```

Add separate cases for an empty workspace name, zero document roots, absolute paths on Unix and Windows, empty repository key, a key outside `^[a-z][a-z0-9_-]*$`, and missing GitHub Node IDs.

Define `valid_workspace()` once in the validation test module by parsing the checked-in fixture, so every test starts from the same schema:

```rust
fn valid_workspace() -> WorkspaceConfigV1 {
    WorkspaceDocument::parse(include_str!("fixtures/valid-workspace.yml"))
        .unwrap()
        .config
}
```

- [ ] **Step 5: Implement pure validation and run all workspace tests**

`validate_workspace(&WorkspaceConfigV1) -> Vec<WorkspaceDiagnostic>` must return all diagnostics in one pass, not stop at the first. Normalize separators before checking that document roots are non-empty relative paths without `..` components or Windows prefixes.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace::
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: parsing, unknown-field round trip, version gate, and every validation case pass.

- [ ] **Step 6: Commit the schema**

```bash
git add src-tauri/src/workspace src-tauri/src/lib.rs
git commit -m "feat: validate OKF workspace schema"
```

### Task 3: Inspect a knowledge repository and create immutable initialization previews

**Files:**
- Create: `src-tauri/src/workspace/service.rs`
- Create: `src-tauri/src/workspace/fixtures/document-with-backend-ref.md`
- Modify: `src-tauri/src/workspace/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/workspace/service.rs`

**Interfaces:**
- Produces: `WorkspaceService::inspect`, `WorkspaceService::create_initialization_preview`, `WorkspaceInspection`, `InitializationPreview`, and `PreviewRegistry`.
- Consumes: Task 2 parsing and validation types; repository fingerprint is supplied as a string so Task 7 can provide the Git implementation.

- [ ] **Step 1: Write failing repository inspection tests using `tempfile`**

```rust
#[test]
fn missing_workspace_returns_initialization_required_without_writing_files() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("existing")).unwrap();

    let result = WorkspaceService::inspect(directory.path()).unwrap();

    assert_eq!(result, WorkspaceInspection::InitializationRequired);
    assert!(!directory.path().join(".okf").exists());
}

#[test]
fn invalid_workspace_reports_every_diagnostic_and_keeps_source_unchanged() {
    let directory = workspace_with("schema_version: 1\nworkspace: {}\n");
    let before = std::fs::read_to_string(directory.path().join(".okf/workspace.yml")).unwrap();

    let result = WorkspaceService::inspect(directory.path()).unwrap();

    assert!(matches!(result, WorkspaceInspection::Invalid { .. }));
    assert_eq!(before, std::fs::read_to_string(directory.path().join(".okf/workspace.yml")).unwrap());
}
```

Use this test helper in the same module:

```rust
fn workspace_with(source: &str) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join(".okf")).unwrap();
    std::fs::write(directory.path().join(".okf/workspace.yml"), source).unwrap();
    directory
}
```

- [ ] **Step 2: Run the service tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::service::tests`

Expected: compilation fails because `WorkspaceService` is absent.

- [ ] **Step 3: Implement read-only inspection and reference diagnostics**

Return one of these tagged states:

```rust
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum WorkspaceInspection {
    Ready { summary: WorkspaceSummary },
    InitializationRequired,
    Invalid { diagnostics: Vec<WorkspaceDiagnostic> },
    UnsupportedVersion { found_version: u32 },
}
```

For a valid v1 config, scan Markdown and YAML files only under `documents.roots`. Detect `repository: "<key>"` values and add `UnknownRepositoryKey` diagnostics for values absent from `repositories`. Do not rewrite any file during inspection.

- [ ] **Step 4: Write failing preview content and stale-preview tests**

```rust
#[test]
fn preview_contains_only_missing_seed_files_and_a_stable_repository_fingerprint() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(directory.path().join("docs")).unwrap();
    std::fs::write(directory.path().join("docs/existing.md"), "# Existing").unwrap();

    let preview = WorkspaceService::create_initialization_preview(
        directory.path(),
        "Mockly",
        "head:abc123;status:clean",
        RepositoryPopulation::ExistingContent { default_branch: "main".into() },
    )
    .unwrap();

    assert_eq!(preview.branch, "okf/init-workspace");
    assert!(preview.files.iter().any(|file| file.path == ".okf/workspace.yml"));
    assert!(preview.files.iter().any(|file| file.path == ".okf/templates/.gitkeep"));
    assert!(!preview.files.iter().any(|file| file.path == "docs/.gitkeep"));
    assert!(preview.files.iter().all(|file| !file.overwrites_existing));
}
```

- [ ] **Step 5: Implement preview generation and in-memory registry**

`InitializationPreview` must contain:

```rust
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RepositoryPopulation {
    Empty { default_branch: String },
    ExistingContent { default_branch: String },
}
```

Use the `default_branch` inside `RepositoryPopulation`, falling back to `main` before constructing the enum when GitHub returns no value. Use the default branch directly for an empty repository and `okf/init-workspace` for existing content. Generate `workspace.id` once per preview, default `documents.roots` to `docs`, use `repositories: []`, omit `github.project`, and use commit message `chore: initialize OkHub workspace`. Store previews by ID in a `Mutex<HashMap<Uuid, InitializationPreview>>`; never persist token or preview content to device settings.

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace::service::tests`

Expected: all inspection and preview tests pass, including the no-write assertions.

- [ ] **Step 6: Commit repository inspection and preview behavior**

```bash
git add src-tauri/src/workspace src-tauri/src/state.rs
git commit -m "feat: preview OKF workspace initialization"
```

### Task 4: Persist one validated current workspace path locally

**Files:**
- Create: `src-tauri/src/settings/mod.rs`
- Create: `src-tauri/src/settings/model.rs`
- Create: `src-tauri/src/settings/service.rs`
- Create: `src-tauri/src/settings/store_adapter.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/settings/service.rs`

**Interfaces:**
- Produces: `LocalSettingsStore`, `CurrentWorkspace`, and `LocalSettingsService::{load,set,clear}`.
- Consumes: `WorkspaceService::inspect`; only a `Ready` repository can become current.

- [ ] **Step 1: Write failing tests for a single path and invalid-path recovery**

```rust
#[test]
fn setting_a_new_workspace_replaces_only_the_current_path() {
    let store = MemoryLocalSettingsStore::default();
    let service = LocalSettingsService::new(store);

    service.set_current(Path::new("/one")).unwrap();
    service.set_current(Path::new("/two")).unwrap();

    assert_eq!(service.load_current().unwrap().unwrap().path, PathBuf::from("/two"));
    assert_eq!(service.store_keys(), vec!["current-workspace-path"]);
}

#[test]
fn a_missing_saved_folder_returns_disconnected_without_deleting_the_value() {
    let service = service_with_saved_path("/missing");
    let result = service.validate_current(|_| false).unwrap();
    assert_eq!(result.status, CurrentWorkspaceStatus::RecoveryRequired);
    assert_eq!(service.raw_saved_path(), Some("/missing".into()));
}
```

- [ ] **Step 2: Run the settings tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::service::tests`

Expected: compilation fails because the settings module is absent.

- [ ] **Step 3: Implement the store port, service, and Tauri store adapter**

Use this focused boundary:

```rust
pub trait LocalSettingsStore: Send + Sync {
    fn read(&self, key: &str) -> Result<Option<String>, AppError>;
    fn write(&self, key: &str, value: &str) -> Result<(), AppError>;
    fn remove(&self, key: &str) -> Result<(), AppError>;
}

pub const CURRENT_WORKSPACE_PATH_KEY: &str = "current-workspace-path";
```

The production adapter uses the existing Tauri store file `settings.json`. It must coexist with `display-density`; clearing or replacing the workspace path must not remove any other key. Canonicalize a path only after it exists and inspection reports `Ready`.

- [ ] **Step 4: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml settings::
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit 0, and tests prove only one current path is stored without deleting display preferences.

- [ ] **Step 5: Commit device-local workspace state**

```bash
git add src-tauri/src/settings src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: persist the current workspace path"
```

### Task 5: Authenticate with GitHub Device Flow and OS credential storage

**Files:**
- Create: `src-tauri/src/auth/mod.rs`
- Create: `src-tauri/src/auth/model.rs`
- Create: `src-tauri/src/auth/ports.rs`
- Create: `src-tauri/src/auth/service.rs`
- Create: `src-tauri/src/auth/keyring_store.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/auth/service.rs`

**Interfaces:**
- Produces: `AuthService::{begin,run,valid_access_token,logout}`, `CredentialStore`, `DeviceFlowApi`, `DeviceAuthorization`, and `AuthStatusEvent`.
- Consumes: `AppError`, `reqwest`, the compile/runtime Client ID, and `CancellationToken`.

- [ ] **Step 1: Write failing state-transition and refresh-rotation tests**

```rust
#[tokio::test]
async fn device_flow_stores_tokens_and_emits_only_public_status() {
    let api = FakeDeviceFlowApi::approved_after_two_polls();
    let credentials = MemoryCredentialStore::default();
    let events = RecordingAuthEvents::default();
    let service = AuthService::new(api, credentials.clone(), FakeClock::at(1_000), NoDelay, events.clone());

    let authorization = service.begin().await.unwrap();
    service.run(authorization.request_id, CancellationToken::new()).await.unwrap();

    assert_eq!(credentials.saved_access_token(), "ghu_private");
    assert_eq!(events.statuses(), vec!["waiting_for_user", "authenticated"]);
    assert!(serde_json::to_string(&events).unwrap().find("ghu_private").is_none());
}

#[tokio::test]
async fn expired_access_token_rotates_both_tokens_without_a_client_secret() {
    let api = FakeDeviceFlowApi::with_refresh_result("ghu_new", "ghr_new", 28_800, 15_897_600);
    let credentials = MemoryCredentialStore::with_expired("ghu_old", "ghr_old");
    let service = test_service(api, credentials.clone());

    assert_eq!(service.valid_access_token().await.unwrap().expose_secret(), "ghu_new");
    assert_eq!(credentials.saved_refresh_token(), "ghr_new");
    assert_eq!(api.last_refresh_client_secret(), None);
}
```

Add denial, device-code expiry, `slow_down`, cancellation, missing credentials, refresh-token expiry, and logout cases.

- [ ] **Step 2: Run the auth tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml auth::service::tests`

Expected: compilation fails because AuthService and its ports are absent.

- [ ] **Step 3: Implement private token types and the Device Flow service**

Keep private values out of `Debug` and serialization:

```rust
pub struct StoredTokens {
    access_token: SecretString,
    refresh_token: SecretString,
    access_expires_at_unix: i64,
    refresh_expires_at_unix: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuthorization {
    pub request_id: Uuid,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at_unix: i64,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubUserSummary {
    pub id: u64,
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AuthStatusEvent {
    WaitingForUser { request_id: Uuid },
    Authenticated { request_id: Uuid, user: GithubUserSummary },
    ReauthenticationRequired { request_id: Uuid },
    Failed { request_id: Uuid, error: AppError },
    Cancelled { request_id: Uuid },
}
```

`begin` requests a device code with `client_id`; `run` respects GitHub's returned interval, increases it by five seconds after `slow_down`, and stops at expiry or cancellation. Refresh with `client_id`, `grant_type=refresh_token`, and `refresh_token`; do not send `client_secret` for Device Flow tokens.

- [ ] **Step 4: Implement the keyring adapter and platform compile guards**

Use service name `com.okhub.desktop.github` and account name `current-user`. Encode the private token record as JSON inside the credential value, never in Tauri store. On unsupported test targets compile a constructor that returns `CredentialStoreUnavailable`; unit tests use `MemoryCredentialStore` and never touch the developer's real keychain.

For macOS and Windows, initialize `keyring::Entry` and map missing entries to `Ok(None)`. A malformed stored record produces `ReauthenticationRequired` and does not echo the malformed contents.

- [ ] **Step 5: Run auth, Rust, and platform build checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml auth::
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass; serialized events and failures contain no token prefixes `ghu_` or `ghr_`.

Then run a manual Device Flow smoke test with `OKHUB_GITHUB_CLIENT_ID` set and confirm the credential appears in macOS Keychain under `com.okhub.desktop.github`, not in `settings.json`.

- [ ] **Step 6: Commit authentication**

```bash
git add src-tauri/src/auth src-tauri/src/state.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: authenticate with GitHub device flow"
```

### Task 6: List accessible repositories and create initialization Draft PRs

**Files:**
- Create: `src-tauri/src/github/mod.rs`
- Create: `src-tauri/src/github/model.rs`
- Create: `src-tauri/src/github/client.rs`
- Create: `src-tauri/src/github/fixtures/installations-page.json`
- Create: `src-tauri/src/github/fixtures/repository-page.json`
- Modify: `src-tauri/src/auth/service.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/github/client.rs`

**Interfaces:**
- Produces: `GithubService::{current_user,list_repositories,repository_detail,resolve_remote_repository,create_draft_pull_request}`.
- Consumes: `AuthService::valid_access_token()` and returns token-free DTOs.

- [ ] **Step 1: Write failing fixture-driven mapping and pagination tests**

```rust
#[test]
fn maps_installation_repositories_to_public_summaries() {
    let response: GithubRepositoryPageResponse = serde_json::from_str(
        include_str!("fixtures/repository-page.json"),
    )
    .unwrap();

    let page = response.into_page(Some("installation:42:page:2".into()));
    assert_eq!(page.items[0].id, "R_kgDOExample");
    assert_eq!(page.items[0].full_name, "Mockly-Company/mockly-knowledge");
    assert_eq!(page.next_cursor.as_deref(), Some("installation:42:page:2"));
    assert!(serde_json::to_string(&page).unwrap().find("token").is_none());
}
```

Add tests for an empty repository with no default branch, renamed repository resolution by Node ID, `401`, `403`, `404`, rate limit, and Draft PR response mapping.

- [ ] **Step 2: Run the GitHub client tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml github::client::tests`

Expected: compilation fails because the GitHub module is absent.

- [ ] **Step 3: Implement the HTTP client and token-free DTOs**

Use base URLs and an `HttpTransport` port injected into `GithubHttpClient` so tests can record requests without network access. Every API request obtains a fresh valid access token immediately before sending. Send `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`, and a stable `User-Agent: OkHub/<package-version>`.

Expose these DTOs:

```rust
pub struct GithubRepositorySummary {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub default_branch: Option<String>,
    pub is_empty: bool,
}

pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

pub struct DraftPullRequestRequest {
    pub repository_full_name: String,
    pub head: String,
    pub base: String,
    pub title: String,
    pub body: String,
}
```

List `/user/installations`, then `/user/installations/{installation_id}/repositories`, preserving a cursor that includes installation and page. `resolve_remote_repository` parses GitHub HTTPS or SSH remotes, requests `/repos/{owner}/{repo}`, and compares the returned Node ID.

- [ ] **Step 4: Implement the fixed Draft PR body convention and error mapping**

Use title `Initialize OkHub workspace` and this body:

```markdown
## Summary

- Initialize this repository as an OkHub knowledge workspace

## Why

- Share OKF documents and workspace metadata through Git

## Changes

- Add `.okf/workspace.yml`
- Add the initial document and template roots when missing

## Test Plan

- Validate `.okf/workspace.yml` in OkHub
- Confirm the configured document root stays inside the repository

## Review Notes

- This change contains workspace metadata only
```

Map authentication failures to `ReauthenticationRequired`, installation access failures to `GithubPermissionDenied`, network/rate-limit failures to `GithubUnavailable`, and a Draft PR failure after a successful push to `DraftPullRequestFailed`. Attach `Retry` recovery and the already-pushed branch name to the latter. Never include response authorization headers or token-bearing request details.

- [ ] **Step 5: Run focused and full Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml github::
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: fixture mapping, pagination, error mapping, renamed repository resolution, and Draft PR payload tests pass.

- [ ] **Step 6: Commit the GitHub repository API**

```bash
git add src-tauri/src/github src-tauri/src/auth/service.rs src-tauri/src/state.rs
git commit -m "feat: access GitHub knowledge repositories"
```

### Task 7: Connect, clone, and initialize repositories without overwriting user work

**Files:**
- Create: `src-tauri/src/repository/mod.rs`
- Create: `src-tauri/src/repository/model.rs`
- Create: `src-tauri/src/repository/service.rs`
- Create: `src-tauri/src/repository/git2_adapter.rs`
- Modify: `src-tauri/src/workspace/service.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/repository/service.rs`
- Test: `src-tauri/src/repository/git2_adapter.rs`

**Interfaces:**
- Produces: `RepositoryService::{inspect_existing,clone,initialize}`, `GitRepositoryPort`, `RepositorySnapshot`, and `InitializationResult`.
- Consumes: valid GitHub token, selected repository detail, Task 3 preview, and Task 6 Draft PR creation.

- [ ] **Step 1: Write failing path collision and remote identity tests**

```rust
#[test]
fn clone_target_is_repository_name_below_the_selected_parent() {
    let parent = tempfile::tempdir().unwrap();
    let target = RepositoryService::clone_target(parent.path(), "mockly-knowledge").unwrap();
    assert_eq!(target, parent.path().join("mockly-knowledge"));
}

#[test]
fn an_existing_non_git_folder_is_a_conflict_and_is_not_deleted() {
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join("mockly-knowledge");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("keep.txt"), "mine").unwrap();

    let error = RepositoryService::ensure_clone_target(&target).unwrap_err();
    assert_eq!(error.code, ErrorCode::RepositoryPathConflict);
    assert_eq!(std::fs::read_to_string(target.join("keep.txt")).unwrap(), "mine");
}
```

Add existing matching clone, mismatched remote, dirty working tree, empty remote, and existing-content repository cases.

- [ ] **Step 2: Run repository tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repository::service::tests`

Expected: compilation fails because `RepositoryService` is absent.

- [ ] **Step 3: Implement inspection, fingerprinting, and safe clone**

Define:

```rust
pub struct RepositorySnapshot {
    pub root: PathBuf,
    pub head_oid: Option<String>,
    pub default_branch: Option<String>,
    pub is_dirty: bool,
    pub has_content: bool,
    pub remote_url: Option<String>,
    pub fingerprint: String,
}

pub struct CloneRequest {
    pub repository_id: String,
    pub full_name: String,
    pub https_url: String,
    pub parent_directory: PathBuf,
}
```

Build the fingerprint as SHA-256 over canonical root, HEAD OID or `empty`, sorted status entries, and remote URL. For existing clones, resolve the remote through `GithubService` and compare Node IDs. For clone, use git2 credential callbacks with username `x-access-token` and the access token exposed only inside the callback; write the clean HTTPS URL to `origin`.

Emit progress values `receiving_objects`, `resolving_deltas`, and `checking_out` without paths containing credentials. On failure keep the target directory and return its path with `CloneFailed` and `Retry`.

- [ ] **Step 4: Write failing initialization execution tests**

```rust
#[test]
fn stale_preview_does_not_write_or_commit() {
    let fixture = initialized_repository_with_existing_content();
    let preview = fixture.preview();
    std::fs::write(fixture.path().join("changed.md"), "changed").unwrap();

    let error = fixture.service.initialize(preview.id).unwrap_err();

    assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
    assert!(!fixture.path().join(".okf/workspace.yml").exists());
}

#[test]
fn existing_content_uses_init_branch_and_requests_one_draft_pr() {
    let fixture = initialized_repository_with_existing_content();
    let result = fixture.service.initialize(fixture.preview().id).unwrap();

    assert_eq!(result.branch, "okf/init-workspace");
    assert_eq!(result.commit_message, "chore: initialize OkHub workspace");
    assert_eq!(fixture.github.draft_pr_requests().len(), 1);
    assert_eq!(fixture.original_branch(), "main");
}
```

Add empty repository initial commit, existing target file refusal, push failure with local commit preservation, existing `okf/init-workspace` branch, and retry after a successful remote push cases.

- [ ] **Step 5: Implement idempotent initialization**

Before writing, reload the preview, recalculate the fingerprint, ensure the worktree is clean, and verify every preview path is absent. Write files using create-new semantics. Commit with the authenticated user's GitHub login and noreply address `{database_id}+{login}@users.noreply.github.com`.

For an empty repository, create the GitHub-reported default branch or `main`, push the initial commit, and do not create a PR. For existing content, create `okf/init-workspace` from the current default-branch HEAD, commit, push, request one Draft PR, then return the connected clone to its original branch. If push fails, keep the local commit and branch and return their names. If the remote branch already contains the same commit, treat retry as success instead of pushing a duplicate.

- [ ] **Step 6: Run repository integration tests with temporary bare remotes**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml repository::
cargo test --manifest-path src-tauri/Cargo.toml workspace::
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: all clone, collision, identity, fingerprint, branch, commit, push-failure, and idempotency tests pass against temporary repositories.

- [ ] **Step 7: Commit Git behavior**

```bash
git add src-tauri/src/repository src-tauri/src/workspace/service.rs src-tauri/src/state.rs
git commit -m "feat: connect and initialize knowledge repositories"
```

### Task 8: Expose narrow Tauri commands and cancellable events

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/auth.rs`
- Create: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Test: `src-tauri/src/commands/auth.rs`
- Test: `src-tauri/src/commands/workspace.rs`

**Interfaces:**
- Produces Tauri commands: `get_auth_state`, `begin_github_auth`, `cancel_github_auth`, `logout_github`, `list_github_repositories`, `inspect_existing_clone`, `clone_repository`, `inspect_workspace`, `connect_workspace`, `preview_workspace_initialization`, `initialize_workspace`, and `get_current_workspace`.
- Emits: `github-auth-status` and `repository-clone-progress` with request IDs.
- Consumes: Tasks 3–7 services through `AppServices`.

- [ ] **Step 1: Write failing command serialization and token-boundary tests**

```rust
#[tokio::test]
async fn begin_auth_returns_public_device_fields_only() {
    let state = test_app_services_with_approved_device_flow();
    let result = begin_github_auth_inner(&state).await.unwrap();
    let json = serde_json::to_string(&result).unwrap();

    assert!(json.contains("userCode"));
    assert!(json.contains("verificationUri"));
    assert!(!json.contains("device_code"));
    assert!(!json.contains("access_token"));
    assert!(!json.contains("refresh_token"));
}

#[tokio::test]
async fn initialization_requires_a_registered_preview_id() {
    let state = test_app_services();
    let error = initialize_workspace_inner(&state, Uuid::new_v4()).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::WorkspaceChangedSincePreview);
}
```

- [ ] **Step 2: Run the command tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands::`

Expected: compilation fails because the commands are absent.

- [ ] **Step 3: Implement command orchestration and cancellation**

Put orchestration in testable inner functions such as `begin_github_auth_inner(&AppServices)` and `initialize_workspace_inner(&AppServices, Uuid)`. Each `#[tauri::command]` function only unwraps `State<'_, AppServices>` and delegates to its inner function.

`begin_github_auth_inner` accepts the frontend-issued request ID, validates and atomically stores it with a `CancellationToken`, spawns `AuthService::run`, and emits each public status with the same ID through `app.emit("github-auth-status", event)`. `cancel_github_auth` cancels only the matching job. Clone accepts and registers the same kind of caller-issued ID before work, then uses it for the command result and every `repository-clone-progress` payload. Duplicate active IDs fail before a second worker starts. Command/event arrival order is not assumed.

Run blocking keyring and git2 operations through `tauri::async_runtime::spawn_blocking`. Remove completed job handles from state. Every command returns `CommandResult<T>` and never stringifies internal `Debug` errors directly.

- [ ] **Step 4: Register production services, commands, plugins, and capability permissions**

In `lib.rs`, initialize in this order:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(build_app_services)
    .invoke_handler(tauri::generate_handler![
        commands::auth::get_auth_state,
        commands::auth::begin_github_auth,
        commands::auth::cancel_github_auth,
        commands::auth::logout_github,
        commands::workspace::list_github_repositories,
        commands::workspace::inspect_existing_clone,
        commands::workspace::clone_repository,
        commands::workspace::inspect_workspace,
        commands::workspace::connect_workspace,
        commands::workspace::preview_workspace_initialization,
        commands::workspace::initialize_workspace,
        commands::workspace::get_current_workspace,
    ])
```

Add Tauri dialog and opener packages through `pnpm tauri add dialog` and `pnpm tauri add opener`; confirm `capabilities/default.json` contains only the generated minimal permissions needed to choose a directory and open the GitHub verification URL.

- [ ] **Step 5: Run Rust tests and a Tauri debug build**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
```

Expected: both commands exit 0; command JSON snapshots contain no private token or device code.

- [ ] **Step 6: Commit the desktop API**

```bash
git add package.json pnpm-lock.yaml src-tauri
git commit -m "feat: expose workspace connection desktop API"
```

### Task 9: Build the React gateway and pure connection state machine

**Files:**
- Create: `src/features/workspace-connection/types.ts`
- Create: `src/features/workspace-connection/WorkspaceConnectionGateway.ts`
- Create: `src/features/workspace-connection/connection-reducer.ts`
- Create: `src/features/workspace-connection/connection-reducer.test.ts`
- Create: `src/infrastructure/workspace/TauriWorkspaceConnectionGateway.ts`
- Create: `src/infrastructure/workspace/UnavailableWorkspaceConnectionGateway.ts`
- Create: `src/infrastructure/workspace/createWorkspaceConnectionGateway.ts`
- Create: `src/test/FakeWorkspaceConnectionGateway.ts`

**Interfaces:**
- Produces: `WorkspaceConnectionGateway`, `ConnectionState`, `connectionReducer`, and production/test adapters.
- Consumes: exact camelCase command DTOs from Task 8.

- [ ] **Step 1: Write failing reducer invalidation tests**

```ts
it("clears repository-dependent state when the selected repository changes", () => {
  const state = readyToInitializeState({ repositoryId: "old" });
  const next = connectionReducer(state, {
    type: "repositorySelected",
    repository: repositorySummary({ id: "new" }),
  });

  expect(next.step).toBe("local");
  expect(next.localRepository).toBeNull();
  expect(next.workspaceInspection).toBeNull();
  expect(next.initializationPreview).toBeNull();
});

it("does not mark initialization complete until the command succeeds", () => {
  const pending = connectionReducer(previewState(), { type: "initializationStarted" });
  expect(pending.status).toBe("initializing");
  expect(pending.connectedWorkspace).toBeNull();
});
```

Add login restart, repository page append, clone progress, cancel, invalid YAML, stale preview, successful connection, and replacement cancel cases.

- [ ] **Step 2: Run the reducer tests and verify they fail**

Run: `pnpm test:run src/features/workspace-connection/connection-reducer.test.ts`

Expected: module resolution fails because the reducer is absent.

- [ ] **Step 3: Define the gateway and reducer types exactly once**

```ts
export interface WorkspaceConnectionGateway {
  getCurrentWorkspace(): Promise<CurrentWorkspaceState>;
  getAuthState(): Promise<AuthState>;
  beginGithubAuth(requestId: string): Promise<DeviceAuthorization>;
  cancelGithubAuth(requestId: string): Promise<void>;
  logoutGithub(): Promise<void>;
  onAuthStatus(listener: (event: AuthStatusEvent) => void): Promise<Unlisten>;
  listRepositories(cursor?: string): Promise<Page<GithubRepositorySummary>>;
  pickDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  inspectExistingClone(path: string, repositoryId: string): Promise<LocalRepository>;
  cloneRepository(requestId: string, repositoryId: string, parentDirectory: string): Promise<CloneJob>;
  onCloneProgress(listener: (event: CloneProgressEvent) => void): Promise<Unlisten>;
  inspectWorkspace(path: string): Promise<WorkspaceInspection>;
  connectWorkspace(path: string): Promise<ConnectedWorkspace>;
  previewInitialization(input: PreviewInitializationInput): Promise<InitializationPreview>;
  initializeWorkspace(previewId: string): Promise<ConnectedWorkspace>;
}
```

Use a discriminated union for `ConnectionState` with steps `auth`, `repository`, `local`, and `initialize`. The reducer owns invalidation; components never mutate downstream selections independently.

- [ ] **Step 4: Implement the Tauri and browser-unavailable adapters**

Map every method to one Task 8 command. Use `@tauri-apps/plugin-dialog` with `{ directory: true, multiple: false }`, `@tauri-apps/plugin-opener` for GitHub URLs, and `@tauri-apps/api/event` for events. The browser adapter returns `DesktopOnly` with the message `GitHub 연결은 OkHub 데스크톱 앱에서 사용할 수 있습니다.` for mutating operations; it must not fabricate a connected workspace.

- [ ] **Step 5: Run reducer, TypeScript, and existing tests**

Run:

```bash
pnpm test:run src/features/workspace-connection/connection-reducer.test.ts
pnpm test:run
pnpm build
```

Expected: reducer and existing Foundation tests pass; production TypeScript compiles without duplicate DTO definitions.

- [ ] **Step 6: Commit the frontend boundary**

```bash
git add src/features/workspace-connection src/infrastructure/workspace src/test/FakeWorkspaceConnectionGateway.ts
git commit -m "feat: add workspace connection state machine"
```

### Task 10: Implement the first-run connection UI and routing gate

**Files:**
- Create: `src/features/workspace-connection/WorkspaceConnectionProvider.tsx`
- Create: `src/features/workspace-connection/WorkspaceConnectionProvider.test.tsx`
- Create: `src/features/workspace-connection/WorkspaceGate.tsx`
- Create: `src/features/workspace-connection/WorkspaceGate.test.tsx`
- Create: `src/features/workspace-connection/WorkspaceConnectionPage.tsx`
- Create: `src/features/workspace-connection/WorkspaceConnectionPage.test.tsx`
- Create: `src/features/workspace-connection/components/GitHubLoginStep.tsx`
- Create: `src/features/workspace-connection/components/RepositorySelectionStep.tsx`
- Create: `src/features/workspace-connection/components/LocalConnectionStep.tsx`
- Create: `src/features/workspace-connection/components/InitializationPreview.tsx`
- Create: `src/features/workspace-connection/components/ConnectionError.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/AppRoutes.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/globals.css`

**Interfaces:**
- Produces: first-run `GitHub 로그인 → OKF 저장소 선택 → 로컬 연결` experience and connected-workspace gate.
- Consumes: Task 9 gateway/reducer and existing OkHub primitives/tokens.

- [ ] **Step 1: Write failing gate and happy-path component tests**

```tsx
it("shows the connection flow instead of the app shell when no workspace is saved", async () => {
  renderApp({ gateway: FakeWorkspaceConnectionGateway.disconnected() });
  expect(await screen.findByRole("heading", { name: "GitHub에 연결" })).toBeInTheDocument();
  expect(screen.queryByRole("main", { name: "OkHub" })).not.toBeInTheDocument();
});

it("connects an existing initialized clone and opens Home", async () => {
  const gateway = FakeWorkspaceConnectionGateway.existingReadyClone();
  renderApp({ gateway });

  await userEvent.click(screen.getByRole("button", { name: "GitHub 로그인" }));
  gateway.approveAuthentication();
  await userEvent.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
  await userEvent.click(screen.getByRole("button", { name: "다음" }));
  await userEvent.click(screen.getByRole("button", { name: "기존 clone 연결" }));

  expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeInTheDocument();
});
```

Add initialization preview confirmation, cancel-without-write, repository refresh, folder collision, invalid YAML, Device Flow expiry, clone progress, keyboard focus, and compact-density cases.

- [ ] **Step 2: Run focused UI tests and verify they fail**

Run: `pnpm test:run src/features/workspace-connection/WorkspaceConnectionPage.test.tsx src/features/workspace-connection/WorkspaceGate.test.tsx`

Expected: module resolution fails because the provider, gate, and page are absent.

- [ ] **Step 3: Implement provider orchestration and gate**

`WorkspaceConnectionProvider` owns the gateway, reducer, event cleanup, and async commands. It exposes:

```ts
export interface WorkspaceConnectionContextValue {
  state: ConnectionState;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  refreshRepositories(): Promise<void>;
  selectRepository(repository: GithubRepositorySummary): void;
  connectExistingClone(): Promise<void>;
  cloneIntoSelectedParent(): Promise<void>;
  confirmInitialization(): Promise<void>;
  retryLastAction(): Promise<void>;
  startReplacement(): void;
  cancelReplacement(): void;
}
```

For Device Flow and clone, the Provider creates the UUID, dispatches the start action so the reducer owns it, and then passes the same UUID to the gateway. Listener callbacks only dispatch events. Repository loading, inspection, and connection are launched only from reducer-accepted state transitions, never directly from a raw event or stale command result. Auth/clone pre-publication buffers and provider-side ownership mirrors are forbidden.

At startup, `WorkspaceGate` waits for `getCurrentWorkspace`. Render an accessible busy state while loading, the connection page for `disconnected` or `recovery_required`, and `<Outlet />` only for `connected`.

- [ ] **Step 4: Implement the three-step page and conditional initialization panel**

Use one visible decision per step:

1. `GitHub 로그인` shows the verification URL, copyable user code, expiration, cancel, and restart.
2. `OKF 저장소 선택` shows repository owner/name, pagination, refresh, and `GitHub에서 새 저장소 만들기`.
3. `로컬 연결` shows `기존 clone 연결` and `새 위치에 clone`; the latter chooses a parent and previews `{parent}/{repository-name}`.

If inspection requires initialization, stay within step 3 and show `InitializationPreview` with every file path and full generated content, target branch, direct-push versus Draft PR explanation, `취소`, and `워크스페이스 초기화`. Do not use an unlabelled ellipsis action.

`ConnectionError` maps every `RecoveryAction` to one explicit button and always shows the preserved local path when supplied.

- [ ] **Step 5: Inject dependencies without breaking Foundation tests**

Allow tests to supply gateways while production uses factories:

```tsx
interface AppProps {
  workspaceGateway?: WorkspaceConnectionGateway;
  preferencesRepository?: PreferencesRepository;
}

export function App({
  workspaceGateway = createWorkspaceConnectionGateway(),
  preferencesRepository = createPreferencesRepository(),
}: AppProps) {
  return (
    <PreferencesProvider repository={preferencesRepository}>
      <WorkspaceConnectionProvider gateway={workspaceGateway}>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </WorkspaceConnectionProvider>
    </PreferencesProvider>
  );
}
```

Update `App.test.tsx` to inject `FakeWorkspaceConnectionGateway.connected()` so its existing application-landmark assertion remains meaningful.

- [ ] **Step 6: Run UI tests, accessibility scan, and build**

Run:

```bash
pnpm test:run src/features/workspace-connection
pnpm test:run
pnpm build
```

Expected: all tests pass, each step has one `h1`, progress is announced without stealing focus, controls have accessible names, and Default/Compact layouts compile.

- [ ] **Step 7: Commit the first-run UI**

```bash
git add src/app src/features/workspace-connection src/styles/globals.css src/test/FakeWorkspaceConnectionGateway.ts
git commit -m "feat: add first-run workspace connection"
```

### Task 11: Add workspace status and safe replacement to Settings

**Files:**
- Create: `src/features/workspace-connection/components/WorkspaceSettingsPanel.tsx`
- Create: `src/features/workspace-connection/components/WorkspaceSettingsPanel.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SettingsPage.test.tsx`
- Modify: `src/features/workspace-connection/WorkspaceConnectionProvider.tsx`

**Interfaces:**
- Produces: current OKF repository/path status, revalidation, and replacement entry point.
- Consumes: Task 10 context. Replacement preserves the old connection until the new one reaches `connected`.

- [ ] **Step 1: Write failing replacement safety tests**

```tsx
it("keeps the current clone when replacement is cancelled", async () => {
  const gateway = FakeWorkspaceConnectionGateway.connected("/work/mockly-knowledge");
  renderSettings({ gateway });

  await userEvent.click(screen.getByRole("button", { name: "다른 지식 저장소 연결" }));
  await userEvent.click(await screen.findByRole("button", { name: "연결 취소" }));

  expect(await screen.findByText("/work/mockly-knowledge")).toBeInTheDocument();
  expect(gateway.deletedPaths).toEqual([]);
});
```

Add current validation success, missing folder recovery, invalid YAML diagnosis, replacement success, and logout-with-clone-preserved cases.

- [ ] **Step 2: Run focused Settings tests and verify they fail**

Run: `pnpm test:run src/features/workspace-connection/components/WorkspaceSettingsPanel.test.tsx src/pages/SettingsPage.test.tsx`

Expected: tests fail because the workspace panel and replacement behavior are absent.

- [ ] **Step 3: Implement the Workspace settings category**

Make the existing six Settings categories selectable. `워크스페이스` displays:

- knowledge repository `owner/name`
- canonical local clone path
- `.okf/workspace.yml` status and schema version
- last validation result from the current session
- `다시 확인` and `다른 지식 저장소 연결` buttons

Replacement enters the same first-run page with `연결 취소`. Keep the old `CurrentWorkspace` in context until the new initialization/validation and `set_current` succeed atomically. Never delete the previous path. The `화면` category retains its existing density behavior and tests.

- [ ] **Step 4: Run Settings, frontend, and Tauri build checks**

Run:

```bash
pnpm test:run src/pages/SettingsPage.test.tsx src/features/workspace-connection/components/WorkspaceSettingsPanel.test.tsx
pnpm test:run
pnpm build
pnpm tauri build --debug --no-bundle
```

Expected: replacement and existing display-density tests pass, web build passes, and the desktop debug build exits 0.

- [ ] **Step 5: Commit Settings integration**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/features/workspace-connection
git commit -m "feat: manage the current workspace connection"
```

### Task 12: Verify security, cross-platform builds, and the complete acceptance flow

**Files:**
- Modify: `.github/workflows/verify.yml`
- Create: `docs/development/github-app.md`
- Modify: `README.md`
- Test: `src-tauri/src/auth/service.rs`
- Test: `src-tauri/src/repository/service.rs`
- Test: `src/features/workspace-connection/WorkspaceConnectionPage.test.tsx`

**Interfaces:**
- Produces: reproducible contributor setup, CI checks, and release-ready acceptance evidence.
- Consumes: all previous tasks.

- [ ] **Step 1: Add a failing secret-leak regression scan**

Create a Rust test that serializes every public auth/error variant and asserts none contains `access_token`, `refresh_token`, `device_code`, `ghu_`, or `ghr_`. Create a frontend test that records all gateway state exposed to React and applies the same assertions.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml token_boundary
pnpm test:run -t "token boundary"
```

Expected: at least one test initially fails if an internal field is still exposed; remove the exposure at the owning boundary, not by string replacement.

- [ ] **Step 2: Document exact GitHub App and local development setup**

`docs/development/github-app.md` must include:

- owner `Mockly-Company`
- public installation setting
- Device Flow enabled
- expiring user-to-server tokens enabled
- Metadata read, Contents read/write, Pull requests read/write
- `OKHUB_GITHUB_CLIENT_ID` as a public build value, never a secret
- no Client Secret or private key in desktop configuration
- where macOS Keychain and Windows Credential Store entries appear
- how to log out and remove only credentials
- how to run the manual smoke test against a disposable knowledge repository

Update README development commands and link the approved design and this setup guide.

- [ ] **Step 3: Extend CI with minimum-version and secret-pattern checks**

Keep the macOS/Windows matrix and add:

```yaml
- run: cargo fmt --manifest-path src-tauri/Cargo.toml --check
- run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
- run: cargo test --manifest-path src-tauri/Cargo.toml
- run: pnpm test:run
- run: pnpm build
- run: pnpm tauri build --debug --no-bundle
```

Add a separate `rust-minimum` job on `macos-latest` using Rust `1.88.0` that runs `cargo check --manifest-path src-tauri/Cargo.toml`. Keep the dependency lockfile compatible with that toolchain. Do not pass real GitHub tokens to pull-request jobs.

- [ ] **Step 4: Run the complete local verification suite**

Run:

```bash
pnpm test:run
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
git diff --check
```

Expected: every command exits 0 with no test failures, compiler errors, Clippy warnings, or whitespace errors.

- [ ] **Step 5: Perform the real-device acceptance walkthrough**

Using a disposable GitHub knowledge repository and the public GitHub App Client ID, verify these paths and record outcomes in the PR Test Plan:

1. Device Flow login stores credentials in the OS keychain and nowhere in `settings.json`.
2. Repository list contains only installations the App can access.
3. Existing matching clone connects; mismatched remote does not.
4. New clone appears at `{selected-parent}/{repository-name}`.
5. Same-name ordinary folder is preserved and produces a path-conflict action.
6. Existing valid workspace opens Home.
7. Invalid YAML stays unchanged and shows the file and diagnostic.
8. Empty repository initializes its default branch after confirmation.
9. Existing-content repository pushes `okf/init-workspace` and creates one Draft PR.
10. Network failure preserves local clone/commit state and offers a safe retry.
11. Settings replacement can be cancelled without losing the previous connection.
12. Logout removes credentials without deleting either clone.

- [ ] **Step 6: Commit verification and contributor documentation**

```bash
git add .github/workflows/verify.yml docs/development/github-app.md README.md src-tauri/src/auth/service.rs src-tauri/src/repository/service.rs src/features/workspace-connection/WorkspaceConnectionPage.test.tsx
git commit -m "test: verify workspace connection flow"
```

## Final Review Gate

### Spec coverage map

| Approved design area | Implementation tasks |
|---|---|
| App repository versus OKF knowledge repository boundary | Global constraints, Tasks 2–4, Task 12 |
| Public GitHub App, Device Flow, token rotation, OS credential storage | Tasks 5, 6, 8, 12 |
| Existing clone and user-selected parent-directory clone | Tasks 7, 8, 10 |
| `.okf/workspace.yml` v1 schema, stable IDs, `key`/`label`, unknown fields | Tasks 2, 3 |
| Initialization preview, empty-repository push, existing-content Draft PR | Tasks 3, 6, 7, 10 |
| One device-local current workspace and safe replacement | Tasks 4, 8, 10, 11 |
| Error recovery, no overwrite/delete/force-push | Tasks 1, 3–8, 10–12 |
| React/Rust boundary and token-free Tauri DTOs | Tasks 1, 5, 8, 9 |
| Unit, integration, accessibility, macOS, and Windows verification | Every task, with full acceptance in Task 12 |

Before requesting review:

1. Compare every section of `docs/superpowers/specs/2026-07-25-github-workspace-connection-design.md` to Tasks 1–12.
2. Confirm no command or serialized DTO exposes a token, device code, Client Secret, or private key.
3. Confirm all filesystem and Git mutation paths are behind an explicit preview confirmation.
4. Confirm `git status --short` in the feature worktree contains no generated credentials, `.env`, incomplete clone, or unrelated documentation.
5. Run the complete verification suite from Task 12 again after the final review fix.
6. Request a code review before push or PR creation.

The pull request description must use these sections and noun/action phrasing:

```markdown
## Summary

## Why

## Changes

## Test Plan

## Review Notes
```

Do not use narrative phrases ending in `~했습니다`.
