import type {
  AppError,
  AuthConnectionState,
  AuthState,
  CloneProgress,
  CloneStartRequest,
  ConnectedConnectionState,
  ConnectedWorkspace,
  ConnectionAction,
  ConnectionState,
  DeviceAuthorization,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  LocalConnectionState,
  LocalInspectionRequest,
  RecoveryRequiredWorkspace,
  RepositoryConnectionState,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceInspection,
  WorkspaceInspectionRequest,
} from "./types";

type AuthenticatedState = Extract<AuthState, { status: "authenticated" }>;
type SignedOutState = Extract<AuthState, { status: "signed_out" }>;
type ReauthenticationState = Extract<
  AuthState,
  { status: "reauthentication_required" }
>;
type FlowFields =
  | { mode: "initial"; replacementWorkspace: null }
  | { mode: "replacement"; replacementWorkspace: ConnectedWorkspace };

type AuthenticatedContext = FlowFields & {
  recoveryWorkspace: RecoveryRequiredWorkspace | null;
  auth: AuthenticatedState;
  repositories: GithubRepositorySummary[];
  nextRepositoryCursor: string | null;
};

type LocalContext = AuthenticatedContext & {
  selectedRepository: GithubRepositorySummary;
};

function flowFields(state: ConnectionState): FlowFields {
  if (state.mode === "replacement") {
    return {
      mode: "replacement",
      replacementWorkspace: state.replacementWorkspace,
    };
  }
  return { mode: "initial", replacementWorkspace: null };
}

function initialFlow(): { mode: "initial"; replacementWorkspace: null } {
  return { mode: "initial", replacementWorkspace: null };
}

function emptyRepositoryAndLocalData() {
  const repositories: GithubRepositorySummary[] = [];
  return {
    repositories,
    nextRepositoryCursor: null,
    activeRepositoryRequest: null,
    selectedRepository: null,
    activeLocalRequest: null,
    activeCloneStartRequest: null,
    localRepository: null,
    cloneJob: null,
    cloneProgress: null,
    activeWorkspaceInspectionRequest: null,
    workspaceInspection: null,
    activeInitializationPreviewRequest: null,
    initializationPreview: null,
    connectedWorkspace: null,
  };
}

function emptyLocalData() {
  return {
    selectedRepository: null,
    activeLocalRequest: null,
    activeCloneStartRequest: null,
    localRepository: null,
    cloneJob: null,
    cloneProgress: null,
    activeWorkspaceInspectionRequest: null,
    workspaceInspection: null,
    activeInitializationPreviewRequest: null,
    initializationPreview: null,
    connectedWorkspace: null,
  };
}

function authIdle(
  flow: FlowFields,
  recoveryWorkspace: RecoveryRequiredWorkspace | null,
  auth: SignedOutState | null = null,
): AuthConnectionState {
  return {
    ...flow,
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "idle",
    recoveryWorkspace,
    auth,
    authorization: null,
    error: null,
  };
}

function authLoading(state: ConnectionState): AuthConnectionState {
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "loading",
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    authorization: null,
    error: null,
  };
}

function authWaiting(
  state: ConnectionState,
  authorization: DeviceAuthorization,
): AuthConnectionState {
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "waiting_for_user",
    recoveryWorkspace: state.recoveryWorkspace,
    auth: { status: "signed_out" },
    authorization,
    error: null,
  };
}

function authReauthenticationRequired(state: ConnectionState): AuthConnectionState {
  const auth: ReauthenticationState = { status: "reauthentication_required" };
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "reauthentication_required",
    recoveryWorkspace: state.recoveryWorkspace,
    auth,
    authorization: null,
    error: null,
  };
}

function authError(state: ConnectionState, error: AppError): AuthConnectionState {
  const auth =
    state.auth?.status === "reauthentication_required" ||
    state.auth?.status === "signed_out"
      ? state.auth
      : null;
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "error",
    recoveryWorkspace: state.recoveryWorkspace,
    auth,
    authorization: null,
    error,
  };
}

