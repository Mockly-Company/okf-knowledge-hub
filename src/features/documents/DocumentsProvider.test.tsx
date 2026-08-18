import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import type { DocumentEventEnvelope } from "./model";
import { DocumentsProvider, useDocuments } from "./DocumentsProvider";

const SESSION_ID = "4b20eda7-09a0-46f9-bd3b-4de83d4b0157";
const SEARCH_ONE_ID = "34e1764e-4278-41f8-bcf8-9f74ff6f66e0";
const SEARCH_TWO_ID = "54bf90af-b193-4387-8618-ae168b775407";

function Probe() {
  const {
    state,
    authoringState,
    setSearchQuery,
    selectDocument,
    openNewDocument,
    createNewDocument,
    updateDraftMarkdown,
    showDocumentsHome,
    closeDraftEditor,
    switchDraft,
  } = useDocuments();
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="revision">{state.latestRevision}</output>
      <output data-testid="workspace">{state.workspaceId ?? "none"}</output>
      <output data-testid="documents">
        {state.catalog.documents.map((document) => document.title).join(",")}
      </output>
      <output data-testid="selected">{state.selectedPath ?? "none"}</output>
      <output data-testid="last-opened">{state.lastOpenedPath ?? "none"}</output>
      <output data-testid="document-notice">{state.documentNotice ?? "none"}</output>
      <output data-testid="search-results">
        {state.searchResults.map((result) => result.title).join(",")}
      </output>
      <output data-testid="templates">{authoringState.templateCatalog.templates.length}</output>
      <output data-testid="creation-status">{authoringState.creation.status}</output>
      <output data-testid="editor-path">{authoringState.editor?.document.path ?? "none"}</output>
      <output data-testid="save-status">{authoringState.editor?.saveStatus ?? "none"}</output>
      <button onClick={() => setSearchQuery("alpha")}>alpha</button>
      <button onClick={() => setSearchQuery("beta")}>beta</button>
      <button onClick={() => selectDocument("docs/guide.md")}>open-guide</button>
      <button onClick={() => selectDocument("docs/api.md")}>open-api</button>
      <button onClick={() => openNewDocument("docs/api")}>new-document</button>
      <button
        onClick={() =>
          createNewDocument({
            title: "지도 API",
            folder: "docs/api",
            fileName: "지도 API.md",
            templateId: "builtin:api_contract",
            separateChange: true,
          })
        }
      >
        create-document
      </button>
      <button onClick={() => updateDraftMarkdown("# changed")}>edit-document</button>
      <button onClick={showDocumentsHome}>documents-home</button>
      <button onClick={closeDraftEditor}>close-editor</button>
      <button onClick={() => switchDraft(null)}>switch-main</button>
    </div>
  );
}

function renderProvider(
  gateway: FakeDocumentsGateway,
  ids: string[] = [SESSION_ID],
  saveDebounceMs = 0,
) {
  const remainingIds = [...ids];
  return render(
    <DocumentsProvider
      gateway={gateway}
      createId={() => {
        const id = remainingIds.shift();
        if (!id) throw new Error("test did not provide enough UUIDs");
        return id;
      }}
      searchDebounceMs={0}
      saveDebounceMs={saveDebounceMs}
    >
      <Probe />
    </DocumentsProvider>,
  );
}

