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
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { DocumentsGateway } from "./DocumentsGateway";
import type { OpenDocumentTab } from "./components/DocumentWorkbenchTabs";
import { documentsKeys } from "./queryKeys";
import {
  createInitialDocumentsState,
  documentsReducer,
  type DocumentsAction,
  type DocumentsState,
  type SelectedDocumentVersion,
} from "./documents-reducer";
import {
  normalizeDocumentPath,
  type AppError,
  type ApproveAndMergeDocsPrResponse,
  type DocsPullRequestDetail,
  type DocsPullRequestSummary,
  type DocumentAsset,
  type DocumentContent,
  type DocumentEventEnvelope,
  type HistoryItem,
  type PublishDocumentDraftResponse,
  type SearchResult,
} from "./model";
import {
  createInitialAuthoringState,
  documentAuthoringReducer,
  type DocumentAuthoringAction,
  type DocumentAuthoringState,
  type DocumentCreationInput,
  type TeamTemplateCopyInput,
} from "./document-authoring-reducer";

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_SAVE_DEBOUNCE_MS = 800;
const DOCUMENT_SEARCH_LIMIT = 20;

const secretMarkers = [
  "access_token",
  "refresh_token",
  "device_code",
  "authorization",
  "password",
  "secret",
  "client_secret",
  "private_key",
  "api_key",
  "api-key",
  "apikey",
  "x-api-key",
  "bearer ",
];

