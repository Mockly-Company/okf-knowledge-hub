import type {
  AppError,
  AuthLoadRequest,
  AuthConnectionState,
  AuthState,
  AuthStatusEvent,
  BufferedCloneEventGroup,
  CloneProgress,
  CloneProgressEvent,
  CloneStartRequest,
  ConnectedConnectionState,
  ConnectedWorkspace,
  ConnectionAction,
  ConnectionState,
  DeviceAuthorization,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  InitializationRequest,
  InitializationResult,
  InitializeConnectionState,
  LoginBeginRequest,
  LocalConnectionState,
  LocalInspectionRequest,
  RecoveryRequiredWorkspace,
  RepositoryConnectionState,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceInspection,
  WorkspaceInspectionRequest,
  WorkspaceConnectionRequest,
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
type InitializationWorkflowState = Exclude<
  InitializeConnectionState,
  ConnectedConnectionState
>;

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
    activeAuthLoadRequest: null,
    activeLoginBeginRequest: null,
    error: null,
  };
}

function authLoading(
  state: ConnectionState,
  request: AuthLoadRequest,
): AuthConnectionState {
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "loading",
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    authorization: null,
    activeAuthLoadRequest: request,
    activeLoginBeginRequest: null,
    error: null,
  };
}

function loginBeginning(
  state: ConnectionState,
  request: LoginBeginRequest,
): AuthConnectionState {
  const auth =
    state.auth?.status === "signed_out" ||
    state.auth?.status === "reauthentication_required"
      ? state.auth
      : null;
  return {
    ...flowFields(state),
    ...emptyRepositoryAndLocalData(),
    step: "auth",
    status: "login_beginning",
    recoveryWorkspace: state.recoveryWorkspace,
    auth,
    authorization: null,
    activeAuthLoadRequest: null,
    activeLoginBeginRequest: request,
    bufferedAuthEvents: [],
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
    activeAuthLoadRequest: null,
    activeLoginBeginRequest: null,
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
    activeAuthLoadRequest: null,
    activeLoginBeginRequest: null,
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
    activeAuthLoadRequest: null,
    activeLoginBeginRequest: null,
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
    activeWorkspaceConnectionRequest: null,
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
    bufferedCloneEvents: [],
  };
}

