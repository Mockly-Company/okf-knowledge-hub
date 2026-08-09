import type {
  AppError,
  DocumentCatalog,
  DocumentContent,
  DocumentEventEnvelope,
  DocumentSearchResponse,
  DocumentSessionSnapshot,
  HistoryCursor,
  HistoryItem,
  HistoryPage,
  IndexStatus,
  SearchResult,
} from "./model";

export type DocumentsStatus = "idle" | "starting" | "ready" | "error";
export type AsyncStatus = "idle" | "queued" | "loading" | "ready" | "error";

export interface SelectedDocumentVersion {
  commitOid: string;
  pathAtCommit: string;
}

interface ReadRequestBase {
  requestId: string;
  sessionId: string;
  path: string;
  status: "queued" | "loading";
}

export type DocumentReadRequest =
  | (ReadRequestBase & { kind: "current" })
  | (ReadRequestBase & {
      kind: "version";
      commitOid: string;
      pathAtCommit: string;
    });

export interface DocumentHistoryRequest {
  requestId: string;
  sessionId: string;
  path: string;
  cursor: HistoryCursor | null;
  append: boolean;
  status: "queued" | "loading";
}

export interface DocumentsState {
  status: DocumentsStatus;
  activeSessionId: string | null;
  latestRevision: number;
  workspaceId: string | null;
  repositoryFullName: string | null;
  branch: string | null;
  catalog: DocumentCatalog;
  indexStatus: IndexStatus;
  lastOpenedPath: string | null;
  searchQuery: string;
  activeSearchRequestId: string | null;
  searchStatus: AsyncStatus;
  searchResults: SearchResult[];
  searchError: AppError | null;
  selectedPath: string | null;
  selectedVersion: SelectedDocumentVersion | null;
  selectedDocument: DocumentContent | null;
  documentStatus: AsyncStatus;
  activeReadRequest: DocumentReadRequest | null;
  historyItems: HistoryItem[];
  historyNextCursor: HistoryCursor | null;
  historyStatus: AsyncStatus;
  activeHistoryRequest: DocumentHistoryRequest | null;
  recoverableError: AppError | null;
}

export type DocumentsAction =
  | { type: "sessionStarting"; sessionId: string }
  | {
      type: "sessionStarted";
      sessionId: string;
      snapshot: DocumentSessionSnapshot;
    }
  | { type: "sessionFailed"; sessionId: string; error: AppError }
  | { type: "documentEventReceived"; event: DocumentEventEnvelope }
  | { type: "searchQueryChanged"; query: string }
  | {
      type: "searchStarted";
      sessionId: string;
      requestId: string;
      query: string;
    }
  | {
      type: "searchDispatched";
      sessionId: string;
      requestId: string;
    }
  | { type: "searchSucceeded"; response: DocumentSearchResponse }
  | {
      type: "searchFailed";
      sessionId: string;
      requestId: string;
      error: AppError;
    }
  | {
      type: "documentSelectionRequested";
      sessionId: string;
      requestId: string;
      path: string;
    }
  | {
      type: "currentVersionRequested";
      sessionId: string;
      requestId: string;
    }
  | {
      type: "documentVersionRequested";
      sessionId: string;
      requestId: string;
      version: SelectedDocumentVersion;
    }
  | { type: "documentReadStarted"; request: DocumentReadRequest }
  | {
      type: "documentReadSucceeded";
      request: DocumentReadRequest;
      content: DocumentContent;
    }
  | {
      type: "documentReadFailed";
      request: DocumentReadRequest;
      error: AppError;
    }
  | {
      type: "historyRequested";
      request: Omit<DocumentHistoryRequest, "status">;
    }
  | { type: "historyStarted"; request: DocumentHistoryRequest }
  | {
      type: "historySucceeded";
      request: DocumentHistoryRequest;
      page: HistoryPage;
    }
  | {
      type: "historyFailed";
      request: DocumentHistoryRequest;
      error: AppError;
    }
  | { type: "sessionOperationFailed"; sessionId: string; error: AppError }
  | { type: "recoverableErrorCleared" };

const EMPTY_CATALOG: DocumentCatalog = { documents: [], roots: [] };
const INITIAL_INDEX: IndexStatus = {
  status: "preparing",
  indexed: 0,
  total: 0,
};

export function createInitialDocumentsState(): DocumentsState {
  return {
    status: "idle",
    activeSessionId: null,
    latestRevision: -1,
    workspaceId: null,
    repositoryFullName: null,
    branch: null,
    catalog: EMPTY_CATALOG,
    indexStatus: INITIAL_INDEX,
    lastOpenedPath: null,
    searchQuery: "",
    activeSearchRequestId: null,
    searchStatus: "idle",
    searchResults: [],
    searchError: null,
    selectedPath: null,
    selectedVersion: null,
    selectedDocument: null,
    documentStatus: "idle",
    activeReadRequest: null,
    historyItems: [],
    historyNextCursor: null,
    historyStatus: "idle",
    activeHistoryRequest: null,
    recoverableError: null,
  };
}

