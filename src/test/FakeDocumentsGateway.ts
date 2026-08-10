import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import type {
  DocumentAsset,
  DocumentCatalog,
  DocumentContent,
  DocumentEventEnvelope,
  DocumentSearchResponse,
  DocumentSessionSnapshot,
  HistoryCursor,
  HistoryPage,
  SearchResult,
  Unlisten,
} from "@/features/documents/model";

const guideSummary = {
  path: "docs/guide.md",
  fileName: "guide.md",
  title: "Guide",
  documentId: "39d2bfb7-2e0d-4b4b-ab5d-7663d5cc3389",
  frontmatterStatus: { status: "valid" as const },
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 120,
};

const apiSummary = {
  path: "docs/api.md",
  fileName: "api.md",
  title: "API",
  documentId: "19f97549-7497-4042-9ad7-6116613e79b7",
  frontmatterStatus: { status: "valid" as const },
  modifiedAtUnixMs: 1_722_000_000_000,
  size: 240,
};

export class FakeDocumentsGateway implements DocumentsGateway {
  readonly guideCatalog: DocumentCatalog = {
    documents: [guideSummary],
    roots: [{ kind: "document", summary: guideSummary }],
  };
  readonly apiCatalog: DocumentCatalog = {
    documents: [apiSummary],
    roots: [{ kind: "document", summary: apiSummary }],
  };
  sessionSnapshot: DocumentSessionSnapshot = {
    sessionId: "4b20eda7-09a0-46f9-bd3b-4de83d4b0157",
    revision: 0,
    workspaceId: "7f1b80e0-1f4b-4c10-9bc0-bb085f0e7f67",
    repositoryFullName: "okf/example-knowledge",
    branch: "main",
    catalog: this.guideCatalog,
    indexStatus: { status: "ready" },
    lastOpenedPath: "docs/guide.md",
  };
  historyPage: HistoryPage = { items: [], nextCursor: null };
  searchResults: SearchResult[] = [];
  startError: unknown | null = null;
  asset: DocumentAsset = { kind: "svg", source: "<svg />" };
  deferSubscription = false;
  deferStart = false;
  deferSearch = false;
  eventBeforeStartResult:
    | ((sessionId: string) => DocumentEventEnvelope)
    | null = null;
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly copiedValues: string[] = [];
  readonly openedUrls: string[] = [];
  unlistenCount = 0;

