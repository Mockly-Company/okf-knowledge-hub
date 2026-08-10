import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentsPage } from "./DocumentsPage";

afterEach(cleanup);

function renderPage(gateway: FakeDocumentsGateway) {
  gateway.sessionSnapshot.lastOpenedPath = null;
  return render(
    <MemoryRouter>
      <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
        <main aria-label="OkHub">
          <DocumentsPage />
        </main>
      </DocumentsProvider>
    </MemoryRouter>,
  );
}

describe("DocumentsPage", () => {
  it("renders the compact search home and opens a search result with its match", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.indexStatus = {
      status: "preparing",
      indexed: 3,
      total: 100,
    };
    gateway.searchResults = [
      {
        path: "docs/api.md",
        title: "API",
        matchField: "body",
        matchText: "응답 DTO",
        snippet: "응답 DTO 계약을 정의합니다.",
      },
    ];
    const user = userEvent.setup();
    renderPage(gateway);

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeVisible();
    expect(screen.getByText("Guide")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Type|Status|Feature/ })).toBeNull();

    await user.type(screen.getByRole("searchbox", { name: "문서 검색" }), "api");
    await user.click(await screen.findByRole("button", { name: /API/ }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "readDocument"),
      ).toContainEqual({
        method: "readDocument",
        args: [expect.any(String), "docs/api.md"],
      }),
    );
  });

  it("does not nest a second main landmark inside the app shell", async () => {
    const gateway = new FakeDocumentsGateway();
    const view = renderPage(gateway);

    await screen.findByRole("heading", { name: "Documents" });
    expect(view.container.querySelectorAll("main")).toHaveLength(1);
  });

  it("offers retry when the local search cache is degraded", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.indexStatus = {
      status: "degraded",
      message: "검색 캐시를 사용할 수 없습니다.",
    };
    const user = userEvent.setup();
    renderPage(gateway);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "검색 캐시를 사용할 수 없습니다.",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(gateway.calls.some((call) => call.method === "refreshSession")).toBe(
      true,
    );
  });

  it("links invalid document roots to Settings", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.startError = {
      code: "workspace_invalid",
      message: "설정한 문서 루트를 찾을 수 없습니다.",
      recovery: "open_workspace_file",
      details: {},
    };
    renderPage(gateway);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "설정한 문서 루트를 찾을 수 없습니다.",
    );
    expect(screen.getByRole("link", { name: "Settings에서 확인" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("offers retry instead of Settings for a retryable start failure", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.startError = {
      code: "document_index_unavailable",
      message: "문서 검색을 준비하지 못했습니다.",
      recovery: "retry",
      details: {},
    };
    const user = userEvent.setup();
    renderPage(gateway);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "문서 검색을 준비하지 못했습니다.",
    );
    expect(screen.queryByRole("link", { name: "Settings에서 확인" })).toBeNull();
    gateway.startError = null;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "startSession"),
      ).toHaveLength(2),
    );
    expect(await screen.findByText("Guide")).toBeVisible();
  });

  it("returns to Documents home with a notice when a tree update removes the selected document", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    render(
      <MemoryRouter>
        <DocumentsProvider gateway={gateway} createId={() => gateway.sessionSnapshot.sessionId}>
          <main aria-label="OkHub"><DocumentsPage /></main>
        </DocumentsProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("region", { name: "Guide" });

    act(() => {
      gateway.emit({
        revision: 1,
        type: "tree_changed",
        sessionId: gateway.sessionSnapshot.sessionId,
        catalog: { documents: [], roots: [] },
      });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "선택한 문서가 삭제되었습니다.",
    );
    expect(screen.queryByRole("region", { name: "Guide" })).toBeNull();
  });

  it("clears a deleted-selection notice when the user opens a different document", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    gateway.sessionSnapshot.catalog = {
      documents: [...gateway.guideCatalog.documents, ...gateway.apiCatalog.documents],
      roots: [...gateway.guideCatalog.roots, ...gateway.apiCatalog.roots],
    };
    render(
      <MemoryRouter>
        <DocumentsProvider gateway={gateway} createId={() => gateway.sessionSnapshot.sessionId}>
          <main aria-label="OkHub"><DocumentsPage /></main>
        </DocumentsProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("region", { name: "Guide" });

    act(() => {
      gateway.emit({
        revision: 1,
        type: "tree_changed",
        sessionId: gateway.sessionSnapshot.sessionId,
        catalog: gateway.apiCatalog,
      });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "선택한 문서가 삭제되었습니다.",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /API/ }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).toBeNull(),
    );
    expect(await screen.findByRole("region", { name: "API" })).toBeVisible();
  });

  it("keeps untrusted Markdown inert when a document is opened from the Documents page", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    vi.spyOn(gateway, "readDocument").mockResolvedValue({
      summary: gateway.guideCatalog.documents[0],
      markdown:
        '# Guide\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(2))',
      properties: {},
      tableOfContents: [],
      lastCommit: null,
    });
    const user = userEvent.setup();
    const view = renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: /Guide/ }));

    expect(await screen.findByText(/<img src=x/)).toBeVisible();
    expect(screen.getByRole("link", { name: "bad" })).toHaveAttribute("href", "#");
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("img[src='x']")).toBeNull();
    expect(gateway.openedUrls).toEqual([]);
  });
});
