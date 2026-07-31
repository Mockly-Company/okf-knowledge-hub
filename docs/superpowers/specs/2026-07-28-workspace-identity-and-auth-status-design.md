# Workspace Identity and GitHub Account Status Design

**Date:** 2026-07-28
**Scope:** MVP stage 1 closeout

## Goal

Show the connected workspace and GitHub account consistently in the application shell, and let a user sign out and authenticate again without disconnecting the local workspace.

## Approved behavior

- The sidebar shows `ConnectedWorkspace.summary.name` instead of static placeholder copy.
- An authenticated account shows its GitHub avatar and `@login` in the sidebar.
- A signed-out account shows `GitHub 재로그인 필요` while the connected local workspace remains usable.
- Settings > `외부 연결` shows the same account state and owns login/logout actions.
- Logging out deletes only GitHub credentials. It does not delete the clone, clear the current workspace setting, or route away from the connected shell.
- Local-only features remain available after logout. Commands that need GitHub must require authentication.
- A failed logout retains the authenticated account in the UI and presents a retryable public error.
- A failed avatar load falls back to the first visible character of the GitHub login.

## State boundary

The existing connection state machine owns onboarding and workspace replacement. Its connected state intentionally does not retain authentication data. Reusing it for account management would make a logout or reauthentication transition discard the connected workspace.

`WorkspaceConnectionProvider` therefore owns one additional, focused `AccountSessionState` reducer. This is not sidebar-local state: the sidebar and Settings consume the same account session, and the Provider remains the only owner of GitHub auth listeners and commands.

```text
WorkspaceConnectionProvider
├─ ConnectionState
│  └─ onboarding, clone, initialization, replacement, connected workspace
└─ AccountSessionState
   └─ loading, authenticated, signed out, reauthentication, login, logout, error
```

The Provider registers the auth listener before loading state. Every auth event is offered to `AccountSessionState`. It is forwarded to the onboarding connection reducer only when no connected workspace is active. This prevents a raw reauthentication event from replacing a valid connected workspace with the onboarding screen.

## Data flow

### Startup

1. Register auth and clone listeners.
2. Load the current workspace.
3. Load GitHub auth state once.
4. Populate the account session for the shell.
5. When no workspace is connected, also populate the onboarding state machine.

### Logout

1. User opens Settings > `외부 연결` and chooses `로그아웃`.
2. An accessible confirmation dialog names the retained local workspace behavior.
3. The account reducer enters `logging_out` while retaining the current user.
4. `logoutGithub()` removes credentials and invalidates active GitHub operations.
5. Success changes only the account session to `signed_out`.
6. Failure restores `authenticated` and exposes a sanitized error.

### Reauthentication

1. A signed-out or expired account chooses `GitHub 다시 로그인`.
2. The account reducer owns the frontend-generated request ID before the command starts.
3. Device Flow progress uses that same request ID.
4. Authentication success updates the account session without changing the connected workspace.

## UI

### Sidebar

- Workspace: real workspace name, truncated visually with the full name in the accessible title.
- Authenticated user: 32px avatar, `@login`, and `GitHub 계정`.
- Signed out: fallback `GH` avatar, `GitHub 재로그인 필요`, and `Settings에서 연결`.
- Loading: stable 32px avatar and two text skeletons so the sidebar does not shift.

### Settings > External connections

- Heading: `외부 연결`
- GitHub account card with status, avatar, login, and the relevant action.
- Authenticated: `로그아웃` opens the confirmation dialog.
- Signed out or expired: `GitHub 다시 로그인` starts Device Flow in the same panel.
- Waiting: show user code, verification URL action, expiration context, and cancel action.
- Error: public message and retry action; no credential or device code is logged outside the active authorization view.

## Error and security rules

- Account errors pass through the existing public error sanitizer.
- A logout failure never optimistically shows `signed_out`.
- Stale login events and events for another request ID are ignored.
- A connected workspace remains the active workspace for every account transition.
- Tokens and device codes are never persisted in React state beyond the existing public Device Flow authorization contract.
- Unmount keeps the existing listener cleanup behavior.

## Verification

- Reducer tests cover load, login, stale events, logout success, logout failure, and reauthentication.
- Provider tests prove listeners are ready before commands and connected workspace identity survives all account transitions.
- Sidebar tests cover authenticated, signed-out, loading, long workspace names, and avatar fallback.
- Settings tests cover the confirmation dialog, focus, logout success/failure, and Device Flow reauthentication.
- Existing onboarding, replacement, frontend build, Rust tests, clippy, and macOS/Windows CI remain green.

## Out of scope

- Disconnecting or deleting the local workspace
- Multiple-account switching
- Multiple-workspace switching
- GitHub Project or document read functionality
- Refreshing GitHub data while offline
