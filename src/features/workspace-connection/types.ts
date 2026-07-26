export type ErrorCode =
  | "authentication_expired"
  | "authentication_denied"
  | "reauthentication_required"
  | "credential_store_unavailable"
  | "github_permission_denied"
  | "github_unavailable"
  | "repository_path_conflict"
  | "repository_remote_mismatch"
  | "repository_dirty"
  | "clone_failed"
  | "workspace_missing"
  | "workspace_invalid"
  | "workspace_version_unsupported"
  | "workspace_changed_since_preview"
  | "push_failed"
  | "draft_pull_request_failed"
  | "local_settings_unavailable"
  | "desktop_only";

export type RecoveryAction =
  | "restart_login"
  | "reinstall_github_app"
  | "choose_another_directory"
  | "connect_existing_clone"
  | "clean_working_tree"
  | "open_workspace_file"
  | "update_okhub"
  | "retry";

export interface AppError {
  code: ErrorCode;
  message: string;
  recovery: RecoveryAction | null;
  details: Record<string, string>;
}

export interface GithubUserSummary {
  id: number;
  login: string;
  avatarUrl: string;
}

export type AuthState =
  | { status: "signed_out" }
  | { status: "authenticated"; user: GithubUserSummary }
  | { status: "reauthentication_required" };

export interface DeviceAuthorization {
  requestId: string;
  userCode: string;
  verificationUri: string;
  expiresAtUnix: number;
  intervalSeconds: number;
}

export type AuthStatusEvent =
  | { status: "waiting_for_user"; requestId: string }
  | { status: "authenticated"; requestId: string; user: GithubUserSummary }
  | { status: "reauthentication_required"; requestId: string }
  | { status: "failed"; requestId: string; error: AppError }
  | { status: "cancelled"; requestId: string };

export interface GithubRepositorySummary {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isEmpty: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RepositorySnapshot {
  root: string;
  headOid: string | null;
  defaultBranch: string | null;
  isDirty: boolean;
  hasContent: boolean;
  remoteUrl: string | null;
  fingerprint: string;
}

export type CloneProgressStage =
  | "receiving_objects"
  | "resolving_deltas"
  | "checking_out";

export interface CloneProgress {
  stage: CloneProgressStage;
  completed: number;
  total: number;
}

export interface CloneJob {
  requestId: string;
  targetPath: string;
}

export type CloneProgressEvent =
  | { status: "progress"; requestId: string; progress: CloneProgress }
  | { status: "completed"; requestId: string; repository: RepositorySnapshot }
  | { status: "failed"; requestId: string; error: AppError }
  | { status: "cancelled"; requestId: string };

type CloneProgressOnlyEvent = Extract<CloneProgressEvent, { status: "progress" }>;
type CloneTerminalEvent = Exclude<CloneProgressEvent, CloneProgressOnlyEvent>;

export interface BufferedCloneEventGroup {
  requestId: string;
  latestProgress: CloneProgressOnlyEvent | null;
  terminal: CloneTerminalEvent | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  documentRoots: string[];
  repositoryCount: number;
}

export type WorkspaceDiagnosticCode =
  | "workspace_yaml_invalid"
  | "workspace_structure_invalid"
  | "schema_version_invalid"
  | "workspace_type_invalid"
  | "workspace_id_missing"
  | "workspace_id_type_invalid"
  | "workspace_id_not_v4"
  | "workspace_name_missing"
  | "workspace_name_type_invalid"
  | "workspace_name_empty"
  | "documents_type_invalid"
  | "document_roots_missing"
  | "document_roots_type_invalid"
  | "document_root_type_invalid"
  | "document_root_path_missing"
  | "document_root_path_type_invalid"
  | "document_root_empty"
  | "document_root_outside_repository"
  | "repositories_type_invalid"
  | "repository_type_invalid"
  | "duplicate_repository_key"
  | "duplicate_repository_label"
  | "repository_key_missing"
  | "repository_key_type_invalid"
  | "repository_key_empty"
  | "repository_key_invalid"
  | "repository_label_missing"
  | "repository_label_type_invalid"
  | "repository_github_missing"
  | "repository_github_type_invalid"
  | "repository_github_id_missing"
  | "repository_github_id_type_invalid"
  | "repository_github_full_name_missing"
  | "repository_github_full_name_type_invalid"
  | "github_type_invalid"
  | "github_project_type_invalid"
  | "github_project_id_missing"
  | "github_project_id_type_invalid"
  | "github_project_owner_missing"
  | "github_project_owner_type_invalid"
  | "github_project_number_missing"
  | "github_project_number_type_invalid"
  | "unknown_repository_key";

export interface WorkspaceDiagnostic {
  code: WorkspaceDiagnosticCode;
  path: string;
  message: string;
  value?: string;
}

export type WorkspaceInspection =
  | { status: "ready"; summary: WorkspaceSummary }
  | { status: "initialization_required" }
  | { status: "invalid"; diagnostics: WorkspaceDiagnostic[] }
  | { status: "unsupported_version"; foundVersion: number };

export type InitializationStrategy =
  | { kind: "direct_push" }
  | { kind: "draft_pull_request"; baseBranch: string };

export interface PreviewFile {
  path: string;
  content: string;
  overwritesExisting: boolean;
}

export interface InitializationPreview {
  id: string;
  workspaceId: string;
  workspaceName: string;
  repositoryFingerprint: string;
  branch: string;
  commitMessage: string;
  strategy: InitializationStrategy;
  files: PreviewFile[];
}

export interface InitializationResult {
  root: string;
  branch: string;
  commitOid: string;
  commitMessage: string;
  pushed: boolean;
  draftPullRequestUrl: string | null;
}

export interface ConnectedWorkspace {
  path: string;
  status: "connected";
  summary: WorkspaceSummary;
}

export interface RecoveryRequiredWorkspace {
  path: string;
  status: "recovery_required";
  summary?: null;
}

export type CurrentWorkspace = ConnectedWorkspace | RecoveryRequiredWorkspace;
export type CurrentWorkspaceState = CurrentWorkspace | null;

export interface PreviewInitializationInput {
  repositoryPath: string;
  workspaceName: string;
  repositoryId: string;
  repositoryFullName: string;
}

export type Unlisten = () => void;

export interface AuthLoadRequest {
  id: string;
}

export interface LoginBeginRequest {
  id: string;
}

export interface RepositoryLoadRequest {
  id: string;
  userId: number;
  cursor: string | null;
  append: boolean;
}

export interface LocalInspectionRequest {
  id: string;
  repositoryId: string;
  path: string;
}

export interface CloneStartRequest {
  id: string;
  repositoryId: string;
  parentDirectory: string;
}

export interface WorkspaceInspectionRequest {
  id: string;
  repositoryRoot: string;
}

export interface InitializationPreviewRequest {
  id: string;
  repositoryRoot: string;
  workspaceName: string;
}

export interface InitializationRequest {
  id: string;
  previewId: string;
  repositoryRoot: string;
}

export type WorkspaceConnectionRequest =
  | {
      id: string;
      repositoryRoot: string;
      source: "existing";
      initializationRequestId: null;
    }
  | {
      id: string;
      repositoryRoot: string;
      source: "initialization";
      initializationRequestId: string;
    };

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
  activeRepositoryRequest: null;
};
type RepositoryData = {
  repositories: GithubRepositorySummary[];
  nextRepositoryCursor: string | null;
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
      bufferedAuthEvents: AuthStatusEvent[];
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
  bufferedCloneEvents: BufferedCloneEventGroup[];
  error: null;
};

