import type {
  AuthConnectionState,
  AuthState,
  ConnectionAction,
  ConnectionState,
  ConnectedWorkspace,
  GithubRepositorySummary,
} from "./types";

type StateOverrides = Partial<Omit<AuthConnectionState, "step" | "status">>;

const emptyValues = {
  mode: "initial" as const,
  auth: null,
  authorization: null,
  repositories: [],
  nextRepositoryCursor: null,
  selectedRepository: null,
  localRepository: null,
  cloneJob: null,
  cloneProgress: null,
  workspaceInspection: null,
  initializationPreview: null,
  connectedWorkspace: null,
  replacementWorkspace: null,
  error: null,
};

export function createInitialConnectionState(): ConnectionState {
  return { ...emptyValues, step: "auth", status: "idle" };
}

function authenticated(auth: AuthState | null) {
  return auth?.status === "authenticated" ? auth : null;
}

function authStep(
  state: ConnectionState,
  status: Extract<ConnectionState, { step: "auth" }>["status"],
  overrides: StateOverrides = {},
): ConnectionState {
  return { ...state, ...overrides, step: "auth", status } as ConnectionState;
}

function repositoryStep(
  state: ConnectionState,
  status: Extract<ConnectionState, { step: "repository" }>["status"] = "idle",
  overrides: StateOverrides = {},
): ConnectionState {
  const auth = authenticated(overrides.auth ?? state.auth);
  return auth
    ? ({ ...state, ...overrides, auth, step: "repository", status } as ConnectionState)
    : state;
}

function localStep(
  state: ConnectionState,
  status: Extract<ConnectionState, { step: "local" }>["status"] = "idle",
  overrides: StateOverrides = {},
): ConnectionState {
  const auth = authenticated(overrides.auth ?? state.auth);
  const selectedRepository = overrides.selectedRepository ?? state.selectedRepository;
  return auth && selectedRepository
    ? ({
        ...state,
        ...overrides,
        auth,
        selectedRepository,
        step: "local",
        status,
      } as ConnectionState)
    : state;
}

function initializeStep(
  state: ConnectionState,
  status: Extract<ConnectionState, { step: "initialize" }>["status"],
  overrides: StateOverrides = {},
): ConnectionState {
  return { ...state, ...overrides, step: "initialize", status } as ConnectionState;
}

function clearRepositoryDependencies() {
  return {
    selectedRepository: null,
    localRepository: null,
    cloneJob: null,
    cloneProgress: null,
    workspaceInspection: null,
    initializationPreview: null,
    connectedWorkspace: null,
    error: null,
  };
}

function clearLocalDependencies() {
  return {
    localRepository: null,
    cloneJob: null,
    cloneProgress: null,
    workspaceInspection: null,
    initializationPreview: null,
    connectedWorkspace: null,
    error: null,
  };
}

function mergeRepositoryPage(
  current: GithubRepositorySummary[],
  incoming: GithubRepositorySummary[],
) {
  const positions = new Map(current.map((item, index) => [item.id, index]));
  const result = [...current];
  for (const item of incoming) {
    const index = positions.get(item.id);
    if (index === undefined) {
      positions.set(item.id, result.length);
      result.push(item);
    } else {
      result[index] = item;
    }
  }
  return result;
}

function connectedState(
  state: ConnectionState,
  workspace: ConnectedWorkspace,
): ConnectionState {
  return initializeStep(state, "connected", {
    mode: "initial",
    connectedWorkspace: workspace,
    replacementWorkspace: null,
    initializationPreview: null,
    cloneJob: null,
    cloneProgress: null,
    error: null,
  });
}

