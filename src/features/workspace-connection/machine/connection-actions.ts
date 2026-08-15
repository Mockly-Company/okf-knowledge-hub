import type {
  AppError,
  AuthLoadRequest,
  AuthState,
  AuthStatusEvent,
  CloneJob,
  CloneProgressEvent,
  CloneStartRequest,
  ConnectedWorkspace,
  CurrentWorkspaceState,
  DeviceAuthorization,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  InitializationRequest,
  InitializationResult,
  LocalInspectionRequest,
  LoginBeginRequest,
  Page,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceConnectionRequest,
  WorkspaceInspection,
  WorkspaceInspectionRequest,
} from "../model/protocol";

export type ConnectionAction =
  | { type: "currentWorkspaceLoaded"; workspace: CurrentWorkspaceState }
  | { type: "authLoadStarted"; request: AuthLoadRequest }
  | { type: "authLoaded"; request: AuthLoadRequest; auth: AuthState }
  | { type: "authLoadFailed"; request: AuthLoadRequest; error: AppError }
  | {
      type: "workspaceRestoreLoaded";
      request: AuthLoadRequest;
      auth: Extract<AuthState, { status: "authenticated" }>;
      workspace: CurrentWorkspaceState;
    }
  | { type: "logoutSucceeded" }
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
  | { type: "draftPullRequestCloneSelectionStarted" }
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
