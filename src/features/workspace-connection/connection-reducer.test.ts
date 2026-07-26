import type { Event } from "@tauri-apps/api/event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
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
  AuthLoadRequest,
  AuthStatusEvent,
  CloneProgressEvent,
  CloneStartRequest,
  ConnectedWorkspace,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  InitializationRequest,
  InitializationResult,
  LoginBeginRequest,
  LocalConnectionState,
  LocalInspectionRequest,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceInspectionRequest,
  WorkspaceInspection,
  WorkspaceConnectionRequest,
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

function authLoadRequest(id = "auth-load-1"): AuthLoadRequest {
  return { id };
}

function loginBeginRequest(id = "login-begin-1"): LoginBeginRequest {
  return { id };
}

function authorization(requestId: string) {
  return {
    requestId,
    userCode: "ABCD-EFGH",
    verificationUri: "https://github.com/login/device",
    expiresAtUnix: 2_000,
    intervalSeconds: 5,
  };
}

function initializationRequest(
  id = "initialization-1",
  root = "/work/old-knowledge",
): InitializationRequest {
  return { id, previewId: "preview-1", repositoryRoot: root };
}

function initializationResult(
  root = "/work/old-knowledge",
): InitializationResult {
  return {
    root,
    branch: "okf/init-workspace",
    commitOid: "commit-1",
    commitMessage: "chore: initialize OkHub workspace",
    pushed: true,
    draftPullRequestUrl: null,
  };
}

function initializationConnectionRequest(
  id: string,
  initializationRequestId: string,
  root = "/work/old-knowledge",
): Extract<WorkspaceConnectionRequest, { source: "initialization" }> {
  return {
    id,
    repositoryRoot: root,
    source: "initialization",
    initializationRequestId,
  };
}

function existingConnectionRequest(
  id: string,
  root = "/work/old-knowledge",
): Extract<WorkspaceConnectionRequest, { source: "existing" }> {
  return {
    id,
    repositoryRoot: root,
    source: "existing",
    initializationRequestId: null,
  };
}

