import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from "react";
import type { DocumentsGateway } from "./DocumentsGateway";
import {
  createInitialDocumentsState,
  documentsReducer,
  type DocumentsAction,
  type DocumentsState,
  type SelectedDocumentVersion,
} from "./documents-reducer";
import type {
  AppError,
  DocumentAsset,
  DocumentEventEnvelope,
  HistoryItem,
} from "./model";

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const DOCUMENT_SEARCH_LIMIT = 20;

const secretMarkers = [
  "access_token",
  "refresh_token",
  "device_code",
  "authorization",
  "password",
  "secret",
  "ghu_",
  "ghr_",
];

function createOperationId(): string {
  return crypto.randomUUID();
}

function containsPrivateValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    secretMarkers.some((marker) => normalized.includes(marker)) ||
    /(?:^|\s)\/(?:users|home|private|var|tmp)\//i.test(value) ||
    /[a-z]:\\/i.test(value) ||
    normalized.includes("search.sqlite3") ||
    normalized.includes("document-search")
  );
}

function fallbackDocumentError(): AppError {
  return {
    code: "document_index_unavailable",
    message: "문서 작업을 완료할 수 없습니다.",
    recovery: "retry",
    details: {},
  };
}

function asDocumentError(error: unknown): AppError {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    !("message" in error)
  ) {
    return fallbackDocumentError();
  }
  const candidate = error as Partial<AppError>;
  if (
    typeof candidate.code !== "string" ||
    typeof candidate.message !== "string" ||
    containsPrivateValue(candidate.message)
  ) {
    return fallbackDocumentError();
  }
  return {
    code: candidate.code as AppError["code"],
    message: candidate.message,
    recovery:
      typeof candidate.recovery === "string" || candidate.recovery === null
        ? (candidate.recovery as AppError["recovery"])
        : null,
    details: {},
  };
}

function sanitizedEvent(event: DocumentEventEnvelope): DocumentEventEnvelope {
  return event.type === "failed"
    ? { ...event, error: asDocumentError(event.error) }
    : event;
}

