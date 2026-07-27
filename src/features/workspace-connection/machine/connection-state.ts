import type {
  AppError,
  AuthLoadRequest,
  AuthState,
  CloneJob,
  CloneProgress,
  CloneStartRequest,
  ConnectedWorkspace,
  DeviceAuthorization,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  InitializationRequest,
  InitializationResult,
  LocalInspectionRequest,
  LoginBeginRequest,
  RecoveryRequiredWorkspace,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceConnectionRequest,
  WorkspaceInspection,
  WorkspaceInspectionRequest,
} from "../model/protocol";

type AuthenticatedState = Extract<AuthState, { status: "authenticated" }>;
type SignedOutState = Extract<AuthState, { status: "signed_out" }>;
type ReauthenticationState = Extract<
  AuthState,
  { status: "reauthentication_required" }
>;
type InvalidWorkspaceInspection = Extract<
  WorkspaceInspection,
  { status: "invalid" | "unsupported_version" }
>;
type ReadyWorkspaceInspection = Extract<
  WorkspaceInspection,
  { status: "ready" | "initialization_required" }
>;
type InitializationRequiredInspection = Extract<
  WorkspaceInspection,
  { status: "initialization_required" }
>;

type InitialMode = { mode: "initial"; replacementWorkspace: null };
type ReplacementMode = {
  mode: "replacement";
  replacementWorkspace: ConnectedWorkspace;
};
type FlowMode = InitialMode | ReplacementMode;
type RecoveryContext = {
  recoveryWorkspace: RecoveryRequiredWorkspace | null;
};

type EmptyRepositoryData = {
  repositories: GithubRepositorySummary[];
  nextRepositoryCursor: null;
  repositoriesLoaded: boolean;
  activeRepositoryRequest: null;
};
type RepositoryData = {
  repositories: GithubRepositorySummary[];
  nextRepositoryCursor: string | null;
  repositoriesLoaded: boolean;
  activeRepositoryRequest: RepositoryLoadRequest | null;
};
type EmptyLocalData = {
  selectedRepository: null;
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: null;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
};
type EmptyConnectionData = { connectedWorkspace: null };

type AuthBase = FlowMode &
  RecoveryContext &
  EmptyRepositoryData &
  EmptyLocalData &
  EmptyConnectionData & { step: "auth" };

export type AuthConnectionState =
  | (AuthBase & {
      status: "idle";
      auth: SignedOutState | null;
      authorization: null;
      activeAuthLoadRequest: null;
      activeLoginBeginRequest: null;
      error: null;
    })
  | (AuthBase & {
      status: "loading";
      auth: AuthState | null;
      authorization: null;
      activeAuthLoadRequest: AuthLoadRequest;
      activeLoginBeginRequest: null;
      error: null;
    })
  | (AuthBase & {
      status: "login_beginning";
      auth: SignedOutState | ReauthenticationState | null;
      authorization: null;
      activeAuthLoadRequest: null;
      activeLoginBeginRequest: LoginBeginRequest;
      error: null;
    })
  | (AuthBase & {
      status: "waiting_for_user";
      auth: SignedOutState;
      authorization: DeviceAuthorization;
      activeAuthLoadRequest: null;
      activeLoginBeginRequest: null;
      error: null;
    })
  | (AuthBase & {
      status: "reauthentication_required";
      auth: ReauthenticationState;
      authorization: null;
      activeAuthLoadRequest: null;
      activeLoginBeginRequest: null;
      error: null;
    })
  | (AuthBase & {
      status: "error";
      auth: SignedOutState | ReauthenticationState | null;
      authorization: null;
      activeAuthLoadRequest: null;
      activeLoginBeginRequest: null;
      error: AppError;
    });

type RepositoryBase = FlowMode &
  RecoveryContext &
  RepositoryData &
  EmptyLocalData &
  EmptyConnectionData & {
    step: "repository";
    auth: AuthenticatedState;
    authorization: null;
  };

export type RepositoryConnectionState =
  | (RepositoryBase & {
      status: "idle";
      activeRepositoryRequest: null;
      error: null;
    })
  | (RepositoryBase & {
      status: "loading";
      activeRepositoryRequest: RepositoryLoadRequest;
      error: null;
    })
  | (RepositoryBase & {
      status: "error";
      activeRepositoryRequest: null;
      error: AppError;
    });

