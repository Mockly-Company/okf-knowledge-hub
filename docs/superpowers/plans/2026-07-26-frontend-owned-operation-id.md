# Frontend-Owned Operation ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub Device Flow and repository clone use a frontend-issued UUID from ownership registration through every Rust command result and event, removing pre-publication buffering and preventing raw rejected events from launching downstream work.

**Architecture:** React generates a UUID v4, registers it in the pure reducer, then calls the Tauri gateway with that same ID after listeners are ready. Rust validates and atomically registers the caller ID before starting work; all public events and command results echo it. Provider listeners only dispatch events, while reducer-accepted state transitions drive repository loading, workspace inspection, and connection.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, Rust, Tokio, UUID, serde.

## Global Constraints

- Keep reducer rejection of stale request IDs, repositories, and paths.
- Do not depend on command Promise/event delivery ordering.
- Do not add an unbounded buffer, provider-side last-action state, or provider-side ownership mirror.
- Register listeners before starting auth or clone and always clean up unlisteners.
- Reject duplicate active UUIDs before starting a second backend worker.
- Keep token material out of command results, events, logs, and React state.
- Preserve current cancellation, durable clone recovery, and browser fail-closed behavior.
- Use strict RED-GREEN TDD and task-separated commits. Do not push or open a PR.

---

### Task 1: Accept caller-owned IDs in Rust auth and clone commands

**Files:**
- Modify: `src-tauri/src/auth/service.rs`
- Modify: `src-tauri/src/commands/auth.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/state.rs`
- Test: `src-tauri/src/auth/service.rs`
- Test: `src-tauri/src/commands/auth.rs`
- Test: `src-tauri/src/commands/workspace.rs`
- Test: `src-tauri/src/state.rs`

**Interfaces:**
- Produces: `begin_github_auth(request_id)` and `clone_repository(request_id, repository, parent_directory)` commands whose result/events preserve the caller UUID.
- Consumes: existing auth, repository, cancellation, event, and durable recovery services.

- [ ] Write Rust tests proving a supplied UUID appears unchanged in authorization/clone results and every terminal/progress event.
- [ ] Write concurrency tests proving a duplicate active UUID is rejected before a second worker starts, while a completed ID can follow the explicitly chosen lifecycle policy without colliding with another active job.
- [ ] Run the focused command/service tests and confirm the new signatures and duplicate-ID assertions fail.
- [ ] Change auth begin and clone orchestration to validate and atomically register the supplied ID before spawning work. Remove backend UUID generation for these two public operations.
- [ ] Keep cancellation and job completion keyed by the same supplied ID and preserve token/error boundaries.
- [ ] Run focused Rust tests, the full Rust suite, format, Clippy, and `git diff --check`.
- [ ] Commit with `fix: accept frontend operation ids`.

### Task 2: Align TypeScript gateway, adapters, fake, and reducer

**Files:**
- Modify: `src/features/workspace-connection/WorkspaceConnectionGateway.ts`
- Modify: `src/features/workspace-connection/types.ts`
- Modify: `src/features/workspace-connection/connection-reducer.ts`
- Modify: `src/features/workspace-connection/connection-reducer.test.ts`
- Modify: `src/infrastructure/workspace/TauriWorkspaceConnectionGateway.ts`
- Modify: `src/infrastructure/workspace/UnavailableWorkspaceConnectionGateway.ts`
- Modify: `src/test/FakeWorkspaceConnectionGateway.ts`

**Interfaces:**
- Produces: `beginGithubAuth(requestId)` and `cloneRepository(requestId, repository, parentDirectory)` using the exact Tauri argument envelope.
- Consumes: Task 1's camelCase wire contract.

- [ ] Write adapter/fake tests that expect the frontend UUID in both invoke envelopes and returned DTOs.
- [ ] Write reducer tests showing owned auth/clone events are accepted before command completion, stale IDs are ignored, duplicate starts do not replace active ownership, and no pre-publication buffer exists.
- [ ] Run focused frontend tests and confirm old signatures/buffer state fail.
- [ ] Remove auth/clone pre-publication buffer types and transitions. Register exact ownership at the start action and treat later command results as matching metadata only.
- [ ] Keep stale repository/path validation and all typed retry inputs.
- [ ] Run reducer/adapter tests, full frontend tests, build, and `git diff --check`.
- [ ] Commit with `fix: align workspace operation ownership`.

### Task 3: Drive downstream commands only from reducer-accepted state

**Files:**
- Modify: `src/features/workspace-connection/WorkspaceConnectionProvider.tsx`
- Modify: `src/features/workspace-connection/WorkspaceConnectionProvider.test.tsx`
- Modify: `src/features/workspace-connection/WorkspaceConnectionPage.test.tsx`

**Interfaces:**
- Produces: listener-first orchestration where event callbacks only dispatch and effects consume reducer-approved states.
- Consumes: Task 2 reducer/gateway contract.

- [ ] Before implementation, remove the existing uncommitted partial Provider fix so the new regression tests demonstrate the bug against committed Task 10 code.
- [ ] Add deterministic RED tests for auth success before `beginGithubAuth` resolves, clone completion before `cloneRepository` resolves, stale auth/clone IDs, stale clone repository/path, exact cancellation/failure/completion ownership, duplicate starts, and mismatched initialization roots.
- [ ] Confirm rejected raw events currently launch or strand downstream gateway operations.
- [ ] Generate the UUID, dispatch ownership first, then call the gateway with the same UUID only after listener setup.
- [ ] Make listeners dispatch-only. Start repository load, workspace inspection, and connection only from reducer-accepted owned state; do not add last-action or temporary ownership refs.
- [ ] Preserve listener cleanup and initialization's separately owned `connectWorkspace(result.root)` step.
- [ ] Run focused provider/reducer tests, full frontend and Rust tests, frontend build, Tauri debug build, and `git diff --check`.
- [ ] Commit with `fix: sequence workspace operations by owned state`.

### Task 4: Independent protocol review

**Files:**
- Review all Task 1-3 commits and tests.

- [ ] Generate one review package from the pre-change base through Task 3.
- [ ] Independently verify the exact UUID across Rust commands, Tauri adapter, reducer, Provider, and fakes.
- [ ] Verify no unbounded/pre-publication buffer or provider ownership mirror remains.
- [ ] Verify stale ID/repository/path events cause no inspection or connection side effects.
- [ ] Run the complete frontend/Rust/build verification after any review fix.
