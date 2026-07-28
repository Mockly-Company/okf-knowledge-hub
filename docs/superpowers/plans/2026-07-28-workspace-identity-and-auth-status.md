# Workspace Identity and GitHub Account Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the real connected workspace and GitHub account throughout the shell, with logout and reauthentication that preserve local workspace access.

**Architecture:** Keep onboarding and workspace replacement in the existing connection state machine. Add a focused account-session reducer owned by `WorkspaceConnectionProvider`; the Provider remains the single auth listener and command owner, while AppSidebar and Settings consume one shared account state.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Testing Library, Tauri 2, Rust, Radix Alert Dialog, Lucide React, Tailwind CSS 4

## Global Constraints

- Branch from the latest `origin/main` after PR #4.
- Use frontend-generated request IDs before starting Device Flow commands.
- Keep the connected local workspace available after logout or authentication expiry.
- Never persist or expose GitHub credentials in frontend state, errors, logs, or settings.
- Register listeners before loading auth state or starting commands, and clean up every listener on unmount.
- Reject stale auth events by request ID.
- Preserve Default and Compact density behavior and existing design tokens.
- Support macOS and Windows.
- Use strict TDD: observe every new test fail before implementing its behavior.
- Do not commit without explicit user approval.

---

## File structure

```text
src/features/workspace-connection/
├─ account-session.ts                 # AccountSessionState, actions, reducer, selectors
├─ account-session.test.ts            # Pure account transition tests
├─ WorkspaceConnectionProvider.tsx    # Single listener/command orchestration
└─ WorkspaceConnectionProvider.test.tsx
src/components/patterns/
├─ AppSidebar.tsx                     # Workspace and account presentation
├─ AppSidebar.test.tsx                # Sidebar state and avatar tests
└─ AppShell.test.tsx                  # Provider-backed shell integration
src/features/workspace-connection/components/
├─ GitHubAccountPanel.tsx             # Settings account status and Device Flow actions
├─ GitHubAccountPanel.test.tsx
└─ LogoutConfirmationDialog.tsx       # Accessible destructive confirmation
src/pages/
├─ SettingsPage.tsx
└─ SettingsPage.test.tsx
src/styles/globals.css                # Sidebar/account/dialog styles using tokens
package.json
pnpm-lock.yaml
```

### Task 1: Add the account-session state machine

**Files:**
- Create: `src/features/workspace-connection/account-session.ts`
- Create: `src/features/workspace-connection/account-session.test.ts`

**Interfaces:**
- Consumes: `AuthState`, `DeviceAuthorization`, `AuthStatusEvent`, and `AppError` from `./types`.
- Produces: `AccountSessionState`, `AccountSessionAction`, `createInitialAccountSessionState()`, and `accountSessionReducer(state, action)`.

- [x] **Step 1: Write failing reducer tests**

Cover these exact transitions:

```ts
expect(accountSessionReducer(initial, { type: "authLoaded", auth: authenticated }))
  .toEqual({ status: "authenticated", user, error: null });

expect(accountSessionReducer(authenticatedState, { type: "logoutStarted" }))
  .toMatchObject({ status: "logging_out", user });

expect(accountSessionReducer(loggingOutState, { type: "logoutFailed", error }))
  .toEqual({ status: "authenticated", user, error });

expect(accountSessionReducer(loggingOutState, { type: "logoutSucceeded" }))
  .toEqual({ status: "signed_out", error: null });
```

Also prove that a Device Flow event with another `requestId` returns the identical state object.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run src/features/workspace-connection/account-session.test.ts`

Expected: FAIL because `account-session` does not exist.

- [x] **Step 3: Implement the discriminated account state**

Use these public states:

```ts
type AccountSessionState =
  | { status: "loading"; error: null }
  | { status: "signed_out"; error: AppError | null }
  | { status: "reauthentication_required"; error: AppError | null }
  | { status: "authenticated"; user: GithubUserSummary; error: AppError | null }
  | { status: "login_beginning"; requestId: string; error: null }
  | { status: "waiting_for_user"; authorization: DeviceAuthorization; error: null }
  | { status: "logging_out"; user: GithubUserSummary; error: null };
```

`logoutFailed` restores `authenticated` with the retained user. `authEventReceived` accepts terminal events only when their `requestId` matches `login_beginning.requestId` or `waiting_for_user.authorization.requestId`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm vitest run src/features/workspace-connection/account-session.test.ts`

Expected: all account-session tests pass.

