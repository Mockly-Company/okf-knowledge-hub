import { describe, expect, it } from "vitest";
import type {
  AppError,
  DocumentCatalog,
  DocumentContent,
  DocumentEvent,
  DocumentEventEnvelope,
  DocumentSessionSnapshot,
  IndexStatus,
} from "./model";
import {
  createInitialDocumentsState,
  documentsReducer,
} from "./documents-reducer";

const SESSION_ID = "4b20eda7-09a0-46f9-bd3b-4de83d4b0157";
const OLD_SESSION_ID = "8631e51a-cdb2-4f39-968b-5c3196cac61a";

const EMPTY_CATALOG: DocumentCatalog = { documents: [], roots: [] };

const GUIDE_SUMMARY = {
  path: "docs/guide.md",
  fileName: "guide.md",
  title: "Guide",
  documentId: "39d2bfb7-2e0d-4b4b-ab5d-7663d5cc3389",
  frontmatterStatus: { status: "valid" as const },
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 120,
};

const GUIDE_CATALOG: DocumentCatalog = {
  documents: [GUIDE_SUMMARY],
  roots: [{ kind: "document", summary: GUIDE_SUMMARY }],
};

const API_SUMMARY = {
  path: "docs/api.md",
  fileName: "api.md",
  title: "API",
  documentId: "19f97549-7497-4042-9ad7-6116613e79b7",
  frontmatterStatus: { status: "valid" as const },
  modifiedAtUnixMs: 1_722_000_000_000,
  size: 240,
};

const API_CATALOG: DocumentCatalog = {
  documents: [API_SUMMARY],
  roots: [{ kind: "document", summary: API_SUMMARY }],
};

const INDEX_READY: IndexStatus = { status: "ready" };

const RECOVERABLE_ERROR: AppError = {
  code: "document_index_unavailable",
  message: "문서 인덱스를 다시 동기화했습니다.",
  recovery: "retry",
  details: {},
};

function sessionStarting() {
  return documentsReducer(createInitialDocumentsState(), {
    type: "sessionStarting",
    sessionId: SESSION_ID,
  });
}

function event(
  revision: number,
  value: DocumentEvent,
): DocumentEventEnvelope {
  return { revision, ...value } as DocumentEventEnvelope;
}

function startSnapshot(
  overrides: Partial<DocumentSessionSnapshot> = {},
): DocumentSessionSnapshot {
  return {
    sessionId: SESSION_ID,
    revision: 0,
    workspaceId: "7f1b80e0-1f4b-4c10-9bc0-bb085f0e7f67",
    repositoryFullName: "okf/example-knowledge",
    branch: "main",
    catalog: GUIDE_CATALOG,
    indexStatus: INDEX_READY,
    lastOpenedPath: "docs/guide.md",
    ...overrides,
  };
}

