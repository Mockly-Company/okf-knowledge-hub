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
  CreateDocumentDraftRequest,
  CreateDocumentDraftResponse,
  EditExistingDocumentDraftRequest,
  DuplicateTeamTemplateRequest,
  DuplicateTeamTemplateResponse,
  DocumentTargetValidation,
  DocumentTemplateCatalog,
  DraftSummary,
  SaveDocumentDraftRequest,
  SaveDocumentDraftResponse,
  SwitchLocalDocumentDraftResponse,
  RecoveredDocument,
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
  private readonly createdPaths = new Set<string>();
  private documentTarget(folder: string, fileName: string): DocumentTargetValidation {
    const normalizedFileName = fileName.replace(/\.md$/i, "").trim().normalize("NFC")
      .replace(/[A-Z]/g, letter => letter.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") + ".md";
    const occupied = new Set([...this.sessionSnapshot.catalog.documents.map(document => document.path), ...this.createdPaths]);
    const path = `${folder}/${normalizedFileName}`;
    let suggestedFileName: string | null = null;
    if (occupied.has(path)) {
      let suffix = 2;
      do { suggestedFileName = `${normalizedFileName.slice(0, -3)}-${suffix++}.md`; } while (occupied.has(`${folder}/${suggestedFileName}`));
    }
    return { normalizedFileName, relativePath: path, hasCollision: occupied.has(path), suggestedFileName };
  }
  templateCatalog: DocumentTemplateCatalog = {
    templates: [
      {
        id: "builtin:blank",
        source: "built_in",
        label: "빈 문서",
        description: null,
        typeKey: null,
        defaults: { tags: [] },
        body: "# {{title}}\n",
        richEditorCompatible: true,
      },
      {
        id: "builtin:api_contract",
        source: "built_in",
        label: "API 계약",
        description: null,
        typeKey: "api_contract",
        defaults: { tags: [] },
        body: "# {{title}}\n\n## 요약\n\n## 범위\n\n### 포함\n\n### 제외\n\n## 처리 흐름\n\n## 공통 계약\n\n## Endpoint\n\n### `METHOD /path`\n\n#### 목적\n\n#### 요청\n\n#### 성공 응답\n\n#### 오류 응답\n\n#### 처리 케이스\n\n## 공통 데이터 모델\n",
        richEditorCompatible: true,
      },
      ...[
        { key: "feature_design", label: "기능 설계", sections: ["요약", "목표", "범위", "사용자 시나리오", "공통 동작 규칙", "제약 사항"] },
        { key: "architecture", label: "시스템·아키텍처 설계", sections: ["요약", "목표와 품질 목표", "범위와 컨텍스트", "제약 사항", "현재 구조", "제안 구조와 해결 전략", "구성 요소와 책임", "주요 실행 흐름", "배포 구조", "공통 설계 원칙", "위험과 기술 부채"] },
        { key: "decision", label: "기술 결정", sections: ["맥락과 문제", "결정 기준", "검토한 선택지", "결정 결과", "결과와 영향", "선택지 비교"] },
        { key: "research", label: "기술 조사", sections: ["조사 질문", "배경", "범위", "평가 기준", "조사 결과", "비교", "결론과 추천", "한계와 미확인 사항", "참고 자료"] },
        { key: "analysis", label: "분석·실험", sections: ["목적과 가설", "대상과 범위", "환경과 전제 조건", "방법", "측정 지표와 성공 기준", "결과", "해석", "한계", "후속 작업", "실행 자료"] },
        { key: "test", label: "테스트 계획·결과", sections: ["목적", "범위", "대상 버전과 환경", "시작 조건과 완료 기준", "테스트 케이스", "실행 결과", "결론"] },
        { key: "incident_review", label: "장애 회고", sections: ["요약", "영향", "탐지", "타임라인", "대응과 복구", "원인과 기여 요인", "배운 점", "재발 방지와 영향 완화 조치"] },
      ].map(({ key, label, sections }) => ({
        id: `builtin:${key}`, source: "built_in" as const, label,
        description: null, typeKey: key, defaults: { tags: [] },
        body: `# {{title}}\n\n${sections.map((section) => `## ${section}\n`).join("\n")}`,
        richEditorCompatible: true,
      })),
    ],
    diagnostics: [],
  };
  drafts: DraftSummary[] = [];
  activeRecovery: RecoveredDocument | null = null;
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
  deferReads = false;
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
  private readonly pendingReads = new Map<
    string,
    {
      sessionId: string;
      path: string;
      sequence: number;
      content: DocumentContent;
      resolve: (content: DocumentContent) => void;
    }
  >();
  private activeSessionId: string | null = null;
  private rememberedPath: string | null = null;
  private revision = 0;
  private latestReadSequence = 0;

  async startSession(requestId: string): Promise<DocumentSessionSnapshot> {
    this.record("startSession", requestId);
    if (this.startError) throw this.startError;
    this.activeSessionId = requestId;
    this.rememberedPath = this.sessionSnapshot.lastOpenedPath;
    this.revision = this.sessionSnapshot.revision;
    this.latestReadSequence = 0;
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

  async listDocumentTemplates(
    sessionId: string,
  ): Promise<DocumentTemplateCatalog> {
    this.record("listDocumentTemplates", sessionId);
    return this.templateCatalog;
  }

  async validateDocumentCreation(
    sessionId: string,
    folder: string,
    fileName: string,
  ): Promise<DocumentTargetValidation> {
    this.record("validateDocumentCreation", sessionId, folder, fileName);
    return this.documentTarget(folder, fileName);
  }

  async createDocumentDraft(
    request: CreateDocumentDraftRequest,
  ): Promise<CreateDocumentDraftResponse> {
    this.record("createDocumentDraft", request);
    const target = this.documentTarget(request.folder, request.fileName);
    const path = `${request.folder}/${target.suggestedFileName ?? target.normalizedFileName}`;
    this.createdPaths.add(path);
    const draft: DraftSummary = {
      workspaceId: this.sessionSnapshot.workspaceId,
      changeId: "269482aa-2c25-4a64-9006-c64ff075b9e5",
      authorLogin: "hyeeun",
      baseCommit: "0123456789abcdef",
      branch: "draft/hyeeun/269482aa-map-api",
      createdAtUnixMs: 1_722_000_000_000,
      lastOpenedAtUnixMs: 1_722_000_000_000,
    };
    this.drafts = [draft];
    return {
      requestId: request.requestId,
      document: {
        changeId: draft.changeId,
        documentId: "80a44162-92c6-4f2c-9b77-ef5c42a52e5a",
        path,
        markdown: `---\nokf_hub_id: 80a44162-92c6-4f2c-9b77-ef5c42a52e5a\ntitle: ${request.title}\n---\n# ${request.title}\n`,
        contentHash: "created-hash",
        draft,
      },
    };
  }

  async editExistingDocumentDraft(
    request: EditExistingDocumentDraftRequest,
  ): Promise<CreateDocumentDraftResponse> {
    this.record("editExistingDocumentDraft", request);
    const draft: DraftSummary = {
      workspaceId: this.sessionSnapshot.workspaceId,
      changeId: "269482aa-2c25-4a64-9006-c64ff075b9e5",
      authorLogin: "hyeeun",
      baseCommit: "0123456789abcdef",
      branch: "draft/hyeeun/269482aa-edit-guide",
      createdAtUnixMs: 1_722_000_000_000,
      lastOpenedAtUnixMs: 1_722_000_000_000,
    };
    this.drafts = [draft];
    const summary = request.path === apiSummary.path ? apiSummary : guideSummary;
    return {
      requestId: request.requestId,
      document: {
        changeId: draft.changeId,
        documentId:
          summary.documentId ?? "80a44162-92c6-4f2c-9b77-ef5c42a52e5a",
        path: request.path,
        markdown: `# ${request.title}`,
        contentHash: "existing-hash",
        draft,
      },
    };
  }

  async duplicateTeamTemplate(
    request: DuplicateTeamTemplateRequest,
  ): Promise<DuplicateTeamTemplateResponse> {
    this.record("duplicateTeamTemplate", request);
    const draft = this.drafts[0] ?? {
      workspaceId: this.sessionSnapshot.workspaceId,
      changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
      authorLogin: "hyeeun",
      baseCommit: "abc123",
      branch: "draft/current-user/ad1d6c6e-team-template",
      createdAtUnixMs: 1,
      lastOpenedAtUnixMs: 1,
    };
    this.drafts = [draft];
    return {
      requestId: request.requestId,
      path: `.okf/templates/${request.fileName}`,
      draft,
    };
  }

  async listLocalDocumentDrafts(sessionId: string): Promise<DraftSummary[]> {
    this.record("listLocalDocumentDrafts", sessionId);
    return this.drafts;
  }

  async getActiveDraftRecovery(sessionId: string): Promise<RecoveredDocument | null> {
    this.record("getActiveDraftRecovery", sessionId);
    return this.activeRecovery;
  }

  async switchLocalDocumentDraft(
    sessionId: string,
    requestId: string,
    changeId: string | null,
  ): Promise<SwitchLocalDocumentDraftResponse> {
    this.record("switchLocalDocumentDraft", sessionId, requestId, changeId);
    return {
      requestId,
      draft: this.drafts.find((draft) => draft.changeId === changeId) ?? null,
    };
  }

  async closeLocalDocumentDraft(sessionId: string): Promise<void> {
    this.record("closeLocalDocumentDraft", sessionId);
  }

  async saveDocumentDraft(
    request: SaveDocumentDraftRequest,
  ): Promise<SaveDocumentDraftResponse> {
    this.record("saveDocumentDraft", request);
    return {
      requestId: request.requestId,
      result: {
        status: "saved",
        changeId: request.changeId,
        documentId: request.documentId,
        path: request.path,
        contentHash: `saved-${request.requestId}`,
      },
    };
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

  async readDocument(
    sessionId: string,
    requestId: string,
    path: string,
  ): Promise<DocumentContent> {
    this.record("readDocument", sessionId, requestId, path);
    const sequence = ++this.latestReadSequence;
    const summary =
      this.sessionSnapshot.catalog.documents.find((document) => document.path === path) ??
      (path === apiSummary.path ? apiSummary : guideSummary);
    const content: DocumentContent = {
      summary: { ...summary, path },
      markdown: `# ${summary.title}`,
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    };
    if (this.deferReads) {
      return new Promise((resolve) => {
        this.pendingReads.set(requestId, {
          sessionId,
          path,
          sequence,
          content,
          resolve,
        });
      });
    }
    this.completeCurrentRead(sessionId, sequence, path);
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
    requestId: string,
    commitOid: string,
    pathAtCommit: string,
  ): Promise<DocumentContent> {
    this.record(
      "readDocumentVersion",
      sessionId,
      requestId,
      commitOid,
      pathAtCommit,
    );
    this.latestReadSequence += 1;
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

  resolveRead(requestId: string): void {
    const pending = this.pendingReads.get(requestId);
    if (!pending) throw new Error(`no deferred read ${requestId}`);
    this.pendingReads.delete(requestId);
    this.completeCurrentRead(
      pending.sessionId,
      pending.sequence,
      pending.path,
    );
    pending.resolve(pending.content);
  }

  emit(event: DocumentEventEnvelope): void {
    if (event.sessionId === this.activeSessionId) {
      this.revision = Math.max(this.revision, event.revision);
      if (event.type === "open_document_changed") {
        this.rememberedPath = event.path;
        this.sessionSnapshot = {
          ...this.sessionSnapshot,
          lastOpenedPath: event.path,
        };
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

  private completeCurrentRead(
    sessionId: string,
    sequence: number,
    path: string,
  ): void {
    if (
      this.activeSessionId !== sessionId ||
      sequence !== this.latestReadSequence ||
      this.rememberedPath === path
    ) {
      return;
    }
    this.rememberedPath = path;
    this.sessionSnapshot = { ...this.sessionSnapshot, lastOpenedPath: path };
    this.emit({
      revision: ++this.revision,
      type: "open_document_changed",
      sessionId,
      path,
    });
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
