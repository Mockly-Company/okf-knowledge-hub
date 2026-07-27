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
  user,
  unavailableError,
  repository,
  localRepository,
  connected,
  repositoryRequest,
  cloneRequest,
  authLoadRequest,
} from "./connection-test-helpers";

describe("connectionReducer replacement transitions", () => {
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