export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  switch (action.type) {
    case "currentWorkspaceLoaded":
      if (action.workspace?.status === "connected") {
        return connectedState(state, action.workspace);
      }
      return authStep(state, "idle", {
        ...clearRepositoryDependencies(),
        repositories: [],
        nextRepositoryCursor: null,
        authorization: null,
        auth: null,
      });
    case "authLoading":
      return authStep(state, "loading", { error: null });
    case "authLoaded":
      if (action.auth.status === "authenticated") {
        const previousUser = authenticated(state.auth)?.user.id;
        const accountChanged = previousUser !== undefined && previousUser !== action.auth.user.id;
        return repositoryStep(state, "idle", {
          ...(accountChanged ? clearRepositoryDependencies() : {}),
          auth: action.auth,
          authorization: null,
          ...(accountChanged ? { repositories: [], nextRepositoryCursor: null } : {}),
          error: null,
        });
      }
      if (action.auth.status === "signed_out") {
        return authStep(state, "idle", {
          ...clearRepositoryDependencies(),
          auth: action.auth,
          authorization: null,
          repositories: [],
          nextRepositoryCursor: null,
        });
      }
      return authStep(
        state,
        "reauthentication_required",
        { auth: action.auth, authorization: null, error: null },
      );
    case "loginStarted":
      return authStep(state, "waiting_for_user", {
        ...clearRepositoryDependencies(),
        auth: { status: "signed_out" },
        authorization: action.authorization,
        repositories: [],
        nextRepositoryCursor: null,
      });
    case "authEventReceived": {
      if (
        action.event.status !== "reauthentication_required" &&
        (!state.authorization ||
          action.event.requestId !== state.authorization.requestId)
      ) {
        return state;
      }
      switch (action.event.status) {
        case "waiting_for_user":
          return authStep(state, "waiting_for_user");
        case "authenticated":
          return repositoryStep(state, "idle", {
            auth: { status: "authenticated", user: action.event.user },
            authorization: null,
            error: null,
          });
        case "reauthentication_required":
          return authStep(state, "reauthentication_required", {
            auth: { status: "reauthentication_required" },
            authorization: null,
          });
        case "failed":
          return authStep(state, "error", {
            authorization: null,
            error: action.event.error,
          });
        case "cancelled":
          return authStep(state, "idle", {
            authorization: null,
            error: null,
          });
      }
    }
    case "repositoryLoading":
      if (state.step !== "repository") return state;
      return repositoryStep(state, "loading", {
        error: null,
        ...(action.append ? {} : { repositories: [], nextRepositoryCursor: null }),
      });
    case "repositoryPageLoaded":
      if (
        state.step !== "repository" ||
        authenticated(state.auth)?.user.id !== action.userId
      ) {
        return state;
      }
      return repositoryStep(state, "idle", {
        repositories: action.append
          ? mergeRepositoryPage(state.repositories, action.page.items)
          : mergeRepositoryPage([], action.page.items),
        nextRepositoryCursor: action.page.nextCursor,
        error: null,
      });
    case "repositorySelected": {
      const changed = state.selectedRepository?.id !== action.repository.id;
      return localStep(state, "idle", {
        ...(changed ? clearLocalDependencies() : {}),
        selectedRepository: action.repository,
      });
    }
    case "localInspectionStarted":
      if (state.step !== "local") return state;
      return localStep(state, "inspecting", { error: null });
    case "localRepositoryChanged":
      if (
        state.step !== "local" ||
        state.selectedRepository.id !== action.repositoryId
      ) {
        return state;
      }
      return localStep(state, "idle", {
        ...clearLocalDependencies(),
        localRepository: action.repository,
      });
    case "cloneStarted":
      if (
        state.step !== "local" ||
        state.selectedRepository.id !== action.repositoryId
      ) {
        return state;
      }
      return localStep(state, "cloning", {
        ...clearLocalDependencies(),
        cloneJob: action.job,
      });
    case "cloneCancellationRequested":
      return state.cloneJob?.requestId === action.requestId
        ? localStep(state, "clone_cancelling")
        : state;
    case "cloneEventReceived":
      if (state.cloneJob?.requestId !== action.event.requestId) return state;
      switch (action.event.status) {
        case "progress":
          return localStep(state, state.status === "clone_cancelling" ? "clone_cancelling" : "cloning", {
            cloneProgress: action.event.progress,
          });
        case "completed":
          return localStep(state, "idle", {
            ...clearLocalDependencies(),
            localRepository: action.event.repository,
          });
        case "failed":
          return localStep(state, "error", {
            cloneJob: null,
            cloneProgress: null,
            error: action.event.error,
          });
        case "cancelled":
          return localStep(state, "idle", {
            cloneJob: null,
            cloneProgress: null,
            error: null,
          });
      }
    case "workspaceInspected": {
      if (
        state.step !== "local" ||
        state.localRepository?.root !== action.repositoryRoot
      ) {
        return state;
      }
      const validationFailed =
        action.inspection.status === "invalid" ||
        action.inspection.status === "unsupported_version";
      return localStep(state, validationFailed ? "validation_failed" : "idle", {
        workspaceInspection: action.inspection,
        initializationPreview: null,
        connectedWorkspace: null,
        error: null,
      });
    }
    case "initializationPreviewLoaded":
      if (
        state.step !== "local" ||
        state.localRepository?.root !== action.repositoryRoot ||
        state.workspaceInspection?.status !== "initialization_required"
      ) {
        return state;
      }
      return initializeStep(state, "preview", {
        initializationPreview: action.preview,
        connectedWorkspace: null,
        error: null,
      });
    case "initializationStarted":
      return state.step === "initialize" && state.initializationPreview
        ? initializeStep(state, "initializing", {
            connectedWorkspace: null,
            error: null,
          })
        : state;
    case "initializationFailed":
      if (state.step !== "initialize" || state.status !== "initializing") {
        return state;
      }
      if (action.error.code === "workspace_changed_since_preview") {
        return localStep(state, "idle", {
          initializationPreview: null,
          connectedWorkspace: null,
          error: action.error,
        });
      }
      return initializeStep(state, "error", {
        connectedWorkspace: null,
        error: action.error,
      });
    case "workspaceConnected":
      if (
        (state.step === "initialize" && state.status === "initializing") ||
        (state.step === "local" &&
          state.workspaceInspection?.status === "ready" &&
          state.localRepository?.root === action.workspace.path)
      ) {
        return connectedState(state, action.workspace);
      }
      return state;
    case "operationFailed":
      return { ...state, status: "error", error: action.error } as ConnectionState;
    case "replacementStarted":
      if (!state.connectedWorkspace) return state;
      return authStep(state, "idle", {
        ...clearRepositoryDependencies(),
        mode: "replacement",
        auth: null,
        authorization: null,
        repositories: [],
        nextRepositoryCursor: null,
        replacementWorkspace: state.connectedWorkspace,
      });
    case "replacementCancelled":
      return state.mode === "replacement" && state.replacementWorkspace
        ? connectedState(state, state.replacementWorkspace)
        : state;
  }
}
