import type {
  AppError,
  AuthLoadRequest,
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
} from "../types";

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
  repositoriesLoaded: boolean;
};

type LocalContext = AuthenticatedContext & {
  selectedRepository: GithubRepositorySummary;
};
type InitializationWorkflowState = Exclude<
  InitializeConnectionState,
  ConnectedConnectionState
>;

export function flowFields(state: ConnectionState): FlowFields {
  if (state.mode === "replacement") {
    return {
      mode: "replacement",
      replacementWorkspace: state.replacementWorkspace,
    };
  }
  return { mode: "initial", replacementWorkspace: null };
}
export function initialFlow(): { mode: "initial"; replacementWorkspace: null } {
  return { mode: "initial", replacementWorkspace: null };
}

export function emptyRepositoryAndLocalData() {
  const repositories: GithubRepositorySummary[] = [];
  return {
    repositories,
    nextRepositoryCursor: null,
    repositoriesLoaded: false,
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

export function emptyLocalData() {
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

export function authIdle(
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

export function authLoading(
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

export function loginBeginning(
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
    error: null,
  };
}

export function authWaiting(
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

export function authReauthenticationRequired(state: ConnectionState): AuthConnectionState {
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

export function authError(state: ConnectionState, error: AppError): AuthConnectionState {
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

export function authenticatedContext(state: ConnectionState): AuthenticatedContext | null {
  if (state.auth?.status !== "authenticated") return null;
  const flow = flowFields(state);
  return {
    ...flow,
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    repositories: state.repositories,
    nextRepositoryCursor: state.nextRepositoryCursor,
    repositoriesLoaded: state.repositoriesLoaded,
  };
}

export function repositoryIdle(
  context: AuthenticatedContext,
  repositories = context.repositories,
  nextRepositoryCursor = context.nextRepositoryCursor,
  repositoriesLoaded = context.repositoriesLoaded,
): RepositoryConnectionState {
  return {
    ...context,
    ...emptyLocalData(),
    step: "repository",
    status: "idle",
    authorization: null,
    repositories,
    nextRepositoryCursor,
    repositoriesLoaded,
    activeRepositoryRequest: null,
    error: null,
  };
}

export function repositoryLoading(
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
    repositoriesLoaded: context.repositoriesLoaded,
    activeRepositoryRequest: request,
    error: null,
  };
}

export function repositoryError(
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

export function localContext(state: ConnectionState): LocalContext | null {
  const context = authenticatedContext(state);
  if (!context || !state.selectedRepository) return null;
  return { ...context, selectedRepository: state.selectedRepository };
}

export function localDefaults(context: LocalContext) {
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

export function localIdle(
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

export function localInspecting(
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

export function cloneStarting(
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

export function cloneRunning(
  context: LocalContext,
  status: "cloning" | "clone_cancelling",
  request: CloneStartRequest,
  job: LocalConnectionState["cloneJob"],
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

export function workspaceInspecting(
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

export function previewLoading(
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

export function validationFailed(
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

export function localWorkspaceConnecting(
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

export function localError(
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

export function initializationValues(
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

export function initializationContext(state: InitializationWorkflowState): LocalContext {
  return {
    ...flowFields(state),
    recoveryWorkspace: state.recoveryWorkspace,
    auth: state.auth,
    repositories: state.repositories,
    nextRepositoryCursor: state.nextRepositoryCursor,
    repositoriesLoaded: state.repositoriesLoaded,
    selectedRepository: state.selectedRepository,
  };
}

export function initializationPreviewState(
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

export function initializingState(
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

export function initializationReadyToConnect(
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

export function initializationConnecting(
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

export function initializationCommandError(
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

export function initializationConnectionError(
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

export function connectedState(workspace: ConnectedWorkspace): ConnectedConnectionState {
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

export function sameRepositoryRequest(
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

export function sameLocalRequest(
  left: LocalInspectionRequest | null,
  right: LocalInspectionRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryId === right.repositoryId &&
    left.path === right.path
  );
}

export function sameCloneRequest(
  left: CloneStartRequest | null,
  right: CloneStartRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryId === right.repositoryId &&
    left.parentDirectory === right.parentDirectory &&
    left.targetPath === right.targetPath
  );
}

export function sameWorkspaceRequest(
  left: WorkspaceInspectionRequest | null,
  right: WorkspaceInspectionRequest,
): boolean {
  return left?.id === right.id && left.repositoryRoot === right.repositoryRoot;
}

export function samePreviewRequest(
  left: InitializationPreviewRequest | null,
  right: InitializationPreviewRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryRoot === right.repositoryRoot &&
    left.workspaceName === right.workspaceName
  );
}

export function sameInitializationRequest(
  left: InitializationRequest | null,
  right: InitializationRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.previewId === right.previewId &&
    left.repositoryRoot === right.repositoryRoot
  );
}

export function sameWorkspaceConnectionRequest(
  left: WorkspaceConnectionRequest | null,
  right: WorkspaceConnectionRequest,
): boolean {
  return (
    left?.id === right.id &&
    left.repositoryRoot === right.repositoryRoot &&
    left.repositoryId === right.repositoryId &&
    left.repositoryFullName === right.repositoryFullName &&
    left.source === right.source &&
    left.initializationRequestId === right.initializationRequestId
  );
}

export function hasNonCancellableMutationOwnership(state: ConnectionState): boolean {
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

export function canStartLocalInspection(state: ConnectionState): boolean {
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

export function canStartClone(state: ConnectionState): boolean {
  return canStartLocalInspection(state);
}

export function canStartWorkspaceInspection(state: ConnectionState): boolean {
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

export function canStartInitializationPreview(state: ConnectionState): boolean {
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

export function mergeRepositoryPage(
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
