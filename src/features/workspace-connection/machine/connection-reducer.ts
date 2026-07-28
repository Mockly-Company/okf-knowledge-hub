import type {
  AuthConnectionState,
  ConnectionAction,
  ConnectionState,
} from "../types";
import {
  flowFields,
  initialFlow,
  authIdle,
  authLoading,
  loginBeginning,
  authWaiting,
  authReauthenticationRequired,
  authError,
  authenticatedContext,
  repositoryIdle,
  repositoryLoading,
  repositoryError,
  localContext,
  localIdle,
  localInspecting,
  cloneStarting,
  cloneRunning,
  workspaceInspecting,
  previewLoading,
  validationFailed,
  localWorkspaceConnecting,
  localError,
  initializationContext,
  initializationPreviewState,
  initializingState,
  initializationReadyToConnect,
  initializationConnecting,
  initializationCommandError,
  initializationConnectionError,
  connectedState,
  sameRepositoryRequest,
  sameLocalRequest,
  sameCloneRequest,
  sameWorkspaceRequest,
  samePreviewRequest,
  sameInitializationRequest,
  sameWorkspaceConnectionRequest,
  hasNonCancellableMutationOwnership,
  canStartLocalInspection,
  canStartClone,
  canStartWorkspaceInspection,
  canStartInitializationPreview,
  mergeRepositoryPage,
} from "./connection-state-builders";

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
          repositoriesLoaded: false,
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
      return hasNonCancellableMutationOwnership(state) ||
        (state.step === "auth" &&
          (state.status === "login_beginning" || state.status === "waiting_for_user"))
        ? state
        : loginBeginning(state, action.request);
    case "loginStarted":
      if (
        state.step === "auth" &&
        state.status === "login_beginning" &&
        state.activeLoginBeginRequest.id === action.request.id
      ) {
        return action.authorization.requestId === action.request.id
          ? authWaiting(state, action.authorization)
          : state;
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
      const activeAuthRequestId =
        state.step === "auth" && state.status === "login_beginning"
          ? state.activeLoginBeginRequest.id
          : state.step === "auth" && state.status === "waiting_for_user"
            ? state.authorization.requestId
            : null;
      if (activeAuthRequestId === null || action.event.requestId !== activeAuthRequestId) {
        return state;
      }
      if (action.event.status === "authenticated") {
        return repositoryIdle({
          ...flowFields(state),
          recoveryWorkspace: state.recoveryWorkspace,
          auth: { status: "authenticated", user: action.event.user },
          repositories: [],
          nextRepositoryCursor: null,
          repositoriesLoaded: false,
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
      return repositoryIdle(context, repositories, action.page.nextCursor, true);
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
      const isReselectedPath =
        state.step === "local" &&
        state.status === "error" &&
        state.errorContext === "pre_repository" &&
        state.failedOperation === "local_inspection" &&
        action.request.id !== state.failedLocalInspectionRequest.id &&
        action.request.path !== state.failedLocalInspectionRequest.path;
      if (
        (!canStartLocalInspection(state) && !isReselectedPath) ||
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
        action.request.targetPath !== state.failedCloneStartRequest.targetPath ||
        action.request.repositoryId !== context.selectedRepository.id
      ) {
        return state;
      }
      return cloneStarting(context, action.request);
    }
    case "cloneAlternateDirectoryStarted": {
      const context = localContext(state);
      if (
        !context ||
        state.step !== "local" ||
        state.status !== "error" ||
        state.errorContext !== "pre_repository" ||
        state.failedOperation !== "clone" ||
        state.error.recovery !== "choose_another_directory" ||
        action.request.id === state.failedCloneStartRequest.id ||
        action.request.repositoryId !== state.failedCloneStartRequest.repositoryId ||
        action.request.repositoryId !== context.selectedRepository.id ||
        action.request.parentDirectory === state.failedCloneStartRequest.parentDirectory
      ) {
        return state;
      }
      return cloneStarting(context, action.request);
    }
    case "cloneStarted": {
      const context = localContext(state);
      if (
        !context ||
        action.job.requestId !== action.request.id ||
        action.job.targetPath !== action.request.targetPath
      ) return state;
      if (
        state.step === "local" &&
        state.status === "clone_starting" &&
        sameCloneRequest(state.activeCloneStartRequest, action.request)
      ) {
        return cloneRunning(context, "cloning", action.request, action.job, null);
      }
      if (
        state.step === "local" &&
        (state.status === "cloning" || state.status === "clone_cancelling") &&
        sameCloneRequest(state.cloneRequest, action.request) &&
        state.cloneJob === null
      ) {
        return cloneRunning(
          context,
          state.status,
          state.cloneRequest,
          action.job,
          state.cloneProgress,
        );
      }
      return state;
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
        state.cloneRequest.id !== action.requestId
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
      const context = localContext(state);
      if (!context || state.step !== "local") return state;
      if (state.status === "clone_starting") {
        if (state.activeCloneStartRequest.id !== action.event.requestId) return state;
        if (action.event.status === "progress") {
          return cloneRunning(
            context,
            "cloning",
            state.activeCloneStartRequest,
            null,
            action.event.progress,
          );
        }
        if (action.event.status === "completed") {
          return action.event.ownershipTargetPath === state.activeCloneStartRequest.targetPath
            ? localIdle(context, action.event.repository)
            : state;
        }
        if (action.event.status === "failed") {
          return localError(context, action.event.error, {
            errorContext: "pre_repository",
            failedOperation: "clone",
            localRepository: null,
            workspaceInspection: null,
            failedLocalInspectionRequest: null,
            failedCloneStartRequest: state.activeCloneStartRequest,
            failedInitializationPreviewRequest: null,
            failedWorkspaceConnectionRequest: null,
          });
        }
        return localIdle(context);
      }
      if (
        (state.status !== "cloning" && state.status !== "clone_cancelling") ||
        state.cloneRequest.id !== action.event.requestId
      ) return state;
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
        return action.event.ownershipTargetPath === state.cloneRequest.targetPath
          ? localIdle(context, action.event.repository)
          : state;
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
    case "draftPullRequestCloneSelectionStarted":
      return state.step === "initialize" &&
        state.status === "ready_to_connect" &&
        state.initializationResult.draftPullRequestUrl !== null
        ? localIdle(initializationContext(state))
        : state;
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
