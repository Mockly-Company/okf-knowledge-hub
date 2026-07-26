import { describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { TauriWorkspaceConnectionGateway } from "@/infrastructure/workspace/TauriWorkspaceConnectionGateway";
import {
  desktopOnlyError,
  UnavailableWorkspaceConnectionGateway,
} from "@/infrastructure/workspace/UnavailableWorkspaceConnectionGateway";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import {
  connectionReducer,
  createInitialConnectionState,
} from "./connection-reducer";
import type {
  AppError,
  ConnectedWorkspace,
  GithubRepositorySummary,
  InitializationPreview,
  CloneProgressEvent,
  AuthStatusEvent,
  RepositorySnapshot,
} from "./types";

const user = { id: 7, login: "hyeeun", avatarUrl: "https://example.test/me" };

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

function readyToInitializeState() {
  let state = createInitialConnectionState();
  state = connectionReducer(state, {
    type: "authLoaded",
    auth: { status: "authenticated", user },
  });
  state = connectionReducer(state, {
    type: "repositorySelected",
    repository: repository("old"),
  });
  state = connectionReducer(state, {
    type: "localRepositoryChanged",
    repositoryId: "old",
    repository: localRepository(),
  });
  state = connectionReducer(state, {
    type: "workspaceInspected",
    repositoryRoot: "/work/old-knowledge",
    inspection: { status: "initialization_required" },
  });
  return connectionReducer(state, {
    type: "initializationPreviewLoaded",
    repositoryRoot: "/work/old-knowledge",
    preview: preview(),
  });
}

describe("connectionReducer", () => {
  it("invalidates repository, local, and preview state when login restarts", () => {
    const state = readyToInitializeState();
    const next = connectionReducer(state, {
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
      selectedRepository: null,
      localRepository: null,
      workspaceInspection: null,
      initializationPreview: null,
      connectedWorkspace: null,
    });
  });

  it("invalidates private downstream state when authentication becomes signed out", () => {
    const state = readyToInitializeState();
    const next = connectionReducer(state, {
      type: "authLoaded",
      auth: { status: "signed_out" },
    });

    expect(next).toMatchObject({
      step: "auth",
      status: "idle",
      repositories: [],
      selectedRepository: null,
      localRepository: null,
      workspaceInspection: null,
      initializationPreview: null,
      connectedWorkspace: null,
    });
  });

  it("ignores terminal auth events that do not match the active login request", () => {
    const initial = createInitialConnectionState();
    const stale = connectionReducer(initial, {
      type: "authEventReceived",
      event: { status: "authenticated", requestId: "old", user },
    });
    expect(stale).toBe(initial);

    const waiting = connectionReducer(initial, {
      type: "loginStarted",
      authorization: {
        requestId: "current",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        expiresAtUnix: 2_000,
        intervalSeconds: 5,
      },
    });
    expect(
      connectionReducer(waiting, {
        type: "authEventReceived",
        event: { status: "cancelled", requestId: "old" },
      }),
    ).toBe(waiting);
  });

  it("appends repository pages, deduplicates by stable id, and refreshes repeated items", () => {
    let state = connectionReducer(createInitialConnectionState(), {
      type: "authLoaded",
      auth: { status: "authenticated", user },
    });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      userId: user.id,
      page: { items: [repository("one"), repository("two")], nextCursor: "next" },
      append: false,
    });
    state = connectionReducer(state, {
      type: "repositoryPageLoaded",
      userId: user.id,
      page: {
        items: [
          { ...repository("two"), fullName: "Renamed/two-knowledge" },
          repository("three"),
        ],
        nextCursor: null,
      },
      append: true,
    });

    expect(state.repositories.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(state.repositories[1]?.fullName).toBe("Renamed/two-knowledge");
    expect(state.nextRepositoryCursor).toBeNull();
  });

  it("ignores a repository response that arrives after authentication was invalidated", () => {
    const signedOut = connectionReducer(readyToInitializeState(), {
      type: "authLoaded",
      auth: { status: "signed_out" },
    });
    const stale = connectionReducer(signedOut, {
      type: "repositoryPageLoaded",
      userId: user.id,
      page: { items: [repository("stale")], nextCursor: null },
      append: false,
    });

    expect(stale).toBe(signedOut);
    expect(stale.repositories).toEqual([]);
  });

  it("does not navigate backwards when a repository page arrives after selection", () => {
    let state = connectionReducer(createInitialConnectionState(), {
      type: "authLoaded",
      auth: { status: "authenticated", user },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("selected"),
    });
    const stale = connectionReducer(state, {
      type: "repositoryPageLoaded",
      userId: user.id,
      page: { items: [repository("late")], nextCursor: null },
      append: false,
    });

    expect(stale).toBe(state);
    expect(stale.step).toBe("local");
  });

  it("clears every repository-dependent value when repository selection changes", () => {
    const state = readyToInitializeState();
    const next = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });

    expect(next).toMatchObject({
      step: "local",
      selectedRepository: { id: "new" },
      localRepository: null,
      workspaceInspection: null,
      initializationPreview: null,
      connectedWorkspace: null,
    });
  });

  it("clears workspace validation and preview when the local repository changes", () => {
    const state = connectionReducer(readyToInitializeState(), {
      type: "repositorySelected",
      repository: repository("old"),
    });
    const next = connectionReducer(state, {
      type: "localRepositoryChanged",
      repositoryId: "old",
      repository: localRepository("/work/new-clone"),
    });

    expect(next).toMatchObject({
      step: "local",
      localRepository: { root: "/work/new-clone" },
      workspaceInspection: null,
      initializationPreview: null,
      connectedWorkspace: null,
    });
  });

  it("accepts clone progress and cancellation only for the active request", () => {
    let state = connectionReducer(
      connectionReducer(createInitialConnectionState(), {
        type: "authLoaded",
        auth: { status: "authenticated", user },
      }),
      { type: "repositorySelected", repository: repository("one") },
    );
    state = connectionReducer(state, {
      type: "cloneStarted",
      repositoryId: "one",
      job: { requestId: "clone-1", targetPath: "/work/one-knowledge" },
    });

    const ignored = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "clone-other",
        progress: { stage: "receiving_objects", completed: 5, total: 10 },
      },
    });
    expect(ignored).toBe(state);

    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: "clone-1",
        progress: { stage: "receiving_objects", completed: 5, total: 10 },
      },
    });
    expect(state.cloneProgress).toEqual({
      stage: "receiving_objects",
      completed: 5,
      total: 10,
    });

    state = connectionReducer(state, { type: "cloneCancellationRequested", requestId: "clone-1" });
    expect(state.status).toBe("clone_cancelling");
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: { status: "cancelled", requestId: "clone-1" },
    });
    expect(state).toMatchObject({ status: "idle", cloneJob: null, cloneProgress: null });
  });

  it("moves a completed clone into local validation without trusting another request", () => {
    let state = connectionReducer(
      connectionReducer(createInitialConnectionState(), {
        type: "authLoaded",
        auth: { status: "authenticated", user },
      }),
      { type: "repositorySelected", repository: repository("one") },
    );
    state = connectionReducer(state, {
      type: "cloneStarted",
      repositoryId: "one",
      job: { requestId: "clone-1", targetPath: "/work/one-knowledge" },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: "clone-1",
        repository: localRepository("/work/one-knowledge"),
      },
    });

    expect(state).toMatchObject({
      step: "local",
      status: "idle",
      cloneJob: null,
      localRepository: { root: "/work/one-knowledge" },
      workspaceInspection: null,
    });
  });

  it("retains invalid YAML and newer schema diagnostics without creating a preview", () => {
    let state = connectionReducer(readyToInitializeState(), {
      type: "repositorySelected",
      repository: repository("old"),
    });
    state = connectionReducer(state, {
      type: "workspaceInspected",
      repositoryRoot: "/work/old-knowledge",
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
      initializationPreview: null,
      workspaceInspection: { status: "invalid" },
    });

    state = connectionReducer(state, {
      type: "workspaceInspected",
      repositoryRoot: "/work/old-knowledge",
      inspection: { status: "unsupported_version", foundVersion: 2 },
    });
    expect(state).toMatchObject({
      step: "local",
      status: "validation_failed",
      initializationPreview: null,
      workspaceInspection: { status: "unsupported_version", foundVersion: 2 },
    });
  });

  it("does not mark initialization complete until a backend connection succeeds", () => {
    const pending = connectionReducer(readyToInitializeState(), {
      type: "initializationStarted",
    });

    expect(pending).toMatchObject({
      step: "initialize",
      status: "initializing",
      connectedWorkspace: null,
    });
  });

  it("ignores a preview response for a local repository that is no longer selected", () => {
    let state = readyToInitializeState();
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });

    const stale = connectionReducer(state, {
      type: "initializationPreviewLoaded",
      repositoryRoot: "/work/old-knowledge",
      preview: preview("stale-preview"),
    });
    expect(stale).toBe(state);
  });

  it("invalidates a stale preview and returns to local validation", () => {
    const stale: AppError = {
      code: "workspace_changed_since_preview",
      message: "초기화 미리보기가 더 이상 유효하지 않습니다.",
      recovery: "retry",
      details: {},
    };
    const next = connectionReducer(
      connectionReducer(readyToInitializeState(), { type: "initializationStarted" }),
      { type: "initializationFailed", error: stale },
    );

    expect(next).toMatchObject({
      step: "local",
      status: "idle",
      initializationPreview: null,
      connectedWorkspace: null,
      error: stale,
    });
  });

  it("marks connected only with the workspace returned by the backend", () => {
    const workspace = connected("/work/new-knowledge");
    const next = connectionReducer(
      connectionReducer(readyToInitializeState(), { type: "initializationStarted" }),
      { type: "workspaceConnected", workspace },
    );

    expect(next).toMatchObject({
      step: "initialize",
      status: "connected",
      connectedWorkspace: workspace,
    });
  });

  it("restores the previous connected workspace when replacement is cancelled", () => {
    const previous = connected();
    let state = connectionReducer(createInitialConnectionState(), {
      type: "currentWorkspaceLoaded",
      workspace: previous,
    });
    state = connectionReducer(state, { type: "replacementStarted" });
    expect(state).toMatchObject({ step: "auth", mode: "replacement" });

    state = connectionReducer(state, { type: "replacementCancelled" });
    expect(state).toMatchObject({
      step: "initialize",
      status: "connected",
      mode: "initial",
      connectedWorkspace: previous,
      replacementWorkspace: null,
    });

    const staleCompletion = connectionReducer(state, {
      type: "workspaceConnected",
      workspace: connected("/work/stale-replacement"),
    });
    expect(staleCompletion).toBe(state);
  });
});