function clearSelection(state: DocumentsState): DocumentsState {
  return {
    ...state,
    selectedPath: null,
    selectedVersion: null,
    selectedDocument: null,
    documentStatus: "idle",
    activeReadRequest: null,
    historyItems: [],
    historyNextCursor: null,
    historyStatus: "idle",
    activeHistoryRequest: null,
  };
}

function openCurrentDocument(
  state: DocumentsState,
  path: string | null,
  requestId: string,
): DocumentsState {
  if (path === null) return clearSelection(state);

  const activeRequest = state.activeReadRequest;
  const alreadyReading =
    activeRequest?.kind === "current" && activeRequest.path === path;
  const alreadyLoaded =
    state.selectedVersion === null &&
    state.selectedDocument?.summary.path === path &&
    state.documentStatus === "ready";
  if (state.selectedPath === path && (alreadyReading || alreadyLoaded)) {
    return state;
  }

  return {
    ...state,
    selectedPath: path,
    selectedVersion: null,
    selectedDocument: null,
    documentStatus: "queued",
    activeReadRequest: {
      requestId,
      sessionId: state.activeSessionId!,
      kind: "current",
      path,
      status: "queued",
    },
    historyItems: [],
    historyNextCursor: null,
    historyStatus: "idle",
    activeHistoryRequest: null,
  };
}

function sameReadRequest(
  active: DocumentReadRequest | null,
  candidate: DocumentReadRequest,
): boolean {
  if (
    active === null ||
    active.requestId !== candidate.requestId ||
    active.sessionId !== candidate.sessionId ||
    active.kind !== candidate.kind ||
    active.path !== candidate.path
  ) {
    return false;
  }
  return (
    active.kind === "current" ||
    (candidate.kind === "version" &&
      active.commitOid === candidate.commitOid &&
      active.pathAtCommit === candidate.pathAtCommit)
  );
}

function sameHistoryRequest(
  active: DocumentHistoryRequest | null,
  candidate: DocumentHistoryRequest,
): boolean {
  return (
    active !== null &&
    active.requestId === candidate.requestId &&
    active.sessionId === candidate.sessionId &&
    active.path === candidate.path &&
    active.append === candidate.append
  );
}

function applyAuthoritativeSnapshot(
  state: DocumentsState,
  snapshot: Pick<
    DocumentSessionSnapshot,
    "catalog" | "indexStatus" | "lastOpenedPath"
  >,
  revision: number,
  requestId: string,
): DocumentsState {
  const authoritative = {
    ...state,
    latestRevision: revision,
    catalog: snapshot.catalog,
    indexStatus: snapshot.indexStatus,
    lastOpenedPath: snapshot.lastOpenedPath,
    recoverableError: null,
  };
  return openCurrentDocument(authoritative, snapshot.lastOpenedPath, requestId);
}

