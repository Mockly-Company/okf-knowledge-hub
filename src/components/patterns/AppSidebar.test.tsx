import { createRef } from "react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { ActiveProjectProvider } from "@/features/active-project/ActiveProjectProvider";
import { PersonalDashboardProvider } from "@/features/dashboard/PersonalDashboardProvider";
import { terminalStoreFor } from "@/features/ai/TerminalSessionStore";
import type { HubWorkspace } from "@/features/docs-repository/DocsRepositoryGateway";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePersonalDashboardGateway } from "@/test/FakePersonalDashboardGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(
  gateway: FakeWorkspaceConnectionGateway,
  initialPath = "/documents",
  documentsGateway = new FakeDocumentsGateway(),
) {
  return render(
    <TestQueryProvider>
      <WorkspaceConnectionProvider gateway={gateway}>
        <DocumentsProvider gateway={documentsGateway}>
          <MemoryRouter initialEntries={[initialPath]}>
            <AppSidebar collapseButtonRef={createRef()} onCollapse={() => {}} />
          </MemoryRouter>
        </DocumentsProvider>
      </WorkspaceConnectionProvider>
    </TestQueryProvider>,
  );
}

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the authenticated GitHub identity without duplicating workspace context", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(screen.queryByText("Mockly")).not.toBeInTheDocument();
    expect(view.container.querySelector(".app-sidebar__workspace")).toBeNull();
    expect(view.container.querySelector('img[src="https://example.test/avatar.png"]'))
      .toBeInTheDocument();
  });

  it("does not duplicate workspace context while reauthentication is required", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    renderSidebar(gateway);

    expect(await screen.findByText("GitHub 재로그인 필요")).toBeInTheDocument();
    expect(screen.queryByText("Mockly")).toBeNull();
    expect(screen.getByText("Settings에서 연결")).toBeInTheDocument();
  });

  it("keeps the sidebar account area neutral while reauthentication is required", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "reauthentication_required" };
    const view = renderSidebar(gateway);

    expect(await screen.findByText("GitHub 재로그인 필요")).toBeVisible();
    expect(screen.getByText("Settings에서 연결")).toBeVisible();
    expect(view.container.querySelector(".app-sidebar__user")).not.toHaveClass(
      "app-sidebar__user--reauthentication-required",
    );
    expect(view.container.querySelector(".lucide-circle-alert")).toBeNull();
  });

  it("falls back to the login initial when the avatar cannot load", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");
    const avatar = view.container.querySelector("img");
    expect(avatar).not.toBeNull();

    fireEvent.error(avatar as HTMLImageElement);

    expect(screen.getByText("H")).toBeInTheDocument();
    expect(view.container.querySelector("img")).not.toBeInTheDocument();
  });

  it("reserves stable identity space while account state loads", () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.deferCurrentWorkspace();
    renderSidebar(gateway);

    expect(screen.getByLabelText("GitHub 계정 불러오는 중")).toBeInTheDocument();
  });

  it("shows the document tree only on Documents routes without sidebar search", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const view = renderSidebar(
      FakeWorkspaceConnectionGateway.connected(),
      "/documents",
      documentsGateway,
    );

    expect(await screen.findByRole("tree", { name: "문서" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "Guide" })).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();

    view.unmount();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/project");
    expect(screen.queryByRole("tree", { name: "문서" })).toBeNull();
  });

  it("keeps the Lucide new-document action available on Documents routes", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    const view = renderSidebar(
      FakeWorkspaceConnectionGateway.connected(),
      "/documents",
      documentsGateway,
    );

    const action = await screen.findByRole("button", { name: "새 문서" });
    expect(action.querySelector("svg.lucide-file-plus-corner")).not.toBeNull();
    expect(view.container.querySelector(".document-tree__header")).toContainElement(
      action,
    );
  });

  it.each(["/documents", "/project", "/ai"])(
    "scopes primary navigation to workspace tools and separates Settings into the bottom footer on %s",
    async (initialPath) => {
      renderSidebar(FakeWorkspaceConnectionGateway.connected(), initialPath);

      await screen.findByText("@hyeeun");
      const primaryNavigation = screen.getByRole("navigation", { name: "주 메뉴" });
      const divider = screen.getByRole("separator");
      const documents = screen.getByRole("link", { name: "Documents" });
      const board = screen.getByRole("link", { name: "Board" });
      const ai = screen.getByRole("link", { name: "AI" });
      const settings = screen.getByRole("link", { name: "Settings" });

      expect(primaryNavigation.nextElementSibling).toBe(divider);
      expect(documents.nextElementSibling).toBe(board);
      expect(board.nextElementSibling).toBe(ai);
      expect(settings.parentElement).not.toBe(primaryNavigation);
      expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    },
  );

  it("returns to the Documents home when the main Documents link is selected", async () => {
    const user = userEvent.setup();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/documents");

    const document = await screen.findByRole("treeitem", { name: "Guide" });
    expect(document).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("link", { name: "Documents" }));

    expect(document).toHaveAttribute("aria-selected", "false");
  });

  it("allows a keyboard user to focus the current route in the primary navigation", async () => {
    const user = userEvent.setup();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/documents");

    await user.tab();
    await user.tab();
    await user.tab();

    const documents = screen.getByRole("link", { name: "Documents" });
    expect(documents).toHaveFocus();
    expect(documents).toHaveAttribute("aria-current", "page");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");

    const result = await axe.run(container);

    expect(result.violations).toEqual([]);
  });
});