- [x] **Step 5: Run TypeScript checks**

Run: `pnpm build`

Expected: exit code 0.

- [ ] **Step 6: Stop for commit approval**

Proposed commit: `feat: add GitHub account session state`

### Task 2: Orchestrate account state without dropping the workspace

**Files:**
- Modify: `src/features/workspace-connection/WorkspaceConnectionProvider.tsx`
- Modify: `src/features/workspace-connection/WorkspaceConnectionProvider.test.tsx`
- Modify: `src/test/FakeWorkspaceConnectionGateway.ts`

**Interfaces:**
- Consumes: Task 1 account reducer.
- Produces additions to `WorkspaceConnectionContextValue`: `account: AccountSessionState` and `logoutGithub(): Promise<void>`.

- [x] **Step 1: Write failing Provider tests**

Add tests that prove:

```ts
expect(result.current.account).toMatchObject({ status: "authenticated", user });
await act(() => result.current.logoutGithub());
expect(result.current.state.connectedWorkspace.path).toBe("/work/mockly-knowledge");
expect(result.current.account.status).toBe("signed_out");
```

Add a rejected fake logout and assert the connected workspace and authenticated user remain. Start login while connected, emit a stale event and then the owned event, and assert only the owned event updates `account` while `state.status` remains `connected`.

- [x] **Step 2: Run focused Provider tests and verify RED**

Run: `pnpm vitest run src/features/workspace-connection/WorkspaceConnectionProvider.test.tsx`

Expected: FAIL because the context has no `account` or `logoutGithub`.

- [x] **Step 3: Extend the fake gateway**

Add `logoutError: AppError | null`. `logoutGithub()` throws it before mutating `authState`; success changes `authState` to `signed_out`.

- [x] **Step 4: Integrate the account reducer**

- Initialize `useReducer(accountSessionReducer, ..., createInitialAccountSessionState)`.
- Keep one auth listener; dispatch sanitized events to the account reducer first.
- Forward auth events to `connectionReducer` only when `stateRef.current.status !== "connected"`.
- After current workspace load, call the existing auth load once for both account and onboarding consumers.
- Before `beginGithubAuth`, register the request ID in the account reducer. When connected, do not send login actions into the onboarding reducer.
- Add `logoutGithub()` that dispatches `logoutStarted`, awaits the gateway, and dispatches success or sanitized failure.

- [x] **Step 5: Run Provider and existing machine tests**

Run: `pnpm vitest run src/features/workspace-connection/WorkspaceConnectionProvider.test.tsx src/features/workspace-connection/machine`

Expected: all tests pass, including stale event ownership tests.

- [x] **Step 6: Run the frontend suite**

Run: `pnpm test:run && pnpm build`

Expected: all tests and build pass.

- [ ] **Step 7: Stop for commit approval**

Proposed commit: `feat: preserve workspace across GitHub account changes`

### Task 3: Render the workspace and account in the sidebar

**Files:**
- Create: `src/components/patterns/AppSidebar.test.tsx`
- Modify: `src/components/patterns/AppSidebar.tsx`
- Modify: `src/components/patterns/AppShell.test.tsx`
- Modify: `src/styles/globals.css`

**Interfaces:**
- Consumes: `useWorkspaceConnection().state`, `.account`, and `.isCurrentWorkspaceLoading`.
- Produces: no new public API.

- [ ] **Step 1: Write failing sidebar tests**

Verify `Mockly`, `@hyeeun`, and the avatar URL for a connected authenticated fake. Verify `GitHub 재로그인 필요` after logout. Fire an image `error` event and verify the visible fallback is `H`. Use a long workspace name and assert its full value is available through `title`.

- [ ] **Step 2: Run the sidebar tests and verify RED**

Run: `pnpm vitest run src/components/patterns/AppSidebar.test.tsx src/components/patterns/AppShell.test.tsx`

Expected: FAIL on placeholder text and missing image.

- [ ] **Step 3: Implement derived sidebar presentation**

- Read context in `AppSidebar`; do not introduce component-local account data.
- Render the connected workspace summary name.
- Render `<img src={user.avatarUrl} alt="" />` when available.
- On image error, switch only presentation to the uppercase first Unicode character of `login`, falling back to `GH`.
- Render stable loading skeleton dimensions using design tokens.

- [ ] **Step 4: Run focused tests and accessibility scan**

Run: `pnpm vitest run src/components/patterns/AppSidebar.test.tsx src/components/patterns/AppShell.test.tsx`