describe("DocumentsProvider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("waits for listener registration before starting the owned session", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.deferSubscription = true;
    renderProvider(gateway);

    await waitFor(() =>
      expect(gateway.calls.map((call) => call.method)).toEqual([
        "onDocumentEvent",
      ]),
    );

    gateway.completeSubscription();

    await waitFor(() =>
      expect(gateway.calls.slice(0, 2)).toEqual([
        { method: "onDocumentEvent", args: [] },
        { method: "startSession", args: [SESSION_ID] },
      ]),
    );
  });

  it("keeps a newer event that arrives before the start result while merging metadata", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.eventBeforeStartResult = (sessionId): DocumentEventEnvelope => ({
      revision: 3,
      type: "tree_changed",
      sessionId,
      catalog: gateway.apiCatalog,
    });

    renderProvider(gateway);

    expect(await screen.findByText("API")).toBeInTheDocument();
    expect(screen.getByTestId("revision")).toHaveTextContent("3");
    expect(screen.getByTestId("workspace")).toHaveTextContent(
      gateway.sessionSnapshot.workspaceId,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
    expect(screen.queryByText("Guide")).not.toBeInTheDocument();
  });

  it("does not read from an open-document event rejected by the reducer", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    renderProvider(gateway);
    await screen.findByText("ready");
    gateway.calls.length = 0;

    act(() => {
      gateway.emit({
        revision: 100,
        type: "open_document_changed",
        sessionId: "8631e51a-cdb2-4f39-968b-5c3196cac61a",
        path: "docs/stale.md",
      });
    });
    await act(async () => Promise.resolve());

    expect(gateway.calls.some((call) => call.method === "readDocument")).toBe(
      false,
    );
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
  });

  it("does not navigate from an unexplained different-path open-document event", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    gateway.sessionSnapshot.catalog = {
      documents: [
        ...gateway.guideCatalog.documents,
        ...gateway.apiCatalog.documents,
      ],
      roots: [...gateway.guideCatalog.roots, ...gateway.apiCatalog.roots],
    };
    renderProvider(gateway);
    await screen.findByText("ready");
    gateway.calls.length = 0;

    act(() => {
      gateway.emit({
        revision: 1,
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/api.md",
      });
    });

    await act(async () => Promise.resolve());

    expect(
      gateway.calls.filter((call) => call.method === "readDocument"),
    ).toEqual([]);
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
  });

  it("does not re-read or show an external-change notice for the same-path event emitted after the first read", async () => {
    const gateway = new FakeDocumentsGateway();
    renderProvider(gateway);
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "readDocument"),
      ).toHaveLength(1),
    );
    gateway.calls.length = 0;

    act(() => {
      gateway.emit({
        revision: 1,
        type: "open_document_changed",
        sessionId: SESSION_ID,
        path: "docs/guide.md",
      });
    });
    await act(async () => Promise.resolve());

    expect(
      gateway.calls.filter((call) => call.method === "readDocument"),
    ).toEqual([]);
    expect(screen.getByTestId("document-notice")).toHaveTextContent("none");
  });

  it("re-reads and notifies when tree reconciliation changes the selected summary", async () => {
    const gateway = new FakeDocumentsGateway();
    renderProvider(gateway);
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "readDocument"),
      ).toHaveLength(1),
    );
    gateway.calls.length = 0;
    const changedSummary = {
      ...gateway.guideCatalog.documents[0],
      modifiedAtUnixMs: gateway.guideCatalog.documents[0].modifiedAtUnixMs + 1,
      size: gateway.guideCatalog.documents[0].size + 10,
    };

    act(() => {
      gateway.emit({
        revision: 1,
        type: "tree_changed",
        sessionId: SESSION_ID,
        catalog: {
          documents: [changedSummary],
          roots: [{ kind: "document", summary: changedSummary }],
        },
      });
    });

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "readDocument"),
      ).toEqual([
        {
          method: "readDocument",
          args: [SESSION_ID, `event:${SESSION_ID}:1`, "docs/guide.md"],
        },
      ]),
    );
    expect(screen.getByTestId("document-notice")).toHaveTextContent(
      "외부 변경사항을 반영했습니다.",
    );
  });

  it("keeps B selected when an older A read emits after B completes", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    gateway.sessionSnapshot.catalog = {
      documents: [
        ...gateway.guideCatalog.documents,
        ...gateway.apiCatalog.documents,
      ],
      roots: [...gateway.guideCatalog.roots, ...gateway.apiCatalog.roots],
    };
    gateway.deferReads = true;
    const user = userEvent.setup();
    renderProvider(gateway, [SESSION_ID, SEARCH_ONE_ID, SEARCH_TWO_ID]);
    await screen.findByText("ready");

    await user.click(screen.getByRole("button", { name: "open-guide" }));
    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "readDocument",
        args: [SESSION_ID, SEARCH_ONE_ID, "docs/guide.md"],
      }),
    );
    await user.click(screen.getByRole("button", { name: "open-api" }));
    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "readDocument",
        args: [SESSION_ID, SEARCH_TWO_ID, "docs/api.md"],
      }),
    );

    act(() => {
      gateway.resolveRead(SEARCH_TWO_ID);
    });
    expect(await screen.findByTestId("selected")).toHaveTextContent(
      "docs/api.md",
    );

    act(() => {
      gateway.resolveRead(SEARCH_ONE_ID);
    });
    await act(async () => Promise.resolve());

    expect(screen.getByTestId("selected")).toHaveTextContent("docs/api.md");
    expect(screen.getByTestId("last-opened")).toHaveTextContent(
      "docs/api.md",
    );
    expect(gateway.sessionSnapshot.lastOpenedPath).toBe("docs/api.md");
  });

  it("stops the exact session, unlistens, and ignores a late start result", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.deferStart = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rendered = renderProvider(gateway);
    await waitFor(() =>
      expect(gateway.calls.some((call) => call.method === "startSession")).toBe(
        true,
      ),
    );

    rendered.unmount();

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "stopSession"),
      ).toEqual([{ method: "stopSession", args: [SESSION_ID] }]),
    );
    expect(gateway.listenerCount()).toBe(0);
    expect(gateway.unlistenCount).toBe(1);

    await act(async () => {
      gateway.resolveStart();
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("uses reducer-owned UUID requests and ignores an older search response", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.deferSearch = true;
    const user = userEvent.setup();
    renderProvider(gateway, [SESSION_ID, SEARCH_ONE_ID, SEARCH_TWO_ID]);
    await screen.findByText("ready");

    await user.click(screen.getByRole("button", { name: "alpha" }));
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "searchDocuments"),
      ).toContainEqual({
        method: "searchDocuments",
        args: [SESSION_ID, SEARCH_ONE_ID, "alpha", 20],
      }),
    );

    await user.click(screen.getByRole("button", { name: "beta" }));
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "searchDocuments"),
      ).toContainEqual({
        method: "searchDocuments",
        args: [SESSION_ID, SEARCH_TWO_ID, "beta", 20],
      }),
    );

    act(() => {
      gateway.resolveSearch(SEARCH_ONE_ID, [
        {
          path: "docs/old.md",
          title: "Old",
          matchField: "body",
          matchText: "alpha",
          snippet: "old",
        },
      ]);
    });
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("search-results")).not.toHaveTextContent("Old");

    act(() => {
      gateway.resolveSearch(SEARCH_TWO_ID, [
        {
          path: "docs/new.md",
          title: "New",
          matchField: "title",
          matchText: "beta",
          snippet: "new",
        },
      ]);
    });
    expect(await screen.findByText("New")).toBeInTheDocument();
  });

  it("validates before creation, restarts on the draft worktree, and autosaves with owned ids", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const user = userEvent.setup();
    const createRequest = "34e1764e-4278-41f8-bcf8-9f74ff6f66e0";
    const restartedSession = "54bf90af-b193-4387-8618-ae168b775407";
    const saveRequest = "5b0df17a-c57d-4e5c-a945-a88f9dbfd6a4";
    renderProvider(gateway, [SESSION_ID, createRequest, restartedSession, saveRequest]);

    await waitFor(() =>
      expect(screen.getByTestId("templates")).toHaveTextContent("2"),
    );
    await user.click(screen.getByRole("button", { name: "new-document" }));
    await user.click(screen.getByRole("button", { name: "create-document" }));

    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "validateDocumentCreation")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "createDocumentDraft")).toHaveLength(1),
    );
    expect(
      gateway.calls.findIndex((call) => call.method === "validateDocumentCreation"),
    ).toBeLessThan(
      gateway.calls.findIndex((call) => call.method === "createDocumentDraft"),
    );
    expect(await screen.findByTestId("editor-path")).toHaveTextContent(
      "docs/api/지도-api.md",
    );
    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "startSession",
        args: [restartedSession],
      }),
    );

    await user.click(screen.getByRole("button", { name: "edit-document" }));
    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "saveDocumentDraft")).toHaveLength(1),
    );
    expect(gateway.calls.find((call) => call.method === "saveDocumentDraft")?.args[0]).toMatchObject({
      requestId: saveRequest,
      markdown: "# changed",
    });
    expect(await screen.findByTestId("save-status")).toHaveTextContent("saved");
  });

  it("flushes the current editor before replacing it with a newly created document", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const user = userEvent.setup();
    const firstCreate = "34e1764e-4278-41f8-bcf8-9f74ff6f66e0";
    const firstSession = "54bf90af-b193-4387-8618-ae168b775407";
    const flushSave = "5b0df17a-c57d-4e5c-a945-a88f9dbfd6a4";
    const secondCreate = "632af6ac-8034-4d83-ac65-8dc43cc306c2";
    const secondSession = "756a7b2c-56dd-4b51-b76e-48c09d2f07cb";
    renderProvider(
      gateway,
      [SESSION_ID, firstCreate, firstSession, flushSave, secondCreate, secondSession],
      60_000,
    );
    await waitFor(() =>
      expect(screen.getByTestId("templates")).toHaveTextContent("2"),
    );
    await user.click(screen.getByRole("button", { name: "create-document" }));
    await screen.findByTestId("editor-path");
    await user.click(screen.getByRole("button", { name: "edit-document" }));

    gateway.calls.length = 0;
    await user.click(screen.getByRole("button", { name: "create-document" }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "createDocumentDraft"),
      ).toHaveLength(1),
    );
    const saveIndex = gateway.calls.findIndex(
      (call) => call.method === "saveDocumentDraft",
    );
    const validationIndex = gateway.calls.findIndex(
      (call) => call.method === "validateDocumentCreation",
    );
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeLessThan(validationIndex);
    expect(gateway.calls[saveIndex]?.args[0]).toMatchObject({
      requestId: flushSave,
      markdown: "# changed",
    });
  });

  it("flushes and closes the current editor before showing Documents home", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    gateway.activeRecovery = {
      document: {
        changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
        documentId: "90e4ad45-f4f4-4cf4-9ef4-5e3d30e46261",
        path: "docs/draft.md",
        markdown: "# 저장 전 초안\n",
        contentHash: "draft-hash",
        draft: {
          workspaceId: gateway.sessionSnapshot.workspaceId,
          changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
          authorLogin: "hyeeun",
          baseCommit: "abc123",
          branch: "draft/hyeeun/ad1d6c6e-draft",
          createdAtUnixMs: 1,
          lastOpenedAtUnixMs: 2,
        },
      },
      conflict: null,
      hasUnsavedRecovery: false,
    };
    const user = userEvent.setup();
    renderProvider(gateway);

    await waitFor(() =>
      expect(screen.getByTestId("editor-path")).toHaveTextContent(
        "docs/draft.md",
      ),
    );
    expect(screen.getByTestId("selected")).toHaveTextContent("docs/guide.md");

    await user.click(screen.getByRole("button", { name: "documents-home" }));

    await waitFor(() =>
      expect(screen.getByTestId("editor-path")).toHaveTextContent("none"),
    );
    expect(screen.getByTestId("selected")).toHaveTextContent("none");
  });

  it("restores a recoverable local draft when the document session starts", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    gateway.activeRecovery = {
      document: {
        changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
        documentId: "90e4ad45-f4f4-4cf4-9ef4-5e3d30e46261",
        path: "docs/recovered.md",
        markdown: "# 복구된 초안\n",
        contentHash: "disk-hash",
        draft: {
          workspaceId: gateway.sessionSnapshot.workspaceId,
          changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
          authorLogin: "hyeeun",
          baseCommit: "abc123",
          branch: "draft/hyeeun/ad1d6c6e-recovered",
          createdAtUnixMs: 1,
          lastOpenedAtUnixMs: 2,
        },
      },
      conflict: null,
      hasUnsavedRecovery: true,
    };

    renderProvider(gateway);

    await waitFor(() =>
      expect(screen.getByTestId("editor-path")).toHaveTextContent(
        "docs/recovered.md",
      ),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("dirty");
  });

  it("reopens the last normally saved draft without scheduling another save", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    gateway.activeRecovery = {
      document: {
        changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
        documentId: "90e4ad45-f4f4-4cf4-9ef4-5e3d30e46261",
        path: "docs/saved.md",
        markdown: "# 저장된 문서\n",
        contentHash: "saved-hash",
        draft: {
          workspaceId: gateway.sessionSnapshot.workspaceId,
          changeId: "ad1d6c6e-e8ec-4a1f-a1b7-f47a50e12a80",
          authorLogin: "hyeeun",
          baseCommit: "abc123",
          branch: "draft/hyeeun/ad1d6c6e-saved",
          createdAtUnixMs: 1,
          lastOpenedAtUnixMs: 2,
        },
      },
      conflict: null,
      hasUnsavedRecovery: false,
    };

    renderProvider(gateway);

    await waitFor(() =>
      expect(screen.getByTestId("editor-path")).toHaveTextContent("docs/saved.md"),
    );
    expect(screen.getByTestId("save-status")).toHaveTextContent("saved");
    expect(
      gateway.calls.filter((call) => call.method === "saveDocumentDraft"),
    ).toHaveLength(0);
  });

  it("flushes a dirty draft before switching to main and then restarts the session", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const user = userEvent.setup();
    const createRequest = "34e1764e-4278-41f8-bcf8-9f74ff6f66e0";
    const createdSession = "54bf90af-b193-4387-8618-ae168b775407";
    const autosaveRequest = "5b0df17a-c57d-4e5c-a945-a88f9dbfd6a4";
    const switchRequest = "632af6ac-8034-4d83-ac65-8dc43cc306c2";
    const mainSession = "756a7b2c-56dd-4b51-b76e-48c09d2f07cb";
    renderProvider(gateway, [
      SESSION_ID,
      createRequest,
      createdSession,
      autosaveRequest,
      switchRequest,
      mainSession,
    ]);
    await screen.findByText("ready");
    await user.click(screen.getByRole("button", { name: "create-document" }));
    await screen.findByTestId("editor-path");
    await user.click(screen.getByRole("button", { name: "edit-document" }));
    await waitFor(() =>
      expect(screen.getByTestId("save-status")).toHaveTextContent("saved"),
    );

    gateway.calls.length = 0;
    await user.click(screen.getByRole("button", { name: "switch-main" }));

    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "switchLocalDocumentDraft",
        args: [createdSession, switchRequest, null],
      }),
    );
    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "startSession",
        args: [mainSession],
      }),
    );
  });
});
