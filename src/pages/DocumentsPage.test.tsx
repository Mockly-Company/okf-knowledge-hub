import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutPreferences,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import * as ActiveProjectModule from "@/features/active-project/ActiveProjectProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { DocumentsPage } from "./DocumentsPage";
import type { ReactElement } from "react";

afterEach(cleanup);

function render(ui: ReactElement) {
  return renderWithoutPreferences(
    <TestQueryProvider>
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        {ui}
      </PreferencesProvider>
    </TestQueryProvider>,
  );
}

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
  it("keeps the Documents home focused on search and creation", async () => {
    const gateway = new FakeDocumentsGateway();
    renderPage(gateway);

    expect(await screen.findByRole("heading", { name: "Documents" })).toHaveClass(
      "font-[number:var(--font-weight-page-title)]",
    );
    expect(screen.getByRole("button", { name: "새 문서" })).toHaveClass(
      "h-[var(--control-height)]",
      "rounded-[var(--radius-md)]",
    );
    expect(screen.queryByRole("combobox", { name: "문서 작업 전환" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "모든 문서" })).not.toBeInTheDocument();
  });

  it("opens the same new-document dialog from the Documents-home text action", async () => {
    const gateway = new FakeDocumentsGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: "새 문서" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("새 문서");
  });

  it("keeps the new-document action in the search toolbar while results use the full page width", async () => {
    const gateway = new FakeDocumentsGateway();
    const view = renderPage(gateway);

    const search = await screen.findByRole("searchbox", { name: "문서 검색" });
    const newDocument = screen.getByRole("button", { name: "새 문서" });
    const toolbar = view.container.querySelector(".document-search__toolbar");
    const results = view.container.querySelector<HTMLElement>(".document-search__results");

    expect(toolbar).not.toBeNull();
    expect(results).not.toBeNull();
    expect(toolbar).toContainElement(search);
    expect(toolbar).toContainElement(newDocument);
    expect(toolbar).not.toContainElement(results);
  });

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
        args: [expect.any(String), expect.any(String), "docs/api.md"],
      }),
    );
  });

  it("focuses and scrolls the visible reader header for a title search match", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.searchResults = [
      {
        path: "docs/guide.md",
        title: "Guide",
        matchField: "title",
        matchText: "Guide",
        snippet: "Guide",
      },
    ];
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const user = userEvent.setup();
    renderPage(gateway);

    await user.type(
      await screen.findByRole("searchbox", { name: "문서 검색" }),
      "Guide",
    );
    await user.click(await screen.findByRole("button", { name: /Guide/ }));

    const reader = await screen.findByRole("region", { name: "Guide" });
    const visibleHeader = reader.querySelector(".document-reader__header");
    expect(visibleHeader).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(visibleHeader));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("renders a current-document notice after the reader header without displacing its title", async () => {
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
    const changedSummary = {
      ...gateway.guideCatalog.documents[0],
      modifiedAtUnixMs: gateway.guideCatalog.documents[0].modifiedAtUnixMs + 1,
      size: gateway.guideCatalog.documents[0].size + 1,
    };

    act(() => {
      gateway.emit({
        revision: 1,
        type: "tree_changed",
        sessionId: gateway.sessionSnapshot.sessionId,
        catalog: {
          documents: [changedSummary],
          roots: [{ kind: "document", summary: changedSummary }],
        },
      });
    });

    const notice = (await screen.findByText(
      "외부 변경사항을 반영했습니다.",
    )).closest('[role="alert"]');
    const reader = await screen.findByRole("region", { name: "Guide" });
    const header = reader.querySelector(".document-reader__header");

    expect(notice).not.toBeNull();
    if (!notice) throw new Error("expected the current-document notice alert");
    const canvas = reader.querySelector(".document-reader__canvas");
    expect(canvas?.firstElementChild).toBe(header);
    expect(notice.parentElement).toBe(canvas);
    expect(header?.nextElementSibling).toBe(notice);
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

    const feedback = (await screen.findByText(
      "검색 캐시를 사용할 수 없습니다.",
    )).closest("[data-feedback-variant]");
    expect(feedback).not.toBeNull();
    if (!feedback) throw new Error("expected index feedback banner");
    expect(feedback).toHaveAttribute("data-feedback-variant", "banner");
    expect(feedback).toHaveAttribute("data-feedback-tone", "warning");
    expect(feedback).toHaveAttribute("data-feedback-action-placement", "end");
    expect(feedback).toHaveTextContent(
      "검색 캐시를 사용할 수 없습니다.",
    );
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(gateway.calls.some((call) => call.method === "refreshSession")).toBe(
      true,
    );
  });

  it("asks to choose a project for invalid document roots without one", async () => {
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
    expect(screen.getByText("프로젝트를 먼저 선택하세요")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "저장소 연결하기" })).toBeNull();
    gateway.startError = null;
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "startSession"),
      ).toHaveLength(2),
    );
    expect(await screen.findByText("Guide")).toBeVisible();
  });

  it("shows a selected-document read error with retry and home actions", async () => {
    const gateway = new FakeDocumentsGateway();
    const read = vi.spyOn(gateway, "readDocument").mockRejectedValue({
      code: "document_index_unavailable",
      message: "문서 파일을 읽지 못했습니다.",
      recovery: "retry",
      details: {},
    });
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: /Guide/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("문서 파일을 읽지 못했습니다.");
    expect(screen.queryByText("문서를 여는 중…")).toBeNull();
    await user.click(screen.getByRole("button", { name: "문서 다시 열기" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Documents 홈" }));
    expect(await screen.findByRole("searchbox", { name: "문서 검색" })).toBeVisible();
  });

  it("keeps matching title and path results available when body search is unavailable", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.deferSearch = true;
    const user = userEvent.setup();
    renderPage(gateway);

    fireEvent.change(
      await screen.findByRole("searchbox", { name: "문서 검색" }),
      { target: { value: "Guide" } },
    );
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "searchDocuments"),
      ).toHaveLength(1),
    );
    const firstSearch = gateway.calls.find(
      (call) => call.method === "searchDocuments",
    )!;
    act(() => {
      gateway.rejectSearch(firstSearch.args[1] as string, {
        code: "document_index_unavailable",
        message: "본문 검색을 사용할 수 없습니다.",
        recovery: "retry",
        details: {},
      });
    });

    expect(await screen.findByRole("button", { name: /Guide/ })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "검색 다시 시도" })).toBeNull();
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

    expect(await screen.findByRole("status")).toHaveTextContent(
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
    expect(await screen.findByRole("status")).toHaveTextContent(
      "선택한 문서가 삭제되었습니다.",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /API/ }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).toBeNull(),
    );
    expect(await screen.findByRole("region", { name: "API" })).toBeVisible();
  });

  it("offers the docs repository picker when the active project has none", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const spy = vi
      .spyOn(ActiveProjectModule, "useOptionalActiveProject")
      .mockReturnValue({
        docsMissing: true,
        activeProjectId: "project-1",
        selectProject: vi.fn(async () => {}),
      } as unknown as ActiveProjectModule.ActiveProjectContextValue);
    try {
      render(
        <MemoryRouter>
          <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
            <DocumentsPage
              docsRepositoryGateway={new FakeDocsRepositoryGateway()}
              repositoryGateway={FakeWorkspaceConnectionGateway.connected()}
            />
          </DocumentsProvider>
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole("group", { name: "문서 저장소 선택" }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "저장소 연결하기" })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("warns while the connected docs repository is not in OKF format", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const repositories = FakeWorkspaceConnectionGateway.connected();
    const current = repositories.currentWorkspace;
    if (current?.status !== "connected") throw new Error("connected fixture expected");
    repositories.currentWorkspace = { ...current, okf: false };
    render(
      <MemoryRouter>
        <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
          <DocumentsPage
            docsRepositoryGateway={new FakeDocsRepositoryGateway()}
            repositoryGateway={repositories}
          />
        </DocumentsProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("OKF 형식에 맞지 않는 저장소입니다."),
    ).toBeVisible();
  });

  it("hides catalog and reader entry when the active project has no docs mapping", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    const connectionGateway = FakeWorkspaceConnectionGateway.connected();
    const spy = vi
      .spyOn(ActiveProjectModule, "useOptionalActiveProject")
      .mockReturnValue({
        docsMissing: true,
      } as ActiveProjectModule.ActiveProjectContextValue);
    try {
      render(
        <MemoryRouter>
          <WorkspaceConnectionProvider gateway={connectionGateway}>
            <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
              <main aria-label="OkHub">
                <DocumentsPage />
              </main>
            </DocumentsProvider>
          </WorkspaceConnectionProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByText("프로젝트를 먼저 선택하세요")).toBeVisible();
      expect(screen.queryByRole("button", { name: "저장소 연결하기" })).toBeNull();
      expect(screen.queryByRole("searchbox", { name: "문서 검색" })).toBeNull();
      expect(screen.queryByRole("button", { name: "새 문서" })).toBeNull();
      expect(screen.queryByText("Guide")).toBeNull();
    } finally {
      spy.mockRestore();
    }
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

  it("renders the unified workspace setup flow instead of a dead-end error when no workspaces exist", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.startError = {
      code: "workspace_missing",
      message: "워크스페이스가 연결되지 않았습니다.",
      recovery: "open_workspace_file",
      details: {},
    };
    const connectionGateway = FakeWorkspaceConnectionGateway.disconnected();
    const projectGateway = new FakeProjectBoardGateway();
    const docsRepoGateway = new FakeDocsRepositoryGateway();

    render(
      <MemoryRouter>
        <WorkspaceConnectionProvider gateway={connectionGateway}>
          <ActiveProjectModule.ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsRepoGateway}
          >
            <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
              <main aria-label="OkHub">
                <DocumentsPage
                  docsRepositoryGateway={docsRepoGateway}
                  repositoryGateway={connectionGateway}
                />
              </main>
            </DocumentsProvider>
          </ActiveProjectModule.ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("GitHub에 로그인하고 문서 워크스페이스를 시작하세요"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "GitHub로 로그인" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows read-only workspace context without duplicate management buttons and prompts inline only when docs are missing", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    const connectionGateway = FakeWorkspaceConnectionGateway.connected();
    const projectGateway = new FakeProjectBoardGateway();
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = [
      {
        id: "project:PVT_1",
        title: "Mockly 기획 보드",
        project: {
          id: "PVT_1",
          owner: "Mockly-Company",
          number: 1,
          title: "Mockly 기획 보드",
          scope: "organization",
        },
        docsRepository: {
          repositoryId: "R_1",
          fullName: "Mockly-Company/Mockly",
        },
      },
      {
        id: "docs:Mockly-Company/handbook",
        title: "Mockly-Company/handbook",
        project: null,
        docsRepository: {
          repositoryId: "R_2",
          fullName: "Mockly-Company/handbook",
        },
      },
      {
        id: "project:PVT_2",
        title: "문서 미연결 보드",
        project: {
          id: "PVT_2",
          owner: "Mockly-Company",
          number: 2,
          title: "문서 미연결 보드",
          scope: "organization",
        },
        docsRepository: null,
      },
    ];
    docsRepoGateway.activeWorkspaceId = "project:PVT_1";

    function WorkspaceSwitcherButtons() {
      const { selectWorkspace } = ActiveProjectModule.useActiveProject();
      return (
        <div>
          <button
            type="button"
            onClick={() => void selectWorkspace("docs:Mockly-Company/handbook")}
          >
            switch-standalone
          </button>
          <button
            type="button"
            onClick={() => void selectWorkspace("project:PVT_2")}
          >
            switch-missing-docs
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkspaceConnectionProvider gateway={connectionGateway}>
          <ActiveProjectModule.ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsRepoGateway}
          >
            <DocumentsProvider gateway={gateway} searchDebounceMs={0}>
              <WorkspaceSwitcherButtons />
              <main aria-label="OkHub">
                <DocumentsPage
                  docsRepositoryGateway={docsRepoGateway}
                  repositoryGateway={connectionGateway}
                />
              </main>
            </DocumentsProvider>
          </ActiveProjectModule.ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("searchbox", { name: "문서 검색" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("region", { name: "현재 작업 공간" }),
    ).toBeVisible();
    expect(screen.getByText("선택된 Project · Mockly 기획 보드")).toBeVisible();
    expect(screen.getByText("문서 저장소 · Mockly-Company/Mockly")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "워크스페이스 설정" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "다른 저장소 연결" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "switch-standalone" }));

    expect(await screen.findByText("문서 전용")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Project 보드 연결" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "워크스페이스 설정" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "switch-missing-docs" }),
    );

    expect(
      await screen.findByText("Mockly-Company #2"),
    ).toBeVisible();
    expect(
      screen.getByText(/문서 미연결 보드.*문서 저장소를 선택하세요/),
    ).toBeVisible();
  });
});