Expected: all tests pass with no duplicate accessible account labels.

- [ ] **Step 5: Run the frontend suite**

Run: `pnpm test:run && pnpm build`

Expected: all tests and build pass.

- [ ] **Step 6: Stop for commit approval**

Proposed commit: `feat: show workspace and GitHub identity in the shell`

### Task 4: Add account management to Settings

**Files:**
- Create: `src/features/workspace-connection/components/GitHubAccountPanel.tsx`
- Create: `src/features/workspace-connection/components/GitHubAccountPanel.test.tsx`
- Create: `src/features/workspace-connection/components/LogoutConfirmationDialog.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SettingsPage.test.tsx`
- Modify: `src/styles/globals.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `account`, `startLogin`, `cancelLogin`, `openVerificationUrl`, and `logoutGithub` from `WorkspaceConnectionContextValue`.
- Produces: `GitHubAccountPanel` with no props.

- [ ] **Step 1: Add Radix Alert Dialog**

Run: `pnpm add @radix-ui/react-alert-dialog`

Expected: dependency and lockfile update without unrelated version changes.

- [ ] **Step 2: Write failing panel tests**

Test authenticated account content, logout confirmation copy, initial focus on Cancel, successful logout, failed logout error, signed-out login, Device Flow code display, verification URL action, and cancel action.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm vitest run src/features/workspace-connection/components/GitHubAccountPanel.test.tsx src/pages/SettingsPage.test.tsx`

Expected: FAIL because `외부 연결` is still a placeholder.

- [ ] **Step 4: Implement the confirmation dialog**

Use Radix Alert Dialog. Title: `GitHub에서 로그아웃할까요?`. Description: `로컬 워크스페이스와 문서는 유지되며 GitHub 동기화, Issue와 PR 기능은 다시 로그인할 때까지 사용할 수 없습니다.` Actions: `취소`, `로그아웃`.

- [ ] **Step 5: Implement the GitHub account panel**

- Authenticated and logging-out states retain account identity.
- Signed-out and reauthentication states show `GitHub 다시 로그인`.
- Waiting state shows the public user code and `GitHub 인증 페이지 열기`.
- Public errors render with `role="alert"`.
- Disable duplicate login/logout actions while their command owns the state.

- [ ] **Step 6: Connect Settings category routing**

Render `GitHubAccountPanel` when `activeCategory === "외부 연결"`. Preserve the existing workspace and display panels unchanged.

- [ ] **Step 7: Run focused and full frontend verification**

Run: `pnpm vitest run src/features/workspace-connection/components/GitHubAccountPanel.test.tsx src/pages/SettingsPage.test.tsx`

Run: `pnpm test:run && pnpm build`

Expected: all tests and build pass.

- [ ] **Step 8: Stop for commit approval**

Proposed commit: `feat: manage GitHub account from settings`

### Task 5: Complete cross-boundary verification

**Files:**
- Modify only if a failing acceptance test exposes an implementation defect.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a verified stage-1 closeout suitable for review.

- [ ] **Step 1: Run complete frontend verification**

Run: `pnpm test:run && pnpm build`

Expected: all tests and production build pass.

- [ ] **Step 2: Run complete Rust verification**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Expected: formatting, 225 or more Rust tests, doc tests, and clippy pass.

- [ ] **Step 3: Verify the minimum Rust toolchain**

Run: `rustup run 1.88.0 cargo check --manifest-path src-tauri/Cargo.toml`

Expected: exit code 0.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors, no secrets, no generated artifacts, and only approved scope.

- [ ] **Step 5: Request review and stop for commit/push approval**

Review specifically:

- connected workspace preservation across auth transitions
- stale Device Flow event rejection
- listener cleanup and duplicate command prevention
- logout failure rollback
- keyboard and screen-reader behavior

Proposed final commit if review fixes are needed: `fix: harden workspace account status`

## Coverage matrix

| Requirement | Task |
|---|---|
| Real workspace name in shell | 3 |
| GitHub avatar and login in shell | 3 |
| Workspace retained after logout | 2 |
| GitHub-only functions require reauthentication | 2, 4 |
| Settings account management | 4 |
| Logout confirmation and failure rollback | 1, 2, 4 |
| Device Flow reauthentication without leaving workspace | 1, 2, 4 |
| Stale request rejection | 1, 2 |
| Accessibility and stable layout | 3, 4 |
| Full frontend/Rust/cross-platform verification | 5 |