function authenticatedContext(state: ConnectionState): AuthenticatedContext | null {
  if (state.auth?.status !== "authenticated") return null;
  const flow = flowFields(state);
  return {
    ...flow,
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    repositories: state.repositories,
    nextRepositoryCursor: state.nextRepositoryCursor,
  };
}

function repositoryIdle(
  context: AuthenticatedContext,
  repositories = context.repositories,
  nextRepositoryCursor = context.nextRepositoryCursor,
): RepositoryConnectionState {
  return {
    ...context,
    ...emptyLocalData(),
    step: "repository",
    status: "idle",
    authorization: null,
    repositories,
    nextRepositoryCursor,
    activeRepositoryRequest: null,
    error: null,
  };
}

function repositoryLoading(
  context: AuthenticatedContext,
  request: RepositoryLoadRequest,
  repositories: GithubRepositorySummary[],
  nextRepositoryCursor: string | null,
): RepositoryConnectionState {
  return {
    ...context,
    ...emptyLocalData(),
    step: "repository",
    status: "loading",
    authorization: null,
    repositories,
    nextRepositoryCursor,
    activeRepositoryRequest: request,
    error: null,
  };
}

function repositoryError(
  context: AuthenticatedContext,
  error: AppError,
): RepositoryConnectionState {
  return {
    ...context,
    ...emptyLocalData(),
    step: "repository",
    status: "error",
    authorization: null,
    activeRepositoryRequest: null,
    error,
  };
}

function localContext(state: ConnectionState): LocalContext | null {
  const context = authenticatedContext(state);
  if (!context || !state.selectedRepository) return null;
  return { ...context, selectedRepository: state.selectedRepository };
}

function localDefaults(context: LocalContext) {
  return {
    ...context,
    authorization: null,
    activeRepositoryRequest: null,
    activeLocalRequest: null,
    activeCloneStartRequest: null,
    localRepository: null,
    cloneJob: null,
    cloneProgress: null,
    activeWorkspaceInspectionRequest: null,
    workspaceInspection: null,
    activeInitializationPreviewRequest: null,
    initializationPreview: null,
    connectedWorkspace: null,
    error: null,
  };
}

function localIdle(
  context: LocalContext,
  localRepository: RepositorySnapshot | null = null,
  workspaceInspection: Extract<
    WorkspaceInspection,
    { status: "ready" | "initialization_required" }
  > | null = null,
): LocalConnectionState {
  const values = {
    ...localDefaults(context),
  };
  if (localRepository === null) {
    return {
      ...values,
      step: "local",
      status: "idle",
      localRepository: null,
      workspaceInspection: null,
    };
  }
  return {
    ...values,
    step: "local",
    status: "idle",
    localRepository,
    workspaceInspection,
  };
}

function localInspecting(
  context: LocalContext,
  request: LocalInspectionRequest,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "inspecting",
    activeLocalRequest: request,
  };
}

function cloneStarting(
  context: LocalContext,
  request: CloneStartRequest,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "clone_starting",
    activeCloneStartRequest: request,
  };
}

function cloneRunning(
  context: LocalContext,
  status: "cloning" | "clone_cancelling",
  job: NonNullable<LocalConnectionState["cloneJob"]>,
  progress: CloneProgress | null,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status,
    cloneJob: job,
    cloneProgress: progress,
  };
}

function workspaceInspecting(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  request: WorkspaceInspectionRequest,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "workspace_inspecting",
    localRepository,
    activeWorkspaceInspectionRequest: request,
  };
}

function previewLoading(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  request: InitializationPreviewRequest,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "preview_loading",
    localRepository,
    workspaceInspection: { status: "initialization_required" },
    activeInitializationPreviewRequest: request,
  };
}

function validationFailed(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  inspection: Extract<
    WorkspaceInspection,
    { status: "invalid" | "unsupported_version" }
  >,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "validation_failed",
    localRepository,
    workspaceInspection: inspection,
  };
}