export interface DocumentsContextValue {
  state: DocumentsState;
  setSearchQuery(query: string): void;
  selectDocument(path: string): void;
  selectCurrentVersion(): void;
  selectDocumentVersion(
    version: SelectedDocumentVersion | Pick<HistoryItem, "commitOid" | "pathAtCommit">,
  ): void;
  loadHistory(): void;
  loadMoreHistory(): void;
  refresh(): Promise<void>;
  readAsset(documentPath: string, assetPath: string): Promise<DocumentAsset>;
  copyText(value: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  clearRecoverableError(): void;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export interface DocumentsProviderProps extends PropsWithChildren {
  gateway: DocumentsGateway;
  createId?: () => string;
  searchDebounceMs?: number;
}

export function DocumentsProvider({
  gateway,
  createId = createOperationId,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  children,
}: DocumentsProviderProps) {
  const [state, dispatch] = useReducer(
    documentsReducer,
    undefined,
    createInitialDocumentsState,
  );
  const stateRef = useRef(state);

  const dispatchAccepted = useCallback((action: DocumentsAction) => {
    const current = stateRef.current;
    const next = documentsReducer(current, action);
    if (next === current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);

  useEffect(() => {
    const sessionId = createId();
    let active = true;
    let unlisten: (() => void) | undefined;
    dispatchAccepted({ type: "sessionStarting", sessionId });

    const setup = async () => {
      try {
        const registeredUnlisten = await gateway.onDocumentEvent((event) => {
          if (!active) return;
          dispatchAccepted({
            type: "documentEventReceived",
            event: sanitizedEvent(event),
          });
        });
        if (!active) {
          registeredUnlisten();
          return;
        }
        unlisten = registeredUnlisten;

        const snapshot = await gateway.startSession(sessionId);
        if (!active) return;
        dispatchAccepted({ type: "sessionStarted", sessionId, snapshot });
      } catch (error) {
        if (!active) return;
        dispatchAccepted({
          type: "sessionFailed",
          sessionId,
          error: asDocumentError(error),
        });
      }
    };

    void setup();
    return () => {
      active = false;
      unlisten?.();
      void gateway.stopSession(sessionId).catch(() => undefined);
    };
  }, [createId, dispatchAccepted, gateway]);

  useEffect(() => {
    if (
      state.status !== "ready" ||
      state.activeSessionId === null ||
      state.searchQuery.trim() === ""
    ) {
      return;
    }
    const sessionId = state.activeSessionId;
    const query = state.searchQuery;
    const timer = window.setTimeout(() => {
      dispatchAccepted({
        type: "searchStarted",
        sessionId,
        requestId: createId(),
        query,
      });
    }, searchDebounceMs);
    return () => window.clearTimeout(timer);
  }, [
    createId,
    dispatchAccepted,
    searchDebounceMs,
    state.activeSessionId,
    state.searchQuery,
    state.status,
  ]);

  const activeSearchRequestId = state.activeSearchRequestId;
  useEffect(() => {
    if (activeSearchRequestId === null) return;
    const current = stateRef.current;
    if (
      current.activeSessionId === null ||
      current.activeSearchRequestId !== activeSearchRequestId ||
      current.searchStatus !== "queued"
    ) {
      return;
    }
    const sessionId = current.activeSessionId;
    const query = current.searchQuery;
    if (
      !dispatchAccepted({
        type: "searchDispatched",
        sessionId,
        requestId: activeSearchRequestId,
      })
    ) {
      return;
    }
    let active = true;
    void gateway
      .searchDocuments(
        sessionId,
        activeSearchRequestId,
        query,
        DOCUMENT_SEARCH_LIMIT,
      )
      .then(
        (response) => {
          if (active) dispatchAccepted({ type: "searchSucceeded", response });
        },
        (error) => {
          if (!active) return;
          dispatchAccepted({
            type: "searchFailed",
            sessionId,
            requestId: activeSearchRequestId,
            error: asDocumentError(error),
          });
        },
      );
    return () => {
      active = false;
    };
  }, [activeSearchRequestId, dispatchAccepted, gateway]);

  const activeReadRequestId = state.activeReadRequest?.requestId ?? null;
  useEffect(() => {
    if (activeReadRequestId === null) return;
    const request = stateRef.current.activeReadRequest;
    if (
      request === null ||
      request.requestId !== activeReadRequestId ||
      request.status !== "queued" ||
      !dispatchAccepted({ type: "documentReadStarted", request })
    ) {
      return;
    }
    let active = true;
    const read =
      request.kind === "current"
        ? gateway.readDocument(request.sessionId, request.path)
        : gateway.readDocumentVersion(
            request.sessionId,
            request.commitOid,
            request.pathAtCommit,
          );
    void read.then(
      (content) => {
        if (active) {
          dispatchAccepted({
            type: "documentReadSucceeded",
            request,
            content,
          });
        }
      },
      (error) => {
        if (active) {
          dispatchAccepted({
            type: "documentReadFailed",
            request,
            error: asDocumentError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [activeReadRequestId, dispatchAccepted, gateway]);

  const activeHistoryRequestId = state.activeHistoryRequest?.requestId ?? null;
  useEffect(() => {
    if (activeHistoryRequestId === null) return;
    const request = stateRef.current.activeHistoryRequest;
    if (
      request === null ||
      request.requestId !== activeHistoryRequestId ||
      request.status !== "queued" ||
      !dispatchAccepted({ type: "historyStarted", request })
    ) {
      return;
    }
    let active = true;
    void gateway
      .listDocumentHistory(
        request.sessionId,
        request.path,
        request.cursor,
      )
      .then(
        (page) => {
          if (active) {
            dispatchAccepted({ type: "historySucceeded", request, page });
          }
        },
        (error) => {
          if (active) {
            dispatchAccepted({
              type: "historyFailed",
              request,
              error: asDocumentError(error),
            });
          }
        },
      );
    return () => {
      active = false;
    };
  }, [activeHistoryRequestId, dispatchAccepted, gateway]);

  const setSearchQuery = useCallback(
    (query: string) => {
      dispatchAccepted({ type: "searchQueryChanged", query });
    },
    [dispatchAccepted],
  );

  const selectDocument = useCallback(
    (path: string) => {
      const sessionId = stateRef.current.activeSessionId;
      if (sessionId === null) return;
      dispatchAccepted({
        type: "documentSelectionRequested",
        sessionId,
        requestId: createId(),
        path,
      });
    },
    [createId, dispatchAccepted],
  );

  const selectCurrentVersion = useCallback(() => {
    const sessionId = stateRef.current.activeSessionId;
    if (sessionId === null) return;
    dispatchAccepted({
      type: "currentVersionRequested",
      sessionId,
      requestId: createId(),
    });
  }, [createId, dispatchAccepted]);

  const selectDocumentVersion = useCallback(
    (version: Pick<HistoryItem, "commitOid" | "pathAtCommit">) => {
      const sessionId = stateRef.current.activeSessionId;
      if (sessionId === null) return;
      dispatchAccepted({
        type: "documentVersionRequested",
        sessionId,
        requestId: createId(),
        version: {
          commitOid: version.commitOid,
          pathAtCommit: version.pathAtCommit,
        },
      });
    },
    [createId, dispatchAccepted],
  );

  const loadHistory = useCallback(() => {
    const current = stateRef.current;
    if (current.activeSessionId === null || current.selectedPath === null) return;
    dispatchAccepted({
      type: "historyRequested",
      request: {
        requestId: createId(),
        sessionId: current.activeSessionId,
        path: current.selectedPath,
        cursor: null,
        append: false,
      },
    });
  }, [createId, dispatchAccepted]);

  const loadMoreHistory = useCallback(() => {
    const current = stateRef.current;
    if (
      current.activeSessionId === null ||
      current.selectedPath === null ||
      current.historyNextCursor === null
    ) {
      return;
    }
    dispatchAccepted({
      type: "historyRequested",
      request: {
        requestId: createId(),
        sessionId: current.activeSessionId,
        path: current.selectedPath,
        cursor: current.historyNextCursor,
        append: true,
      },
    });
  }, [createId, dispatchAccepted]);

  const refresh = useCallback(async () => {
    const sessionId = stateRef.current.activeSessionId;
    if (sessionId === null) return;
    try {
      await gateway.refreshSession(sessionId);
    } catch (error) {
      dispatchAccepted({
        type: "sessionOperationFailed",
        sessionId,
        error: asDocumentError(error),
      });
    }
  }, [dispatchAccepted, gateway]);

  const readAsset = useCallback(
    async (documentPath: string, assetPath: string) => {
      const sessionId = stateRef.current.activeSessionId;
      if (sessionId === null) throw fallbackDocumentError();
      try {
        return await gateway.readDocumentAsset(
          sessionId,
          documentPath,
          assetPath,
        );
      } catch (error) {
        throw asDocumentError(error);
      }
    },
    [gateway],
  );

  const copyText = useCallback(
    async (value: string) => {
      try {
        await gateway.copyText(value);
      } catch (error) {
        throw asDocumentError(error);
      }
    },
    [gateway],
  );

  const openExternal = useCallback(
    async (url: string) => {
      try {
        await gateway.openExternal(url);
      } catch (error) {
        throw asDocumentError(error);
      }
    },
    [gateway],
  );

  const clearRecoverableError = useCallback(() => {
    dispatchAccepted({ type: "recoverableErrorCleared" });
  }, [dispatchAccepted]);

  const value = useMemo<DocumentsContextValue>(
    () => ({
      state,
      setSearchQuery,
      selectDocument,
      selectCurrentVersion,
      selectDocumentVersion,
      loadHistory,
      loadMoreHistory,
      refresh,
      readAsset,
      copyText,
      openExternal,
      clearRecoverableError,
    }),
    [
      clearRecoverableError,
      copyText,
      loadHistory,
      loadMoreHistory,
      openExternal,
      readAsset,
      refresh,
      selectCurrentVersion,
      selectDocument,
      selectDocumentVersion,
      setSearchQuery,
      state,
    ],
  );

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments(): DocumentsContextValue {
  const value = useContext(DocumentsContext);
  if (!value) {
    throw new Error("useDocuments must be used inside DocumentsProvider");
  }
  return value;
}
