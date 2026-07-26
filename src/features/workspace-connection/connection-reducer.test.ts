import type { Event } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { TauriWorkspaceConnectionGateway } from "@/infrastructure/workspace/TauriWorkspaceConnectionGateway";
import {
  desktopOnlyError,
  UnavailableWorkspaceConnectionGateway,
} from "@/infrastructure/workspace/UnavailableWorkspaceConnectionGateway";
import {
  connectionReducer,
  createInitialConnectionState,
} from "./connection-reducer";
import type {
  AppError,
  AuthStatusEvent,
  CloneProgressEvent,
  CloneStartRequest,
  ConnectedWorkspace,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  LocalInspectionRequest,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceInspectionRequest,
} from "./types";

const user = { id: 7, login: "hyeeun", avatarUrl: "https://example.test/me" };
const unavailableError: AppError = {
  code: "github_unavailable",
  message: "GitHub에 연결할 수 없습니다.",
  recovery: "retry",
  details: {},
};

function repository(id: string): GithubRepositorySummary {
  return {
    id,
    owner: "Mockly-Company",
    name: `${id}-knowledge`,
    fullName: `Mockly-Company/${id}-knowledge`,
    defaultBranch: "main",
    isEmpty: false,
  };
}

function localRepository(root = "/work/old-knowledge"): RepositorySnapshot {
  return {
    root,
    headOid: "abc123",
    defaultBranch: "main",
    isDirty: false,
    hasContent: true,
    remoteUrl: "https://github.com/Mockly-Company/old-knowledge.git",
    fingerprint: "fingerprint",
  };
}

function preview(id = "preview-1"): InitializationPreview {
  return {
    id,
    workspaceId: "workspace-1",
    workspaceName: "Mockly",
    repositoryFingerprint: "fingerprint",
    branch: "okf/init-workspace",
    commitMessage: "chore: initialize OkHub workspace",
    strategy: { kind: "draft_pull_request", baseBranch: "main" },
    files: [
      {
        path: ".okf/workspace.yml",
        content: "schema_version: 1\n",
        overwritesExisting: false,
      },
    ],
  };
}

function connected(path = "/work/old-knowledge"): ConnectedWorkspace {
  return {
    path,
    status: "connected",
    summary: {
      id: "workspace-1",
      name: "Mockly",
      documentRoots: ["docs"],
      repositoryCount: 0,
    },
  };
}

function repositoryRequest(
  id = "repositories-1",
  cursor: string | null = null,
  append = false,
): RepositoryLoadRequest {
  return { id, userId: user.id, cursor, append };
}

function localRequest(id: string, path: string): LocalInspectionRequest {
  return { id, repositoryId: "old", path };
}

function cloneRequest(id: string, parentDirectory: string): CloneStartRequest {
  return { id, repositoryId: "old", parentDirectory };
}

function workspaceRequest(id: string, root: string): WorkspaceInspectionRequest {
  return { id, repositoryRoot: root };
}

function previewRequest(
  id: string,
  root: string,
  workspaceName = "Mockly",
): InitializationPreviewRequest {
  return { id, repositoryRoot: root, workspaceName };
}

function repositoryState() {
  return connectionReducer(createInitialConnectionState(), {
    type: "authLoaded",
    auth: { status: "authenticated", user },
  });
}

function selectedRepositoryState() {
  return connectionReducer(repositoryState(), {
    type: "repositorySelected",
    repository: repository("old"),
  });
}

function localState(root = "/work/old-knowledge") {
  const request = localRequest(`local-${root}`, root);
  let state = connectionReducer(selectedRepositoryState(), {
    type: "localInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "localRepositoryChanged",
    request,
    repository: localRepository(root),
  });
}

function initializationRequiredState(root = "/work/old-knowledge") {
  const request = workspaceRequest(`workspace-${root}`, root);
  let state = connectionReducer(localState(root), {
    type: "workspaceInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "workspaceInspected",
    request,
    inspection: { status: "initialization_required" },
  });
}

function previewState() {
  const request = previewRequest("preview-request-1", "/work/old-knowledge");
  let state = connectionReducer(initializationRequiredState(), {
    type: "initializationPreviewStarted",
    request,
  });
  return connectionReducer(state, {
    type: "initializationPreviewLoaded",
    request,
    preview: preview(),
  });
}

