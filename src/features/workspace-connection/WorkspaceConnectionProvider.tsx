import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { WorkspaceConnectionGateway } from "./WorkspaceConnectionGateway";
import { connectionReducer, createInitialConnectionState } from "./connection-reducer";
import { cloneTargetPath } from "./types";
import type {
  AppError,
  CloneStartRequest,
  ConnectionState,
  GithubRepositorySummary,
  InitializationPreviewRequest,
  InitializationRequest,
  LocalInspectionRequest,
  WorkspaceConnectionRequest,
  WorkspaceInspectionRequest,
  WorkspaceInspection,
} from "./types";

export interface WorkspaceConnectionContextValue {
  state: ConnectionState;
  canCancelReplacement: boolean;
  isCurrentWorkspaceLoading: boolean;
  isWorkspaceValidating: boolean;
  workspaceValidation:
    | { requestId: string | null; path: string; inspection: WorkspaceInspection; error: null }
    | { requestId: string; path: string; inspection: null; error: AppError }
    | null;
  cloneTargetPreview: CloneTargetPreview | null;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  openVerificationUrl(url: string): Promise<void>;
  openLocalPath(path: string): Promise<void>;
  refreshRepositories(): Promise<void>;
  loadNextRepositories(): Promise<void>;
  selectRepository(repository: GithubRepositorySummary): void;
  connectExistingClone(): Promise<void>;
  cloneIntoSelectedParent(): Promise<void>;
  confirmCloneTarget(): Promise<void>;
  cancelCloneTarget(): void;
  chooseAnotherCloneDirectory(): Promise<void>;
  previewInitialization(): Promise<void>;
  cancelInitializationPreview(): void;
  confirmInitialization(): Promise<void>;
  retryLastAction(): Promise<void>;
  revalidateCurrentWorkspace(): Promise<void>;
  startReplacement(): Promise<void>;
  cancelReplacement(): Promise<void>;
}

export interface CloneTargetPreview {
  repositoryId: string;
  parentDirectory: string;
  targetPath: string;
  mode: "start" | "alternate_directory";
}

const WorkspaceConnectionContext =
  createContext<WorkspaceConnectionContextValue | null>(null);

function operationId(): string {
  return crypto.randomUUID();
}

function asAppError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return error as AppError;
  }
  return {
    code: "github_unavailable",
    message: error instanceof Error ? error.message : "연결 작업을 완료할 수 없습니다.",
    recovery: "retry",
    details: {},
  };
}

