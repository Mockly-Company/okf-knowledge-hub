import { createRef } from "react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { ActiveProjectProvider } from "@/features/active-project/ActiveProjectProvider";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(
  gateway: FakeWorkspaceConnectionGateway,
  initialPath = "/",
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

  it.each(["/", "/documents", "/project"])(
    "keeps the primary navigation divider directly below Ticket on %s",
    async (initialPath) => {
      renderSidebar(FakeWorkspaceConnectionGateway.connected(), initialPath);

      await screen.findByText("@hyeeun");
      const primaryNavigation = screen.getByRole("navigation", { name: "주 메뉴" });
      const divider = screen.getByRole("separator");

      expect(primaryNavigation.nextElementSibling).toBe(divider);
    },
  );

  it.each(["/", "/documents", "/project"])(
    "keeps Settings directly below Ticket on %s",
    async (initialPath) => {
      renderSidebar(FakeWorkspaceConnectionGateway.connected(), initialPath);

      await screen.findByText("@hyeeun");
      const primaryNavigation = screen.getByRole("navigation", { name: "주 메뉴" });
      const project = screen.getByRole("link", { name: "Ticket" });
      const settings = screen.getByRole("link", { name: "Settings" });

      expect(project.nextElementSibling).toBe(settings);
      expect(settings.parentElement).toBe(primaryNavigation);
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

describe("AppSidebar project search", () => {
  const linkedProject: ResolvedGithubProject = {
    id: "PVT_linked",
    owner: "Mockly-Company",
    number: 1,
    title: "Mockly Board",
    scope: "organization",
  };
  const otherProject: ResolvedGithubProject = {
    id: "PVT_other",
    owner: "Mockly-Company",
    number: 2,
    title: "Other Thing",
    scope: "organization",
  };

  function renderSidebarWithProjects(options: {
    linked: ResolvedGithubProject[];
    searchable: ResolvedGithubProject[] | Error;
  }) {
    const projectGateway = new FakeProjectBoardGateway();
    projectGateway.linkedProjects = options.linked;
    projectGateway.projectList = options.searchable;
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <DocumentsProvider gateway={new FakeDocumentsGateway()}>
            <ActiveProjectProvider
              projectGateway={projectGateway}
              workspaceGateway={workspaceGateway}
            >
              <MemoryRouter initialEntries={["/"]}>
                <AppSidebar collapseButtonRef={createRef()} onCollapse={() => {}} />
              </MemoryRouter>
            </ActiveProjectProvider>
          </DocumentsProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );
    return { projectGateway };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  async function openAddPanel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("button", { name: "프로젝트 추가" }),
    );
    await screen.findByRole("button", { name: "검색" });
  }

  it("searches by project name instead of org", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [],
      searchable: [linkedProject, otherProject],
    });
    await openAddPanel(user);

    const query = screen.getByLabelText("프로젝트 명");
    expect(query).toHaveAttribute("placeholder", "프로젝트 명으로 검색");
    await user.type(query, "other");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(
      await screen.findByRole("button", {
        name: "Other Thing · Mockly-Company #2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mockly Board/ }),
    ).toBeNull();
    // 이름 검색은 전체 목록을 가져와 화면에서 거른다. Org exact-match가 아니다.
    expect(projectGateway.calls).toContainEqual({
      method: "listGithubProjects",
      owner: undefined,
    });
  });

  it("excludes already-linked projects from search results", async () => {
    const user = userEvent.setup();
    renderSidebarWithProjects({
      linked: [linkedProject],
      searchable: [linkedProject, otherProject],
    });
    await openAddPanel(user);

    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(
      await screen.findByRole("button", {
        name: "Other Thing · Mockly-Company #2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Mockly Board/ }),
    ).toBeNull();
  });

  it("hints when the only match is already linked", async () => {
    const user = userEvent.setup();
    renderSidebarWithProjects({
      linked: [linkedProject],
      searchable: [linkedProject],
    });
    await openAddPanel(user);

    await user.type(screen.getByLabelText("프로젝트 명"), "mockly");
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(
      await screen.findByText("이미 연결된 프로젝트입니다."),
    ).toBeInTheDocument();
  });

  it("removes a project from the results right after linking it", async () => {
    const user = userEvent.setup();
    renderSidebarWithProjects({ linked: [], searchable: [otherProject] });
    await openAddPanel(user);

    await user.click(screen.getByRole("button", { name: "검색" }));
    const result = await screen.findByRole("button", {
      name: "Other Thing · Mockly-Company #2",
    });
    await user.click(result);

    // 연결 후 패널이 닫힌다. 다시 열어 검색하면 연결된 항목은 제외된다.
    await user.click(await screen.findByRole("button", { name: "프로젝트 추가" }));
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(
      await screen.findByText("이미 연결된 프로젝트입니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Other Thing/ }),
    ).toBeNull();
  });

  it("says when project search results were truncated", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [linkedProject],
      searchable: [otherProject],
    });
    projectGateway.listTruncated = true;

    await user.click(await screen.findByRole("button", { name: "프로젝트 추가" }));
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(
      await screen.findByText("프로젝트가 많아 일부만 검색했습니다."),
    ).toBeInTheDocument();
  });

  it("shows an error when switching projects fails", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [linkedProject, otherProject],
      searchable: [],
    });
    const trigger = await screen.findByRole("combobox", {
      name: "활성 프로젝트",
    });
    // 자동 선택이 끝난 뒤부터 실패를 유도한다.
    await waitFor(() =>
      expect(trigger).toHaveTextContent("Mockly Board"),
    );
    projectGateway.setActiveProject = async () => {
      throw new Error("전환 실패");
    };

    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", {
        name: "Other Thing · Mockly-Company #2",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("전환 실패");
    // 실패한 선택으로 넘어가지 않는다.
    expect(
      screen.getByRole("combobox", { name: "활성 프로젝트" }),
    ).toHaveTextContent("Mockly Board");
  });

  it("lists only linked projects without a local option", async () => {
    const user = userEvent.setup();
    renderSidebarWithProjects({
      linked: [linkedProject, otherProject],
      searchable: [],
    });
    const trigger = await screen.findByRole("combobox", {
      name: "활성 프로젝트",
    });
    await waitFor(() => expect(trigger).toHaveTextContent("Mockly Board"));

    await user.click(trigger);

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Mockly Board"),
      expect.stringContaining("Other Thing"),
    ]);
  });

  it("shows the backend reason when linking fails", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [],
      searchable: [otherProject],
    });
    projectGateway.linkGithubProject = async () => {
      throw new Error("워크스페이스가 연결되지 않았습니다.");
    };
    await openAddPanel(user);

    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Other Thing · Mockly-Company #2",
      }),
    );

    expect(
      await screen.findByText(/프로젝트 연결에 실패했습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/워크스페이스가 연결되지 않았습니다/),
    ).toBeInTheDocument();
  });

  it("offers a retry when selecting right after linking fails", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [],
      searchable: [otherProject],
    });
    let selectCalls = 0;
    projectGateway.setActiveProject = async () => {
      selectCalls += 1;
      if (selectCalls === 1) {
        throw new Error("연결되지 않은 Project입니다.");
      }
      return { docsRepository: null };
    };
    await openAddPanel(user);

    await user.click(screen.getByRole("button", { name: "검색" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Other Thing · Mockly-Company #2",
      }),
    );

    // 연결은 됐으니 결과에서는 빠지고, 선택만 다시 시도하면 된다.
    expect(
      await screen.findByText(/프로젝트를 연결했지만 선택하지 못했습니다/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/연결되지 않은 Project입니다/).length,
    ).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "다시 선택" }));

    expect(
      screen.queryByRole("button", { name: "검색" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "활성 프로젝트" }),
    ).toHaveTextContent("Other Thing");
  });

  it("shows the raw reason when switching fails with a string error", async () => {
    const user = userEvent.setup();
    const { projectGateway } = renderSidebarWithProjects({
      linked: [linkedProject, otherProject],
      searchable: [],
    });
    const trigger = await screen.findByRole("combobox", {
      name: "활성 프로젝트",
    });
    await waitFor(() =>
      expect(trigger).toHaveTextContent("Mockly Board"),
    );
    projectGateway.setActiveProject = async () => {
      throw "Command set_active_github_project failed oddly";
    };

    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", {
        name: "Other Thing · Mockly-Company #2",
      }),
    );

    // 사유 없는 "전환에 실패했습니다"만 보여주면 진단이 안 된다.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Command set_active_github_project failed oddly",
    );
  });

  it("keeps long search result labels inside the sidebar width", async () => {
    const user = userEvent.setup();
    renderSidebarWithProjects({
      linked: [],
      searchable: [
        {
          ...otherProject,
          title:
            "아주 긴 프로젝트 이름이 사이드바 너비를 넘지 않고 말줄임되어야 합니다",
        },
      ],
    });
    await openAddPanel(user);

    await user.click(screen.getByRole("button", { name: "검색" }));
    const result = await screen.findByRole("button", { name: /아주 긴 프로젝트/ });

    expect(result.className).toContain("min-w-0");
    expect(result.querySelector(".truncate")).not.toBeNull();
  });
});
