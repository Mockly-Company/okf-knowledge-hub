import { describe, expect, expectTypeOf, it } from "vitest";
import {
  connectionReducer,
  createInitialConnectionState,
} from "../connection-reducer";
import type {
  AppError,
  AuthStatusEvent,
  CloneStartRequest,
  CloneProgressEvent,
  LocalInspectionRequest,
  RepositorySnapshot,
  WorkspaceInspection,
} from "../../model/protocol";
import type { LocalConnectionState } from "../connection-state";
import {
  unavailableError,
  repository,
  localRepository,
  preview,
  connected,
  workspaceRequest,
  previewRequest,
  initializationRequest,
  initializationResult,
  initializationConnectionRequest,
  existingConnectionRequest,
  localState,
  initializationRequiredState,
  readyWorkspaceState,
  previewState,
  connectingState,
} from "./connection-test-helpers";

describe("connectionReducer workspace initialization transitions", () => {
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

});