function cloneRunning(
  context: LocalContext,
  status: "cloning" | "clone_cancelling",
  request: CloneStartRequest,
  job: NonNullable<LocalConnectionState["cloneJob"]>,
  progress: CloneProgress | null,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status,
    cloneJob: job,
    cloneRequest: request,
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

function localWorkspaceConnecting(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  workspaceInspection: Extract<WorkspaceInspection, { status: "ready" }>,
  request: Extract<WorkspaceConnectionRequest, { source: "existing" }>,
): LocalConnectionState {
  return {
    ...localDefaults(context),
    step: "local",
    status: "workspace_connecting",
    localRepository,
    workspaceInspection,
    activeWorkspaceConnectionRequest: request,
  };
}

function localError(
  context: LocalContext,
  error: AppError,
  failure:
    | {
        errorContext: "pre_repository";
        failedOperation: "local_inspection";
        localRepository: null;
        workspaceInspection: null;
        failedLocalInspectionRequest: LocalInspectionRequest;
        failedCloneStartRequest: null;
        failedInitializationPreviewRequest: null;
        failedWorkspaceConnectionRequest: null;
      }
    | {
        errorContext: "pre_repository";
        failedOperation: "clone";
        localRepository: null;
        workspaceInspection: null;
        failedLocalInspectionRequest: null;
        failedCloneStartRequest: CloneStartRequest;
        failedInitializationPreviewRequest: null;
        failedWorkspaceConnectionRequest: null;
      }
    | {
        errorContext: "repository";
        localRepository: RepositorySnapshot;
        workspaceInspection: null;
        failedInitializationPreviewRequest: null;
        failedWorkspaceConnectionRequest: null;
      }
    | {
        errorContext: "initialization_preview";
        localRepository: RepositorySnapshot;
        workspaceInspection: Extract<
          WorkspaceInspection,
          { status: "initialization_required" }
        >;
        failedInitializationPreviewRequest: InitializationPreviewRequest | null;
        failedWorkspaceConnectionRequest: null;
      }
    | {
        errorContext: "workspace_connection";
        localRepository: RepositorySnapshot;
        workspaceInspection: Extract<WorkspaceInspection, { status: "ready" }>;
        failedInitializationPreviewRequest: null;
        failedWorkspaceConnectionRequest: Extract<
          WorkspaceConnectionRequest,
          { source: "existing" }
        >;
      },
): LocalConnectionState {
  const values = { ...localDefaults(context), error };
  switch (failure.errorContext) {
    case "pre_repository":
      return { ...values, step: "local", status: "error", ...failure };
    case "repository":
      return { ...values, step: "local", status: "error", ...failure };
    case "initialization_preview":
      return { ...values, step: "local", status: "error", ...failure };
    case "workspace_connection":
      return { ...values, step: "local", status: "error", ...failure };
  }
}

function initializationValues(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  preview: InitializationPreview,
) {
  const workspaceInspection: Extract<
    WorkspaceInspection,
    { status: "initialization_required" }
  > = { status: "initialization_required" };
  return {
    ...localDefaults(context),
    localRepository,
    workspaceInspection,
    initializationPreview: preview,
  };
}

function initializationContext(state: InitializationWorkflowState): LocalContext {
  return {
    ...flowFields(state),
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    repositories: state.repositories,
    nextRepositoryCursor: state.nextRepositoryCursor,
    selectedRepository: state.selectedRepository,
  };
}

function initializationPreviewState(
  context: LocalContext,
  localRepository: RepositorySnapshot,
  preview: InitializationPreview,
): InitializeConnectionState {
  return {
    ...initializationValues(context, localRepository, preview),
    step: "initialize",
    status: "preview",
    activeInitializationRequest: null,
    completedInitializationRequest: null,
    initializationResult: null,
    activeWorkspaceConnectionRequest: null,
    failedInitializationRequest: null,
    failedWorkspaceConnectionRequest: null,
    error: null,
  };
}

function initializingState(
  state: Extract<
    InitializeConnectionState,
    { status: "preview" } | { status: "error"; failedOperation: "initialization" }
  >,
  request: InitializationRequest,
): InitializeConnectionState {
  return {
    ...initializationValues(
      initializationContext(state),
      state.localRepository,
      state.initializationPreview,
    ),
    step: "initialize",
    status: "initializing",
    activeInitializationRequest: request,
    completedInitializationRequest: null,
    initializationResult: null,
    activeWorkspaceConnectionRequest: null,
    failedInitializationRequest: null,
    failedWorkspaceConnectionRequest: null,
    error: null,
  };
}

function initializationReadyToConnect(
  state: Extract<InitializeConnectionState, { status: "initializing" }>,
  result: InitializationResult,
): InitializeConnectionState {
  return {
    ...initializationValues(
      initializationContext(state),
      state.localRepository,
      state.initializationPreview,
    ),
    step: "initialize",
    status: "ready_to_connect",
    activeInitializationRequest: null,
    completedInitializationRequest: state.activeInitializationRequest,
    initializationResult: result,
    activeWorkspaceConnectionRequest: null,
    failedInitializationRequest: null,
    failedWorkspaceConnectionRequest: null,
    error: null,
  };
}

function initializationConnecting(
  state: Extract<
    InitializeConnectionState,
    | { status: "ready_to_connect" }
    | { status: "error"; failedOperation: "connection" }
  >,
  request: Extract<WorkspaceConnectionRequest, { source: "initialization" }>,
): InitializeConnectionState {
  return {
    ...initializationValues(
      initializationContext(state),
      state.localRepository,
      state.initializationPreview,
    ),
    step: "initialize",
    status: "connecting",
    activeInitializationRequest: null,
    completedInitializationRequest: state.completedInitializationRequest,
    initializationResult: state.initializationResult,
    activeWorkspaceConnectionRequest: request,
    failedInitializationRequest: null,
    failedWorkspaceConnectionRequest: null,
    error: null,
  };
}

function initializationCommandError(
  state: Extract<InitializeConnectionState, { status: "initializing" }>,
  error: AppError,
): InitializeConnectionState {
  return {
    ...initializationValues(
      initializationContext(state),
      state.localRepository,
      state.initializationPreview,
    ),
    step: "initialize",
    status: "error",
    failedOperation: "initialization",
    activeInitializationRequest: null,
    completedInitializationRequest: null,
    initializationResult: null,
    activeWorkspaceConnectionRequest: null,
    failedInitializationRequest: state.activeInitializationRequest,
    failedWorkspaceConnectionRequest: null,
    error,
  };
}

function initializationConnectionError(
  state: Extract<InitializeConnectionState, { status: "connecting" }>,
  error: AppError,
): InitializeConnectionState {
  return {
    ...initializationValues(
      initializationContext(state),
      state.localRepository,
      state.initializationPreview,
    ),
    step: "initialize",
    status: "error",
    failedOperation: "connection",
    activeInitializationRequest: null,
    completedInitializationRequest: state.completedInitializationRequest,
    initializationResult: state.initializationResult,
    activeWorkspaceConnectionRequest: null,
    failedInitializationRequest: null,
    failedWorkspaceConnectionRequest: state.activeWorkspaceConnectionRequest,
    error,
  };
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

function sameInitializationRequest(
  left: InitializationRequest | null,
  right: InitializationRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.previewId === right.previewId &&
    left.repositoryRoot === right.repositoryRoot
  );
}

function sameWorkspaceConnectionRequest(
  left: WorkspaceConnectionRequest | null,
  right: WorkspaceConnectionRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryRoot === right.repositoryRoot &&
    left.source === right.source &&
    left.initializationRequestId === right.initializationRequestId
  );
}