type LocalBase = FlowMode &
  RecoveryContext &
  RepositoryData &
  EmptyConnectionData & {
    step: "local";
    auth: AuthenticatedState;
    authorization: null;
    activeRepositoryRequest: null;
    selectedRepository: GithubRepositorySummary;
  };

type LocalIdleCommon = LocalBase & {
  status: "idle";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type LocalChoiceIdleState = LocalIdleCommon & {
  localRepository: null;
  workspaceInspection: null;
};

type LocalRepositoryIdleState = LocalIdleCommon & {
  localRepository: RepositorySnapshot;
  workspaceInspection: ReadyWorkspaceInspection | null;
};

type LocalIdleState = LocalChoiceIdleState | LocalRepositoryIdleState;

type LocalInspectingState = LocalBase & {
  status: "inspecting";
  activeLocalRequest: LocalInspectionRequest;
  activeCloneStartRequest: null;
  localRepository: null;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type CloneStartingState = LocalBase & {
  status: "clone_starting";
  activeLocalRequest: null;
  activeCloneStartRequest: CloneStartRequest;
  localRepository: null;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type CloneRunningState = LocalBase & {
  status: "cloning" | "clone_cancelling";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: null;
  cloneJob: CloneJob | null;
  cloneRequest: CloneStartRequest;
  cloneProgress: CloneProgress | null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type WorkspaceInspectingState = LocalBase & {
  status: "workspace_inspecting";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: RepositorySnapshot;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: WorkspaceInspectionRequest;
  workspaceInspection: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type PreviewLoadingState = LocalBase & {
  status: "preview_loading";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: RepositorySnapshot;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: InitializationRequiredInspection;
  activeInitializationPreviewRequest: InitializationPreviewRequest;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type ValidationFailedState = LocalBase & {
  status: "validation_failed";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: RepositorySnapshot;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: InvalidWorkspaceInspection;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: null;
};

type LocalWorkspaceConnectingState = LocalBase & {
  status: "workspace_connecting";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: RepositorySnapshot;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  workspaceInspection: Extract<WorkspaceInspection, { status: "ready" }>;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: Extract<
    WorkspaceConnectionRequest,
    { source: "existing" }
  >;
  error: null;
};

type LocalErrorCommon = LocalBase & {
  status: "error";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  cloneJob: null;
  cloneProgress: null;
  activeWorkspaceInspectionRequest: null;
  activeInitializationPreviewRequest: null;
  initializationPreview: null;
  activeWorkspaceConnectionRequest: null;
  error: AppError;
};

type LocalInspectionErrorState = LocalErrorCommon & {
  errorContext: "pre_repository";
  failedOperation: "local_inspection";
  localRepository: null;
  workspaceInspection: null;
  failedLocalInspectionRequest: LocalInspectionRequest;
  failedCloneStartRequest: null;
  failedInitializationPreviewRequest: null;
  failedWorkspaceConnectionRequest: null;
};

type LocalCloneErrorState = LocalErrorCommon & {
  errorContext: "pre_repository";
  failedOperation: "clone";
  localRepository: null;
  workspaceInspection: null;
  failedLocalInspectionRequest: null;
  failedCloneStartRequest: CloneStartRequest;
  failedInitializationPreviewRequest: null;
  failedWorkspaceConnectionRequest: null;
};

type LocalPreRepositoryErrorState =
  | LocalInspectionErrorState
  | LocalCloneErrorState;

type LocalRepositoryErrorState = LocalErrorCommon & {
  errorContext: "repository";
  localRepository: RepositorySnapshot;
  workspaceInspection: null;
  failedInitializationPreviewRequest: null;
  failedWorkspaceConnectionRequest: null;
};

type LocalInitializationPreviewErrorState = LocalErrorCommon & {
  errorContext: "initialization_preview";
  localRepository: RepositorySnapshot;
  workspaceInspection: InitializationRequiredInspection;
  failedInitializationPreviewRequest: InitializationPreviewRequest | null;
  failedWorkspaceConnectionRequest: null;
};

type LocalWorkspaceConnectionErrorState = LocalErrorCommon & {
  errorContext: "workspace_connection";
  localRepository: RepositorySnapshot;
  workspaceInspection: Extract<WorkspaceInspection, { status: "ready" }>;
  failedInitializationPreviewRequest: null;
  failedWorkspaceConnectionRequest: Extract<
    WorkspaceConnectionRequest,
    { source: "existing" }
  >;
};

type LocalErrorState =
  | LocalPreRepositoryErrorState
  | LocalRepositoryErrorState
  | LocalInitializationPreviewErrorState
  | LocalWorkspaceConnectionErrorState;

export type LocalConnectionState =
  | LocalIdleState
  | LocalInspectingState
  | CloneStartingState
  | CloneRunningState
  | WorkspaceInspectingState
  | PreviewLoadingState
  | ValidationFailedState
  | LocalWorkspaceConnectingState
  | LocalErrorState;

type InitializationBase = FlowMode &
  RecoveryContext &
  RepositoryData &
  EmptyConnectionData & {
    step: "initialize";
    auth: AuthenticatedState;
    authorization: null;
    activeRepositoryRequest: null;
    selectedRepository: GithubRepositorySummary;
    activeLocalRequest: null;
    activeCloneStartRequest: null;
    localRepository: RepositorySnapshot;
    cloneJob: null;
    cloneProgress: null;
    activeWorkspaceInspectionRequest: null;
    workspaceInspection: InitializationRequiredInspection;
    activeInitializationPreviewRequest: null;
    initializationPreview: InitializationPreview;
  };

type InitializationPreviewState = InitializationBase & {
  status: "preview";
  activeInitializationRequest: null;
  completedInitializationRequest: null;
  initializationResult: null;
  activeWorkspaceConnectionRequest: null;
  failedInitializationRequest: null;
  failedWorkspaceConnectionRequest: null;
  error: null;
};
type InitializingState = InitializationBase & {
  status: "initializing";
  activeInitializationRequest: InitializationRequest;
  completedInitializationRequest: null;
  initializationResult: null;
  activeWorkspaceConnectionRequest: null;
  failedInitializationRequest: null;
  failedWorkspaceConnectionRequest: null;
  error: null;
};
type InitializationReadyToConnectState = InitializationBase & {
  status: "ready_to_connect";
  activeInitializationRequest: null;
  completedInitializationRequest: InitializationRequest;
  initializationResult: InitializationResult;
  activeWorkspaceConnectionRequest: null;
  failedInitializationRequest: null;
  failedWorkspaceConnectionRequest: null;
  error: null;
};
type InitializationConnectingState = InitializationBase & {
  status: "connecting";
  activeInitializationRequest: null;
  completedInitializationRequest: InitializationRequest;
  initializationResult: InitializationResult;
  activeWorkspaceConnectionRequest: Extract<
    WorkspaceConnectionRequest,
    { source: "initialization" }
  >;
  failedInitializationRequest: null;
  failedWorkspaceConnectionRequest: null;
  error: null;
};
type InitializationCommandErrorState = InitializationBase & {
  status: "error";
  failedOperation: "initialization";
  activeInitializationRequest: null;
  completedInitializationRequest: null;
  initializationResult: null;
  activeWorkspaceConnectionRequest: null;
  failedInitializationRequest: InitializationRequest;
  failedWorkspaceConnectionRequest: null;
  error: AppError;
};
type InitializationConnectionErrorState = InitializationBase & {
  status: "error";
  failedOperation: "connection";
  activeInitializationRequest: null;
  completedInitializationRequest: InitializationRequest;
  initializationResult: InitializationResult;
  activeWorkspaceConnectionRequest: null;
  failedInitializationRequest: null;
  failedWorkspaceConnectionRequest: Extract<
    WorkspaceConnectionRequest,
    { source: "initialization" }
  >;
  error: AppError;
};

export type ConnectedConnectionState = InitialMode &
  RecoveryContext &
  EmptyRepositoryData &
  EmptyLocalData & {
    step: "initialize";
    status: "connected";
    auth: null;
    authorization: null;
    connectedWorkspace: ConnectedWorkspace;
    recoveryWorkspace: null;
    error: null;
  };

export type InitializeConnectionState =
  | InitializationPreviewState
  | InitializingState
  | InitializationReadyToConnectState
  | InitializationConnectingState
  | InitializationCommandErrorState
  | InitializationConnectionErrorState
  | ConnectedConnectionState;

export type ConnectionState =
  | AuthConnectionState
  | RepositoryConnectionState
  | LocalConnectionState
  | InitializeConnectionState;