function repositoryState() {
  const request = authLoadRequest();
  const loading = connectionReducer(createInitialConnectionState(), {
    type: "authLoadStarted",
    request,
  });
  return connectionReducer(loading, {
    type: "authLoaded",
    request,
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

function readyWorkspaceState(root = "/work/old-knowledge") {
  const request = workspaceRequest(`ready-workspace-${root}`, root);
  let state = connectionReducer(localState(root), {
    type: "workspaceInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "workspaceInspected",
    request,
    inspection: { status: "ready", summary: connected(root).summary },
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

function readyToConnectState(request = initializationRequest()) {
  let state = connectionReducer(previewState(), {
    type: "initializationStarted",
    request,
  });
  return connectionReducer(state, {
    type: "initializationSucceeded",
    request,
    result: initializationResult(request.repositoryRoot),
  });
}

function connectingState(
  initialization = initializationRequest(),
  connection = initializationConnectionRequest(
    "workspace-connection-1",
    initialization.id,
    initialization.repositoryRoot,
  ),
) {
  return connectionReducer(readyToConnectState(initialization), {
    type: "workspaceConnectionStarted",
    request: connection,
  });
}

describe("connectionReducer", () => {
  it("clears all auth-dependent state when login restarts", () => {
    const request = loginBeginRequest("login-2");
    const beginning = connectionReducer(previewState(), {
      type: "loginBeginStarted",
      request,
    });
    const next = connectionReducer(beginning, {
      type: "loginStarted",
      request,
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
      const request = authLoadRequest("reauth-load");
      const next =
        source === "loaded"
          ? connectionReducer(
              connectionReducer(current, { type: "authLoadStarted", request }),
              {
                type: "authLoaded",
                request,
                auth: { status: "reauthentication_required" },
              },
            )
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
    const request = authLoadRequest("replacement-reauth");
    state = connectionReducer(state, { type: "authLoadStarted", request });
    state = connectionReducer(state, {
      type: "authLoaded",
      request,
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

  it("does not let a stale auth load reverse global reauthentication", () => {
    const request = { id: "auth-load-old" };
    let state = connectionReducer(createInitialConnectionState(), {
      type: "authLoadStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "reauthentication_required", requestId: "global" },
    });

    const stale = connectionReducer(state, {
      type: "authLoaded",
      request,
      auth: { status: "authenticated", user },
    });

    expect(stale).toBe(state);
    expect(stale).toMatchObject({ step: "auth", status: "reauthentication_required" });
  });

  it("ignores stale auth failure after global reauthentication in replacement mode", () => {
    const previous = connected();
    let state = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: previous,
    });
    state = connectionReducer(state, { type: "replacementStarted" });
    const request = authLoadRequest("replacement-stale-load");
    state = connectionReducer(state, { type: "authLoadStarted", request });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "reauthentication_required", requestId: "global" },
    });

    const stale = connectionReducer(state, {
      type: "authLoadFailed",
      request,
      error: unavailableError,
    });

    expect(stale).toBe(state);
    expect(stale).toMatchObject({
      status: "reauthentication_required",
      mode: "replacement",
      replacementWorkspace: previous,
    });
  });

  it("ignores stale auth load success and failure after a newer load", () => {
    const oldRequest = authLoadRequest("auth-load-old-overlap");
    const newRequest = authLoadRequest("auth-load-new-overlap");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "authLoadStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, { type: "authLoadStarted", request: newRequest });

    expect(
      connectionReducer(state, {
        type: "authLoaded",
        request: oldRequest,
        auth: { status: "authenticated", user },
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "authLoadFailed",
        request: oldRequest,
        error: unavailableError,
      }),
    ).toBe(state);
  });

  it("ignores stale login begin success and failure after a newer attempt", () => {
    const oldRequest = { id: "login-old" };
    const newRequest = { id: "login-new" };
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, { type: "loginBeginStarted", request: newRequest });

    expect(
      connectionReducer(state, {
        type: "loginBeginFailed",
        request: oldRequest,
        error: unavailableError,
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "loginStarted",
        request: oldRequest,
        authorization: {
          requestId: "backend-old",
          userCode: "OLD",
          verificationUri: "https://github.com/login/device",
          expiresAtUnix: 2_000,
          intervalSeconds: 5,
        },
      }),
    ).toBe(state);
  });

  it("keeps global reauthentication after a pending login begin resolves late", () => {
    const request = loginBeginRequest("login-before-global-reauth");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "reauthentication_required", requestId: "global" },
    });

    expect(
      connectionReducer(state, {
        type: "loginBeginFailed",
        request,
        error: unavailableError,
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "loginStarted",
        request,
        authorization: {
          requestId: "backend-late-login",
          userCode: "LATE",
          verificationUri: "https://github.com/login/device",
          expiresAtUnix: 2_000,
          intervalSeconds: 5,
        },
      }),
    ).toBe(state);
  });

  it("replays authenticated when the auth event precedes the command response", () => {
    const request = loginBeginRequest("early-authenticated-login");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "authenticated", requestId: "backend-early-auth", user },
    });
    state = connectionReducer(state, {
      type: "loginStarted",
      request,
      authorization: authorization("backend-early-auth"),
    });

    expect(state).toMatchObject({
      step: "repository",
      status: "idle",
      auth: { status: "authenticated", user },
    });
  });

  it("replays early auth failure and cancellation without leaving login pending", () => {
    const failureRequest = loginBeginRequest("early-failed-login");
    let failed = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: failureRequest,
    });
    failed = connectionReducer(failed, {
      type: "authEventReceived",
      event: {
        status: "failed",
        requestId: "backend-early-failed",
        error: unavailableError,
      },
    });
    failed = connectionReducer(failed, {
      type: "loginStarted",
      request: failureRequest,
      authorization: authorization("backend-early-failed"),
    });
    expect(failed).toMatchObject({ step: "auth", status: "error" });

    const cancelRequest = loginBeginRequest("early-cancelled-login");
    let cancelled = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: cancelRequest,
    });
    cancelled = connectionReducer(cancelled, {
      type: "authEventReceived",
      event: { status: "cancelled", requestId: "backend-early-cancelled" },
    });
    cancelled = connectionReducer(cancelled, {
      type: "loginStarted",
      request: cancelRequest,
      authorization: authorization("backend-early-cancelled"),
    });
    expect(cancelled).toMatchObject({ step: "auth", status: "idle" });
  });

  it("buffers waiting and stops replay after the first matching auth terminal", () => {
    const request = loginBeginRequest("early-auth-order");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "cancelled", requestId: "unrelated-auth-order" },
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "waiting_for_user", requestId: "backend-auth-order" },
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "authenticated", requestId: "backend-auth-order", user },
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: {
        status: "failed",
        requestId: "backend-auth-order",
        error: unavailableError,
      },
    });
    state = connectionReducer(state, {
      type: "loginStarted",
      request,
      authorization: authorization("backend-auth-order"),
    });

    expect(state).toMatchObject({ step: "repository", status: "idle" });
  });

  it("bounds auth events that arrive before the command response", () => {
    const request = loginBeginRequest("bounded-auth-events");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    for (let index = 0; index < 12; index += 1) {
      state = connectionReducer(state, {
        type: "authEventReceived",
        event: { status: "waiting_for_user", requestId: `auth-${index}` },
      });
    }

    expect(state).toMatchObject({ step: "auth", status: "login_beginning" });
    if (state.step !== "auth" || state.status !== "login_beginning") {
      throw new Error("Expected a pending login begin state");
    }
    expect(state.bufferedAuthEvents).toHaveLength(8);
    expect(state.bufferedAuthEvents[0]?.requestId).toBe("auth-4");
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
    const state = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: initializationRequest("repository-selection-init"),
    });

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

  it("does not let read starts displace clone or initialization ownership", () => {
    const clone = cloneRequest("clone-owner-guard", "/work");
    let cloning = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: clone,
    });
    cloning = connectionReducer(cloning, {
      type: "cloneStarted",
      request: clone,
      job: { requestId: "backend-owner-guard", targetPath: "/work/old-knowledge" },
    });

    expect(
      connectionReducer(cloning, {
        type: "localInspectionStarted",
        request: localRequest("displacing-local", "/work/other"),
      }),
    ).toBe(cloning);
    expect(
      connectionReducer(cloning, {
        type: "workspaceInspectionStarted",
        request: workspaceRequest("displacing-workspace", "/work/old-knowledge"),
      }),
    ).toBe(cloning);
    expect(
      connectionReducer(cloning, {
        type: "initializationPreviewStarted",
        request: previewRequest("displacing-preview", "/work/old-knowledge"),
      }),
    ).toBe(cloning);
    expect(
      connectionReducer(cloning, {
        type: "authLoadStarted",
        request: authLoadRequest("displacing-auth-load"),
      }),
    ).toBe(cloning);
    expect(
      connectionReducer(cloning, {
        type: "loginBeginStarted",
        request: loginBeginRequest("displacing-login"),
      }),
    ).toBe(cloning);

    const initializing = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: {
        id: "initialization-owner",
        previewId: "preview-1",
        repositoryRoot: "/work/old-knowledge",
      },
    });
    expect(
      connectionReducer(initializing, {
        type: "cloneStarting",
        request: cloneRequest("displacing-clone", "/work"),
      }),
    ).toBe(initializing);
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
    const clone = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: newClone,
    });
    expect(
      connectionReducer(clone, {
        type: "cloneStartFailed",
        request: oldClone,
        error: unavailableError,
      }),
    ).toBe(clone);
  });

  it("retains local inspection input and retries it only with a new owner", () => {
    const failedRequest = localRequest("failed-local-inspection", "/work/retry-local");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "localInspectionStarted",
      request: failedRequest,
    });
    state = connectionReducer(state, {
      type: "localInspectionFailed",
      request: failedRequest,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "local",
      status: "error",
      errorContext: "pre_repository",
      failedOperation: "local_inspection",
      failedLocalInspectionRequest: failedRequest,
    });

    expect(
      connectionReducer(state, {
        type: "localInspectionRetryStarted",
        request: failedRequest,
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "localInspectionRetryStarted",
        request: localRequest("changed-local-retry", "/work/different"),
      }),
    ).toBe(state);

    const retry = localRequest("retry-local-inspection", "/work/retry-local");
    const retried = connectionReducer(state, {
      type: "localInspectionRetryStarted",
      request: retry,
    });
    expect(retried).toMatchObject({
      status: "inspecting",
      activeLocalRequest: retry,
      error: null,
    });
  });

  it("retains clone start input and retries it only with a new owner", () => {
    const failedRequest = cloneRequest("failed-clone-start", "/work/retry-clone");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: failedRequest,
    });
    state = connectionReducer(state, {
      type: "cloneStartFailed",
      request: failedRequest,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "local",
      status: "error",
      failedOperation: "clone",
      failedCloneStartRequest: failedRequest,
    });

    expect(
      connectionReducer(state, {
        type: "cloneRetryStarted",
        request: failedRequest,
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "cloneRetryStarted",
        request: cloneRequest("changed-clone-retry", "/work/different"),
      }),
    ).toBe(state);

    const retry = cloneRequest("retry-clone-start", "/work/retry-clone");
    const retried = connectionReducer(state, {
      type: "cloneRetryStarted",
      request: retry,
    });
    expect(retried).toMatchObject({
      status: "clone_starting",
      activeCloneStartRequest: retry,
      error: null,
    });
  });

  it("retains the original clone input after a terminal clone failure", () => {
    const original = cloneRequest("terminal-clone-source", "/work/terminal-clone");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: original,
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request: original,
      job: { requestId: "terminal-clone-job", targetPath: "/work/old-knowledge" },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "failed",
        requestId: "terminal-clone-job",
        error: unavailableError,
      },
    });

    expect(state).toMatchObject({
      status: "error",
      failedOperation: "clone",
      failedCloneStartRequest: original,
    });
    const retry = cloneRequest("terminal-clone-retry", "/work/terminal-clone");
    expect(
      connectionReducer(state, { type: "cloneRetryStarted", request: retry }),
    ).toMatchObject({ status: "clone_starting", activeCloneStartRequest: retry });
  });

  it("clears local retry context on repository change and reauthentication", () => {
    const failedRequest = localRequest("clear-local-context", "/work/clear-local");
    let failed = connectionReducer(selectedRepositoryState(), {
      type: "localInspectionStarted",
      request: failedRequest,
    });
    failed = connectionReducer(failed, {
      type: "localInspectionFailed",
      request: failedRequest,
      error: unavailableError,
    });

    const changed = connectionReducer(failed, {
      type: "repositorySelected",
      repository: repository("new"),
    });
    expect(changed).toMatchObject({ status: "idle", selectedRepository: { id: "new" } });
    expect("failedOperation" in changed).toBe(false);

    const reauthenticated = connectionReducer(failed, {
      type: "authEventReceived",
      event: { status: "reauthentication_required", requestId: "global" },
    });
    expect(reauthenticated).toMatchObject({
      step: "auth",
      status: "reauthentication_required",
    });
    expect("failedOperation" in reauthenticated).toBe(false);
  });

  it("rejects an older clone start result for the same repository", () => {
    const oldRequest = cloneRequest("clone-start-old", "/work/old-parent");
    const newRequest = cloneRequest("clone-start-new", "/work/new-parent");
    const state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: newRequest,
    });
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

  it("replays early clone progress and completion after the job id is published", () => {
    const request = cloneRequest("early-clone-complete", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "backend-early-clone",
        progress: { stage: "receiving_objects", completed: 4, total: 10 },
      },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: "backend-early-clone",
        repository: localRepository("/work/old-knowledge"),
      },
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request,
      job: { requestId: "backend-early-clone", targetPath: "/work/old-knowledge" },
    });

    expect(state).toMatchObject({
      step: "local",
      status: "idle",
      localRepository: { root: "/work/old-knowledge" },
      cloneJob: null,
    });
  });

  it("replays early clone failure and cancellation without leaving clone pending", () => {
    const failedRequest = cloneRequest("early-clone-failed", "/work");
    let failed = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: failedRequest,
    });
    failed = connectionReducer(failed, {
      type: "cloneEventReceived",
      event: {
        status: "failed",
        requestId: "backend-early-failed-clone",
        error: unavailableError,
      },
    });
    failed = connectionReducer(failed, {
      type: "cloneStarted",
      request: failedRequest,
      job: {
        requestId: "backend-early-failed-clone",
        targetPath: "/work/old-knowledge",
      },
    });
    expect(failed).toMatchObject({ step: "local", status: "error" });

    const cancelledRequest = cloneRequest("early-clone-cancelled", "/work");
    let cancelled = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: cancelledRequest,
    });
    cancelled = connectionReducer(cancelled, {
      type: "cloneEventReceived",
      event: { status: "cancelled", requestId: "backend-early-cancelled-clone" },
    });
    cancelled = connectionReducer(cancelled, {
      type: "cloneStarted",
      request: cancelledRequest,
      job: {
        requestId: "backend-early-cancelled-clone",
        targetPath: "/work/old-knowledge",
      },
    });
    expect(cancelled).toMatchObject({ step: "local", status: "idle" });
  });

  it("lets an early clone terminal dominate later progress and drops unrelated ids", () => {
    const request = cloneRequest("early-clone-order", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "unrelated-clone",
        progress: { stage: "receiving_objects", completed: 9, total: 10 },
      },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: "backend-clone-order",
        repository: localRepository(),
      },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "backend-clone-order",
        progress: { stage: "checking_out", completed: 10, total: 10 },
      },
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request,
      job: { requestId: "backend-clone-order", targetPath: "/work/old-knowledge" },
    });

    expect(state).toMatchObject({ status: "idle", localRepository: { fingerprint: "fingerprint" } });
  });

  it("bounds early clone events by request id and keeps only latest progress", () => {
    const request = cloneRequest("bounded-clone-events", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    for (let index = 0; index < 6; index += 1) {
      state = connectionReducer(state, {
        type: "cloneEventReceived",
        event: {
          status: "progress",
          requestId: `clone-${index}`,
          progress: { stage: "receiving_objects", completed: index, total: 10 },
        },
      });
    }
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "clone-5",
        progress: { stage: "checking_out", completed: 10, total: 10 },
      },
    });

    expect(state).toMatchObject({ step: "local", status: "clone_starting" });
    if (state.step !== "local" || state.status !== "clone_starting") {
      throw new Error("Expected a pending clone start state");
    }
    expect(state.bufferedCloneEvents).toHaveLength(4);
    expect(state.bufferedCloneEvents.map((group) => group.requestId)).toEqual([
      "clone-2",
      "clone-3",
      "clone-4",
      "clone-5",
    ]);
    expect(state.bufferedCloneEvents[3]?.latestProgress?.progress).toEqual({
      stage: "checking_out",
      completed: 10,
      total: 10,
    });
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

  it("cancels preview loading and ignores its late result", () => {
    const request = previewRequest("cancelled-preview", "/work/old-knowledge");
    const loading = connectionReducer(initializationRequiredState(), {
      type: "initializationPreviewStarted",
      request,
    });
    const cancelled = connectionReducer(loading, {
      type: "initializationPreviewCancelled",
    });

    expect(cancelled).toMatchObject({
      step: "local",
      status: "idle",
      workspaceInspection: { status: "initialization_required" },
      activeInitializationPreviewRequest: null,
      initializationPreview: null,
    });
    expect(
      connectionReducer(cancelled, {
        type: "initializationPreviewLoaded",
        request,
        preview: preview("late-cancelled-preview"),
      }),
    ).toBe(cancelled);
  });

  it("returns from rendered preview without losing the inspected repository", () => {
    const cancelled = connectionReducer(previewState(), {
      type: "initializationPreviewCancelled",
    });

    expect(cancelled).toMatchObject({
      step: "local",
      status: "idle",
      localRepository: { root: "/work/old-knowledge" },
      workspaceInspection: { status: "initialization_required" },
      initializationPreview: null,
    });
  });

  it("retries preview failure directly with a new owner", () => {
    const oldRequest = previewRequest("failed-preview", "/work/old-knowledge");
    let state = connectionReducer(initializationRequiredState(), {
      type: "initializationPreviewStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "initializationPreviewFailed",
      request: oldRequest,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "local",
      status: "error",
      errorContext: "initialization_preview",
      localRepository: { root: "/work/old-knowledge" },
      workspaceInspection: { status: "initialization_required" },
      failedInitializationPreviewRequest: oldRequest,
    });
    expect(
      connectionReducer(state, {
        type: "initializationPreviewStarted",
        request: oldRequest,
      }),
    ).toBe(state);

    const retry = previewRequest("retry-preview", "/work/old-knowledge");
    const retried = connectionReducer(state, {
      type: "initializationPreviewStarted",
      request: retry,
    });

    expect(retried).toMatchObject({
      step: "local",
      status: "preview_loading",
      activeInitializationPreviewRequest: retry,
      error: null,
    });
  });

  it("couples every exported local error context to its valid data", () => {
    type PreRepositoryError = Extract<
      LocalConnectionState,
      { status: "error"; errorContext: "pre_repository" }
    >;
    type PreviewError = Extract<
      LocalConnectionState,
      { status: "error"; errorContext: "initialization_preview" }
    >;
    type ConnectionError = Extract<
      LocalConnectionState,
      { status: "error"; errorContext: "workspace_connection" }
    >;

    expectTypeOf<PreRepositoryError["localRepository"]>().toEqualTypeOf<null>();
    expectTypeOf<PreRepositoryError["workspaceInspection"]>().toEqualTypeOf<null>();
    expectTypeOf<PreviewError["localRepository"]>().toEqualTypeOf<RepositorySnapshot>();
    expectTypeOf<PreviewError["workspaceInspection"]>().toEqualTypeOf<
      Extract<WorkspaceInspection, { status: "initialization_required" }>
    >();
    expectTypeOf<ConnectionError["workspaceInspection"]>().toEqualTypeOf<
      Extract<WorkspaceInspection, { status: "ready" }>
    >();
  });

  it("does not mark initialization complete until backend connection succeeds", () => {
    const pending = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: initializationRequest(),
    });
    expect(pending).toMatchObject({
      step: "initialize",
      status: "initializing",
      connectedWorkspace: null,
      initializationPreview: { id: "preview-1" },
    });
  });

  it("ignores stale initialization success and failure for the same root", () => {
    const oldRequest = initializationRequest("initialization-old");
    const newRequest = initializationRequest("initialization-new");
    const state = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: newRequest,
    });

    expect(
      connectionReducer(state, {
        type: "initializationSucceeded",
        request: oldRequest,
        result: initializationResult(),
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "initializationFailed",
        request: oldRequest,
        error: unavailableError,
      }),
    ).toBe(state);
  });

  it("retries initialization with the immutable preview and a new owner", () => {
    const oldRequest = initializationRequest("failed-initialization");
    let state = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, {
      type: "initializationFailed",
      request: oldRequest,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "initialize",
      status: "error",
      failedOperation: "initialization",
      initializationPreview: { id: "preview-1" },
      activeInitializationRequest: null,
      failedInitializationRequest: oldRequest,
    });
    expect(
      connectionReducer(state, {
        type: "initializationStarted",
        request: oldRequest,
      }),
    ).toBe(state);

    const retry = initializationRequest("retry-initialization");
    const retried = connectionReducer(state, {
      type: "initializationStarted",
      request: retry,
    });

    expect(retried).toMatchObject({
      status: "initializing",
      initializationPreview: { id: "preview-1" },
      activeInitializationRequest: retry,
      error: null,
    });
    expect(
      connectionReducer(retried, {
        type: "initializationFailed",
        request: oldRequest,
        error: unavailableError,
      }),
    ).toBe(retried);
  });

  it("ignores stale same-root connect success and failure", () => {
    const initialize = initializationRequest("connect-owner-init");
    const current = initializationConnectionRequest(
      "connect-current",
      initialize.id,
    );
    const stale = initializationConnectionRequest("connect-stale", initialize.id);
    const state = connectingState(initialize, current);

    expect(
      connectionReducer(state, {
        type: "workspaceConnected",
        request: stale,
        workspace: connected(),
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "workspaceConnectionFailed",
        request: stale,
        error: unavailableError,
      }),
    ).toBe(state);
  });

  it("retries only workspace connection after durable initialization succeeds", () => {
    const initialize = initializationRequest("durable-initialization");
    const first = initializationConnectionRequest("connect-failed", initialize.id);
    let state = connectingState(initialize, first);
    state = connectionReducer(state, {
      type: "workspaceConnectionFailed",
      request: first,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "initialize",
      status: "error",
      failedOperation: "connection",
      completedInitializationRequest: initialize,
      initializationResult: { root: "/work/old-knowledge", pushed: true },
      initializationPreview: { id: "preview-1" },
      failedWorkspaceConnectionRequest: first,
    });
    expect(
      connectionReducer(state, {
        type: "workspaceConnectionStarted",
        request: first,
      }),
    ).toBe(state);

    const retry = initializationConnectionRequest("connect-retry", initialize.id);
    state = connectionReducer(state, {
      type: "workspaceConnectionStarted",
      request: retry,
    });
    expect(state).toMatchObject({
      status: "connecting",
      activeWorkspaceConnectionRequest: retry,
      completedInitializationRequest: initialize,
      error: null,
    });

    const workspace = connected();
    state = connectionReducer(state, {
      type: "workspaceConnected",
      request: retry,
      workspace,
    });
    expect(state).toMatchObject({ status: "connected", connectedWorkspace: workspace });
  });

  it("owns and retries connection to an existing workspace", () => {
    const first = existingConnectionRequest("existing-connect-failed");
    let state = connectionReducer(readyWorkspaceState(), {
      type: "workspaceConnectionStarted",
      request: first,
    });
    state = connectionReducer(state, {
      type: "workspaceConnectionFailed",
      request: first,
      error: unavailableError,
    });
    expect(state).toMatchObject({
      step: "local",
      status: "error",
      errorContext: "workspace_connection",
      localRepository: { root: "/work/old-knowledge" },
      workspaceInspection: { status: "ready" },
      failedWorkspaceConnectionRequest: first,
    });
    expect(
      connectionReducer(state, {
        type: "workspaceConnectionStarted",
        request: first,
      }),
    ).toBe(state);

    const retry = existingConnectionRequest("existing-connect-retry");
    state = connectionReducer(state, {
      type: "workspaceConnectionStarted",
      request: retry,
    });
    const stale = connectionReducer(state, {
      type: "workspaceConnected",
      request: first,
      workspace: connected(),
    });
    expect(stale).toBe(state);

    const workspace = connected();
    state = connectionReducer(state, {
      type: "workspaceConnected",
      request: retry,
      workspace,
    });
    expect(state).toMatchObject({ status: "connected", connectedWorkspace: workspace });
  });

  it("invalidates a stale initialization preview", () => {
    const error: AppError = {
      code: "workspace_changed_since_preview",
      message: "초기화 미리보기가 더 이상 유효하지 않습니다.",
      recovery: "retry",
      details: {},
    };
    const request = initializationRequest("stale-preview-init");
    const next = connectionReducer(
      connectionReducer(previewState(), { type: "initializationStarted", request }),
      { type: "initializationFailed", request, error },
    );
    expect(next).toMatchObject({
      step: "local",
      status: "error",
      initializationPreview: null,
      connectedWorkspace: null,
      error,
    });
  });

  it("marks connected only after the owned initialize and connect sequence", () => {
    const workspace = connected("/work/old-knowledge");
    const initialize = initializationRequest("owned-initialize");
    let next = connectionReducer(previewState(), {
      type: "initializationStarted",
      request: initialize,
    });
    next = connectionReducer(next, {
      type: "initializationSucceeded",
      request: initialize,
      result: initializationResult(),
    });
    const connect = initializationConnectionRequest("owned-connect", initialize.id);
    next = connectionReducer(next, {
      type: "workspaceConnectionStarted",
      request: connect,
    });
    next = connectionReducer(next, {
      type: "workspaceConnected",
      request: connect,
      workspace,
    });
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
    const authRequest = authLoadRequest("replacement-auth");
    state = connectionReducer(state, {
      type: "authLoadStarted",
      request: authRequest,
    });
    state = connectionReducer(state, {
      type: "authLoaded",
      request: authRequest,
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
    expect(restored).toEqual(
      connectionReducer(createInitialConnectionState(), {
        type: "currentWorkspaceLoaded",
        workspace: previous,
      }),
    );
  });

  it("does not cancel replacement while a non-cancellable mutation owns the flow", () => {
    const previous = connected();
    let state = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: previous,
    });
    state = connectionReducer(state, { type: "replacementStarted" });
    const authRequest = authLoadRequest("replacement-mutation-auth");
    state = connectionReducer(state, { type: "authLoadStarted", request: authRequest });
    state = connectionReducer(state, {
      type: "authLoaded",
      request: authRequest,
      auth: { status: "authenticated", user },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("old"),
    });
    const clone = cloneRequest("replacement-owned-clone", "/work");
    state = connectionReducer(state, { type: "cloneStarting", request: clone });

    expect(connectionReducer(state, { type: "replacementCancelled" })).toBe(state);
    expect(state).toMatchObject({
      mode: "replacement",
      status: "clone_starting",
      activeCloneStartRequest: clone,
      replacementWorkspace: previous,
    });
  });

  it("clears local retry context when replacement is cancelled", () => {
    const previous = connected();
    let state = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: previous,
    });
    state = connectionReducer(state, { type: "replacementStarted" });
    const authRequest = authLoadRequest("replacement-retry-context-auth");
    state = connectionReducer(state, { type: "authLoadStarted", request: authRequest });
    state = connectionReducer(state, {
      type: "authLoaded",
      request: authRequest,
      auth: { status: "authenticated", user },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("old"),
    });
    const failedRequest = cloneRequest("replacement-failed-clone", "/work/replacement");
    state = connectionReducer(state, { type: "cloneStarting", request: failedRequest });
    state = connectionReducer(state, {
      type: "cloneStartFailed",
      request: failedRequest,
      error: unavailableError,
    });

    const restored = connectionReducer(state, { type: "replacementCancelled" });
    expect(restored).toMatchObject({ status: "connected", connectedWorkspace: previous });
    expect("failedOperation" in restored).toBe(false);
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