describe("connectionReducer", () => {
  it("clears all auth-dependent state when login restarts", () => {
    const next = connectionReducer(previewState(), {
      type: "loginStarted",
      authorization: {
        requestId: "login-2",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        expiresAtUnix: 2_000,
        intervalSeconds: 5,
      },
    });

    expect(next).toMatchObject({
      step: "auth",
      status: "waiting_for_user",
      repositories: [],
      activeRepositoryRequest: null,
      selectedRepository: null,
      localRepository: null,
      workspaceInspection: null,
      initializationPreview: null,
      connectedWorkspace: null,
    });
  });

  it.each(["loaded", "event"] as const)(
    "fully invalidates auth-dependent state on global reauthentication (%s)",
    (source) => {
      const current = previewState();
      const next =
        source === "loaded"
          ? connectionReducer(current, {
              type: "authLoaded",
              auth: { status: "reauthentication_required" },
            })
          : connectionReducer(current, {
              type: "authEventReceived",
              event: { status: "reauthentication_required", requestId: "global" },
            });

      expect(next).toMatchObject({
        step: "auth",
        status: "reauthentication_required",
        repositories: [],
        activeRepositoryRequest: null,
        selectedRepository: null,
        activeLocalRequest: null,
        localRepository: null,
        activeCloneStartRequest: null,
        cloneJob: null,
        activeWorkspaceInspectionRequest: null,
        workspaceInspection: null,
        activeInitializationPreviewRequest: null,
        initializationPreview: null,
        connectedWorkspace: null,
      });
    },
  );

  it("keeps only the explicit replacement fallback during reauthentication", () => {
    const previous = connected();
    let state = connectionReducer(
      connectionReducer(createInitialConnectionState(), {
        type: "currentWorkspaceLoaded",
        workspace: previous,
      }),
      { type: "replacementStarted" },
    );
    state = connectionReducer(state, {
      type: "authLoaded",
      auth: { status: "reauthentication_required" },
    });

    expect(state).toMatchObject({
      step: "auth",
      status: "reauthentication_required",
      mode: "replacement",
      replacementWorkspace: previous,
      repositories: [],
      selectedRepository: null,
      localRepository: null,
      initializationPreview: null,
    });
  });

  it("ignores auth terminal events without the active login request", () => {
    const initial = createInitialConnectionState();
    expect(
      connectionReducer(initial, {
        type: "authEventReceived",
        event: { status: "authenticated", requestId: "old", user },
      }),
    ).toBe(initial);
  });

  it("appends repository pages and deduplicates by stable id", () => {
    const first = repositoryRequest("page-1");
    let state = connectionReducer(repositoryState(), {
      type: "repositoryLoading",
      request: first,
    });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      request: first,
      page: { items: [repository("one"), repository("two")], nextCursor: "next" },
    });
    const second = repositoryRequest("page-2", "next", true);
    state = connectionReducer(state, { type: "repositoryLoading", request: second });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      request: second,
      page: {
        items: [
          { ...repository("two"), fullName: "Renamed/two-knowledge" },
          repository("three"),
        ],
        nextCursor: null,
      },
    });

    expect(state.repositories.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(state.repositories[1]?.fullName).toBe("Renamed/two-knowledge");
    expect(state.nextRepositoryCursor).toBeNull();
  });

  it("rejects an older refresh response for the same account", () => {
    const oldRequest = repositoryRequest("refresh-old");
    const newRequest = repositoryRequest("refresh-new");
    let state = connectionReducer(repositoryState(), {
      type: "repositoryLoading",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "repositoryLoading",
      request: newRequest,
    });
    const stale = connectionReducer(state, {
      type: "repositoryPageLoaded",
      request: oldRequest,
      page: { items: [repository("stale")], nextCursor: "stale-cursor" },
    });

    expect(stale).toBe(state);
    expect(stale.activeRepositoryRequest).toEqual(newRequest);
  });

  it("rejects a page whose cursor or append ownership differs", () => {
    const seed = repositoryRequest("seed");
    let state = connectionReducer(repositoryState(), {
      type: "repositoryLoading",
      request: seed,
    });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      request: seed,
      page: { items: [repository("one")], nextCursor: "cursor-1" },
    });
    const active = repositoryRequest("append-1", "cursor-1", true);
    state = connectionReducer(state, {
      type: "repositoryLoading",
      request: active,
    });
    const wrongOwner = { ...active, cursor: "cursor-older", append: false };

    const stale =
      connectionReducer(state, {
        type: "repositoryPageLoaded",
        request: wrongOwner,
        page: { items: [repository("stale")], nextCursor: null },
      });
    expect(stale).toBe(state);
    expect(stale.activeRepositoryRequest).toEqual(active);
  });

  it("rejects stale repository-load failure for an older request", () => {
    const oldRequest = repositoryRequest("old-failure");
    const newRequest = repositoryRequest("new-failure");
    let state = connectionReducer(repositoryState(), {
      type: "repositoryLoading",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "repositoryLoading",
      request: newRequest,
    });
    expect(
      connectionReducer(state, {
        type: "repositoryLoadFailed",
        request: oldRequest,
        error: unavailableError,
      }),
    ).toBe(state);
  });

  it("clears repository-dependent state when repository selection changes", () => {
    const next = connectionReducer(previewState(), {
      type: "repositorySelected",
      repository: repository("new"),
    });
    expect(next).toMatchObject({
      step: "local",
      selectedRepository: { id: "new" },
      localRepository: null,
      workspaceInspection: null,
      initializationPreview: null,
    });
  });

  it("treats selecting the current repository as a true no-op", () => {
    const state = previewState();

    expect(
      connectionReducer(state, {
        type: "repositorySelected",
        repository: repository("old"),
      }),
    ).toBe(state);
  });

  it.each(["clone_starting", "cloning", "clone_cancelling"] as const)(
    "does not change repositories while a clone is %s",
    (status) => {
      const request = cloneRequest("clone-selection-guard", "/work");
      let state = connectionReducer(selectedRepositoryState(), {
        type: "cloneStarting",
        request,
      });
      if (status !== "clone_starting") {
        state = connectionReducer(state, {
          type: "cloneStarted",
          request,
          job: {
            requestId: "backend-selection-guard",
            targetPath: "/work/old-knowledge",
          },
        });
      }
      if (status === "clone_cancelling") {
        state = connectionReducer(state, {
          type: "cloneCancellationRequested",
          requestId: "backend-selection-guard",
        });
      }

      const blocked = connectionReducer(state, {
        type: "repositorySelected",
        repository: repository("new"),
      });

      expect(blocked).toBe(state);
      expect(blocked.status).toBe(status);
      expect(blocked.selectedRepository?.id).toBe("old");
    },
  );

  it("keeps clone event ownership after a blocked repository change", () => {
    const request = cloneRequest("clone-event-owner", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request,
      job: { requestId: "backend-event-owner", targetPath: "/work/old-knowledge" },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });

    const progressed = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "backend-event-owner",
        progress: { stage: "receiving_objects", completed: 2, total: 3 },
      },
    });

    expect(progressed).toMatchObject({
      status: "cloning",
      selectedRepository: { id: "old" },
      cloneJob: { requestId: "backend-event-owner" },
      cloneProgress: { completed: 2, total: 3 },
    });
  });

  it("does not change repositories while initialization mutates the workspace", () => {
    const state = connectionReducer(previewState(), { type: "initializationStarted" });

    const blocked = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });

    expect(blocked).toBe(state);
    expect(blocked).toMatchObject({
      step: "initialize",
      status: "initializing",
      selectedRepository: { id: "old" },
      initializationPreview: { id: "preview-1" },
    });
  });

  it("rejects an older folder inspection for the same repository", () => {
    const oldRequest = localRequest("local-old", "/work/old");
    const newRequest = localRequest("local-new", "/work/new");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "localInspectionStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "localInspectionStarted",
      request: newRequest,
    });
    const stale = connectionReducer(state, {
      type: "localRepositoryChanged",
      request: oldRequest,
      repository: localRepository("/work/old"),
    });

    expect(stale).toBe(state);
    expect(stale.activeLocalRequest).toEqual(newRequest);
  });

  it("rejects stale local-operation failures after a newer request takes ownership", () => {
    const oldLocal = localRequest("old-local-failure", "/work/old");
    const newLocal = localRequest("new-local-failure", "/work/new");
    let local = connectionReducer(selectedRepositoryState(), {
      type: "localInspectionStarted",
      request: oldLocal,
    });
    local = connectionReducer(local, {
      type: "localInspectionStarted",
      request: newLocal,
    });
    expect(
      connectionReducer(local, {
        type: "localInspectionFailed",
        request: oldLocal,
        error: unavailableError,
      }),
    ).toBe(local);

    const oldClone = cloneRequest("old-clone-failure", "/work/old");
    const newClone = cloneRequest("new-clone-failure", "/work/new");
    let clone = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: oldClone,
    });
    clone = connectionReducer(clone, { type: "cloneStarting", request: newClone });
    expect(
      connectionReducer(clone, {
        type: "cloneStartFailed",
        request: oldClone,
        error: unavailableError,
      }),
    ).toBe(clone);
  });

  it("rejects an older clone start result for the same repository", () => {
    const oldRequest = cloneRequest("clone-start-old", "/work/old-parent");
    const newRequest = cloneRequest("clone-start-new", "/work/new-parent");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: oldRequest,
    });
    state = connectionReducer(state, { type: "cloneStarting", request: newRequest });
    const stale = connectionReducer(state, {
      type: "cloneStarted",
      request: oldRequest,
      job: { requestId: "backend-old", targetPath: "/work/old-parent/old-knowledge" },
    });

    expect(stale).toBe(state);
    expect(stale.activeCloneStartRequest).toEqual(newRequest);
  });

  it("correlates clone progress and cancellation by backend request id", () => {
    const request = cloneRequest("clone-start", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request,
      job: { requestId: "clone-1", targetPath: "/work/old-knowledge" },
    });
    expect(
      connectionReducer(state, {
        type: "cloneEventReceived",
        event: {
          status: "progress",
          requestId: "clone-other",
          progress: { stage: "receiving_objects", completed: 5, total: 10 },
        },
      }),
    ).toBe(state);
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "clone-1",
        progress: { stage: "receiving_objects", completed: 5, total: 10 },
      },
    });
    expect(state.cloneProgress?.completed).toBe(5);
    state = connectionReducer(state, {
      type: "cloneCancellationRequested",
      requestId: "clone-1",
    });
    expect(state.status).toBe("clone_cancelling");
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: { status: "cancelled", requestId: "clone-1" },
    });
    expect(state).toMatchObject({ status: "idle", cloneJob: null, cloneProgress: null });
  });

  it("rejects an older workspace inspection for the same root", () => {
    const oldRequest = workspaceRequest("workspace-old", "/work/old-knowledge");
    const newRequest = workspaceRequest("workspace-new", "/work/old-knowledge");
    let state = connectionReducer(localState(), {
      type: "workspaceInspectionStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "workspaceInspectionStarted",
      request: newRequest,
    });
    const stale = connectionReducer(state, {
      type: "workspaceInspected",
      request: oldRequest,
      inspection: { status: "initialization_required" },
    });

    expect(stale).toBe(state);
    expect(stale.activeWorkspaceInspectionRequest).toEqual(newRequest);
  });

  it("rejects stale workspace and preview failures", () => {
    const oldWorkspace = workspaceRequest("old-workspace-failure", "/work/old-knowledge");
    const newWorkspace = workspaceRequest("new-workspace-failure", "/work/old-knowledge");
    let workspace = connectionReducer(localState(), {
      type: "workspaceInspectionStarted",
      request: oldWorkspace,
    });
    workspace = connectionReducer(workspace, {
      type: "workspaceInspectionStarted",
      request: newWorkspace,
    });
    expect(
      connectionReducer(workspace, {
        type: "workspaceInspectionFailed",
        request: oldWorkspace,
        error: unavailableError,
      }),
    ).toBe(workspace);

    const oldPreview = previewRequest("old-preview-failure", "/work/old-knowledge");
    const newPreview = previewRequest("new-preview-failure", "/work/old-knowledge");
    let pendingPreview = connectionReducer(initializationRequiredState(), {
      type: "initializationPreviewStarted",
      request: oldPreview,
    });
    pendingPreview = connectionReducer(pendingPreview, {
      type: "initializationPreviewStarted",
      request: newPreview,
    });
    expect(
      connectionReducer(pendingPreview, {
        type: "initializationPreviewFailed",
        request: oldPreview,
        error: unavailableError,
      }),
    ).toBe(pendingPreview);
  });

  it("retains invalid YAML and newer schema diagnostics", () => {
    const invalidRequest = workspaceRequest("invalid", "/work/old-knowledge");
    let state = connectionReducer(localState(), {
      type: "workspaceInspectionStarted",
      request: invalidRequest,
    });
    state = connectionReducer(state, {
      type: "workspaceInspected",
      request: invalidRequest,
      inspection: {
        status: "invalid",
        diagnostics: [
          {
            code: "workspace_yaml_invalid",
            path: ".okf/workspace.yml",
            message: "YAML을 읽을 수 없습니다.",
          },
        ],
      },
    });
    expect(state).toMatchObject({
      step: "local",
      status: "validation_failed",
      workspaceInspection: { status: "invalid" },
      initializationPreview: null,
    });

    const newerRequest = workspaceRequest("newer", "/work/old-knowledge");
    state = connectionReducer(state, {
      type: "workspaceInspectionStarted",
      request: newerRequest,
    });
    state = connectionReducer(state, {
      type: "workspaceInspected",
      request: newerRequest,
      inspection: { status: "unsupported_version", foundVersion: 2 },
    });
    expect(state).toMatchObject({
      status: "validation_failed",
      workspaceInspection: { status: "unsupported_version", foundVersion: 2 },
    });
  });

  it("rejects an older initialization preview for the same root and name", () => {
    const oldRequest = previewRequest("preview-old", "/work/old-knowledge");
    const newRequest = previewRequest("preview-new", "/work/old-knowledge");
    let state = connectionReducer(initializationRequiredState(), {
      type: "initializationPreviewStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "initializationPreviewStarted",
      request: newRequest,
    });
    const stale = connectionReducer(state, {
      type: "initializationPreviewLoaded",
      request: oldRequest,
      preview: preview("stale"),
    });

    expect(stale).toBe(state);
    expect(stale.activeInitializationPreviewRequest).toEqual(newRequest);
  });

  it("does not mark initialization complete until backend connection succeeds", () => {
    const pending = connectionReducer(previewState(), { type: "initializationStarted" });
    expect(pending).toMatchObject({
      step: "initialize",
      status: "initializing",
      connectedWorkspace: null,
      initializationPreview: { id: "preview-1" },
    });
  });

  it("invalidates a stale initialization preview", () => {
    const error: AppError = {
      code: "workspace_changed_since_preview",
      message: "초기화 미리보기가 더 이상 유효하지 않습니다.",
      recovery: "retry",
      details: {},
    };
    const next = connectionReducer(
      connectionReducer(previewState(), { type: "initializationStarted" }),
      { type: "initializationFailed", error },
    );
    expect(next).toMatchObject({
      step: "local",
      status: "error",
      initializationPreview: null,
      connectedWorkspace: null,
      error,
    });
  });

  it("marks connected only with a backend workspace while initialization is pending", () => {
    const workspace = connected("/work/old-knowledge");
    const next = connectionReducer(
      connectionReducer(previewState(), { type: "initializationStarted" }),
      { type: "workspaceConnected", workspace },
    );
    expect(next).toMatchObject({
      step: "initialize",
      status: "connected",
      connectedWorkspace: workspace,
    });
  });

  it("cancels replacement into a clean connected state", () => {
    const previous = connected();
    let state = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: previous,
    });
    state = connectionReducer(state, { type: "replacementStarted" });
    state = connectionReducer(state, {
      type: "authLoaded",
      auth: { status: "authenticated", user },
    });
    const request = repositoryRequest("replacement-repos");
    state = connectionReducer(state, { type: "repositoryLoading", request });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      request,
      page: { items: [repository("new")], nextCursor: "replacement-next" },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });
    const pathRequest: LocalInspectionRequest = {
      id: "replacement-path",
      repositoryId: "new",
      path: "/work/new-knowledge",
    };
    state = connectionReducer(state, {
      type: "localInspectionStarted",
      request: pathRequest,
    });
    state = connectionReducer(state, {
      type: "localRepositoryChanged",
      request: pathRequest,
      repository: localRepository("/work/new-knowledge"),
    });

    const restored = connectionReducer(state, { type: "replacementCancelled" });
    expect(restored).toEqual({
      ...createInitialConnectionState(),
      step: "initialize",
      status: "connected",
      connectedWorkspace: previous,
    });
  });

  it("preserves recovery-required startup path for Task 10 diagnostics", () => {
    const next = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: { path: "/missing/mockly-knowledge", status: "recovery_required" },
    });
    expect(next).toMatchObject({
      step: "auth",
      status: "idle",
      recoveryWorkspace: {
        path: "/missing/mockly-knowledge",
        status: "recovery_required",
      },
    });
  });
});

