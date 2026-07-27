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
  localRequest,
  cloneRequest,
  selectedRepositoryState,
} from "./connection-test-helpers";

describe("connectionReducer local and clone transitions", () => {
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
    expect(
      connectionReducer(state, {
        type: "cloneRetryStarted",
        request: {
          ...failedRequest,
          id: "changed-clone-target",
          targetPath: "/work/retry-clone/not-the-owned-target",
        },
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

  it("allows a new clone parent only for a failed clone that requests directory recovery", () => {
    const failedRequest = cloneRequest("collision-clone", "/work/taken");
    const collisionError: AppError = {
      code: "repository_path_conflict",
      message: "이미 폴더가 있습니다.",
      recovery: "choose_another_directory",
      details: { path: "/work/taken/old-knowledge" },
    };
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: failedRequest,
    });
    state = connectionReducer(state, {
      type: "cloneStartFailed",
      request: failedRequest,
      error: collisionError,
    });

    const newDirectory = cloneRequest("collision-new-parent", "/work/available");
    expect(
      connectionReducer(state, {
        type: "cloneAlternateDirectoryStarted",
        request: newDirectory,
      }),
    ).toMatchObject({
      status: "clone_starting",
      activeCloneStartRequest: newDirectory,
      error: null,
    });

    const retryOnlyError = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: failedRequest,
    });
    const retryOnlyFailure = connectionReducer(retryOnlyError, {
      type: "cloneStartFailed",
      request: failedRequest,
      error: unavailableError,
    });
    expect(
      connectionReducer(retryOnlyFailure, {
        type: "cloneAlternateDirectoryStarted",
        request: newDirectory,
      }),
    ).toBe(retryOnlyFailure);
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
      job: { requestId: original.id, targetPath: "/work/old-knowledge" },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "failed",
        requestId: original.id,
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

  it("correlates clone progress and cancellation by the frontend-owned request id", () => {
    const request = cloneRequest("clone-start", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneStarted",
      request,
      job: { requestId: request.id, targetPath: "/work/old-knowledge" },
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
        requestId: request.id,
        progress: { stage: "receiving_objects", completed: 5, total: 10 },
      },
    });
    expect(state.cloneProgress?.completed).toBe(5);
    state = connectionReducer(state, {
      type: "cloneCancellationRequested",
      requestId: request.id,
    });
    expect(state.status).toBe("clone_cancelling");
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: { status: "cancelled", requestId: request.id },
    });
    expect(state).toMatchObject({ status: "idle", cloneJob: null, cloneProgress: null });
  });

  it("accepts matching early clone progress and completion before job metadata", () => {
    const request = cloneRequest("early-clone-complete", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: request.id,
        progress: { stage: "receiving_objects", completed: 4, total: 10 },
      },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: request.id,
        ownershipTargetPath: request.targetPath,
        repository: localRepository("/work/old-knowledge"),
      },
    });
    expect(state).toMatchObject({
      step: "local",
      status: "idle",
      localRepository: { root: "/work/old-knowledge" },
      cloneJob: null,
    });
    expect(
      connectionReducer(state, {
        type: "cloneStarted",
        request,
        job: { requestId: request.id, targetPath: request.targetPath },
      }),
    ).toBe(state);
  });

  it("accepts a backend ownership target through a symlink even when inspection canonicalizes root", () => {
    const request = cloneRequest("symlink-clone", "/workspace-link");
    const starting = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });

    const completed = connectionReducer(starting, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: request.id,
        ownershipTargetPath: "/workspace-link/old-knowledge",
        repository: localRepository("/real-workspace/old-knowledge"),
      },
    });

    expect(completed).toMatchObject({
      step: "local",
      status: "idle",
      localRepository: { root: "/real-workspace/old-knowledge" },
    });
  });

  it("keeps Windows request ownership separate from a canonical repository root", () => {
    const request: CloneStartRequest = {
      ...cloneRequest("windows-clone", "C:\\workspace-link"),
      targetPath: "C:\\workspace-link\\old-knowledge",
    };
    const starting = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });

    const completed = connectionReducer(starting, {
      type: "cloneEventReceived",
      event: {
        status: "completed",
        requestId: request.id,
        ownershipTargetPath: "C:\\workspace-link\\old-knowledge",
        repository: localRepository("\\\\?\\C:\\real-workspace\\old-knowledge"),
      },
    });

    expect(completed).toMatchObject({
      step: "local",
      status: "idle",
      localRepository: { root: "\\\\?\\C:\\real-workspace\\old-knowledge" },
    });
  });

  it("rejects a duplicate active clone start without replacing its owned request", () => {
    const original = cloneRequest("clone-original", "/work");
    const duplicate = cloneRequest("clone-duplicate", "/other");
    const active = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: original,
    });

    expect(
      connectionReducer(active, { type: "cloneStarting", request: duplicate }),
    ).toBe(active);
    expect(active).toMatchObject({ activeCloneStartRequest: original });
  });

  it("rejects same-id clone results and completions with a different owned target", () => {
    const request = cloneRequest("owned-target", "/work");
    const starting = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    expect(
      connectionReducer(starting, {
        type: "cloneStarted",
        request,
        job: { requestId: request.id, targetPath: "/other/old-knowledge" },
      }),
    ).toBe(starting);
    expect(
      connectionReducer(starting, {
        type: "cloneEventReceived",
        event: {
          status: "completed",
          requestId: request.id,
          ownershipTargetPath: "/other/old-knowledge",
          repository: localRepository("/other/old-knowledge"),
        },
      }),
    ).toBe(starting);

    const running = connectionReducer(starting, {
      type: "cloneStarted",
      request,
      job: { requestId: request.id, targetPath: "/work/old-knowledge" },
    });
    expect(
      connectionReducer(running, {
        type: "cloneEventReceived",
        event: {
          status: "completed",
          requestId: request.id,
          ownershipTargetPath: "/other/old-knowledge",
          repository: localRepository("/other/old-knowledge"),
        },
      }),
    ).toBe(running);
  });

  it("keeps early clone failure and cancellation terminal when job metadata arrives late", () => {
    const failedRequest = cloneRequest("early-clone-failed", "/work");
    let failed = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request: failedRequest,
    });
    failed = connectionReducer(failed, {
      type: "cloneEventReceived",
      event: {
        status: "failed",
        requestId: failedRequest.id,
        error: unavailableError,
      },
    });
    failed = connectionReducer(failed, {
      type: "cloneStarted",
      request: failedRequest,
      job: {
        requestId: failedRequest.id,
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
      event: { status: "cancelled", requestId: cancelledRequest.id },
    });
    cancelled = connectionReducer(cancelled, {
      type: "cloneStarted",
      request: cancelledRequest,
      job: {
        requestId: cancelledRequest.id,
        targetPath: "/work/old-knowledge",
      },
    });
    expect(cancelled).toMatchObject({ step: "local", status: "idle" });
  });

  it("drops stale clone ids and does not retain clone event buffers", () => {
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
        requestId: request.id,
        ownershipTargetPath: request.targetPath,
        repository: localRepository(),
      },
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: request.id,
        progress: { stage: "checking_out", completed: 10, total: 10 },
      },
    });
    expect(state).toMatchObject({ status: "idle", localRepository: { fingerprint: "fingerprint" } });
    expect("bufferedCloneEvents" in state).toBe(false);
  });

  it("accepts early clone progress immediately without a publication buffer", () => {
    const request = cloneRequest("early-clone-progress", "/work");
    let state = connectionReducer(selectedRepositoryState(), {
      type: "cloneStarting",
      request,
    });
    state = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: request.id,
        progress: { stage: "checking_out", completed: 10, total: 10 },
      },
    });

    expect(state).toMatchObject({
      step: "local",
      status: "cloning",
      cloneJob: null,
      cloneProgress: { stage: "checking_out", completed: 10, total: 10 },
    });
  });

});
