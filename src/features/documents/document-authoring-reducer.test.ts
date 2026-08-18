import { describe, expect, it } from "vitest";
import {
  createInitialAuthoringState,
  documentAuthoringReducer,
} from "./document-authoring-reducer";

const input = {
  title: "지도 API",
  folder: "docs/api",
  fileName: "지도 API.md",
  templateId: "builtin:api_contract",
  separateChange: true,
};

describe("documentAuthoringReducer", () => {
  it("registers validation ownership before allowing document creation", () => {
    const requested = documentAuthoringReducer(createInitialAuthoringState(), {
      type: "creationRequested",
      requestId: "request-a",
      input,
    });
    const started = documentAuthoringReducer(requested, {
      type: "validationStarted",
      requestId: "request-a",
    });
    const validated = documentAuthoringReducer(started, {
      type: "validationSucceeded",
      requestId: "request-a",
      validation: {
        normalizedFileName: "지도-api.md",
        relativePath: "docs/api/지도-api.md",
        hasCollision: false,
        suggestedFileName: null,
      },
    });

    expect(requested.creation.status).toBe("validation_queued");
    expect(started.creation.status).toBe("validating");
    expect(validated.creation.status).toBe("creation_queued");
  });

  it("keeps a collision for explicit confirmation and never queues creation", () => {
    const state = documentAuthoringReducer(
      documentAuthoringReducer(
        documentAuthoringReducer(createInitialAuthoringState(), {
          type: "creationRequested",
          requestId: "request-a",
          input,
        }),
        { type: "validationStarted", requestId: "request-a" },
      ),
      {
        type: "validationSucceeded",
        requestId: "request-a",
        validation: {
          normalizedFileName: "지도-api.md",
          relativePath: "docs/api/지도-api.md",
          hasCollision: true,
          suggestedFileName: "지도-api-2.md",
        },
      },
    );

    expect(state.creation.status).toBe("collision");
    expect(state.creation.validation?.suggestedFileName).toBe("지도-api-2.md");
  });

  it("ignores stale create and save responses", () => {
    const creating = documentAuthoringReducer(
      {
        ...createInitialAuthoringState(),
        creation: {
          status: "creating",
          requestId: "current",
          input,
          validation: null,
          error: null,
        },
      },
      {
        type: "creationSucceeded",
        requestId: "stale",
        response: {
          requestId: "stale",
          document: {
            changeId: "change",
            documentId: "document",
            path: "docs/stale.md",
            markdown: "stale",
            contentHash: "hash",
            draft: {
              workspaceId: "workspace",
              changeId: "change",
              authorLogin: "hyeeun",
              baseCommit: "base",
              branch: "draft/hyeeun/change-stale",
              createdAtUnixMs: 1,
              lastOpenedAtUnixMs: 1,
            },
          },
        },
      },
    );

    expect(creating.creation.status).toBe("creating");
    expect(creating.editor).toBeNull();
  });

  it("does not let a delayed recovery replace a document created after template loading began", () => {
    const loading = documentAuthoringReducer(createInitialAuthoringState(), {
      type: "templatesLoading",
      sessionId: "old-session",
    });
    const creating = {
      ...loading,
      creation: {
        status: "creating" as const,
        requestId: "create-current",
        input,
        validation: null,
        error: null,
      },
    };
    const created = documentAuthoringReducer(creating, {
      type: "creationSucceeded",
      requestId: "create-current",
      response: {
        requestId: "create-current",
        document: {
          changeId: "new-change",
          documentId: "new-document",
          path: "docs/new-document.md",
          markdown: "# 새 문서",
          contentHash: "new-hash",
          draft: {
            workspaceId: "workspace",
            changeId: "new-change",
            authorLogin: "hyeeun",
            baseCommit: "base",
            branch: "draft/hyeeun/new-change-new-document",
            createdAtUnixMs: 2,
            lastOpenedAtUnixMs: 2,
          },
        },
      },
    });

    const afterDelayedRecovery = documentAuthoringReducer(created, {
      type: "templatesLoaded",
      sessionId: "old-session",
      catalog: { templates: [], diagnostics: [] },
      drafts: [],
      activeBranch: "draft/hyeeun/old-change-old-document",
      recovery: {
        document: {
          changeId: "old-change",
          documentId: "old-document",
          path: "docs/old-document.md",
          markdown: "# 이전 문서",
          contentHash: "old-hash",
          draft: {
            workspaceId: "workspace",
            changeId: "old-change",
            authorLogin: "hyeeun",
            baseCommit: "base",
            branch: "draft/hyeeun/old-change-old-document",
            createdAtUnixMs: 1,
            lastOpenedAtUnixMs: 1,
          },
        },
        conflict: null,
        hasUnsavedRecovery: false,
      },
    });

    expect(afterDelayedRecovery.editor?.document.path).toBe(
      "docs/new-document.md",
    );
    expect(afterDelayedRecovery.activeChangeId).toBe("new-change");
  });

  it("turns a matching save conflict into an editor conflict without discarding text", () => {
    const editor = {
      document: {
        changeId: "change",
        documentId: "document",
        path: "docs/guide.md",
        markdown: "original",
        contentHash: "hash-a",
        draft: {
          workspaceId: "workspace",
          changeId: "change",
          authorLogin: "hyeeun",
          baseCommit: "base",
          branch: "draft/hyeeun/change-guide",
          createdAtUnixMs: 1,
          lastOpenedAtUnixMs: 1,
        },
      },
      markdown: "hub edit",
      savedMarkdown: "original",
      contentHash: "hash-a",
      saveStatus: "saving" as const,
      saveRequestId: "save-a",
      saveSnapshot: "hub edit",
      conflict: null,
      error: null,
      mode: "rich" as const,
      closeAfterSave: false,
    };

    const state = documentAuthoringReducer(
      { ...createInitialAuthoringState(), editor },
      {
        type: "saveSucceeded",
        requestId: "save-a",
        response: {
          requestId: "save-a",
          result: {
            status: "conflict",
            changeId: "change",
            documentId: "document",
            path: "docs/guide.md",
            diskHash: "hash-b",
            diskMarkdown: "external",
            hubMarkdown: "hub edit",
          },
        },
      },
    );

    expect(state.editor?.saveStatus).toBe("conflict");
    expect(state.editor?.markdown).toBe("hub edit");
    expect(state.editor?.conflict?.diskMarkdown).toBe("external");

    const diskAccepted = documentAuthoringReducer(state, {
      type: "conflictDiskAccepted",
    });
    expect(diskAccepted.editor?.markdown).toBe("external");
    expect(diskAccepted.editor?.contentHash).toBe("hash-b");
    expect(diskAccepted.editor?.saveStatus).toBe("dirty");

    const merging = documentAuthoringReducer(state, {
      type: "conflictMergeStarted",
    });
    expect(merging.editor?.mode).toBe("source");
    expect(merging.editor?.markdown).toContain("<<<<<<< 내 내용");
    expect(merging.editor?.markdown).toContain("hub edit");
    expect(merging.editor?.markdown).toContain("external");
    expect(merging.editor?.contentHash).toBe("hash-b");
  });
});
