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
  repositoryRequest,
  localRequest,
  cloneRequest,
  workspaceRequest,
  previewRequest,
  authLoadRequest,
  loginBeginRequest,
  initializationRequest,
  repositoryState,
  selectedRepositoryState,
  previewState,
} from "./connection-test-helpers";

describe("connectionReducer repository transitions", () => {
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
            requestId: request.id,
            targetPath: "/work/old-knowledge",
          },
        });
      }
      if (status === "clone_cancelling") {
        state = connectionReducer(state, {
          type: "cloneCancellationRequested",
          requestId: request.id,
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
      job: { requestId: request.id, targetPath: "/work/old-knowledge" },
    });
    state = connectionReducer(state, {
      type: "repositorySelected",
      repository: repository("new"),
    });

    const progressed = connectionReducer(state, {
      type: "cloneEventReceived",
      event: {
        status: "progress",
        requestId: request.id,
        progress: { stage: "receiving_objects", completed: 2, total: 3 },
      },
    });

    expect(progressed).toMatchObject({
      status: "cloning",
      selectedRepository: { id: "old" },
      cloneJob: { requestId: request.id },
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
      job: { requestId: clone.id, targetPath: "/work/old-knowledge" },
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

});