type CloneRunningState = LocalBase & {
  status: "cloning" | "clone_cancelling";
  activeLocalRequest: null;
  activeCloneStartRequest: null;
  localRepository: null;
  cloneJob: CloneJob;
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

export type ConnectionAction =
  | { type: "currentWorkspaceLoaded"; workspace: CurrentWorkspaceState }
  | { type: "authLoadStarted"; request: AuthLoadRequest }
  | { type: "authLoaded"; request: AuthLoadRequest; auth: AuthState }
  | { type: "authLoadFailed"; request: AuthLoadRequest; error: AppError }
  | { type: "loginBeginStarted"; request: LoginBeginRequest }
  | {
      type: "loginStarted";
      request: LoginBeginRequest;
      authorization: DeviceAuthorization;
    }
  | { type: "loginBeginFailed"; request: LoginBeginRequest; error: AppError }
  | { type: "authEventReceived"; event: AuthStatusEvent }
  | { type: "repositoryLoading"; request: RepositoryLoadRequest }
  | {
      type: "repositoryPageLoaded";
      request: RepositoryLoadRequest;
      page: Page<GithubRepositorySummary>;
    }
  | {
      type: "repositoryLoadFailed";
      request: RepositoryLoadRequest;
      error: AppError;
    }
  | { type: "repositorySelected"; repository: GithubRepositorySummary }
  | { type: "localInspectionStarted"; request: LocalInspectionRequest }
  | { type: "localInspectionRetryStarted"; request: LocalInspectionRequest }
  | {
      type: "localRepositoryChanged";
      request: LocalInspectionRequest;
      repository: RepositorySnapshot;
    }
  | {
      type: "localInspectionFailed";
      request: LocalInspectionRequest;
      error: AppError;
    }
  | { type: "cloneStarting"; request: CloneStartRequest }
  | { type: "cloneRetryStarted"; request: CloneStartRequest }
  | { type: "cloneAlternateDirectoryStarted"; request: CloneStartRequest }
  | { type: "cloneStarted"; request: CloneStartRequest; job: CloneJob }
  | { type: "cloneStartFailed"; request: CloneStartRequest; error: AppError }
  | { type: "cloneCancellationRequested"; requestId: string }
  | { type: "cloneEventReceived"; event: CloneProgressEvent }
  | {
      type: "workspaceInspectionStarted";
      request: WorkspaceInspectionRequest;
    }
  | {
      type: "workspaceInspected";
      request: WorkspaceInspectionRequest;
      inspection: WorkspaceInspection;
    }
  | {
      type: "workspaceInspectionFailed";
      request: WorkspaceInspectionRequest;
      error: AppError;
    }
  | {
      type: "initializationPreviewStarted";
      request: InitializationPreviewRequest;
    }
  | {
      type: "initializationPreviewLoaded";
      request: InitializationPreviewRequest;
      preview: InitializationPreview;
    }
  | {
      type: "initializationPreviewFailed";
      request: InitializationPreviewRequest;
      error: AppError;
    }
  | { type: "initializationPreviewCancelled" }
  | { type: "initializationStarted"; request: InitializationRequest }
  | {
      type: "initializationSucceeded";
      request: InitializationRequest;
      result: InitializationResult;
    }
  | { type: "initializationFailed"; request: InitializationRequest; error: AppError }
  | { type: "workspaceConnectionStarted"; request: WorkspaceConnectionRequest }
  | {
      type: "workspaceConnected";
      request: WorkspaceConnectionRequest;
      workspace: ConnectedWorkspace;
    }
  | {
      type: "workspaceConnectionFailed";
      request: WorkspaceConnectionRequest;
      error: AppError;
    }
  | { type: "replacementStarted" }
  | { type: "replacementCancelled" };