const secretTokenPrefixPattern =
  /(?:^|[^a-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-|sk-[a-z0-9_-]{6,})/i;

function createOperationId(): string {
  return crypto.randomUUID();
}

function containsPrivateValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    secretMarkers.some((marker) => normalized.includes(marker)) ||
    secretTokenPrefixPattern.test(value) ||
    /(?:^|[^a-z0-9])\/(?:users|home|private|var|tmp)\//i.test(value) ||
    /(?:^|[^a-z0-9])(?:\\\\\?\\)?[a-z]:[\\/]/i.test(value) ||
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
  authoringState: DocumentAuthoringState;
  openTabs: readonly OpenDocumentTab[];
  canGoBackDocument: boolean;
  canGoForwardDocument: boolean;
  preferredViewMode: "html" | "markdown" | null;
  preferredViewTargetPath: string | null;
  clearPreferredViewMode(expectedPath?: string): void;
  closeDocumentTab(path: string): void;
  goBackDocument(): void;
  goForwardDocument(): void;
  openDocumentInNewWindow(
    path: string,
    viewMode?: "html" | "markdown",
    title?: string,
  ): Promise<void>;
  setSearchQuery(query: string): void;
  retrySearch(): void;
  selectDocument(
    path: string,
    searchMatch?: Pick<SearchResult, "matchField" | "matchText">,
    preferredViewMode?: "html" | "markdown",
  ): void;
  showDocumentsHome(): void;
  retrySession(): void;
  resetForWorkspaceSwitch(): void;
  selectCurrentVersion(): void;
  selectDocumentVersion(
    version: SelectedDocumentVersion | Pick<HistoryItem, "commitOid" | "pathAtCommit">,
  ): void;
  loadHistory(): void;
  loadMoreHistory(): void;
  refresh(): Promise<void>;
  readAsset(documentPath: string, assetPath: string): Promise<DocumentAsset>;
  readDocumentPreview(path: string): Promise<DocumentContent>;
  readPreviewAsset(documentPath: string, assetPath: string): Promise<DocumentAsset>;
  copyText(value: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  clearRecoverableError(): void;
  openNewDocument(folder?: string): void;
  closeNewDocument(): void;
  createNewDocument(input: DocumentCreationInput): void;
  editSelectedDocument(): void;
  useSuggestedFileName(): void;
  updateDraftMarkdown(markdown: string): void;
  setDraftEditorMode(mode: "rich" | "source"): void;
  acceptDiskConflict(): void;
  acceptHubConflict(): void;
  startConflictMerge(): void;
  closeDraftEditor(): void;
  duplicateTeamTemplate(input: TeamTemplateCopyInput): void;
  switchDraft(changeId: string | null): void;
  listDocsPullRequests(): Promise<DocsPullRequestSummary[]>;
  getDocsPullRequestDetail(number: number): Promise<DocsPullRequestDetail>;
  editorBaselineMarkdown: string | null | undefined;
  publishDocumentDraft(input: {
    intent: "review" | "publish";
    message: string;
    reviewNote: string;
  }): Promise<PublishDocumentDraftResponse>;
  approveAndMergeDocsPullRequest(
    number: number,
    comment?: string,
  ): Promise<ApproveAndMergeDocsPrResponse>;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export interface DocumentsProviderProps extends PropsWithChildren {
  gateway: DocumentsGateway;
  createId?: () => string;
  initialSearchQuery?: string;
  searchDebounceMs?: number;
  saveDebounceMs?: number;
}

export function DocumentsProvider({
  gateway,
  createId = createOperationId,
  initialSearchQuery = "",
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS,
  children,
}: DocumentsProviderProps) {
  const [state, dispatch] = useReducer(
    documentsReducer,
    initialSearchQuery,
    (searchQuery) => ({
      ...createInitialDocumentsState(),
      searchQuery,
    }),
  );
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [preferredViewPreference, setPreferredViewPreference] = useState<{
    path: string;
    mode: "html" | "markdown";
  } | null>(null);
  const preferredViewMode = preferredViewPreference?.mode ?? null;
  const preferredViewTargetPath = preferredViewPreference?.path ?? null;
  const clearPreferredViewMode = useCallback((expectedPath?: string) => {
    setPreferredViewPreference((current) => {
      if (!current) return null;
      if (
        expectedPath &&
        current.path.toLowerCase() !==
          normalizeDocumentPath(expectedPath).toLowerCase()
      ) {
        return current;
      }
      return null;
    });
  }, []);
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([]);
  const [navHistory, setNavHistory] = useState<{
    entries: Array<string | null>;
    index: number;
  }>({ entries: [null], index: 0 });
  const navHistoryRef = useRef(navHistory);
  navHistoryRef.current = navHistory;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const skipNextHistoryPushRef = useRef(false);
  const [editorBaselines, setEditorBaselines] = useState<
    Record<string, string | null>
  >({});
  const [authoringState, authoringDispatch] = useReducer(
    documentAuthoringReducer,
    undefined,
    createInitialAuthoringState,
  );
  const stateRef = useRef(state);
  const authoringStateRef = useRef(authoringState);
  const pendingWorkspaceResetRef = useRef(false);
  const queryClient = useQueryClient();
  const activeProject = useOptionalActiveProject();
  const registerBeforeWorkspaceSwitch =
    activeProject?.registerBeforeWorkspaceSwitch;

  const dispatchAccepted = useCallback((action: DocumentsAction) => {
    const current = stateRef.current;
    const next = documentsReducer(current, action);
    if (next === current) return false;
    stateRef.current = next;
    dispatch(action);
    return true;
  }, []);

  const dispatchAuthoringAccepted = useCallback(
    (action: DocumentAuthoringAction) => {
      const current = authoringStateRef.current;
      const next = documentAuthoringReducer(current, action);
      if (next === current) return false;
      authoringStateRef.current = next;
      authoringDispatch(action);
      return true;
    },
    [],
  );

  useEffect(() => {
    authoringStateRef.current = authoringState;
  }, [authoringState]);

  useEffect(() => {
    const sessionId = createId();
    let active = true;
    let unlisten: (() => void) | undefined;
    const isWorkspaceReset = pendingWorkspaceResetRef.current;
    pendingWorkspaceResetRef.current = false;
    dispatchAccepted({
      type: isWorkspaceReset ? "workspaceSessionStarting" : "sessionStarting",
      sessionId,
    });

    const setup = async () => {
      try {
        const registeredUnlisten = await gateway.onDocumentEvent((event) => {
          if (!active) return;
          if (
            event.type === "tree_changed" &&
            event.sessionId === stateRef.current.activeSessionId
          ) {
            void queryClient.invalidateQueries({
              queryKey: documentsKeys.session(sessionId),
            });
          }
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
  }, [createId, dispatchAccepted, gateway, queryClient, sessionAttempt]);

  useEffect(() => {
    if (state.status !== "ready" || state.activeSessionId === null) return;
    const sessionId = state.activeSessionId;
    let active = true;
    dispatchAuthoringAccepted({ type: "templatesLoading", sessionId });
    void Promise.all([
      queryClient.fetchQuery({
        queryKey: documentsKeys.templates(sessionId),
        queryFn: () => gateway.listDocumentTemplates(sessionId),
      }),
      queryClient.fetchQuery({
        queryKey: documentsKeys.drafts(sessionId),
        queryFn: () => gateway.listLocalDocumentDrafts(sessionId),
      }),
      queryClient.fetchQuery({
        queryKey: documentsKeys.recovery(sessionId),
        queryFn: () => gateway.getActiveDraftRecovery(sessionId),
      }),
    ]).then(
      ([catalog, drafts, recovery]) => {
        if (!active || stateRef.current.activeSessionId !== sessionId) return;
        dispatchAuthoringAccepted({
          type: "templatesLoaded",
          sessionId,
          catalog,
          drafts,
          activeBranch: stateRef.current.branch ?? "main",
          recovery,
        });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [dispatchAuthoringAccepted, gateway, queryClient, state.activeSessionId, state.status]);

  const creationRequestId = authoringState.creation.requestId;
  const creationStatus = authoringState.creation.status;
  useEffect(() => {
    if (
      creationRequestId === null ||
      creationStatus !== "validation_queued" ||
      stateRef.current.activeSessionId === null
    ) {
      return;
    }
    const sessionId = stateRef.current.activeSessionId;
    const input = authoringStateRef.current.creation.input;
    if (
      input === null ||
      !dispatchAuthoringAccepted({
        type: "validationStarted",
        requestId: creationRequestId,
      })
    ) {
      return;
    }
    // 파일 생성·삭제 직후의 중복 검사가 뒤집히지 않도록 캐시하지 않는다.
    void gateway
      .validateDocumentCreation(sessionId, input.folder, input.fileName)
      .then(
        (validation) => {
          dispatchAuthoringAccepted({
            type: "validationSucceeded",
            requestId: creationRequestId,
            validation,
          });
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "creationFailed",
            requestId: creationRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [
    creationRequestId,
    creationStatus,
    dispatchAuthoringAccepted,
    gateway,
    queryClient,
  ]);

  useEffect(() => {
    if (
      creationRequestId === null ||
      creationStatus !== "creation_queued" ||
      stateRef.current.activeSessionId === null
    ) {
      return;
    }
    const sessionId = stateRef.current.activeSessionId;
    const input = authoringStateRef.current.creation.input;
    const validation = authoringStateRef.current.creation.validation;
    if (
      input === null ||
      validation === null ||
      !dispatchAuthoringAccepted({
        type: "creationStarted",
        requestId: creationRequestId,
      })
    ) {
      return;
    }
    void gateway
      .createDocumentDraft({
        sessionId,
        requestId: creationRequestId,
        ...input,
        fileName: validation.normalizedFileName,
      })
      .then(
        (response) => {
          setEditorBaselines((prev) => ({
            ...prev,
            [response.document.path]: null,
          }));
          if (
            dispatchAuthoringAccepted({
              type: "creationSucceeded",
              requestId: creationRequestId,
              response,
            })
          ) {
            setSessionAttempt((attempt) => attempt + 1);
          }
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "creationFailed",
            requestId: creationRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [
    creationRequestId,
    creationStatus,
    dispatchAuthoringAccepted,
    gateway,
  ]);

  const existingEditRequestId = authoringState.existingEdit.requestId;
  const existingEditStatus = authoringState.existingEdit.status;
  useEffect(() => {
    const sessionId = stateRef.current.activeSessionId;
    const request = authoringStateRef.current.existingEdit;
    if (
      sessionId === null ||
      existingEditRequestId === null ||
      existingEditStatus !== "queued" ||
      request.path === null ||
      request.title === null ||
      !dispatchAuthoringAccepted({
        type: "existingEditStarted",
        requestId: existingEditRequestId,
      })
    ) {
      return;
    }
    void gateway
      .editExistingDocumentDraft({
        sessionId,
        requestId: existingEditRequestId,
        path: request.path,
        title: request.title,
      })
      .then(
        (response) => {
          if (
            dispatchAuthoringAccepted({
              type: "existingEditSucceeded",
              requestId: existingEditRequestId,
              response,
            })
          ) {
            setSessionAttempt((attempt) => attempt + 1);
          }
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "existingEditFailed",
            requestId: existingEditRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [
    dispatchAuthoringAccepted,
    existingEditRequestId,
    existingEditStatus,
    gateway,
  ]);

  const editorMarkdown = authoringState.editor?.markdown ?? null;
  const editorSaveStatus = authoringState.editor?.saveStatus ?? null;
  useEffect(() => {
    if (editorMarkdown === null || editorSaveStatus !== "dirty") return;
    const timer = window.setTimeout(() => {
      dispatchAuthoringAccepted({
        type: "saveQueued",
        requestId: createId(),
        markdown: editorMarkdown,
      });
    }, saveDebounceMs);
    return () => window.clearTimeout(timer);
  }, [
    createId,
    dispatchAuthoringAccepted,
    editorMarkdown,
    editorSaveStatus,
    saveDebounceMs,
  ]);

  const saveRequestId = authoringState.editor?.saveRequestId ?? null;
  useEffect(() => {
    const editor = authoringStateRef.current.editor;
    const sessionId = stateRef.current.activeSessionId;
    if (
      saveRequestId === null ||
      editor === null ||
      editor.saveStatus !== "queued" ||
      editor.saveSnapshot === null ||
      sessionId === null ||
      !dispatchAuthoringAccepted({
        type: "saveStarted",
        requestId: saveRequestId,
      })
    ) {
      return;
    }
    void gateway
      .saveDocumentDraft({
        sessionId,
        requestId: saveRequestId,
        changeId: editor.document.changeId,
        documentId: editor.document.documentId,
        path: editor.document.path,
        expectedHash: editor.contentHash,
        markdown: editor.saveSnapshot,
      })
      .then(
        (response) => {
          void queryClient.invalidateQueries({
            queryKey: documentsKeys.session(sessionId),
          });
          dispatchAuthoringAccepted({
            type: "saveSucceeded",
            requestId: saveRequestId,
            response,
          });
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "saveFailed",
            requestId: saveRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [dispatchAuthoringAccepted, gateway, queryClient, saveRequestId]);

  const flushCurrentEditor = useCallback(async (): Promise<boolean> => {
    const editor = authoringStateRef.current.editor;
    if (editor === null || editor.saveStatus === "saved") return true;
    if (editor.saveStatus === "dirty") {
      dispatchAuthoringAccepted({
        type: "saveQueued",
        requestId: createId(),
        markdown: editor.markdown,
      });
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const status = authoringStateRef.current.editor?.saveStatus;
      if (status === undefined || status === "saved") return true;
      if (status === "error" || status === "conflict") return false;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    return false;
  }, [createId, dispatchAuthoringAccepted]);

  const showDocumentsHome = useCallback(() => {
    void (async () => {
      const sessionId = stateRef.current.activeSessionId;
      if (sessionId === null || !(await flushCurrentEditor())) return;
      setPreferredViewPreference(null);
      dispatchAuthoringAccepted({ type: "editorCloseRequested" });
      dispatchAccepted({ type: "documentsHomeRequested", sessionId });
    })();
  }, [dispatchAccepted, dispatchAuthoringAccepted, flushCurrentEditor]);

  useEffect(() => {
    if (!registerBeforeWorkspaceSwitch) return;
    return registerBeforeWorkspaceSwitch(async () => {
      if (!(await flushCurrentEditor())) {
        return false;
      }
      dispatchAuthoringAccepted({ type: "editorCloseRequested" });
      return true;
    });
  }, [
    dispatchAuthoringAccepted,
    flushCurrentEditor,
    registerBeforeWorkspaceSwitch,
  ]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (!("__TAURI_INTERNALS__" in window) || !active) return;
        const appWindow = getCurrentWindow();
        const registered = await appWindow.onCloseRequested(async (event) => {
          const status = authoringStateRef.current.editor?.saveStatus;
          if (!status || status === "saved") return;
          event.preventDefault();
          if (await flushCurrentEditor()) await appWindow.destroy();
        });
        if (active) unlisten = registered;
        else registered();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [flushCurrentEditor]);

  const templateCopyRequestId = authoringState.templateCopy.requestId;
  const templateCopyStatus = authoringState.templateCopy.status;
  useEffect(() => {
    const sessionId = stateRef.current.activeSessionId;
    const input = authoringStateRef.current.templateCopy.input;
    if (
      sessionId === null ||
      input === null ||
      templateCopyRequestId === null ||
      templateCopyStatus !== "queued" ||
      !dispatchAuthoringAccepted({
        type: "templateCopyStarted",
        requestId: templateCopyRequestId,
      })
    ) {
      return;
    }
    void gateway
      .duplicateTeamTemplate({
        sessionId,
        requestId: templateCopyRequestId,
        ...input,
      })
      .then(
        (response) => {
          if (
            dispatchAuthoringAccepted({
              type: "templateCopySucceeded",
              requestId: templateCopyRequestId,
              response,
            })
          ) {
            setSessionAttempt((attempt) => attempt + 1);
          }
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "templateCopyFailed",
            requestId: templateCopyRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [
    dispatchAuthoringAccepted,
    gateway,
    templateCopyRequestId,
    templateCopyStatus,
  ]);

  const draftSwitchRequestId = authoringState.draftSwitch.requestId;
  const draftSwitchStatus = authoringState.draftSwitch.status;
  useEffect(() => {
    const sessionId = stateRef.current.activeSessionId;
    const changeId = authoringStateRef.current.draftSwitch.changeId;
    if (
      sessionId === null ||
      draftSwitchRequestId === null ||
      draftSwitchStatus !== "queued" ||
      !dispatchAuthoringAccepted({
        type: "draftSwitchStarted",
        requestId: draftSwitchRequestId,
      })
    ) {
      return;
    }
    void gateway
      .switchLocalDocumentDraft(sessionId, draftSwitchRequestId, changeId)
      .then(
        (response) => {
          if (
            response.requestId === draftSwitchRequestId &&
            dispatchAuthoringAccepted({
              type: "draftSwitchSucceeded",
              requestId: draftSwitchRequestId,
              changeId: response.draft?.changeId ?? null,
            })
          ) {
            setSessionAttempt((attempt) => attempt + 1);
          }
        },
        (error) => {
          dispatchAuthoringAccepted({
            type: "draftSwitchFailed",
            requestId: draftSwitchRequestId,
            error: asDocumentError(error),
          });
        },
      );
  }, [
    dispatchAuthoringAccepted,
    draftSwitchRequestId,
    draftSwitchStatus,
    gateway,
  ]);

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
    void queryClient
      .fetchQuery({
        queryKey: documentsKeys.search(sessionId, query),
        queryFn: () =>
          gateway.searchDocuments(
            sessionId,
            activeSearchRequestId,
            query,
            DOCUMENT_SEARCH_LIMIT,
          ),
      })
      .then(
        (response) => {
          // A cache hit returns the earlier request's correlation ids, so
          // re-correlate the items to the request that is still loading.
          const recorrelated = {
            ...response,
            sessionId,
            requestId: activeSearchRequestId,
          };
          if (active) dispatchAccepted({ type: "searchSucceeded", response: recorrelated });
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
  }, [activeSearchRequestId, dispatchAccepted, gateway, queryClient]);

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
    const locator =
      request.kind === "current"
        ? request.path
        : `${request.commitOid}:${request.pathAtCommit}`;
    void queryClient
      .fetchQuery({
        queryKey: documentsKeys.read(
          request.sessionId,
          request.kind,
          locator,
        ),
        queryFn: () =>
          request.kind === "current"
            ? gateway.readDocument(
                request.sessionId,
                request.requestId,
                request.path,
              )
            : gateway.readDocumentVersion(
                request.sessionId,
                request.requestId,
                request.commitOid,
                request.pathAtCommit,
              ),
      })
      .then(
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
  }, [activeReadRequestId, dispatchAccepted, gateway, queryClient]);

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
    void queryClient
      .fetchQuery({
        queryKey: documentsKeys.history(
          request.sessionId,
          request.path,
          request.cursor,
        ),
        queryFn: () =>
          gateway.listDocumentHistory(
            request.sessionId,
            request.path,
            request.cursor,
          ),
      })
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
  }, [activeHistoryRequestId, dispatchAccepted, gateway, queryClient]);

  const setSearchQuery = useCallback(
    (query: string) => {
      dispatchAccepted({ type: "searchQueryChanged", query });
    },
    [dispatchAccepted],
  );

  const retrySearch = useCallback(() => {
    const current = stateRef.current;
    if (
      current.status !== "ready" ||
      current.activeSessionId === null ||
      current.searchQuery.trim() === ""
    ) {
      return;
    }
    dispatchAccepted({
      type: "searchStarted",
      sessionId: current.activeSessionId,
      requestId: createId(),
      query: current.searchQuery,
    });
  }, [createId, dispatchAccepted]);

  const selectDocument = useCallback(
    (
      path: string,
      searchMatch?: Pick<SearchResult, "matchField" | "matchText">,
      nextPreferredViewMode?: "html" | "markdown",
    ) => {
      const sessionId = stateRef.current.activeSessionId;
      if (sessionId === null) return;
      const basePath = normalizeDocumentPath(path);
      if (!basePath) return;
      const isHtmlPath = /\.html$/i.test(basePath);
      const normalizedPath = isHtmlPath
        ? basePath.replace(/\.html$/i, ".md")
        : basePath;
      const resolvedViewMode =
        nextPreferredViewMode ?? (isHtmlPath ? "html" : null);
      void (async () => {
        if (!(await flushCurrentEditor()) || stateRef.current.activeSessionId !== sessionId) return;
        // view 파라미터(또는 .html 경로)가 없는 일반 선택에서는 이전 선호값을 물려받지 않도록 null로 초기화한다.
        setPreferredViewPreference(
          resolvedViewMode
            ? {
                path: normalizedPath,
                mode: resolvedViewMode,
              }
            : null,
        );
        dispatchAuthoringAccepted({ type: "editorCloseRequested" });
        dispatchAccepted({
          type: "documentSelectionRequested",
          sessionId,
          requestId: createId(),
          path: normalizedPath,
          searchMatch,
        });
      })();
    },
    [createId, dispatchAccepted, dispatchAuthoringAccepted, flushCurrentEditor],
  );

  const retrySession = useCallback(() => {
    setPreferredViewPreference(null);
    setSessionAttempt((attempt) => attempt + 1);
  }, []);

  const resetForWorkspaceSwitch = useCallback(() => {
    setPreferredViewPreference(null);
    setOpenTabs([]);
    setNavHistory({ entries: [null], index: 0 });
    skipNextHistoryPushRef.current = false;
    dispatchAuthoringAccepted({ type: "workspaceAuthoringReset" });
    dispatchAccepted({ type: "searchQueryChanged", query: "" });
    pendingWorkspaceResetRef.current = true;
    setSessionAttempt((attempt) => attempt + 1);
  }, [dispatchAccepted, dispatchAuthoringAccepted]);

  const titleByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const summary of state.catalog.documents) {
      map.set(normalizeDocumentPath(summary.path).toLowerCase(), summary.title);
    }
    if (state.selectedDocument) {
      map.set(
        normalizeDocumentPath(state.selectedDocument.summary.path).toLowerCase(),
        state.selectedDocument.summary.title,
      );
    }
    return map;
  }, [state.catalog.documents, state.selectedDocument]);

  useEffect(() => {
    const normalizedSelected = state.selectedPath
      ? normalizeDocumentPath(state.selectedPath)
      : null;

    setOpenTabs((currentTabs) => {
      const catalogSet =
        state.catalog.documents.length > 0
          ? new Set(
              state.catalog.documents.map((doc) =>
                normalizeDocumentPath(doc.path).toLowerCase(),
              ),
            )
          : null;

      let next = currentTabs
        .filter((tab) => {
          const key = normalizeDocumentPath(tab.path).toLowerCase();
          if (normalizedSelected && key === normalizedSelected.toLowerCase()) {
            return true;
          }
          return !catalogSet || catalogSet.has(key);
        })
        .map((tab) => {
          const key = normalizeDocumentPath(tab.path).toLowerCase();
          const refreshedTitle = titleByPath.get(key);
          return refreshedTitle && refreshedTitle !== tab.title
            ? { ...tab, title: refreshedTitle }
            : tab;
        });

      if (normalizedSelected) {
        const selectedKey = normalizedSelected.toLowerCase();
        const existingIdx = next.findIndex(
          (tab) => normalizeDocumentPath(tab.path).toLowerCase() === selectedKey,
        );
        const resolvedTitle =
          titleByPath.get(selectedKey) ??
          (normalizedSelected.split("/").pop()?.replace(/\.md$/i, "") ||
            normalizedSelected);
        if (existingIdx === -1) {
          if (next.length >= 12) {
            next = next.slice(next.length - 11);
          }
          next = [...next, { path: normalizedSelected, title: resolvedTitle }];
        } else if (next[existingIdx]!.title !== resolvedTitle) {
          next = next.map((tab, idx) =>
            idx === existingIdx ? { ...tab, title: resolvedTitle } : tab,
          );
        }
      }

      if (
        next.length === currentTabs.length &&
        next.every(
          (tab, idx) =>
            tab.path === currentTabs[idx]?.path &&
            tab.title === currentTabs[idx]?.title,
        )
      ) {
        return currentTabs;
      }
      return next;
    });

    if (state.status !== "ready") {
      return;
    }

    setNavHistory((current) => {
      const currentTarget = current.entries[current.index] ?? null;
      const sameTarget =
        (currentTarget === null && normalizedSelected === null) ||
        (currentTarget !== null &&
          normalizedSelected !== null &&
          currentTarget.toLowerCase() === normalizedSelected.toLowerCase());
      if (sameTarget) {
        // 뒤/앞 이동은 index를 먼저 옮기므로 여기서 sameTarget이 된다. 스킵 플래그를 함께 해제하지 않으면
        // 다음 일반 문서 이동이 히스토리에 기록되지 않는다.
        skipNextHistoryPushRef.current = false;
        return current;
      }
      if (skipNextHistoryPushRef.current) {
        skipNextHistoryPushRef.current = false;
        return current;
      }
      const nextEntries = [
        ...current.entries.slice(0, current.index + 1),
        normalizedSelected,
      ].slice(-30);
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
      };
    });
  }, [state.catalog.documents, state.selectedPath, state.status, titleByPath]);

  const closeDocumentTab = useCallback(
    (rawPath: string) => {
      const targetKey = normalizeDocumentPath(rawPath).toLowerCase();
      if (!targetKey) return;
      const currentTabs = openTabsRef.current;
      const closeIndex = currentTabs.findIndex(
        (tab) => normalizeDocumentPath(tab.path).toLowerCase() === targetKey,
      );
      if (closeIndex === -1) return;
      const remaining = currentTabs.filter((_, idx) => idx !== closeIndex);
      setOpenTabs(remaining);

      const activeKey = stateRef.current.selectedPath
        ? normalizeDocumentPath(stateRef.current.selectedPath).toLowerCase()
        : null;
      if (activeKey === targetKey) {
        const fallbackTab =
          remaining[closeIndex] ?? remaining[closeIndex - 1] ?? null;
        if (fallbackTab) {
          selectDocument(fallbackTab.path);
        } else {
          showDocumentsHome();
        }
      }
    },
    [selectDocument, showDocumentsHome],
  );

  const canGoBackDocument = navHistory.index > 0;
  const canGoForwardDocument = navHistory.index < navHistory.entries.length - 1;

  const goBackDocument = useCallback(() => {
    const current = navHistoryRef.current;
    if (current.index <= 0) return;
    const nextIndex = current.index - 1;
    const target = current.entries[nextIndex] ?? null;
    skipNextHistoryPushRef.current = true;
    // Advance the ref synchronously so a second click before re-render moves one more step.
    const next = { ...current, index: nextIndex };
    navHistoryRef.current = next;
    setNavHistory(next);
    if (target === null) {
      showDocumentsHome();
    } else {
      selectDocument(target);
    }
  }, [selectDocument, showDocumentsHome]);

  const goForwardDocument = useCallback(() => {
    const current = navHistoryRef.current;
    if (current.index >= current.entries.length - 1) return;
    const nextIndex = current.index + 1;
    const target = current.entries[nextIndex] ?? null;
    skipNextHistoryPushRef.current = true;
    const next = { ...current, index: nextIndex };
    navHistoryRef.current = next;
    setNavHistory(next);
    if (target === null) {
      showDocumentsHome();
    } else {
      selectDocument(target);
    }
  }, [selectDocument, showDocumentsHome]);

  const openDocumentInNewWindow = useCallback(
    async (
      rawPath: string,
      viewMode?: "html" | "markdown",
      title?: string,
    ) => {
      const normalized = normalizeDocumentPath(rawPath).replace(/\.html$/i, ".md");
      if (!normalized) return;
      const resolvedTitle =
        title ??
        titleByPath.get(normalized.toLowerCase()) ??
        normalized.split("/").pop()?.replace(/\.md$/i, "") ??
        normalized;
      if (gateway.openDocumentWindow) {
        try {
          await gateway.openDocumentWindow(
            normalized,
            viewMode,
            resolvedTitle,
            stateRef.current.workspaceId,
          );
          return;
        } catch (error) {
          throw asDocumentError(error);
        }
      }
      if (typeof window !== "undefined") {
        const params = new URLSearchParams({ doc: normalized });
        const workspaceId = stateRef.current.workspaceId;
        if (workspaceId) params.set("workspaceId", workspaceId);
        if (viewMode) params.set("view", viewMode);
        window.open(
          `#/doc-window?${params.toString()}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
    },
    [gateway, titleByPath],
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
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.session(sessionId),
      });
    } catch (error) {
      dispatchAccepted({
        type: "sessionOperationFailed",
        sessionId,
        error: asDocumentError(error),
      });
    }
  }, [dispatchAccepted, gateway, queryClient]);

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

  const readDocumentPreview = useCallback(
    async (path: string): Promise<DocumentContent> => {
      const normalized = normalizeDocumentPath(path).replace(/\.html$/i, ".md");
      if (!normalized) throw fallbackDocumentError();
      try {
        if (gateway.readStandaloneDocument) {
          const payload = await gateway.readStandaloneDocument(
            stateRef.current.workspaceId,
            normalized,
          );
          return payload.document;
        }
        const sessionId = stateRef.current.activeSessionId;
        if (sessionId === null) throw fallbackDocumentError();
        return await gateway.readDocument(sessionId, createId(), normalized);
      } catch (error) {
        throw asDocumentError(error);
      }
    },
    [createId, gateway],
  );

  const readPreviewAsset = useCallback(
    async (documentPath: string, assetPath: string): Promise<DocumentAsset> => {
      try {
        if (gateway.readStandaloneDocumentAsset) {
          return await gateway.readStandaloneDocumentAsset(
            stateRef.current.workspaceId,
            documentPath,
            assetPath,
          );
        }
        return await readAsset(documentPath, assetPath);
      } catch (error) {
        throw asDocumentError(error);
      }
    },
    [gateway, readAsset],
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

  const openNewDocument = useCallback(
    (folder = "docs") => {
      dispatchAuthoringAccepted({ type: "dialogOpened", folder });
    },
    [dispatchAuthoringAccepted],
  );

  const closeNewDocument = useCallback(() => {
    dispatchAuthoringAccepted({ type: "dialogClosed" });
  }, [dispatchAuthoringAccepted]);

  const createNewDocument = useCallback(
    (input: DocumentCreationInput) => {
      void (async () => {
        if (!(await flushCurrentEditor())) return;
        dispatchAuthoringAccepted({
          type: "creationRequested",
          requestId: createId(),
          input,
        });
      })();
    },
    [createId, dispatchAuthoringAccepted, flushCurrentEditor],
  );

  const editSelectedDocument = useCallback(() => {
    const current = stateRef.current;
    if (current.selectedDocument === null || current.selectedVersion !== null) {
      return;
    }
    const docPath = current.selectedDocument.summary.path;
    const baseline = current.selectedDocument.markdown;
    setEditorBaselines((prev) => ({ ...prev, [docPath]: baseline }));
    dispatchAuthoringAccepted({
      type: "existingEditRequested",
      requestId: createId(),
      path: docPath,
      title: current.selectedDocument.summary.title,
    });
  }, [createId, dispatchAuthoringAccepted]);

  const useSuggestedFileName = useCallback(() => {
    const creation = authoringStateRef.current.creation;
    const suggested = creation.validation?.suggestedFileName;
    const input = creation.input;
    if (!input || !suggested) return;
    void (async () => {
      if (!(await flushCurrentEditor())) return;
      dispatchAuthoringAccepted({
        type: "creationRequested",
        requestId: createId(),
        input: { ...input, fileName: suggested },
      });
    })();
  }, [createId, dispatchAuthoringAccepted, flushCurrentEditor]);

  const updateDraftMarkdown = useCallback(
    (markdown: string) => {
      dispatchAuthoringAccepted({ type: "editorChanged", markdown });
    },
    [dispatchAuthoringAccepted],
  );

  const setDraftEditorMode = useCallback(
    (mode: "rich" | "source") => {
      void (async () => {
        if (await flushCurrentEditor()) {
          dispatchAuthoringAccepted({ type: "editorModeChanged", mode });
        }
      })();
    },
    [dispatchAuthoringAccepted, flushCurrentEditor],
  );

  const acceptDiskConflict = useCallback(() => {
    dispatchAuthoringAccepted({ type: "conflictDiskAccepted" });
  }, [dispatchAuthoringAccepted]);

  const acceptHubConflict = useCallback(() => {
    dispatchAuthoringAccepted({ type: "conflictHubAccepted" });
  }, [dispatchAuthoringAccepted]);

  const startConflictMerge = useCallback(() => {
    dispatchAuthoringAccepted({ type: "conflictMergeStarted" });
  }, [dispatchAuthoringAccepted]);

  const closeDraftEditor = useCallback(() => {
    const editor = authoringStateRef.current.editor;
    if (editor?.saveStatus === "dirty") {
      dispatchAuthoringAccepted({
        type: "saveQueued",
        requestId: createId(),
        markdown: editor.markdown,
      });
    }
    dispatchAuthoringAccepted({ type: "editorCloseRequested" });
  }, [createId, dispatchAuthoringAccepted]);

  const duplicateTeamTemplate = useCallback(
    (input: TeamTemplateCopyInput) => {
      void (async () => {
        if (!(await flushCurrentEditor())) return;
        dispatchAuthoringAccepted({
          type: "templateCopyRequested",
          requestId: createId(),
          input,
        });
      })();
    },
    [createId, dispatchAuthoringAccepted, flushCurrentEditor],
  );

  const switchDraft = useCallback(
    (changeId: string | null) => {
      void (async () => {
        if (!(await flushCurrentEditor())) return;
        dispatchAuthoringAccepted({
          type: "draftSwitchRequested",
          requestId: createId(),
          changeId,
        });
      })();
    },
    [createId, dispatchAuthoringAccepted, flushCurrentEditor],
  );

  const listDocsPullRequests = useCallback(async () => {
    const sessionId = stateRef.current.activeSessionId;
    if (!sessionId) return [];
    return gateway.listDocsPullRequests(sessionId);
  }, [gateway]);

  const getDocsPullRequestDetail = useCallback(
    async (number: number) => {
      const sessionId = stateRef.current.activeSessionId;
      if (!sessionId) {
        throw fallbackDocumentError();
      }
      return gateway.getDocsPullRequestDetail(sessionId, number);
    },
    [gateway],
  );

  const publishDocumentDraft = useCallback(
    async (input: {
      intent: "review" | "publish";
      message: string;
      reviewNote: string;
    }) => {
      const sessionId = stateRef.current.activeSessionId;
      if (!sessionId) {
        throw fallbackDocumentError();
      }
      if (!(await flushCurrentEditor())) {
        throw fallbackDocumentError();
      }
      const response = await gateway.publishDocumentDraft({
        sessionId,
        intent: input.intent,
        message: input.message,
        reviewNote: input.reviewNote,
      });
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.pullRequests(sessionId),
      });
      if (response.merged) {
        dispatchAuthoringAccepted({ type: "editorCloseRequested" });
        setSessionAttempt((attempt) => attempt + 1);
      }
      return response;
    },
    [dispatchAuthoringAccepted, flushCurrentEditor, gateway, queryClient],
  );

  const approveAndMergeDocsPullRequest = useCallback(
    async (number: number, comment?: string) => {
      const sessionId = stateRef.current.activeSessionId;
      if (!sessionId) {
        throw fallbackDocumentError();
      }
      const response = await gateway.approveAndMergeDocsPullRequest(
        sessionId,
        number,
        comment,
      );
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.pullRequests(sessionId),
      });
      await refresh();
      return response;
    },
    [gateway, queryClient, refresh],
  );

  const editorBaselineMarkdown = useMemo(() => {
    const activePath = authoringState.editor?.document.path;
    if (!activePath) return undefined;
    if (Object.prototype.hasOwnProperty.call(editorBaselines, activePath)) {
      return editorBaselines[activePath];
    }
    return null;
  }, [authoringState.editor?.document.path, editorBaselines]);

  const value = useMemo<DocumentsContextValue>(
    () => ({
      state,
      authoringState,
      openTabs,
      canGoBackDocument,
      canGoForwardDocument,
      preferredViewMode,
      preferredViewTargetPath,
      clearPreferredViewMode,
      closeDocumentTab,
      goBackDocument,
      goForwardDocument,
      openDocumentInNewWindow,
      setSearchQuery,
      retrySearch,
      selectDocument,
      showDocumentsHome,
      retrySession,
      resetForWorkspaceSwitch,
      selectCurrentVersion,
      selectDocumentVersion,
      loadHistory,
      loadMoreHistory,
      refresh,
      readAsset,
      readDocumentPreview,
      readPreviewAsset,
      copyText,
      openExternal,
      clearRecoverableError,
      openNewDocument,
      closeNewDocument,
      createNewDocument,
      editSelectedDocument,
      useSuggestedFileName,
      updateDraftMarkdown,
      setDraftEditorMode,
      acceptDiskConflict,
      acceptHubConflict,
      startConflictMerge,
      closeDraftEditor,
      duplicateTeamTemplate,
      switchDraft,
      listDocsPullRequests,
      getDocsPullRequestDetail,
      editorBaselineMarkdown,
      publishDocumentDraft,
      approveAndMergeDocsPullRequest,
    }),
    [
      acceptDiskConflict,
      acceptHubConflict,
      approveAndMergeDocsPullRequest,
      authoringState,
      canGoBackDocument,
      canGoForwardDocument,
      clearPreferredViewMode,
      clearRecoverableError,
      closeDocumentTab,
      closeDraftEditor,
      closeNewDocument,
      createNewDocument,
      editSelectedDocument,
      editorBaselineMarkdown,
      copyText,
      duplicateTeamTemplate,
      getDocsPullRequestDetail,
      goBackDocument,
      goForwardDocument,
      listDocsPullRequests,
      loadHistory,
      loadMoreHistory,
      openDocumentInNewWindow,
      openExternal,
      openTabs,
      preferredViewMode,
      preferredViewTargetPath,
      publishDocumentDraft,
      readAsset,
      readDocumentPreview,
      readPreviewAsset,
      refresh,
      selectCurrentVersion,
      selectDocument,
      selectDocumentVersion,
      setSearchQuery,
      retrySearch,
      showDocumentsHome,
      switchDraft,
      retrySession,
      resetForWorkspaceSwitch,
      state,
      startConflictMerge,
      openNewDocument,
      setDraftEditorMode,
      updateDraftMarkdown,
      useSuggestedFileName,
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

export function useOptionalDocuments(): DocumentsContextValue | null {
  return useContext(DocumentsContext);
}