describe("AppSidebar workspace switcher", () => {
  const projectWorkspace: HubWorkspace = {
    id: "project:PVT_linked",
    title: "Mockly Board",
    project: {
      id: "PVT_linked",
      owner: "Mockly-Company",
      number: 1,
      title: "Mockly Board",
      scope: "organization",
    },
    docsRepository: {
      repositoryId: "R_1",
      fullName: "Mockly-Company/Mockly",
    },
  };

  const standaloneWorkspace: HubWorkspace = {
    id: "docs:Mockly-Company/handbook",
    title: "Mockly-Company/handbook",
    project: null,
    docsRepository: {
      repositoryId: "R_2",
      fullName: "Mockly-Company/handbook",
    },
  };

  const missingDocsWorkspace: HubWorkspace = {
    id: "project:PVT_empty",
    title: "New Project",
    project: {
      id: "PVT_empty",
      owner: "Mockly-Company",
      number: 3,
      title: "New Project",
      scope: "organization",
    },
    docsRepository: null,
  };

  function renderSidebarWithWorkspaces(
    workspaces: HubWorkspace[],
    activeWorkspaceId: string | null = workspaces[0]?.id ?? null,
    aiGateway?: FakeAiGateway,
  ) {
    const projectGateway = new FakeProjectBoardGateway();
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = workspaces;
    docsRepoGateway.activeWorkspaceId = activeWorkspaceId;
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const view = render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <DocumentsProvider gateway={new FakeDocumentsGateway()}>
            <ActiveProjectProvider
              projectGateway={projectGateway}
              docsRepositoryGateway={docsRepoGateway}
              aiGateway={aiGateway}
            >
              <MemoryRouter initialEntries={["/documents"]}>
                <AppSidebar
                  collapseButtonRef={createRef()}
                  onCollapse={() => {}}
                  docsRepositoryGateway={docsRepoGateway}
                  repositoryGateway={workspaceGateway}
                  aiGateway={aiGateway}
                />
              </MemoryRouter>
            </ActiveProjectProvider>
          </DocumentsProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );
    return { view, projectGateway, docsRepoGateway, workspaceGateway };
  }

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("displays the active Project workspace and its subordinate docs repository", async () => {
    const { view } = renderSidebarWithWorkspaces([projectWorkspace]);

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    expect(switcher).toHaveAccessibleName(
      "워크스페이스 전환, 현재 Mockly Board (문서 · Mockly-Company/Mockly)",
    );
    expect(screen.getByText("선택된 Project")).toBeInTheDocument();
    expect(switcher).toHaveTextContent("Mockly Board");
    expect(switcher).toHaveTextContent("문서 · Mockly-Company/Mockly");
    expect(switcher.textContent).not.toContain("└");

    const result = await axe.run(view.container);
    expect(result.violations).toEqual([]);
  });

  it("displays standalone docs mode clearly when no GitHub Project board is attached", async () => {
    renderSidebarWithWorkspaces([standaloneWorkspace]);

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    expect(switcher).toHaveAccessibleName(
      "워크스페이스 전환, 현재 Mockly-Company/handbook (문서 전용 · Mockly-Company/handbook)",
    );
    expect(switcher).toHaveTextContent("Mockly-Company/handbook");
    expect(switcher).toHaveTextContent("문서 전용 · Mockly-Company/handbook");
  });

  it("indicates when a Project workspace still needs a docs repository", async () => {
    renderSidebarWithWorkspaces([missingDocsWorkspace]);

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    expect(switcher).toHaveAccessibleName(
      "워크스페이스 전환, 현재 New Project (문서 저장소 연결 필요)",
    );
    expect(switcher).toHaveTextContent("New Project");
    expect(switcher).toHaveTextContent("문서 저장소 연결 필요");
    expect(switcher.textContent).not.toContain("└");
  });

  it("switches workspaces from the dropdown menu and surfaces errors on failure", async () => {
    const user = userEvent.setup();
    const { docsRepoGateway } = renderSidebarWithWorkspaces([
      projectWorkspace,
      standaloneWorkspace,
    ]);

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    await waitFor(() => expect(switcher).toHaveTextContent("Mockly Board"));

    await user.click(switcher);
    await user.click(
      await screen.findByRole("menuitemradio", {
        name: /Mockly-Company\/handbook/,
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^워크스페이스 전환/ }),
      ).toHaveTextContent("문서 전용 · Mockly-Company/handbook"),
    );

    docsRepoGateway.setActiveWorkspace = async () => {
      throw "Command set_active_hub_workspace failed oddly";
    };

    await user.click(
      screen.getByRole("button", { name: /^워크스페이스 전환/ }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", {
        name: /Mockly Board/,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Command set_active_hub_workspace failed oddly",
    );
  });

  it("avoids duplicate connect modals when empty and opens add/manage dialogs from the switcher once connected", async () => {
    const user = userEvent.setup();
    const emptyOnDocs = renderSidebarWithWorkspaces([]);

    expect(
      await screen.findByText("연결된 워크스페이스 없음"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "워크스페이스 연결" }),
    ).toBeNull();
    emptyOnDocs.view.unmount();

    const projectGateway = new FakeProjectBoardGateway();
    const emptyDocsRepoGateway = new FakeDocsRepositoryGateway();
    const emptyWorkspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const emptyOnBoard = render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={emptyWorkspaceGateway}>
          <DocumentsProvider gateway={new FakeDocumentsGateway()}>
            <ActiveProjectProvider
              projectGateway={projectGateway}
              docsRepositoryGateway={emptyDocsRepoGateway}
            >
              <MemoryRouter initialEntries={["/project"]}>
                <AppSidebar
                  collapseButtonRef={createRef()}
                  onCollapse={() => {}}
                  docsRepositoryGateway={emptyDocsRepoGateway}
                  repositoryGateway={emptyWorkspaceGateway}
                />
              </MemoryRouter>
            </ActiveProjectProvider>
          </DocumentsProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "워크스페이스 시작하기" }),
    ).toHaveAttribute("href", "/documents");
    emptyOnBoard.unmount();

    renderSidebarWithWorkspaces([projectWorkspace]);
    await user.click(
      await screen.findByRole("button", { name: /^워크스페이스 전환/ }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "새 워크스페이스 추가" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "새 워크스페이스 추가" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");

    await user.click(
      await screen.findByRole("button", { name: /^워크스페이스 전환/ }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "워크스페이스 설정" }),
    );
    expect(
      await screen.findByRole("dialog", { name: /워크스페이스 설정/ }),
    ).toBeVisible();
  });

  it("keeps long workspace titles truncated inside the sidebar width", async () => {
    renderSidebarWithWorkspaces([
      {
        ...projectWorkspace,
        title: "아주 긴 프로젝트 이름이 사이드바 너비를 넘지 않고 말줄임되어야 합니다",
      },
    ]);

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    expect(switcher.className).toContain("min-w-0");
    expect(switcher.querySelectorAll(".truncate").length).toBeGreaterThanOrEqual(2);
  });

  it("shows active workspace AI badge on nav link, background AI counts on switcher and dropdown items, and decrements immediately on exit", async () => {
    const user = userEvent.setup();
    const aiGateway = new FakeAiGateway();
    const makeRenderer = () => new FakeTerminalRenderer();

    // session-0: projectWorkspace, session-1 & session-2: standaloneWorkspace
    await terminalStoreFor(aiGateway, makeRenderer, projectWorkspace.id).open(
      "claude",
    );
    await terminalStoreFor(
      aiGateway,
      makeRenderer,
      standaloneWorkspace.id,
    ).open("codex");
    await terminalStoreFor(
      aiGateway,
      makeRenderer,
      standaloneWorkspace.id,
    ).open("antigravity");

    const { view } = renderSidebarWithWorkspaces(
      [projectWorkspace, standaloneWorkspace],
      projectWorkspace.id,
      aiGateway,
    );

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    await waitFor(() => expect(switcher).toHaveTextContent("Mockly Board"));

    // 주 메뉴 AI 링크에는 현재 활성 워크스페이스의 실행 개수(1)만 표시
    const aiNavLink = screen.getByRole("link", { name: /^AI/ });
    expect(within(aiNavLink).getByText("1")).toBeInTheDocument();

    // 전환기 영역에는 백그라운드 실행 개수(2) 표시
    expect(
      screen.getByText("다른 워크스페이스 AI 실행 중 2개"),
    ).toBeInTheDocument();

    const a11y = await axe.run(view.container);
    expect(a11y.violations).toEqual([]);

    // 드롭다운을 열면 각 워크스페이스 항목에 AI 실행 배지가 표시된다
    await user.click(switcher);
    const activeItem = await screen.findByRole("menuitemradio", {
      name: /Mockly Board/,
    });
    const backgroundItem = screen.getByRole("menuitemradio", {
      name: /Mockly-Company\/handbook/,
    });
    expect(within(activeItem).getByText("AI 1")).toBeInTheDocument();
    expect(within(backgroundItem).getByText("AI 2")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // 터미널 프로세스가 자연 종료(exit)되면 탭을 닫지 않아도 즉시 배지가 감소·제거된다
    act(() => {
      aiGateway.emitTerminal(0, { kind: "exit", exit_code: 0 });
      aiGateway.emitTerminal(1, { kind: "exit", exit_code: 0 });
    });

    await waitFor(() =>
      expect(within(aiNavLink).queryByText("1")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("다른 워크스페이스 AI 실행 중 1개"),
    ).toBeInTheDocument();

    act(() => {
      aiGateway.emitTerminal(2, { kind: "exit", exit_code: 0 });
    });

    await waitFor(() =>
      expect(
        screen.queryByText(/다른 워크스페이스 AI 실행 중/),
      ).not.toBeInTheDocument(),
    );
  });

  it("pins 내 대시보드 above the workspace switcher with an unread NEW count badge", async () => {
    const dashboardGateway = new FakePersonalDashboardGateway({
      viewerLogin: "hyeeun",
      tasks: [
        {
          workspaceId: projectWorkspace.id,
          workspaceTitle: "Mockly Board",
          projectOwner: "Mockly-Company",
          projectNumber: 1,
          projectTitle: "Mockly Board",
          repositoryFullName: "Mockly-Company/okf-knowledge-hub",
          issueNumber: 74,
          title: "대시보드 구현",
          url: "https://github.com/Mockly-Company/okf-knowledge-hub/issues/74",
          status: "ready",
          layer: "frontend",
          kind: "작업",
          dependsOn: null,
          predecessorDone: true,
          readyToStart: true,
          isNew: true,
          assignees: [{ login: "hyeeun" }],
          createdAt: "2026-11-14T01:00:00Z",
          updatedAt: "2026-11-14T06:00:00Z",
        },
      ],
      notifications: [
        {
          id: "n1",
          workspaceId: projectWorkspace.id,
          workspaceTitle: "Mockly Board",
          repositoryFullName: "Mockly-Company/okf-docs",
          kind: "open_pr",
          prNumber: 12,
          title: "docs: 기획 변경",
          summary: "변경 요약",
          authorLogin: "alice",
          url: "https://github.com/Mockly-Company/okf-docs/pull/12",
          primaryDocPath: "docs/spec.md",
          hasCompanionHtml: true,
          timestamp: "2026-11-14T07:00:00Z",
          isNew: true,
        },
      ],
    });

    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = [projectWorkspace];
    docsRepoGateway.activeWorkspaceId = projectWorkspace.id;

    const view = render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}>
          <ActiveProjectProvider
            projectGateway={FakeProjectBoardGateway.empty()}
            docsRepositoryGateway={docsRepoGateway}
          >
            <PersonalDashboardProvider gateway={dashboardGateway}>
              <DocumentsProvider gateway={new FakeDocumentsGateway()}>
                <MemoryRouter initialEntries={["/home"]}>
                  <AppSidebar collapseButtonRef={createRef()} onCollapse={() => {}} />
                </MemoryRouter>
              </DocumentsProvider>
            </PersonalDashboardProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const dashboardLink = await screen.findByRole("link", {
      name: /^내 대시보드/,
    });
    expect(dashboardLink).toHaveAttribute("href", "/home");
    expect(dashboardLink).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(within(dashboardLink).getByText("2")).toBeVisible());

    const switcher = await screen.findByRole("button", {
      name: /^워크스페이스 전환/,
    });
    // `내 대시보드` 링크가 DOM 상에서 워크스페이스 전환기보다 먼저 위치해야 한다
    expect(
      dashboardLink.compareDocumentPosition(switcher) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const a11y = await axe.run(view.container);
    expect(a11y.violations).toEqual([]);
  });
});