  private readonly listeners = new Set<
    (event: DocumentEventEnvelope) => void
  >();
  private pendingSubscription:
    | {
        listener: (event: DocumentEventEnvelope) => void;
        resolve: (unlisten: Unlisten) => void;
      }
    | null = null;
  private pendingStart:
    | { requestId: string; resolve: (snapshot: DocumentSessionSnapshot) => void }
    | null = null;
  private readonly pendingSearches = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: DocumentSearchResponse) => void;
      reject: (error: unknown) => void;
    }
  >();
  private activeSessionId: string | null = null;
  private rememberedPath: string | null = null;
  private revision = 0;

  async startSession(requestId: string): Promise<DocumentSessionSnapshot> {
    this.record("startSession", requestId);
    if (this.startError) throw this.startError;
    this.activeSessionId = requestId;
    this.rememberedPath = this.sessionSnapshot.lastOpenedPath;
    this.revision = this.sessionSnapshot.revision;
    const event = this.eventBeforeStartResult?.(requestId);
    if (event) this.emit(event);
    if (this.deferStart) {
      return new Promise((resolve) => {
        this.pendingStart = { requestId, resolve };
      });
    }
    return { ...this.sessionSnapshot, sessionId: requestId };
  }

  async stopSession(sessionId: string): Promise<void> {
    this.record("stopSession", sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = null;
  }

  async refreshSession(sessionId: string): Promise<void> {
    this.record("refreshSession", sessionId);
  }

  async searchDocuments(
    sessionId: string,
    requestId: string,
    query: string,
    limit: number,
  ): Promise<DocumentSearchResponse> {
    this.record("searchDocuments", sessionId, requestId, query, limit);
    if (this.deferSearch) {
      return new Promise((resolve, reject) => {
        this.pendingSearches.set(requestId, { sessionId, resolve, reject });
      });
    }
    return { sessionId, requestId, items: this.searchResults };
  }

  async readDocument(sessionId: string, path: string): Promise<DocumentContent> {
    this.record("readDocument", sessionId, path);
    const summary = path === apiSummary.path ? apiSummary : guideSummary;
    const content = {
      summary: { ...summary, path },
      markdown: `# ${summary.title}`,
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    };
    if (this.activeSessionId === sessionId && this.rememberedPath !== path) {
      this.rememberedPath = path;
      this.emit({
        revision: ++this.revision,
        type: "open_document_changed",
        sessionId,
        path,
      });
    }
    return content;
  }

  async readDocumentAsset(
    sessionId: string,
    documentPath: string,
    assetPath: string,
  ): Promise<DocumentAsset> {
    this.record("readDocumentAsset", sessionId, documentPath, assetPath);
    return this.asset;
  }

  async listDocumentHistory(
    sessionId: string,
    path: string,
    cursor: HistoryCursor | null,
  ): Promise<HistoryPage> {
    this.record("listDocumentHistory", sessionId, path, cursor);
    return this.historyPage;
  }

  async readDocumentVersion(
    sessionId: string,
    commitOid: string,
    pathAtCommit: string,
  ): Promise<DocumentContent> {
    this.record("readDocumentVersion", sessionId, commitOid, pathAtCommit);
    return {
      summary: { ...guideSummary, path: pathAtCommit },
      markdown: "# Historical Guide",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    };
  }

  onDocumentEvent(
    listener: (event: DocumentEventEnvelope) => void,
  ): Promise<Unlisten> {
    this.record("onDocumentEvent");
    if (this.deferSubscription) {
      return new Promise((resolve) => {
        this.pendingSubscription = { listener, resolve };
      });
    }
    this.listeners.add(listener);
    return Promise.resolve(this.unlisten(listener));
  }

  async copyText(value: string): Promise<void> {
    this.record("copyText", value);
    this.copiedValues.push(value);
  }

  async openExternal(url: string): Promise<void> {
    this.record("openExternal", url);
    this.openedUrls.push(url);
  }

  completeSubscription(): void {
    const pending = this.pendingSubscription;
    if (!pending) throw new Error("no deferred document subscription");
    this.pendingSubscription = null;
    this.listeners.add(pending.listener);
    pending.resolve(this.unlisten(pending.listener));
  }

  resolveStart(snapshot: DocumentSessionSnapshot = this.sessionSnapshot): void {
    const pending = this.pendingStart;
    if (!pending) throw new Error("no deferred document start");
    this.pendingStart = null;
    pending.resolve({ ...snapshot, sessionId: pending.requestId });
  }

  resolveSearch(requestId: string, items: SearchResult[]): void {
    const pending = this.pendingSearches.get(requestId);
    if (!pending) throw new Error(`no deferred search ${requestId}`);
    this.pendingSearches.delete(requestId);
    pending.resolve({ sessionId: pending.sessionId, requestId, items });
  }

  rejectSearch(requestId: string, error: unknown): void {
    const pending = this.pendingSearches.get(requestId);
    if (!pending) throw new Error(`no deferred search ${requestId}`);
    this.pendingSearches.delete(requestId);
    pending.reject(error);
  }

  emit(event: DocumentEventEnvelope): void {
    if (event.sessionId === this.activeSessionId) {
      this.revision = Math.max(this.revision, event.revision);
      if (event.type === "open_document_changed") {
        this.rememberedPath = event.path;
      }
    }
    for (const listener of this.listeners) listener(event);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  private unlisten(listener: (event: DocumentEventEnvelope) => void): Unlisten {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unlistenCount += 1;
      this.listeners.delete(listener);
    };
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