function workspaceNameFromRepository(repositoryName: string): string {
  const stem = repositoryName.replace(/-knowledge$/i, "");
  return stem.replace(/(^|[-_\s])(\p{L})/gu, (_, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`);
}

function canCancelReplacement(state: ConnectionState): boolean {
  if (state.mode !== "replacement") return false;
  return !(
    (state.step === "local" &&
      (state.status === "clone_starting" ||
        state.status === "cloning" ||
        state.status === "clone_cancelling" ||
        state.status === "workspace_connecting")) ||
    (state.step === "initialize" &&
      (state.status === "initializing" || state.status === "connecting"))
  );
}

interface WorkspaceConnectionProviderProps extends PropsWithChildren {
  gateway: WorkspaceConnectionGateway;
}

export function WorkspaceConnectionProvider({
  gateway,
  children,
}: WorkspaceConnectionProviderProps) {
  const [state, dispatch] = useReducer(connectionReducer, undefined, createInitialConnectionState);
  const stateRef = useRef(state);
  const [isCurrentWorkspaceLoading, setCurrentWorkspaceLoading] = useState(true);
  const [cloneTargetPreview, setCloneTargetPreview] = useState<CloneTargetPreview | null>(null);
  const [isWorkspaceValidating, setWorkspaceValidating] = useState(false);
  const [workspaceValidation, setWorkspaceValidation] = useState<
    WorkspaceConnectionContextValue["workspaceValidation"]
  >(null);
  const activeWorkspaceValidationRef = useRef<{ requestId: string; path: string } | null>(null);

  const dispatchAccepted = useCallback((action: Parameters<typeof connectionReducer>[1]) => {
    const current = stateRef.current;
    const next = connectionReducer(current, action);
    if (next === current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);

  const loadRepositories = useCallback(
    async (cursor: string | null, append: boolean, authenticatedUserId?: number) => {
      const current = stateRef.current;
      const userId = authenticatedUserId ?? (current.auth?.status === "authenticated" ? current.auth.user.id : null);
      if (userId === null) return;
      const request = { id: operationId(), userId, cursor, append };
      if (!dispatchAccepted({ type: "repositoryLoading", request })) return;
      try {
        const page = await gateway.listRepositories(cursor ?? undefined);
        dispatchAccepted({ type: "repositoryPageLoaded", request, page });
      } catch (error) {
        dispatchAccepted({ type: "repositoryLoadFailed", request, error: asAppError(error) });
      }
    },
    [dispatchAccepted, gateway],
  );

  const loadAuth = useCallback(async () => {
    const request = { id: operationId() };
    if (!dispatchAccepted({ type: "authLoadStarted", request })) return;
    try {
      const auth = await gateway.getAuthState();
      dispatchAccepted({ type: "authLoaded", request, auth });
    } catch (error) {
      dispatchAccepted({ type: "authLoadFailed", request, error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const inspectWorkspace = useCallback(
    async (repositoryRoot: string) => {
      const request: WorkspaceInspectionRequest = { id: operationId(), repositoryRoot };
      if (!dispatchAccepted({ type: "workspaceInspectionStarted", request })) return;
      try {
        const inspection = await gateway.inspectWorkspace(repositoryRoot);
        dispatchAccepted({ type: "workspaceInspected", request, inspection });
      } catch (error) {
        dispatchAccepted({ type: "workspaceInspectionFailed", request, error: asAppError(error) });
      }
    },
    [dispatchAccepted, gateway],
  );

  const inspectLocalClone = useCallback(
    async (request: LocalInspectionRequest, retry = false) => {
      if (!dispatchAccepted({ type: retry ? "localInspectionRetryStarted" : "localInspectionStarted", request })) return;
      try {
        const repository = await gateway.inspectExistingClone(request.path, request.repositoryId);
        dispatchAccepted({ type: "localRepositoryChanged", request, repository });
      } catch (error) {
        dispatchAccepted({ type: "localInspectionFailed", request, error: asAppError(error) });
      }
    },
    [dispatchAccepted, gateway],
  );

  const clone = useCallback(
    async (request: CloneStartRequest, mode: "start" | "retry" | "alternate_directory" = "start") => {
      const current = stateRef.current;
      const repository = current.selectedRepository;
      if (!repository || repository.id !== request.repositoryId) return;
      if (!dispatchAccepted({
        type:
          mode === "retry"
            ? "cloneRetryStarted"
            : mode === "alternate_directory"
              ? "cloneAlternateDirectoryStarted"
              : "cloneStarting",
        request,
      })) return;
      try {
        const job = await gateway.cloneRepository(
          request.id,
          repository,
          request.parentDirectory,
        );
        dispatchAccepted({ type: "cloneStarted", request, job });
      } catch (error) {
        dispatchAccepted({ type: "cloneStartFailed", request, error: asAppError(error) });
      }
    },
    [dispatchAccepted, gateway],
  );

  const startLogin = useCallback(async () => {
    const request = { id: operationId() };
    if (!dispatchAccepted({ type: "loginBeginStarted", request })) return;
    try {
      const authorization = await gateway.beginGithubAuth(request.id);
      dispatchAccepted({ type: "loginStarted", request, authorization });
    } catch (error) {
      dispatchAccepted({ type: "loginBeginFailed", request, error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const cancelLogin = useCallback(async () => {
    const current = stateRef.current;
    if (
      current.step !== "auth" ||
      (current.status !== "login_beginning" && current.status !== "waiting_for_user")
    ) return;
    const requestId = current.status === "login_beginning"
      ? current.activeLoginBeginRequest.id
      : current.authorization.requestId;
    try {
      await gateway.cancelGithubAuth(requestId);
    } finally {
      dispatchAccepted({ type: "authEventReceived", event: { status: "cancelled", requestId } });
    }
  }, [dispatchAccepted, gateway]);

  const openVerificationUrl = useCallback(async (url: string) => {
    await gateway.openExternal(url);
  }, [gateway]);

  const openLocalPath = useCallback(async (path: string) => {
    await gateway.openPath(path);
  }, [gateway]);

  const refreshRepositories = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "repository") return;
    await loadRepositories(null, false);
  }, [loadRepositories]);

  const loadNextRepositories = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "repository" || !current.nextRepositoryCursor) return;
    await loadRepositories(current.nextRepositoryCursor, true);
  }, [loadRepositories]);

  const selectRepository = useCallback((repository: GithubRepositorySummary) => {
    dispatchAccepted({ type: "repositorySelected", repository });
  }, [dispatchAccepted]);

  const connectExistingClone = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "local" || !current.selectedRepository) return;
    const path = await gateway.pickDirectory();
    if (!path) return;
    await inspectLocalClone({ id: operationId(), repositoryId: current.selectedRepository.id, path });
  }, [gateway, inspectLocalClone]);

  const selectCloneTarget = useCallback(async (
    mode: CloneTargetPreview["mode"],
  ) => {
    const current = stateRef.current;
    if (current.step !== "local" || !current.selectedRepository) return;
    const parentDirectory = await gateway.pickDirectory();
    if (!parentDirectory) return;
    const latest = stateRef.current;
    if (
      latest.step !== "local" ||
      latest.selectedRepository.id !== current.selectedRepository.id
    ) return;
    setCloneTargetPreview({
      repositoryId: latest.selectedRepository.id,
      parentDirectory,
      targetPath: cloneTargetPath(parentDirectory, latest.selectedRepository.name),
      mode,
    });
  }, [gateway]);

  const cloneIntoSelectedParent = useCallback(async () => {
    await selectCloneTarget("start");
  }, [selectCloneTarget]);

  const confirmCloneTarget = useCallback(async () => {
    const preview = cloneTargetPreview;
    const current = stateRef.current;
    if (
      !preview ||
      current.step !== "local" ||
      current.selectedRepository.id !== preview.repositoryId
    ) return;
    setCloneTargetPreview(null);
    await clone(
      {
        id: operationId(),
        repositoryId: preview.repositoryId,
        parentDirectory: preview.parentDirectory,
        targetPath: preview.targetPath,
      },
      preview.mode,
    );
  }, [clone, cloneTargetPreview]);

  const cancelCloneTarget = useCallback(() => {
    setCloneTargetPreview(null);
  }, []);

  const chooseAnotherCloneDirectory = useCallback(async () => {
    const current = stateRef.current;
    if (
      current.step !== "local" ||
      current.status !== "error" ||
      current.errorContext !== "pre_repository" ||
      current.failedOperation !== "clone" ||
      current.error.recovery !== "choose_another_directory"
    ) return;
    await selectCloneTarget("alternate_directory");
  }, [selectCloneTarget]);

  const previewInitialization = useCallback(async () => {
    const current = stateRef.current;
    if (
      current.step !== "local" ||
      !current.localRepository ||
      current.workspaceInspection?.status !== "initialization_required"
    ) return;
    const request: InitializationPreviewRequest = {
      id: operationId(),
      repositoryRoot: current.localRepository.root,
      workspaceName: workspaceNameFromRepository(current.selectedRepository.name),
    };
    if (!dispatchAccepted({ type: "initializationPreviewStarted", request })) return;
    try {
      const preview = await gateway.previewInitialization({
        repositoryPath: request.repositoryRoot,
        workspaceName: request.workspaceName,
        repositoryId: current.selectedRepository.id,
        repositoryFullName: current.selectedRepository.fullName,
      });
      dispatchAccepted({ type: "initializationPreviewLoaded", request, preview });
    } catch (error) {
      dispatchAccepted({ type: "initializationPreviewFailed", request, error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const cancelInitializationPreview = useCallback(() => {
    dispatchAccepted({ type: "initializationPreviewCancelled" });
  }, [dispatchAccepted]);

  const connectInitializedWorkspace = useCallback(
    async (request: WorkspaceConnectionRequest) => {
      if (!dispatchAccepted({ type: "workspaceConnectionStarted", request })) return;
      try {
        const workspace = await gateway.connectWorkspace(request.repositoryRoot, {
          id: request.repositoryId,
          fullName: request.repositoryFullName,
        });
        if (dispatchAccepted({ type: "workspaceConnected", request, workspace })) {
          activeWorkspaceValidationRef.current = null;
          setWorkspaceValidating(false);
          setWorkspaceValidation({
            requestId: null,
            path: workspace.path,
            inspection: { status: "ready", summary: workspace.summary },
            error: null,
          });
        }
      } catch (error) {
        dispatchAccepted({ type: "workspaceConnectionFailed", request, error: asAppError(error) });
      }
    },
    [dispatchAccepted, gateway],
  );

  const confirmInitialization = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "initialize" || current.status !== "preview") return;
    const request: InitializationRequest = {
      id: operationId(),
      previewId: current.initializationPreview.id,
      repositoryRoot: current.localRepository.root,
    };
    if (!dispatchAccepted({ type: "initializationStarted", request })) return;
    try {
      const result = await gateway.initializeWorkspace(request.previewId);
      dispatchAccepted({ type: "initializationSucceeded", request, result });
    } catch (error) {
      dispatchAccepted({ type: "initializationFailed", request, error: asAppError(error) });
    }
  }, [dispatchAccepted, gateway]);

  const retryLastAction = useCallback(async () => {
    const current = stateRef.current;
    if (current.step === "auth") {
      await startLogin();
      return;
    }
    if (current.step === "repository") {
      await loadRepositories(null, false);
      return;
    }
    if (current.step === "local" && current.status === "error") {
      if (current.errorContext === "pre_repository" && current.failedOperation === "local_inspection") {
        await inspectLocalClone({ ...current.failedLocalInspectionRequest, id: operationId() }, true);
      } else if (current.errorContext === "pre_repository" && current.failedOperation === "clone") {
        await clone({ ...current.failedCloneStartRequest, id: operationId() }, "retry");
      } else if (current.errorContext === "repository") {
        await inspectWorkspace(current.localRepository.root);
      } else if (current.errorContext === "initialization_preview") {
        await previewInitialization();
      } else if (current.errorContext === "workspace_connection") {
        await connectInitializedWorkspace({
          ...current.failedWorkspaceConnectionRequest,
          id: operationId(),
        });
      }
      return;
    }
    if (current.step === "initialize" && current.status === "error") {
      if (current.failedOperation === "initialization") {
        const request = { ...current.failedInitializationRequest, id: operationId() };
        if (!dispatchAccepted({ type: "initializationStarted", request })) return;
        try {
          const result = await gateway.initializeWorkspace(request.previewId);
          dispatchAccepted({ type: "initializationSucceeded", request, result });
        } catch (error) {
          dispatchAccepted({ type: "initializationFailed", request, error: asAppError(error) });
        }
      } else {
        await connectInitializedWorkspace({ ...current.failedWorkspaceConnectionRequest, id: operationId() });
      }
    }
  }, [clone, connectInitializedWorkspace, dispatchAccepted, gateway, inspectLocalClone, inspectWorkspace, loadRepositories, previewInitialization, startLogin]);

  const startReplacement = useCallback(async () => {
    if (!dispatchAccepted({ type: "replacementStarted" })) return;
    activeWorkspaceValidationRef.current = null;
    setWorkspaceValidating(false);
    setWorkspaceValidation(null);
    await loadAuth();
  }, [dispatchAccepted, loadAuth]);
  const cancelReplacement = useCallback(async () => {
    const current = stateRef.current;
    if (current.mode !== "replacement") return;
    if (
      current.step === "auth" &&
      (current.status === "login_beginning" ||
        current.status === "waiting_for_user")
    ) {
      await cancelLogin();
    }
    if (dispatchAccepted({ type: "replacementCancelled" })) {
      activeWorkspaceValidationRef.current = null;
      setWorkspaceValidating(false);
      setWorkspaceValidation({
        requestId: null,
        path: current.replacementWorkspace.path,
        inspection: { status: "ready", summary: current.replacementWorkspace.summary },
        error: null,
      });
    }
  }, [cancelLogin, dispatchAccepted]);
  const revalidateCurrentWorkspace = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "initialize" || current.status !== "connected") {
      throw new Error("연결된 워크스페이스가 없습니다.");
    }
    const validationRequest = {
      requestId: operationId(),
      path: current.connectedWorkspace.path,
    };
    activeWorkspaceValidationRef.current = validationRequest;
    setWorkspaceValidating(true);
    try {
      const inspection = await gateway.inspectWorkspace(validationRequest.path);
      const latest = activeWorkspaceValidationRef.current;
      const latestState = stateRef.current;
      if (
        latest?.requestId === validationRequest.requestId &&
        latestState.step === "initialize" &&
        latestState.status === "connected" &&
        latestState.connectedWorkspace.path === validationRequest.path
      ) {
        setWorkspaceValidation({ ...validationRequest, inspection, error: null });
      }
    } catch (error) {
      const latest = activeWorkspaceValidationRef.current;
      const latestState = stateRef.current;
      if (
        latest?.requestId === validationRequest.requestId &&
        latestState.step === "initialize" &&
        latestState.status === "connected" &&
        latestState.connectedWorkspace.path === validationRequest.path
      ) {
        setWorkspaceValidation({
          ...validationRequest,
          inspection: null,
          error: asAppError(error),
        });
      }
    } finally {
      if (activeWorkspaceValidationRef.current?.requestId === validationRequest.requestId) {
        activeWorkspaceValidationRef.current = null;
        setWorkspaceValidating(false);
      }
    }
  }, [gateway]);

  useEffect(() => {
    let active = true;
    let unlistenAuth: (() => void) | undefined;
    let unlistenClone: (() => void) | undefined;

    const setup = async () => {
      const subscriptions = await Promise.allSettled([
        gateway.onAuthStatus((event) => {
          dispatchAccepted({ type: "authEventReceived", event });
        }),
        gateway.onCloneProgress((event) => {
          dispatchAccepted({ type: "cloneEventReceived", event });
        }),
      ]);
      const [authSubscription, cloneSubscription] = subscriptions;
      unlistenAuth = authSubscription.status === "fulfilled"
        ? authSubscription.value
        : undefined;
      unlistenClone = cloneSubscription.status === "fulfilled"
        ? cloneSubscription.value
        : undefined;
      if (authSubscription.status === "rejected" || cloneSubscription.status === "rejected") {
        unlistenAuth?.();
        unlistenClone?.();
        unlistenAuth = undefined;
        unlistenClone = undefined;
        return;
      }
      if (!active) {
        unlistenAuth?.();
        unlistenClone?.();
        return;
      }
      try {
        const workspace = await gateway.getCurrentWorkspace();
        if (!active) return;
        const accepted = dispatchAccepted({ type: "currentWorkspaceLoaded", workspace });
        if (accepted && workspace?.status === "connected") {
          setWorkspaceValidation({
            requestId: null,
            path: workspace.path,
            inspection: { status: "ready", summary: workspace.summary },
            error: null,
          });
        }
        setCurrentWorkspaceLoading(false);
        if (accepted && workspace?.status !== "connected") void loadAuth();
      } catch {
        if (!active) return;
        dispatchAccepted({ type: "currentWorkspaceLoaded", workspace: null });
        setCurrentWorkspaceLoading(false);
        void loadAuth();
      }
    };
    void setup();
    return () => {
      active = false;
      unlistenAuth?.();
      unlistenClone?.();
    };
  }, [dispatchAccepted, gateway, loadAuth]);

  useEffect(() => {
    if (
      state.step === "repository" &&
      state.status === "idle" &&
      !state.repositoriesLoaded
    ) {
      void loadRepositories(null, false, state.auth.user.id);
    }
  }, [loadRepositories, state]);

  useEffect(() => {
    if (
      state.step === "local" &&
      state.status === "idle" &&
      state.localRepository &&
      state.workspaceInspection === null
    ) {
      void inspectWorkspace(state.localRepository.root);
      return;
    }
    if (
      state.step === "local" &&
      state.status === "idle" &&
      state.localRepository &&
      state.workspaceInspection?.status === "ready"
    ) {
      void connectInitializedWorkspace({
        id: operationId(),
        repositoryRoot: state.localRepository.root,
        repositoryId: state.selectedRepository.id,
        repositoryFullName: state.selectedRepository.fullName,
        source: "existing",
        initializationRequestId: null,
      });
      return;
    }
    if (state.step === "initialize" && state.status === "ready_to_connect") {
      void connectInitializedWorkspace({
        id: operationId(),
        repositoryRoot: state.initializationResult.root,
        repositoryId: state.selectedRepository.id,
        repositoryFullName: state.selectedRepository.fullName,
        source: "initialization",
        initializationRequestId: state.completedInitializationRequest.id,
      });
    }
  }, [connectInitializedWorkspace, inspectWorkspace, state]);

  const value = useMemo<WorkspaceConnectionContextValue>(
    () => ({
      state,
      canCancelReplacement: canCancelReplacement(state),
      isCurrentWorkspaceLoading,
      isWorkspaceValidating,
      workspaceValidation,
      cloneTargetPreview,
      startLogin,
      cancelLogin,
      openVerificationUrl,
      openLocalPath,
      refreshRepositories,
      loadNextRepositories,
      selectRepository,
      connectExistingClone,
      cloneIntoSelectedParent,
      confirmCloneTarget,
      cancelCloneTarget,
      chooseAnotherCloneDirectory,
      previewInitialization,
      cancelInitializationPreview,
      confirmInitialization,
      retryLastAction,
      revalidateCurrentWorkspace,
      startReplacement,
      cancelReplacement,
    }),
    [cancelCloneTarget, cancelInitializationPreview, cancelLogin, cancelReplacement, chooseAnotherCloneDirectory, cloneIntoSelectedParent, cloneTargetPreview, confirmCloneTarget, confirmInitialization, connectExistingClone, isCurrentWorkspaceLoading, isWorkspaceValidating, loadNextRepositories, openLocalPath, openVerificationUrl, previewInitialization, refreshRepositories, revalidateCurrentWorkspace, retryLastAction, selectRepository, startLogin, startReplacement, state, workspaceValidation],
  );

  return <WorkspaceConnectionContext.Provider value={value}>{children}</WorkspaceConnectionContext.Provider>;
}

export function useWorkspaceConnection(): WorkspaceConnectionContextValue {
  const value = useContext(WorkspaceConnectionContext);
  if (!value) throw new Error("useWorkspaceConnection must be used inside WorkspaceConnectionProvider");
  return value;
}