describe("documentsReducer", () => {
  it("applies the revision-zero start snapshot before any event", () => {
    const state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot(),
    });

    expect(state.status).toBe("ready");
    expect(state.latestRevision).toBe(0);
    expect(state.catalog).toBe(GUIDE_CATALOG);
    expect(state.indexStatus).toBe(INDEX_READY);
    expect(state.lastOpenedPath).toBe("docs/guide.md");
    expect(state.selectedPath).toBe("docs/guide.md");
    expect(state.activeReadRequest).toMatchObject({
      requestId: `session:${SESSION_ID}:0`,
      kind: "current",
      path: "docs/guide.md",
      status: "queued",
    });
  });

  it("returns the identical state for an older session or lower/equal event revision", () => {
    const active = documentsReducer(sessionStarting(), {
      type: "documentEventReceived",
      event: event(7, {
        type: "tree_changed",
        sessionId: SESSION_ID,
        catalog: GUIDE_CATALOG,
      }),
    });

    const oldSession = documentsReducer(active, {
      type: "documentEventReceived",
      event: event(8, {
        type: "tree_changed",
        sessionId: OLD_SESSION_ID,
        catalog: API_CATALOG,
      }),
    });
    const lowerRevision = documentsReducer(active, {
      type: "documentEventReceived",
      event: event(6, {
        type: "tree_changed",
        sessionId: SESSION_ID,
        catalog: API_CATALOG,
      }),
    });
    const equalRevision = documentsReducer(active, {
      type: "documentEventReceived",
      event: event(7, {
        type: "index_status_changed",
        sessionId: SESSION_ID,
        status: { status: "degraded", message: "stale" },
      }),
    });

    expect(oldSession).toBe(active);
    expect(lowerRevision).toBe(active);
    expect(equalRevision).toBe(active);
  });

  it("merges start metadata without overwriting newer pre-result event state", () => {
    const eventCatalog = API_CATALOG;
    const eventIndex: IndexStatus = {
      status: "preparing",
      indexed: 3,
      total: 7,
    };
    const beforeResult = documentsReducer(sessionStarting(), {
      type: "documentEventReceived",
      event: event(4, {
        type: "resynced",
        sessionId: SESSION_ID,
        barrierId: "15bca508-eede-4dd2-96cb-b836f37ba97b",
        snapshot: {
          sessionId: SESSION_ID,
          catalog: eventCatalog,
          indexStatus: eventIndex,
          lastOpenedPath: "docs/api.md",
        },
      }),
    });

    const afterResult = documentsReducer(beforeResult, {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot({
        catalog: GUIDE_CATALOG,
        indexStatus: INDEX_READY,
        lastOpenedPath: "docs/guide.md",
      }),
    });

    expect(afterResult.status).toBe("ready");
    expect(afterResult.workspaceId).toBe(
      "7f1b80e0-1f4b-4c10-9bc0-bb085f0e7f67",
    );
    expect(afterResult.repositoryFullName).toBe("okf/example-knowledge");
    expect(afterResult.branch).toBe("main");
    expect(afterResult.latestRevision).toBe(4);
    expect(afterResult.catalog).toBe(eventCatalog);
    expect(afterResult.indexStatus).toBe(eventIndex);
    expect(afterResult.lastOpenedPath).toBe("docs/api.md");
    expect(afterResult.selectedPath).toBe("docs/api.md");
  });

  it("atomically replaces authoritative tree, index, and open state on resync", () => {
    const failed = documentsReducer(sessionStarting(), {
      type: "documentEventReceived",
      event: event(9, {
        type: "failed",
        sessionId: SESSION_ID,
        error: RECOVERABLE_ERROR,
      }),
    });
    expect(failed.recoverableError).toBe(RECOVERABLE_ERROR);

    const resynced = documentsReducer(failed, {
      type: "documentEventReceived",
      event: event(10, {
        type: "resynced",
        sessionId: SESSION_ID,
        barrierId: "15bca508-eede-4dd2-96cb-b836f37ba97b",
        snapshot: {
          sessionId: SESSION_ID,
          catalog: API_CATALOG,
          indexStatus: INDEX_READY,
          lastOpenedPath: "docs/api.md",
        },
      }),
    });

    expect(resynced).toMatchObject({
      latestRevision: 10,
      catalog: API_CATALOG,
      indexStatus: INDEX_READY,
      lastOpenedPath: "docs/api.md",
      selectedPath: "docs/api.md",
      selectedVersion: null,
      recoverableError: null,
    });
    expect(resynced.activeReadRequest).toMatchObject({
      requestId: `event:${SESSION_ID}:10`,
      sessionId: SESSION_ID,
      kind: "current",
      path: "docs/api.md",
      status: "queued",
    });
  });

  it("returns the identical state for stale search results and errors", () => {
    let active = documentsReducer(sessionStarting(), {
      type: "searchQueryChanged",
      query: "new query",
    });
    active = documentsReducer(active, {
      type: "searchStarted",
      sessionId: SESSION_ID,
      requestId: "34e1764e-4278-41f8-bcf8-9f74ff6f66e0",
      query: "new query",
    });

    const oldSuccess = documentsReducer(active, {
      type: "searchSucceeded",
      response: {
        sessionId: SESSION_ID,
        requestId: "54bf90af-b193-4387-8618-ae168b775407",
        items: [
          {
            path: "docs/stale.md",
            title: "Stale",
            matchField: "body",
            matchText: "stale",
            snippet: "stale result",
          },
        ],
      },
    });
    const oldFailure = documentsReducer(active, {
      type: "searchFailed",
      sessionId: SESSION_ID,
      requestId: "54bf90af-b193-4387-8618-ae168b775407",
      error: RECOVERABLE_ERROR,
    });
    const oldSession = documentsReducer(active, {
      type: "searchFailed",
      sessionId: OLD_SESSION_ID,
      requestId: "34e1764e-4278-41f8-bcf8-9f74ff6f66e0",
      error: RECOVERABLE_ERROR,
    });

    expect(oldSuccess).toBe(active);
    expect(oldFailure).toBe(active);
    expect(oldSession).toBe(active);
  });

  it("rejects a document result after a newer selection owns the read", () => {
    let state = sessionStarting();
    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/guide.md",
    });
    const oldRequest = state.activeReadRequest!;
    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      path: "docs/api.md",
    });

    const staleContent: DocumentContent = {
      summary: GUIDE_SUMMARY,
      markdown: "# Guide",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    };
    const rejected = documentsReducer(state, {
      type: "documentReadSucceeded",
      request: oldRequest,
      content: staleContent,
    });

    expect(rejected).toBe(state);
  });

  it("keeps the search match that requested document navigation", () => {
    const state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/api.md",
      searchMatch: { matchField: "body", matchText: "응답 DTO" },
    });

    expect(state.selectedSearchMatch).toEqual({
      matchField: "body",
      matchText: "응답 DTO",
    });
  });

  it("preserves a search match when the matching open event arrives before the read", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/api.md",
      searchMatch: { matchField: "body", matchText: "응답 DTO" },
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/api.md",
      }),
    });

    expect(state.selectedSearchMatch).toEqual({
      matchField: "body",
      matchText: "응답 DTO",
    });
  });

  it("keeps the Documents home open when a canceled read emits a late open event", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/api.md",
    });
    state = documentsReducer(state, {
      type: "documentsHomeRequested",
      sessionId: SESSION_ID,
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/api.md",
      }),
    });

    expect(state.selectedPath).toBeNull();
    expect(state.documentsHomeRequested).toBe(true);
    expect(state.latestRevision).toBe(1);
  });

  it("opens the migrated path after a tree update provisionally removes the selected path", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot(),
    });
    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "tree_changed",
        sessionId: SESSION_ID,
        catalog: API_CATALOG,
      }),
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(2, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/api.md",
      }),
    });

    expect(state.selectedPath).toBe("docs/api.md");
    expect(state.documentsHomeRequested).toBe(false);
    expect(state.documentNotice).toBeNull();
    expect(state.activeReadRequest).toMatchObject({
      kind: "current",
      path: "docs/api.md",
      status: "queued",
    });
  });

  it("does not let a different-path open event override an intact newer selection", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot({
        catalog: {
          documents: [GUIDE_SUMMARY, API_SUMMARY],
          roots: [
            { kind: "document", summary: GUIDE_SUMMARY },
            { kind: "document", summary: API_SUMMARY },
          ],
        },
        lastOpenedPath: null,
      }),
    });
    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/guide.md",
    });
    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      path: "docs/api.md",
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/api.md",
      }),
    });
    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(2, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/guide.md",
      }),
    });

    expect(state.selectedPath).toBe("docs/api.md");
    expect(state.lastOpenedPath).toBe("docs/api.md");
    expect(state.activeReadRequest).toMatchObject({
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      path: "docs/api.md",
    });
  });

  it("adopts a migrated path from resync after provisional tree removal", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot(),
    });
    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "tree_changed",
        sessionId: SESSION_ID,
        catalog: API_CATALOG,
      }),
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(2, {
        type: "resynced",
        sessionId: SESSION_ID,
        barrierId: "54bf90af-b193-4387-8618-ae168b775407",
        snapshot: {
          sessionId: SESSION_ID,
          catalog: API_CATALOG,
          indexStatus: INDEX_READY,
          lastOpenedPath: "docs/api.md",
        },
      }),
    });

    expect(state.selectedPath).toBe("docs/api.md");
    expect(state.documentsHomeRequested).toBe(false);
    expect(state.activeReadRequest).toMatchObject({
      kind: "current",
      path: "docs/api.md",
      status: "queued",
    });
  });

  it("keeps explicit Documents home open across an authoritative resync", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot(),
    });
    state = documentsReducer(state, {
      type: "documentsHomeRequested",
      sessionId: SESSION_ID,
    });

    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "resynced",
        sessionId: SESSION_ID,
        barrierId: "54bf90af-b193-4387-8618-ae168b775407",
        snapshot: {
          sessionId: SESSION_ID,
          catalog: API_CATALOG,
          indexStatus: INDEX_READY,
          lastOpenedPath: "docs/api.md",
        },
      }),
    });

    expect(state.selectedPath).toBeNull();
    expect(state.documentsHomeRequested).toBe(true);
    expect(state.activeReadRequest).toBeNull();
  });

  it("owns history pages by the selected path and rejects a stale page after selection changes", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/guide.md",
    });
    state = documentsReducer(state, {
      type: "historyRequested",
      request: {
        requestId: "34e1764e-4278-41f8-bcf8-9f74ff6f66e0",
        sessionId: SESSION_ID,
        path: "docs/guide.md",
        cursor: null,
        append: false,
      },
    });
    const historyRequest = state.activeHistoryRequest!;
    expect(state).toMatchObject({ activeHistoryPath: "docs/guide.md" });

    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      path: "docs/api.md",
    });
    const rejected = documentsReducer(state, {
      type: "historySucceeded",
      request: historyRequest,
      page: {
        items: [
          {
            commitOid: "aabbccddeeff",
            shortOid: "aabbccd",
            pathAtCommit: "docs/guide.md",
            authorName: "Kim",
            authoredAtUnix: 1_721_000_000,
            message: "stale",
          },
        ],
        nextCursor: null,
      },
    });

    expect(rejected).toBe(state);
    expect(rejected.historyItems).toEqual([]);
  });

  it("returns home and clears a stale last-opened path when the accepted session has no such catalog document", () => {
    const state = documentsReducer(sessionStarting(), {
      type: "sessionStarted",
      sessionId: SESSION_ID,
      snapshot: startSnapshot({ lastOpenedPath: "docs/missing.md" }),
    });

    expect(state.selectedPath).toBeNull();
    expect(state.lastOpenedPath).toBeNull();
    expect(state.activeReadRequest).toBeNull();
  });

  it("clears a prior document notice when an unrelated selection or current-version read starts", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/guide.md",
    });
    state = documentsReducer(state, {
      type: "documentEventReceived",
      event: event(1, {
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/guide.md",
      }),
    });
    state = documentsReducer(state, {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      path: "docs/api.md",
    });
    expect(state.documentNotice).toBeNull();

    state = {
      ...state,
      documentNotice: "외부 변경사항을 반영했습니다.",
    };
    state = documentsReducer(state, {
      type: "currentVersionRequested",
      sessionId: SESSION_ID,
      requestId: "34e1764e-4278-41f8-bcf8-9f74ff6f66e0",
    });
    expect(state.documentNotice).toBeNull();
  });

  it("clears a prior document notice when a historical version read starts", () => {
    let state = documentsReducer(sessionStarting(), {
      type: "documentSelectionRequested",
      sessionId: SESSION_ID,
      requestId: "a0989d32-3ca8-494e-aece-7d7c22c92bc1",
      path: "docs/guide.md",
    });
    state = {
      ...state,
      documentNotice: "외부 변경사항을 반영했습니다.",
    };

    state = documentsReducer(state, {
      type: "documentVersionRequested",
      sessionId: SESSION_ID,
      requestId: "77c039b8-c07d-4fbe-b676-cf3ab0944233",
      version: {
        commitOid: "aabbccddeeff",
        pathAtCommit: "docs/guide.md",
      },
    });

    expect(state.documentNotice).toBeNull();
  });
});
