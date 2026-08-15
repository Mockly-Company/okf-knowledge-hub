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
  const { state, setSearchQuery, selectDocument } = useDocuments();
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
      <button onClick={() => setSearchQuery("alpha")}>alpha</button>
      <button onClick={() => setSearchQuery("beta")}>beta</button>
      <button onClick={() => selectDocument("docs/guide.md")}>open-guide</button>
      <button onClick={() => selectDocument("docs/api.md")}>open-api</button>
    </div>
  );
}

function renderProvider(
  gateway: FakeDocumentsGateway,
  ids: string[] = [SESSION_ID],
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
});