function hasNonCancellableMutationOwnership(state: ConnectionState): boolean {
  return (
    (state.step === "local" &&
      (state.status === "clone_starting" ||
        state.status === "cloning" ||
        state.status === "clone_cancelling" ||
        state.status === "workspace_connecting")) ||
    (state.step === "initialize" &&
      (state.status === "initializing" || state.status === "connecting"))
  );
}

function canStartLocalInspection(state: ConnectionState): boolean {
  return (
    state.step === "local" &&
    (state.status === "idle" ||
      state.status === "inspecting" ||
      state.status === "workspace_inspecting" ||
      state.status === "preview_loading" ||
      state.status === "validation_failed" ||
      (state.status === "error" && state.errorContext !== "pre_repository"))
  );
}

function canStartClone(state: ConnectionState): boolean {
  return canStartLocalInspection(state);
}

function canStartWorkspaceInspection(state: ConnectionState): boolean {
  return (
    state.step === "local" &&
    state.localRepository !== null &&
    (state.status === "idle" ||
      state.status === "workspace_inspecting" ||
      state.status === "preview_loading" ||
      state.status === "validation_failed" ||
      state.status === "error")
  );
}

function canStartInitializationPreview(state: ConnectionState): boolean {
  return (
    state.step === "local" &&
    (state.status === "idle" ||
      state.status === "preview_loading" ||
      (state.status === "error" &&
        state.errorContext === "initialization_preview")) &&
    state.localRepository !== null &&
    state.workspaceInspection?.status === "initialization_required"
  );
}

const MAX_BUFFERED_AUTH_EVENTS = 8;
const MAX_BUFFERED_CLONE_REQUESTS = 4;

function appendBoundedAuthEvent(
  events: AuthStatusEvent[],
  event: AuthStatusEvent,
): AuthStatusEvent[] {
  return [...events, event].slice(-MAX_BUFFERED_AUTH_EVENTS);
}

function replayBufferedAuthEvents(
  state: AuthConnectionState,
  requestId: string,
  events: AuthStatusEvent[],
): ConnectionState {
  let next: ConnectionState = state;
  for (const event of events) {
    if (event.requestId !== requestId) continue;
    next = connectionReducer(next, { type: "authEventReceived", event });
    if (next.step !== "auth" || next.status !== "waiting_for_user") break;
  }
  return next;
}

function bufferCloneEvent(
  groups: BufferedCloneEventGroup[],
  event: CloneProgressEvent,
): BufferedCloneEventGroup[] {
  const existingIndex = groups.findIndex(
    (group) => group.requestId === event.requestId,
  );
  if (existingIndex === -1) {
    const group: BufferedCloneEventGroup = {
      requestId: event.requestId,
      latestProgress: event.status === "progress" ? event : null,
      terminal: event.status === "progress" ? null : event,
    };
    return [...groups, group].slice(-MAX_BUFFERED_CLONE_REQUESTS);
  }

  const existing = groups[existingIndex];
  if (!existing || existing.terminal) return groups;
  const updated: BufferedCloneEventGroup =
    event.status === "progress"
      ? { ...existing, latestProgress: event }
      : { ...existing, terminal: event };
  return groups.map((group, index) =>
    index === existingIndex ? updated : group,
  );
}

