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
} from "./types";

export interface WorkspaceConnectionContextValue {
  state: ConnectionState;
  isCurrentWorkspaceLoading: boolean;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  openVerificationUrl(url: string): Promise<void>;
  refreshRepositories(): Promise<void>;
  loadNextRepositories(): Promise<void>;
  selectRepository(repository: GithubRepositorySummary): void;
  connectExistingClone(): Promise<void>;
  cloneIntoSelectedParent(): Promise<void>;
  chooseAnotherCloneDirectory(): Promise<void>;
  previewInitialization(): Promise<void>;
  cancelInitializationPreview(): void;
  confirmInitialization(): Promise<void>;
  retryLastAction(): Promise<void>;
  startReplacement(): void;
  cancelReplacement(): void;
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

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    if (current.step !== "auth" || current.status !== "waiting_for_user") return;
    try {
      await gateway.cancelGithubAuth(current.authorization.requestId);
    } finally {
      dispatchAccepted({ type: "authEventReceived", event: { status: "cancelled", requestId: current.authorization.requestId } });
    }
  }, [dispatchAccepted, gateway]);

  const openVerificationUrl = useCallback(async (url: string) => {
    await gateway.openExternal(url);
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

  const cloneIntoSelectedParent = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== "local" || !current.selectedRepository) return;
    const parentDirectory = await gateway.pickDirectory();
    if (!parentDirectory) return;
    await clone({ id: operationId(), repositoryId: current.selectedRepository.id, parentDirectory });
  }, [clone, gateway]);

  const chooseAnotherCloneDirectory = useCallback(async () => {
    const current = stateRef.current;
    if (
      current.step !== "local" ||
      current.status !== "error" ||
      current.errorContext !== "pre_repository" ||
      current.failedOperation !== "clone" ||
      current.error.recovery !== "choose_another_directory"
    ) return;
    const parentDirectory = await gateway.pickDirectory();
    if (
      !parentDirectory ||
      parentDirectory === current.failedCloneStartRequest.parentDirectory
    ) return;
    await clone(
      {
        id: operationId(),
        repositoryId: current.failedCloneStartRequest.repositoryId,
        parentDirectory,
      },
      "alternate_directory",
    );
  }, [clone, gateway]);

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
        const workspace = await gateway.connectWorkspace(request.repositoryRoot);
        dispatchAccepted({ type: "workspaceConnected", request, workspace });
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

  const startReplacement = useCallback(() => dispatchAccepted({ type: "replacementStarted" }), [dispatchAccepted]);
  const cancelReplacement = useCallback(() => dispatchAccepted({ type: "replacementCancelled" }), [dispatchAccepted]);

  useEffect(() => {
    let active = true;
    let unlistenAuth: (() => void) | undefined;
    let unlistenClone: (() => void) | undefined;

    const setup = async () => {
      const subscriptions = await Promise.all([
        gateway.onAuthStatus((event) => {
          dispatchAccepted({ type: "authEventReceived", event });
        }),
        gateway.onCloneProgress((event) => {
          dispatchAccepted({ type: "cloneEventReceived", event });
        }),
      ]);
      [unlistenAuth, unlistenClone] = subscriptions;
      if (!active) {
        unlistenAuth();
        unlistenClone();
        return;
      }
      try {
        const workspace = await gateway.getCurrentWorkspace();
        if (!active) return;
        const accepted = dispatchAccepted({ type: "currentWorkspaceLoaded", workspace });
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
        source: "existing",
        initializationRequestId: null,
      });
      return;
    }
    if (state.step === "initialize" && state.status === "ready_to_connect") {
      void connectInitializedWorkspace({
        id: operationId(),
        repositoryRoot: state.initializationResult.root,
        source: "initialization",
        initializationRequestId: state.completedInitializationRequest.id,
      });
    }
  }, [connectInitializedWorkspace, inspectWorkspace, state]);

  const value = useMemo<WorkspaceConnectionContextValue>(
    () => ({
      state,
      isCurrentWorkspaceLoading,
      startLogin,
      cancelLogin,
      openVerificationUrl,
      refreshRepositories,
      loadNextRepositories,
      selectRepository,
      connectExistingClone,
      cloneIntoSelectedParent,
      chooseAnotherCloneDirectory,
      previewInitialization,
      cancelInitializationPreview,
      confirmInitialization,
      retryLastAction,
      startReplacement,
      cancelReplacement,
    }),
    [cancelInitializationPreview, cancelLogin, cancelReplacement, chooseAnotherCloneDirectory, cloneIntoSelectedParent, confirmInitialization, connectExistingClone, isCurrentWorkspaceLoading, loadNextRepositories, openVerificationUrl, previewInitialization, refreshRepositories, retryLastAction, selectRepository, startLogin, startReplacement, state],
  );

  return <WorkspaceConnectionContext.Provider value={value}>{children}</WorkspaceConnectionContext.Provider>;
}

export function useWorkspaceConnection(): WorkspaceConnectionContextValue {
  const value = useContext(WorkspaceConnectionContext);
  if (!value) throw new Error("useWorkspaceConnection must be used inside WorkspaceConnectionProvider");
  return value;
}