function localError(
  context: LocalContext,
  error: AppError,
  localRepository: RepositorySnapshot | null,
  workspaceInspection: WorkspaceInspection | null,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "error",
    localRepository,
    workspaceInspection,
    error,
  };
}

function initializationState(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  preview: InitializationPreview,
  status: "preview" | "initializing",
): ConnectionState {
  const workspaceInspection: Extract<
    WorkspaceInspection,
    { status: "initialization_required" }
  > = { status: "initialization_required" };
  const values = {
    ...localDefaults(context),
    localRepository,
    workspaceInspection,
    initializationPreview: preview,
  };
  if (status === "preview") {
    return { ...values, step: "initialize", status: "preview" };
  }
  return { ...values, step: "initialize", status: "initializing" };
}

function initializationError(
  state: Extract<ConnectionState, { step: "initialize" }>,
  error: AppError,
): ConnectionState {
  if (state.status === "connected") return state;
  return { ...state, status: "error", error };
}

function connectedState(workspace: ConnectedWorkspace): ConnectedConnectionState {
  return {
    ...initialFlow(),
    ...emptyRepositoryAndLocalData(),
    step: "initialize",
    status: "connected",
    recoveryWorkspace: null,
    auth: null,
    authorization: null,
    connectedWorkspace: workspace,
    error: null,
  };
}

function sameRepositoryRequest(
  left: RepositoryLoadRequest | null,
  right: RepositoryLoadRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.userId === right.userId &&
    left.cursor === right.cursor &&
    left.append === right.append
  );
}

function sameLocalRequest(
  left: LocalInspectionRequest | null,
  right: LocalInspectionRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryId === right.repositoryId &&
    left.path === right.path
  );
}

function sameCloneRequest(
  left: CloneStartRequest | null,
  right: CloneStartRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryId === right.repositoryId &&
    left.parentDirectory === right.parentDirectory
  );
}

function sameWorkspaceRequest(
  left: WorkspaceInspectionRequest | null,
  right: WorkspaceInspectionRequest,
): boolean {
  return left?.id === right.id && left.repositoryRoot === right.repositoryRoot;
}

function samePreviewRequest(
  left: InitializationPreviewRequest | null,
  right: InitializationPreviewRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryRoot === right.repositoryRoot &&
    left.workspaceName === right.workspaceName
  );
}