describe("workspace connection gateway adapters", () => {
  it("selects the desktop adapter only when the official runtime detector succeeds", () => {
    expect(createWorkspaceConnectionGateway(() => true)).toBeInstanceOf(
      TauriWorkspaceConnectionGateway,
    );
    expect(createWorkspaceConnectionGateway(() => false)).toBeInstanceOf(
      UnavailableWorkspaceConnectionGateway,
    );
  });

  it("maps every desktop operation to the exact Task 8 command contract", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T,>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
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

    expect(calls).toEqual([
      { command: "get_current_workspace", args: undefined },
      { command: "get_auth_state", args: undefined },
      { command: "begin_github_auth", args: undefined },
      { command: "cancel_github_auth", args: { requestId: "auth-1" } },
      { command: "logout_github", args: undefined },
      { command: "list_github_repositories", args: { cursor: "cursor-1" } },
      {
        command: "inspect_existing_clone",
        args: { path: "/work/repo", repositoryId: "repo-1" },
      },
      {
        command: "clone_repository",
        args: {
          request: {
            repositoryId: "repo-1",
            fullName: "Mockly-Company/repo-1-knowledge",
            httpsUrl: "https://github.com/Mockly-Company/repo-1-knowledge.git",
            parentDirectory: "/work",
          },
        },
      },
      { command: "cancel_repository_clone", args: { requestId: "clone-1" } },
      { command: "inspect_workspace", args: { repositoryPath: "/work/repo" } },
      { command: "connect_workspace", args: { repositoryPath: "/work/repo" } },
      {
        command: "preview_workspace_initialization",
        args: {
          request: {
            repositoryPath: "/work/repo",
            workspaceName: "Mockly",
            repositoryId: "repo-1",
            repositoryFullName: "Mockly-Company/repo-1-knowledge",
          },
        },
      },
      { command: "initialize_workspace", args: { previewId: "preview-1" } },
    ]);
  });

  it("uses exact directory options and the opener boundary", async () => {
    const choose = vi.fn(async () => "/selected");
    const launch = vi.fn(async () => undefined);
    const gateway = new TauriWorkspaceConnectionGateway(
      async <T,>() => undefined as T,
      async () => () => undefined,
      choose,
      launch,
    );

    await expect(gateway.pickDirectory()).resolves.toBe("/selected");
    await gateway.openExternal("https://github.com/login/device");

    expect(choose).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(launch).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("subscribes only to the two public events and returns their teardown functions", async () => {
    const subscriptions: string[] = [];
    const teardowns: string[] = [];
    let authHandler: ((event: Event<AuthStatusEvent>) => void) | undefined;
    let cloneHandler: ((event: Event<CloneProgressEvent>) => void) | undefined;
    const listen = async <T,>(
      event: string,
      listener: (event: Event<T>) => void,
    ) => {
      subscriptions.push(event);
      if (event === "github-auth-status") {
        authHandler = listener as (event: Event<AuthStatusEvent>) => void;
      } else {
        cloneHandler = listener as (event: Event<CloneProgressEvent>) => void;
      }
      return () => teardowns.push(event);
    };
    const gateway = new TauriWorkspaceConnectionGateway(
      async <T,>() => undefined as T,
      listen,
      async () => null,
      async () => undefined,
    );
    const authListener = vi.fn();
    const cloneListener = vi.fn();

    const unlistenAuth = await gateway.onAuthStatus(authListener);
    const unlistenClone = await gateway.onCloneProgress(cloneListener);
    const authEvent: AuthStatusEvent = { status: "waiting_for_user", requestId: "auth-1" };
    const cloneEvent: CloneProgressEvent = { status: "cancelled", requestId: "clone-1" };
    authHandler?.({ event: "github-auth-status", id: 1, payload: authEvent });
    cloneHandler?.({ event: "repository-clone-progress", id: 2, payload: cloneEvent });
    unlistenAuth();
    unlistenClone();

    expect(subscriptions).toEqual(["github-auth-status", "repository-clone-progress"]);
    expect(authListener).toHaveBeenCalledWith(authEvent);
    expect(cloneListener).toHaveBeenCalledWith(cloneEvent);
    expect(teardowns).toEqual(["github-auth-status", "repository-clone-progress"]);
  });

  it("fails closed in a browser without fabricating auth, repository, or connection success", async () => {
    const gateway = new UnavailableWorkspaceConnectionGateway();
    const expected = desktopOnlyError();

    await expect(gateway.getCurrentWorkspace()).rejects.toEqual(expected);
    await expect(gateway.getAuthState()).rejects.toEqual(expected);
    await expect(gateway.listRepositories()).rejects.toEqual(expected);
    await expect(gateway.connectWorkspace("/work/repo")).rejects.toEqual(expected);
    await expect(gateway.onAuthStatus(() => undefined)).rejects.toEqual(expected);
  });
});