function replayBufferedCloneEvents(
  context: LocalContext,
  request: CloneStartRequest,
  job: NonNullable<LocalConnectionState["cloneJob"]>,
  groups: BufferedCloneEventGroup[],
): LocalConnectionState {
  const group = groups.find((candidate) => candidate.requestId === job.requestId);
  if (!group) return cloneRunning(context, "cloning", request, job, null);
  if (group.terminal?.status === "completed") {
    return localIdle(context, group.terminal.repository);
  }
  if (group.terminal?.status === "failed") {
    return localError(context, group.terminal.error, {
      errorContext: "pre_repository",
      failedOperation: "clone",
      localRepository: null,
      workspaceInspection: null,
      failedLocalInspectionRequest: null,
      failedCloneStartRequest: request,
      failedInitializationPreviewRequest: null,
      failedWorkspaceConnectionRequest: null,
    });
  }
  if (group.terminal?.status === "cancelled") return localIdle(context);
  return cloneRunning(
    context,
    "cloning",
    request,
    job,
    group.latestProgress?.progress ?? null,
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
    case "authLoadStarted":
      if (
        hasNonCancellableMutationOwnership(state) ||
        (state.step === "auth" &&
          (state.status === "waiting_for_user" ||
            state.status === "login_beginning"))
      ) {
        return state;
      }
      return authLoading(state, action.request);
    case "authLoaded":
      if (
        state.step !== "auth" ||
        state.status !== "loading" ||
        state.activeAuthLoadRequest.id !== action.request.id
      ) {
        return state;
      }
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
    case "authLoadFailed":
      return state.step === "auth" &&
        state.status === "loading" &&
        state.activeAuthLoadRequest.id === action.request.id
        ? authError(state, action.error)
        : state;
    case "loginBeginStarted":
      return hasNonCancellableMutationOwnership(state)
        ? state
        : loginBeginning(state, action.request);
    case "loginStarted":
      if (
        state.step === "auth" &&
        state.status === "login_beginning" &&
        state.activeLoginBeginRequest.id === action.request.id
      ) {
        return replayBufferedAuthEvents(
          authWaiting(state, action.authorization),
          action.authorization.requestId,
          state.bufferedAuthEvents,
        );
      }
      return state;
    case "loginBeginFailed":
      return state.step === "auth" &&
        state.status === "login_beginning" &&
        state.activeLoginBeginRequest.id === action.request.id
        ? authError(state, action.error)
        : state;
    case "authEventReceived": {
      if (action.event.status === "reauthentication_required") {
        return authReauthenticationRequired(state);
      }
      if (state.step === "auth" && state.status === "login_beginning") {
        return {
          ...state,
          bufferedAuthEvents: appendBoundedAuthEvent(
            state.bufferedAuthEvents,
            action.event,
          ),
        };
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
        (state.step === "initialize" && state.status !== "preview")
      ) {
        return state;
      }
      if (state.selectedRepository?.id === action.repository.id) return state;
      if (hasNonCancellableMutationOwnership(state)) return state;
      return localIdle({ ...context, selectedRepository: action.repository });
    }
    case "localInspectionStarted": {
      const context = localContext(state);
      if (
        !canStartLocalInspection(state) ||
        !context ||
        context.selectedRepository.id !== action.request.repositoryId
      ) {
        return state;
      }
      return localInspecting(context, action.request);
    }
    case "localInspectionRetryStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "error" ||
        state.errorContext !== "pre_repository" ||
        state.failedOperation !== "local_inspection" ||
        action.request.id === state.failedLocalInspectionRequest.id ||
        action.request.repositoryId !==
          state.failedLocalInspectionRequest.repositoryId ||
        action.request.path !== state.failedLocalInspectionRequest.path ||
        action.request.repositoryId !== context.selectedRepository.id
      ) {
        return state;
      }
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
      return localError(context, action.error, {
        errorContext: "pre_repository",
        failedOperation: "local_inspection",
        localRepository: null,
        workspaceInspection: null,
        failedLocalInspectionRequest: action.request,
        failedCloneStartRequest: null,
        failedInitializationPreviewRequest: null,
        failedWorkspaceConnectionRequest: null,
      });
    }
    case "cloneStarting": {
      const context = localContext(state);
      if (
        !canStartClone(state) ||
        !context ||
        context.selectedRepository.id !== action.request.repositoryId
      ) {
        return state;
      }
      return cloneStarting(context, action.request);
    }
    case "cloneRetryStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "error" ||
        state.errorContext !== "pre_repository" ||
        state.failedOperation !== "clone" ||
        action.request.id === state.failedCloneStartRequest.id ||
        action.request.repositoryId !== state.failedCloneStartRequest.repositoryId ||
        action.request.parentDirectory !==
          state.failedCloneStartRequest.parentDirectory ||
        action.request.repositoryId !== context.selectedRepository.id
      ) {
        return state;
      }
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
      return replayBufferedCloneEvents(
        context,
        state.activeCloneStartRequest,
        action.job,
        state.bufferedCloneEvents,
      );
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
      return localError(context, action.error, {
        errorContext: "pre_repository",
        failedOperation: "clone",
        localRepository: null,
        workspaceInspection: null,
        failedLocalInspectionRequest: null,
        failedCloneStartRequest: action.request,
        failedInitializationPreviewRequest: null,
        failedWorkspaceConnectionRequest: null,
      });
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
      return cloneRunning(
        context,
        "clone_cancelling",
        state.cloneRequest,
        state.cloneJob,
        state.cloneProgress,
      );
    }
    case "cloneEventReceived": {
      if (state.step === "local" && state.status === "clone_starting") {
        return {
          ...state,
          bufferedCloneEvents: bufferCloneEvent(
            state.bufferedCloneEvents,
            action.event,
          ),
        };
      }
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
        return cloneRunning(
          context,
          state.status,
          state.cloneRequest,
          state.cloneJob,
          action.event.progress,
        );
      }
      if (action.event.status === "completed") {
        return localIdle(context, action.event.repository);
      }
      if (action.event.status === "failed") {
        return localError(context, action.event.error, {
          errorContext: "pre_repository",
          failedOperation: "clone",
          localRepository: null,
          workspaceInspection: null,
          failedLocalInspectionRequest: null,
          failedCloneStartRequest: state.cloneRequest,
          failedInitializationPreviewRequest: null,
          failedWorkspaceConnectionRequest: null,
        });
      }
      return localIdle(context);
    }
    case "workspaceInspectionStarted": {
      const context = localContext(state);
      if (
        !canStartWorkspaceInspection(state) ||
        !context ||
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
      return localError(context, action.error, {
        errorContext: "repository",
        localRepository: state.localRepository,
        workspaceInspection: null,
        failedInitializationPreviewRequest: null,
        failedWorkspaceConnectionRequest: null,
      });
    }
    case "initializationPreviewStarted": {
      const context = localContext(state);
      if (
        !canStartInitializationPreview(state) ||
        !context ||
        !state.localRepository ||
        state.workspaceInspection?.status !== "initialization_required" ||
        (state.step === "local" &&
          state.status === "error" &&
          state.failedInitializationPreviewRequest?.id === action.request.id) ||
        state.localRepository.root !== action.request.repositoryRoot
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
      return initializationPreviewState(context, state.localRepository, action.preview);
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
        {
          errorContext: "initialization_preview",
          localRepository: state.localRepository,
          workspaceInspection: state.workspaceInspection,
          failedInitializationPreviewRequest: action.request,
          failedWorkspaceConnectionRequest: null,
        },
      );
    }
    case "initializationPreviewCancelled": {
      const context = localContext(state);
      if (!context) return state;
      if (
        state.step === "local" &&
        (state.status === "preview_loading" ||
          (state.status === "error" &&
            state.errorContext === "initialization_preview"))
      ) {
        return localIdle(context, state.localRepository, state.workspaceInspection);
      }
      if (state.step === "initialize" && state.status === "preview") {
        return localIdle(context, state.localRepository, state.workspaceInspection);
      }
      return state;
    }
    case "initializationStarted": {
      if (
        state.step !== "initialize" ||
        (state.status !== "preview" &&
          !(state.status === "error" &&
            state.failedOperation === "initialization")) ||
        (state.status === "error" &&
          state.failedInitializationRequest.id === action.request.id) ||
        action.request.previewId !== state.initializationPreview.id ||
        action.request.repositoryRoot !== state.localRepository.root
      ) {
        return state;
      }
      return initializingState(state, action.request);
    }
    case "initializationSucceeded": {
      if (
        state.step !== "initialize" ||
        state.status !== "initializing" ||
        !sameInitializationRequest(state.activeInitializationRequest, action.request) ||
        action.result.root !== action.request.repositoryRoot
      ) {
        return state;
      }
      return initializationReadyToConnect(state, action.result);
    }
    case "initializationFailed": {
      if (
        state.step !== "initialize" ||
        state.status !== "initializing" ||
        !sameInitializationRequest(state.activeInitializationRequest, action.request)
      ) {
        return state;
      }
      if (action.error.code === "workspace_changed_since_preview") {
        const context = localContext(state);
        return context
          ? localError(context, action.error, {
              errorContext: "initialization_preview",
              localRepository: state.localRepository,
              workspaceInspection: state.workspaceInspection,
              failedInitializationPreviewRequest: null,
              failedWorkspaceConnectionRequest: null,
            })
          : state;
      }
      return initializationCommandError(state, action.error);
    }
    case "workspaceConnectionStarted": {
      const context = localContext(state);
      if (
        context &&
        action.request.source === "existing" &&
        state.step === "local" &&
        ((state.status === "idle" &&
          state.workspaceInspection?.status === "ready") ||
          (state.status === "error" &&
            state.errorContext === "workspace_connection")) &&
        state.localRepository !== null &&
        state.workspaceInspection?.status === "ready" &&
        (state.status !== "error" ||
          state.failedWorkspaceConnectionRequest.id !== action.request.id) &&
        state.localRepository.root === action.request.repositoryRoot
      ) {
        return localWorkspaceConnecting(
          context,
          state.localRepository,
          state.workspaceInspection,
          action.request,
        );
      }
      if (
        state.step === "local" &&
        hasNonCancellableMutationOwnership(state)
      ) {
        return state;
      }
      if (
        action.request.source === "initialization" &&
        state.step === "initialize" &&
        (state.status === "ready_to_connect" ||
          (state.status === "error" && state.failedOperation === "connection")) &&
        (state.status !== "error" ||
          state.failedWorkspaceConnectionRequest.id !== action.request.id) &&
        state.completedInitializationRequest.id ===
          action.request.initializationRequestId &&
        state.localRepository.root === action.request.repositoryRoot
      ) {
        return initializationConnecting(state, action.request);
      }
      return state;
    }
    case "workspaceConnected":
      if (
        state.step === "local" &&
        state.status === "workspace_connecting" &&
        sameWorkspaceConnectionRequest(
          state.activeWorkspaceConnectionRequest,
          action.request,
        ) &&
        action.workspace.path === action.request.repositoryRoot
      ) {
        return connectedState(action.workspace);
      }
      if (
        state.step === "initialize" &&
        state.status === "connecting" &&
        sameWorkspaceConnectionRequest(
          state.activeWorkspaceConnectionRequest,
          action.request,
        ) &&
        action.workspace.path === action.request.repositoryRoot
      ) {
        return connectedState(action.workspace);
      }
      return state;
    case "workspaceConnectionFailed": {
      const context = localContext(state);
      if (
        context &&
        state.step === "local" &&
        state.status === "workspace_connecting" &&
        sameWorkspaceConnectionRequest(
          state.activeWorkspaceConnectionRequest,
          action.request,
        )
      ) {
        return localError(context, action.error, {
          errorContext: "workspace_connection",
          localRepository: state.localRepository,
          workspaceInspection: state.workspaceInspection,
          failedInitializationPreviewRequest: null,
          failedWorkspaceConnectionRequest: state.activeWorkspaceConnectionRequest,
        });
      }
      if (
        state.step === "initialize" &&
        state.status === "connecting" &&
        sameWorkspaceConnectionRequest(
          state.activeWorkspaceConnectionRequest,
          action.request,
        )
      ) {
        return initializationConnectionError(state, action.error);
      }
      return state;
    }
    case "replacementStarted":
      return state.step === "initialize" && state.status === "connected"
        ? authIdle(
            { mode: "replacement", replacementWorkspace: state.connectedWorkspace },
            null,
          )
        : state;
    case "replacementCancelled":
      return state.mode === "replacement" &&
        !hasNonCancellableMutationOwnership(state)
        ? connectedState(state.replacementWorkspace)
        : state;
  }
}