function mergeRepositoryPage(
  current: GithubRepositorySummary[],
  incoming: GithubRepositorySummary[],
): GithubRepositorySummary[] {
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

export function createInitialConnectionState(): AuthConnectionState {
  return authIdle(initialFlow(), null);
}

export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  switch (action.type) {
    case "currentWorkspaceLoaded":
      if (action.workspace?.status === "connected") {
        return connectedState(action.workspace);
      }
      return authIdle(
        initialFlow(),
        action.workspace?.status === "recovery_required" ? action.workspace : null,
      );
    case "authLoading":
      return authLoading(state);
    case "authLoaded":
      if (action.auth.status === "authenticated") {
        return repositoryIdle({
          ...flowFields(state),
          recoveryWorkspace: state.recoveryWorkspace,
          auth: action.auth,
          repositories: [],
          nextRepositoryCursor: null,
        });
      }
      if (action.auth.status === "reauthentication_required") {
        return authReauthenticationRequired(state);
      }
      return authIdle(flowFields(state), state.recoveryWorkspace, action.auth);
    case "loginStarted":
      return authWaiting(state, action.authorization);
    case "authEventReceived": {
      if (action.event.status === "reauthentication_required") {
        return authReauthenticationRequired(state);
      }
      if (
        state.step !== "auth" ||
        state.status !== "waiting_for_user" ||
        action.event.requestId !== state.authorization.requestId
      ) {
        return state;
      }
      if (action.event.status === "authenticated") {
        return repositoryIdle({
          ...flowFields(state),
          recoveryWorkspace: state.recoveryWorkspace,
          auth: { status: "authenticated", user: action.event.user },
          repositories: [],
          nextRepositoryCursor: null,
        });
      }
      if (action.event.status === "failed") return authError(state, action.event.error);
      if (action.event.status === "cancelled") {
        return authIdle(flowFields(state), state.recoveryWorkspace, {
          status: "signed_out",
        });
      }
      return state;
    }
    case "repositoryLoading": {
      if (state.step !== "repository" || state.auth.user.id !== action.request.userId) {
        return state;
      }
      const cursorIsOwned = action.request.append
        ? action.request.cursor === state.nextRepositoryCursor && action.request.cursor !== null
        : action.request.cursor === null;
      if (!cursorIsOwned) return state;
      const context = authenticatedContext(state);
      if (!context) return state;
      return repositoryLoading(
        context,
        action.request,
        action.request.append ? state.repositories : [],
        action.request.append ? state.nextRepositoryCursor : null,
      );
    }
    case "repositoryPageLoaded": {
      if (
        state.step !== "repository" ||
        state.status !== "loading" ||
        !sameRepositoryRequest(state.activeRepositoryRequest, action.request)
      ) {
        return state;
      }
      const context = authenticatedContext(state);
      if (!context) return state;
      const repositories = action.request.append
        ? mergeRepositoryPage(state.repositories, action.page.items)
        : mergeRepositoryPage([], action.page.items);
      return repositoryIdle(context, repositories, action.page.nextCursor);
    }
    case "repositoryLoadFailed": {
      if (
        state.step !== "repository" ||
        state.status !== "loading" ||
        !sameRepositoryRequest(state.activeRepositoryRequest, action.request)
      ) {
        return state;
      }
      const context = authenticatedContext(state);
      return context ? repositoryError(context, action.error) : state;
    }
    case "repositorySelected": {
      const context = authenticatedContext(state);
      if (
        !context ||
        state.step === "auth" ||
        (state.step === "initialize" && state.status === "connected")
      ) {
        return state;
      }
      if (state.selectedRepository?.id === action.repository.id) return state;
      if (
        (state.step === "local" &&
          (state.status === "clone_starting" ||
            state.status === "cloning" ||
            state.status === "clone_cancelling")) ||
        (state.step === "initialize" && state.status === "initializing")
      ) {
        return state;
      }
      return localIdle({ ...context, selectedRepository: action.repository });
    }
    case "localInspectionStarted": {
      const context = localContext(state);
      if (!context || context.selectedRepository.id !== action.request.repositoryId) return state;
      return localInspecting(context, action.request);
    }
    case "localRepositoryChanged": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "inspecting" ||
        !sameLocalRequest(state.activeLocalRequest, action.request)
      ) {
        return state;
      }
      return localIdle(context, action.repository);
    }
    case "localInspectionFailed": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "inspecting" ||
        !sameLocalRequest(state.activeLocalRequest, action.request)
      ) {
        return state;
      }
      return localError(context, action.error, null, null);
    }
    case "cloneStarting": {
      const context = localContext(state);
      if (!context || context.selectedRepository.id !== action.request.repositoryId) return state;
      return cloneStarting(context, action.request);
    }
    case "cloneStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "clone_starting" ||
        !sameCloneRequest(state.activeCloneStartRequest, action.request)
      ) {
        return state;
      }
      return cloneRunning(context, "cloning", action.job, null);
    }
    case "cloneStartFailed": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "clone_starting" ||
        !sameCloneRequest(state.activeCloneStartRequest, action.request)
      ) {
        return state;
      }
      return localError(context, action.error, null, null);
    }
    case "cloneCancellationRequested": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "cloning" ||
        state.cloneJob.requestId !== action.requestId
      ) {
        return state;
      }
      return cloneRunning(context, "clone_cancelling", state.cloneJob, state.cloneProgress);
    }
    case "cloneEventReceived": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        (state.status !== "cloning" && state.status !== "clone_cancelling") ||
        state.cloneJob.requestId !== action.event.requestId
      ) {
        return state;
      }
      if (action.event.status === "progress") {
        return cloneRunning(context, state.status, state.cloneJob, action.event.progress);
      }
      if (action.event.status === "completed") {
        return localIdle(context, action.event.repository);
      }
      if (action.event.status === "failed") {
        return localError(context, action.event.error, null, null);
      }
      return localIdle(context);
    }
    case "workspaceInspectionStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        !state.localRepository ||
        state.localRepository.root !== action.request.repositoryRoot
      ) {
        return state;
      }
      return workspaceInspecting(context, state.localRepository, action.request);
    }
    case "workspaceInspected": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "workspace_inspecting" ||
        !sameWorkspaceRequest(state.activeWorkspaceInspectionRequest, action.request)
      ) {
        return state;
      }
      if (
        action.inspection.status === "invalid" ||
        action.inspection.status === "unsupported_version"
      ) {
        return validationFailed(context, state.localRepository, action.inspection);
      }
      return localIdle(context, state.localRepository, action.inspection);
    }
    case "workspaceInspectionFailed": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "workspace_inspecting" ||
        !sameWorkspaceRequest(state.activeWorkspaceInspectionRequest, action.request)
      ) {
        return state;
      }
      return localError(context, action.error, state.localRepository, null);
    }
    case "initializationPreviewStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        (state.status !== "idle" && state.status !== "preview_loading") ||
        !state.localRepository ||
        state.localRepository.root !== action.request.repositoryRoot ||
        state.workspaceInspection?.status !== "initialization_required"
      ) {
        return state;
      }
      return previewLoading(context, state.localRepository, action.request);
    }
    case "initializationPreviewLoaded": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "preview_loading" ||
        !samePreviewRequest(state.activeInitializationPreviewRequest, action.request) ||
        action.preview.workspaceName !== action.request.workspaceName ||
        action.preview.repositoryFingerprint !== state.localRepository.fingerprint
      ) {
        return state;
      }
      return initializationState(context, state.localRepository, action.preview, "preview");
    }
    case "initializationPreviewFailed": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "preview_loading" ||
        !samePreviewRequest(state.activeInitializationPreviewRequest, action.request)
      ) {
        return state;
      }
      return localError(
        context,
        action.error,
        state.localRepository,
        state.workspaceInspection,
      );
    }
    case "initializationStarted": {
      if (state.step !== "initialize" || state.status !== "preview") return state;
      const context = localContext(state);
      return context
        ? initializationState(context, state.localRepository, state.initializationPreview, "initializing")
        : state;
    }
    case "initializationFailed": {
      if (state.step !== "initialize" || state.status !== "initializing") return state;
      if (action.error.code === "workspace_changed_since_preview") {
        const context = localContext(state);
        return context
          ? localError(context, action.error, state.localRepository, state.workspaceInspection)
          : state;
      }
      return initializationError(state, action.error);
    }
    case "workspaceConnected":
      if (
        state.step === "initialize" &&
        state.status === "initializing" &&
        state.localRepository.root === action.workspace.path
      ) {
        return connectedState(action.workspace);
      }
      if (
        state.step === "local" &&
        state.status === "idle" &&
        state.workspaceInspection?.status === "ready" &&
        state.localRepository?.root === action.workspace.path
      ) {
        return connectedState(action.workspace);
      }
      return state;
    case "authOperationFailed":
      return state.step === "auth" ? authError(state, action.error) : state;
    case "replacementStarted":
      return state.step === "initialize" && state.status === "connected"
        ? authIdle(
            { mode: "replacement", replacementWorkspace: state.connectedWorkspace },
            null,
          )
        : state;
    case "replacementCancelled":
      return state.mode === "replacement"
        ? connectedState(state.replacementWorkspace)
        : state;
  }
}
