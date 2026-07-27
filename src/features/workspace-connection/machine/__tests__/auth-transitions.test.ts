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
  authLoadRequest,
  loginBeginRequest,
  authorization,
  previewState,
} from "./connection-test-helpers";

describe("connectionReducer auth transitions", () => {
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

  it("rejects duplicate login starts without replacing the owned operation id", () => {
    const oldRequest = { id: "login-old" };
    const newRequest = { id: "login-new" };
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: oldRequest,
    });
    state = connectionReducer(state, { type: "loginBeginStarted", request: newRequest });

    expect(state).toMatchObject({
      status: "login_beginning",
      activeLoginBeginRequest: oldRequest,
    });

    expect(
      connectionReducer(state, {
        type: "loginBeginFailed",
        request: newRequest,
        error: unavailableError,
      }),
    ).toBe(state);
    expect(
      connectionReducer(state, {
        type: "loginStarted",
        request: newRequest,
        authorization: {
          requestId: newRequest.id,
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

  it("accepts a matching authenticated event before the auth command response", () => {
    const request = loginBeginRequest("early-authenticated-login");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "authenticated", requestId: request.id, user },
    });
    state = connectionReducer(state, {
      type: "loginStarted",
      request,
      authorization: authorization(request.id),
    });

    expect(state).toMatchObject({
      step: "repository",
      status: "idle",
      auth: { status: "authenticated", user },
    });
  });

  it("keeps early auth failure and cancellation terminal when the command resolves late", () => {
    const failureRequest = loginBeginRequest("early-failed-login");
    let failed = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: failureRequest,
    });
    failed = connectionReducer(failed, {
      type: "authEventReceived",
      event: {
        status: "failed",
        requestId: failureRequest.id,
        error: unavailableError,
      },
    });
    failed = connectionReducer(failed, {
      type: "loginStarted",
      request: failureRequest,
      authorization: authorization(failureRequest.id),
    });
    expect(failed).toMatchObject({ step: "auth", status: "error" });

    const cancelRequest = loginBeginRequest("early-cancelled-login");
    let cancelled = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request: cancelRequest,
    });
    cancelled = connectionReducer(cancelled, {
      type: "authEventReceived",
      event: { status: "cancelled", requestId: cancelRequest.id },
    });
    cancelled = connectionReducer(cancelled, {
      type: "loginStarted",
      request: cancelRequest,
      authorization: authorization(cancelRequest.id),
    });
    expect(cancelled).toMatchObject({ step: "auth", status: "idle" });
  });

  it("ignores unrelated auth events without retaining a publication buffer", () => {
    const request = loginBeginRequest("early-auth-order");
    let state = connectionReducer(createInitialConnectionState(), {
      type: "loginBeginStarted",
      request,
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "waiting_for_user", requestId: "unrelated-auth-order" },
    });
    state = connectionReducer(state, {
      type: "authEventReceived",
      event: { status: "waiting_for_user", requestId: request.id },
    });

    expect(state).toMatchObject({ step: "auth", status: "login_beginning" });
    expect("bufferedAuthEvents" in state).toBe(false);
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

});