describe("workspace connection gateway adapters", () => {
  it("selects the desktop adapter only when runtime detection succeeds", () => {
    expect(createWorkspaceConnectionGateway(() => true)).toBeInstanceOf(
      TauriWorkspaceConnectionGateway,
    );
    expect(createWorkspaceConnectionGateway(() => false)).toBeInstanceOf(
      UnavailableWorkspaceConnectionGateway,
    );
  });

  it("maps every desktop operation to the exact Task 8 command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const responses: Record<string, unknown> = {
        get_current_workspace: null,
        get_auth_state: { status: "signed_out" },
        begin_github_auth: {
          requestId: "auth-1",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
          expiresAtUnix: 2_000,
          intervalSeconds: 5,
        },
        cancel_github_auth: true,
        logout_github: undefined,
        list_github_repositories: { items: [], nextCursor: null },
        inspect_existing_clone: localRepository(),
        clone_repository: { requestId: "clone-1", targetPath: "/work/repo" },
        cancel_repository_clone: true,
        inspect_workspace: { status: "initialization_required" },
        connect_workspace: connected(),
        preview_workspace_initialization: preview(),
        initialize_workspace: {
          root: "/work/repo",
          branch: "main",
          commitOid: "abc123",
          commitMessage: "chore: initialize OkHub workspace",
          pushed: true,
          draftPullRequestUrl: null,
        },
      };
      return responses[command] as T;
    };
    const gateway = new TauriWorkspaceConnectionGateway(
      invoke,
      async () => () => undefined,
      async () => "/work",
      async () => undefined,
    );

    await gateway.getCurrentWorkspace();
    await gateway.getAuthState();
    await gateway.beginGithubAuth();
    await gateway.cancelGithubAuth("auth-1");
    await gateway.logoutGithub();
    await gateway.listRepositories("cursor-1");
    await gateway.inspectExistingClone("/work/repo", "repo-1");
    await gateway.cloneRepository(repository("repo-1"), "/work");
    await gateway.cancelRepositoryClone("clone-1");
    await gateway.inspectWorkspace("/work/repo");
    await gateway.connectWorkspace("/work/repo");
    await gateway.previewInitialization({
      repositoryPath: "/work/repo",
      workspaceName: "Mockly",
      repositoryId: "repo-1",
      repositoryFullName: "Mockly-Company/repo-1-knowledge",
    });
    await gateway.initializeWorkspace("preview-1");

    expect(calls.map(({ command }) => command)).toEqual([
      "get_current_workspace",
      "get_auth_state",
      "begin_github_auth",
      "cancel_github_auth",
      "logout_github",
      "list_github_repositories",
      "inspect_existing_clone",
      "clone_repository",
      "cancel_repository_clone",
      "inspect_workspace",
      "connect_workspace",
      "preview_workspace_initialization",
      "initialize_workspace",
    ]);
    expect(calls[8]?.args).toEqual({ requestId: "clone-1" });
  });

  it("uses exact dialog options and caller-owned event teardown", async () => {
    const choose = vi.fn(async () => "/selected");
    const subscriptions: string[] = [];
    const teardowns: string[] = [];
    let authHandler: ((event: Event<AuthStatusEvent>) => void) | undefined;
    const listen = async <T,>(event: string, listener: (event: Event<T>) => void) => {
      subscriptions.push(event);
      authHandler = listener as (event: Event<AuthStatusEvent>) => void;
      return () => teardowns.push(event);
    };
    const gateway = new TauriWorkspaceConnectionGateway(
      async <T,>() => undefined as T,
      listen,
      choose,
      async () => undefined,
    );
    const listener = vi.fn();
    const unlisten = await gateway.onAuthStatus(listener);
    const event: AuthStatusEvent = { status: "waiting_for_user", requestId: "auth-1" };
    authHandler?.({ event: "github-auth-status", id: 1, payload: event });
    unlisten();

    await expect(gateway.pickDirectory()).resolves.toBe("/selected");
    expect(choose).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(subscriptions).toEqual(["github-auth-status"]);
    expect(listener).toHaveBeenCalledWith(event);
    expect(teardowns).toEqual(["github-auth-status"]);
  });

  it("fails closed in a browser", async () => {
    const gateway = new UnavailableWorkspaceConnectionGateway();
    const expected = desktopOnlyError();
    await expect(gateway.getCurrentWorkspace()).rejects.toEqual(expected);
    await expect(gateway.getAuthState()).rejects.toEqual(expected);
    await expect(gateway.listRepositories()).rejects.toEqual(expected);
    await expect(gateway.connectWorkspace("/work/repo")).rejects.toEqual(expected);
  });
});