export function documentsReducer(
  state: DocumentsState,
  action: DocumentsAction,
): DocumentsState {
  switch (action.type) {
    case "sessionStarting":
      return {
        ...createInitialDocumentsState(),
        status: "starting",
        activeSessionId: action.sessionId,
      };

    case "sessionStarted": {
      if (
        state.activeSessionId !== action.sessionId ||
        action.snapshot.sessionId !== action.sessionId
      ) {
        return state;
      }
      const metadataChanged =
        state.status !== "ready" ||
        state.workspaceId !== action.snapshot.workspaceId ||
        state.repositoryFullName !== action.snapshot.repositoryFullName ||
        state.branch !== action.snapshot.branch;
      let next = metadataChanged
        ? {
            ...state,
            status: "ready" as const,
            workspaceId: action.snapshot.workspaceId,
            repositoryFullName: action.snapshot.repositoryFullName,
            branch: action.snapshot.branch,
          }
        : state;
      if (action.snapshot.revision <= state.latestRevision) return next;
      next = applyAuthoritativeSnapshot(
        next,
        action.snapshot,
        action.snapshot.revision,
        `session:${action.sessionId}:${action.snapshot.revision}`,
      );
      return next;
    }

    case "sessionFailed":
      return state.activeSessionId === action.sessionId
        ? { ...state, status: "error", recoverableError: action.error }
        : state;

    case "documentEventReceived": {
      const received = action.event;
      if (
        received.sessionId !== state.activeSessionId ||
        received.revision <= state.latestRevision
      ) {
        return state;
      }
      switch (received.type) {
        case "tree_changed":
          return {
            ...state,
            latestRevision: received.revision,
            catalog: received.catalog,
          };
        case "index_status_changed":
          return {
            ...state,
            latestRevision: received.revision,
            indexStatus: received.status,
          };
        case "open_document_changed": {
          const next = {
            ...state,
            latestRevision: received.revision,
            lastOpenedPath: received.path,
          };
          return openCurrentDocument(
            next,
            received.path,
            `event:${received.sessionId}:${received.revision}`,
          );
        }
        case "failed":
          return {
            ...state,
            latestRevision: received.revision,
            recoverableError: received.error,
          };
        case "resynced":
          if (received.snapshot.sessionId !== state.activeSessionId) return state;
          return applyAuthoritativeSnapshot(
            state,
            received.snapshot,
            received.revision,
            `event:${received.sessionId}:${received.revision}`,
          );
      }
    }

    case "searchQueryChanged":
      if (state.searchQuery === action.query) return state;
      return {
        ...state,
        searchQuery: action.query,
        activeSearchRequestId: null,
        searchStatus: "idle",
        searchResults: action.query.trim() === "" ? [] : state.searchResults,
        searchError: null,
      };

    case "searchStarted":
      if (
        state.activeSessionId !== action.sessionId ||
        state.searchQuery !== action.query ||
        action.query.trim() === ""
      ) {
        return state;
      }
      return {
        ...state,
        activeSearchRequestId: action.requestId,
        searchStatus: "queued",
        searchError: null,
      };

    case "searchDispatched":
      return state.activeSessionId === action.sessionId &&
        state.activeSearchRequestId === action.requestId &&
        state.searchStatus === "queued"
        ? { ...state, searchStatus: "loading" }
        : state;

    case "searchSucceeded":
      return state.activeSessionId === action.response.sessionId &&
        state.activeSearchRequestId === action.response.requestId &&
        state.searchStatus === "loading"
        ? {
            ...state,
            searchStatus: "ready",
            searchResults: action.response.items,
            searchError: null,
          }
        : state;

    case "searchFailed":
      return state.activeSessionId === action.sessionId &&
        state.activeSearchRequestId === action.requestId &&
        state.searchStatus === "loading"
        ? { ...state, searchStatus: "error", searchError: action.error }
        : state;

    case "documentSelectionRequested":
      if (state.activeSessionId !== action.sessionId) return state;
      return openCurrentDocument(state, action.path, action.requestId);

    case "currentVersionRequested":
      if (state.activeSessionId !== action.sessionId || state.selectedPath === null) {
        return state;
      }
      return {
        ...state,
        selectedVersion: null,
        selectedDocument: null,
        documentStatus: "queued",
        activeReadRequest: {
          requestId: action.requestId,
          sessionId: action.sessionId,
          kind: "current",
          path: state.selectedPath,
          status: "queued",
        },
      };

    case "documentVersionRequested":
      if (state.activeSessionId !== action.sessionId || state.selectedPath === null) {
        return state;
      }
      return {
        ...state,
        selectedVersion: action.version,
        selectedDocument: null,
        documentStatus: "queued",
        activeReadRequest: {
          requestId: action.requestId,
          sessionId: action.sessionId,
          kind: "version",
          path: state.selectedPath,
          commitOid: action.version.commitOid,
          pathAtCommit: action.version.pathAtCommit,
          status: "queued",
        },
      };

    case "documentReadStarted":
      return sameReadRequest(state.activeReadRequest, action.request) &&
        state.activeReadRequest?.status === "queued"
        ? {
            ...state,
            documentStatus: "loading",
            activeReadRequest: { ...state.activeReadRequest, status: "loading" },
          }
        : state;

    case "documentReadSucceeded":
      return sameReadRequest(state.activeReadRequest, action.request)
        ? {
            ...state,
            selectedDocument: action.content,
            documentStatus: "ready",
            activeReadRequest: null,
          }
        : state;

    case "documentReadFailed":
      return sameReadRequest(state.activeReadRequest, action.request)
        ? {
            ...state,
            documentStatus: "error",
            activeReadRequest: null,
            recoverableError: action.error,
          }
        : state;

    case "historyRequested": {
      const request = action.request;
      if (
        state.activeSessionId !== request.sessionId ||
        state.selectedPath !== request.path ||
        (request.append && request.cursor !== state.historyNextCursor) ||
        (!request.append && request.cursor !== null)
      ) {
        return state;
      }
      return {
        ...state,
        historyItems: request.append ? state.historyItems : [],
        historyStatus: "queued",
        activeHistoryRequest: { ...request, status: "queued" },
      };
    }

    case "historyStarted":
      return sameHistoryRequest(state.activeHistoryRequest, action.request) &&
        state.activeHistoryRequest?.status === "queued"
        ? {
            ...state,
            historyStatus: "loading",
            activeHistoryRequest: {
              ...state.activeHistoryRequest,
              status: "loading",
            },
          }
        : state;

    case "historySucceeded":
      return sameHistoryRequest(state.activeHistoryRequest, action.request)
        ? {
            ...state,
            historyItems: action.request.append
              ? [...state.historyItems, ...action.page.items]
              : action.page.items,
            historyNextCursor: action.page.nextCursor,
            historyStatus: "ready",
            activeHistoryRequest: null,
          }
        : state;

    case "historyFailed":
      return sameHistoryRequest(state.activeHistoryRequest, action.request)
        ? {
            ...state,
            historyStatus: "error",
            activeHistoryRequest: null,
            recoverableError: action.error,
          }
        : state;

    case "sessionOperationFailed":
      return state.activeSessionId === action.sessionId
        ? { ...state, recoverableError: action.error }
        : state;

    case "recoverableErrorCleared":
      return state.recoverableError === null
        ? state
        : { ...state, recoverableError: null };
  }
}
