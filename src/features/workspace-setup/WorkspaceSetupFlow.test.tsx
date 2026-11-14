import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActiveProjectProvider,
  useActiveProject,
} from "@/features/active-project/ActiveProjectProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { WorkspaceContextBar } from "./WorkspaceContextBar";
import { WorkspaceSetupFlow } from "./WorkspaceSetupFlow";
import { WorkspaceManageDialog } from "./WorkspaceManageDialog";

function ActiveWorkspaceProbe() {
  const { activeWorkspace } = useActiveProject();
  return (
    <p data-testid="active-ws">
      {activeWorkspace
        ? `${activeWorkspace.title}|project=${activeWorkspace.project?.id ?? "none"}|docs=${activeWorkspace.docsRepository?.fullName ?? "none"}`
        : "empty"}
    </p>
  );
}

describe("WorkspaceSetupFlow & WorkspaceManageDialog", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("provides inline GitHub login when signed out instead of forcing Settings navigation", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.disconnected();
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    const documentsGateway = new FakeDocumentsGateway();

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <WorkspaceSetupFlow
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const loginButton = await screen.findByRole("button", {
      name: "GitHub로 로그인",
    });
    await user.click(loginButton);

    expect(
      await screen.findByRole("button", { name: /GitHub 인증 페이지 열기/ }),
    ).toBeInTheDocument();
  });

  it("auto-loads projects and creates a unified Project + Document Repo workspace with same-owner priority", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.currentWorkspace = null;
    workspaceGateway.repositories = [
      {
        id: "R_other",
        owner: "Other-Org",
        name: "random-app",
        fullName: "Other-Org/random-app",
        defaultBranch: "main",
        isEmpty: false,
      },
      {
        id: "R_mockly_docs",
        owner: "Mockly-Company",
        name: "mockly-docs",
        fullName: "Mockly-Company/mockly-docs",
        defaultBranch: "main",
        isEmpty: false,
      },
    ];
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.projectList = [
      {
        id: "PVT_sprint",
        owner: "Mockly-Company",
        number: 3,
        title: "Mockly Sprint",
        scope: "organization",
      },
    ];
    const docsGateway = new FakeDocsRepositoryGateway();
    docsGateway.prepareResult = {
      parentDirectory: "/app/repos/Mockly-Company",
      alreadyCloned: true,
    };
    const documentsGateway = new FakeDocumentsGateway();

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <ActiveWorkspaceProbe />
              <WorkspaceSetupFlow
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    // "검색" 버튼을 누르지 않아도 접근 가능한 GitHub Project가 바로 나타난다.
    const projectItem = await screen.findByRole("button", {
      name: /Mockly Sprint/,
    });
    await user.click(projectItem);

    // 2단계: 선택한 Project의 소속 문서 저장소를 고르며 같은 소유자 배지가 먼저 표시된다.
    expect(await screen.findByText("같은 소유자")).toBeInTheDocument();
    const repoButtons = screen
      .getAllByRole("button")
      .map((el) => el.textContent ?? "")
      .filter((text) => text.includes("/"));
    expect(repoButtons[0]).toContain("Mockly-Company/mockly-docs");

    await user.click(
      screen.getByRole("button", { name: /Mockly-Company\/mockly-docs/ }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "Mockly Sprint|project=PVT_sprint|docs=Mockly-Company/mockly-docs",
      ),
    );
  });

  it("creates a standalone document workspace without a project and keeps WorkspaceManageDialog read-only on project settings", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.currentWorkspace = null;
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    docsGateway.prepareResult = {
      parentDirectory: "/app/repos/Mockly-Company",
      alreadyCloned: true,
    };
    const documentsGateway = new FakeDocumentsGateway();

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <ActiveWorkspaceProbe />
              <WorkspaceSetupFlow
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
              <WorkspaceManageDialog
                open={true}
                onOpenChange={() => {}}
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    await user.click(
      await screen.findByRole("tab", { name: "문서 저장소만 관리" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Mockly-Company\/mockly-knowledge/,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "mockly-knowledge|project=none|docs=Mockly-Company/mockly-knowledge",
      ),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "워크스페이스 설정",
    });
    expect(
      within(dialog).getByText(
        "문서 전용 워크스페이스 · 연결된 GitHub Project가 없습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "GitHub Project 보드 연결" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "다른 Project로 변경" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "보드만 연결 해제" }),
    ).toBeNull();
  });

  it("supports keyboard arrow/Home/End tab switching and links tabs to tabpanel", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.currentWorkspace = null;
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    const documentsGateway = new FakeDocumentsGateway();

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <WorkspaceSetupFlow
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const projectTab = await screen.findByRole("tab", {
      name: "Project와 함께 시작",
    });
    const docsTab = screen.getByRole("tab", { name: "문서 저장소만 관리" });
    const panel = screen.getByRole("tabpanel");

    expect(projectTab).toHaveAttribute("aria-selected", "true");
    expect(docsTab).toHaveAttribute("aria-selected", "false");
    expect(panel).toHaveAttribute("aria-labelledby", projectTab.id);

    projectTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(docsTab).toHaveFocus();
    expect(docsTab).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-labelledby", docsTab.id);
    expect(
      await screen.findByText(/GitHub Project 보드 없이 문서 저장소만 단독으로 연결합니다/),
    ).toBeInTheDocument();

    await user.keyboard("{Home}");
    expect(projectTab).toHaveFocus();
    expect(projectTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(docsTab).toHaveFocus();
    expect(docsTab).toHaveAttribute("aria-selected", "true");
  });

  it("renders flat WorkspaceContextBar labels without hierarchy glyphs and read-only 선택된 Project in WorkspaceManageDialog", async () => {
    const { useState } = await import("react");
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createStandaloneWorkspace(
      "R_1",
      "Mockly-Company/mockly-knowledge",
    );
    await docsGateway.createProjectWorkspace(
      {
        id: "PVT_roadmap",
        owner: "Mockly-Company",
        number: 7,
        title: "제품 로드맵",
        scope: "organization",
      },
      {
        repositoryId: "R_2",
        fullName: "Mockly-Company/roadmap-docs",
      },
    );
    await docsGateway.setActiveWorkspace("repo:R_1");
    const documentsGateway = new FakeDocumentsGateway();

    function ManageHarness() {
      const [manageOpen, setManageOpen] = useState(false);
      return (
        <>
          <WorkspaceContextBar
            docsRepositoryGateway={docsGateway}
            repositoryGateway={workspaceGateway}
          />
          <button type="button" onClick={() => setManageOpen(true)}>
            open-sidebar-manage
          </button>
          <WorkspaceManageDialog
            open={manageOpen}
            onOpenChange={setManageOpen}
            docsRepositoryGateway={docsGateway}
            repositoryGateway={workspaceGateway}
          />
        </>
      );
    }

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <ManageHarness />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    expect(within(contextBar).getByText("문서 전용")).toBeInTheDocument();
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/mockly-knowledge"),
    ).toBeInTheDocument();
    expect(within(contextBar).queryByText("상위 Project 없음")).toBeNull();
    expect(within(contextBar).queryByText(/└/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "open-sidebar-manage" }));
    const dialog = await screen.findByRole("dialog", {
      name: "워크스페이스 설정",
    });
    const standaloneTab = within(dialog).getByRole("tab", {
      name: /mockly-knowledge \(문서 전용\) · 사용 중/,
    });
    const projectTab = within(dialog).getByRole("tab", {
      name: "제품 로드맵",
    });
    expect(standaloneTab).toHaveAttribute("aria-selected", "true");
    expect(projectTab).toHaveAttribute("aria-selected", "false");

    await user.click(projectTab);
    expect(projectTab).toHaveAttribute("aria-selected", "true");
    const projectSection = within(dialog).getByRole("region", {
      name: "선택된 Project",
    });
    expect(projectSection).toHaveTextContent("Mockly-Company #7");
    expect(projectSection).toHaveTextContent("제품 로드맵");
    const docsSection = within(dialog).getByRole("region", {
      name: "문서 저장소",
    });
    expect(docsSection).toHaveTextContent("Mockly-Company/roadmap-docs");
    expect(docsSection).toHaveTextContent("저장소 변경");
    expect(within(dialog).queryByText(/└/)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "다른 Project로 변경" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "보드만 연결 해제" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "닫기" }));
    // 비활성 탭만 보고 닫았으므로 뒤 화면의 활성 워크스페이스는 그대로 유지된다.
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/mockly-knowledge"),
    ).toBeInTheDocument();
  });

  it("manages inactive and active workspace tabs independently without unintended background switching and closes only when empty", async () => {
    const { useState } = await import("react");
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.repositories = [
      {
        id: "R_alpha",
        owner: "Mockly-Company",
        name: "alpha-docs",
        fullName: "Mockly-Company/alpha-docs",
        defaultBranch: "main",
        isEmpty: false,
      },
      {
        id: "R_beta",
        owner: "Mockly-Company",
        name: "beta-docs",
        fullName: "Mockly-Company/beta-docs",
        defaultBranch: "main",
        isEmpty: false,
      },
      {
        id: "R_beta_new",
        owner: "Mockly-Company",
        name: "beta-v2-docs",
        fullName: "Mockly-Company/beta-v2-docs",
        defaultBranch: "main",
        isEmpty: false,
      },
      {
        id: "R_solo",
        owner: "Mockly-Company",
        name: "solo-notes",
        fullName: "Mockly-Company/solo-notes",
        defaultBranch: "main",
        isEmpty: false,
      },
    ];
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    docsGateway.prepareResult = {
      parentDirectory: "/app/repos/Mockly-Company",
      alreadyCloned: true,
    };
    await docsGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha Project",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsGateway.createProjectWorkspace(
      {
        id: "PVT_beta",
        owner: "Mockly-Company",
        number: 2,
        title: "Beta Project",
        scope: "organization",
      },
      { repositoryId: "R_beta", fullName: "Mockly-Company/beta-docs" },
    );
    await docsGateway.createStandaloneWorkspace("R_solo", "Mockly-Company/solo-notes");
    await docsGateway.setActiveWorkspace("PVT_alpha");
    const documentsGateway = new FakeDocumentsGateway();

    function ManageDialogHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <ActiveWorkspaceProbe />
          <WorkspaceContextBar
            docsRepositoryGateway={docsGateway}
            repositoryGateway={workspaceGateway}
          />
          <output data-testid="dialog-open">{open ? "open" : "closed"}</output>
          <WorkspaceManageDialog
            open={open}
            onOpenChange={setOpen}
            docsRepositoryGateway={docsGateway}
            repositoryGateway={workspaceGateway}
          />
        </>
      );
    }

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <ManageDialogHarness />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "워크스페이스 설정" });
    expect(screen.getByTestId("active-ws")).toHaveTextContent("Alpha Project|project=PVT_alpha|docs=Mockly-Company/alpha-docs");

    // 1. 비활성 Beta 탭에서 문서 저장소 변경해도 활성 Alpha는 유지된다
    await user.click(within(dialog).getByRole("tab", { name: "Beta Project" }));
    await user.click(within(dialog).getByRole("button", { name: "저장소 변경" }));
    await user.click(await within(dialog).findByRole("button", { name: /Mockly-Company\/beta-v2-docs/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("region", { name: "문서 저장소" })).toHaveTextContent(
        "Mockly-Company/beta-v2-docs",
      ),
    );
    expect(screen.getByTestId("active-ws")).toHaveTextContent("Alpha Project|project=PVT_alpha|docs=Mockly-Company/alpha-docs");

    // 2. 비활성 Beta 탭 해제 시 모달이 열려 있고 남은 탭으로 포커스가 이동하며, Alpha는 유지된다
    await user.click(within(dialog).getByRole("button", { name: "워크스페이스 연결 해제" }));
    await user.click(within(dialog).getByRole("button", { name: "연결 해제 확인" }));
    await waitFor(() =>
      expect(within(dialog).queryByRole("tab", { name: "Beta Project" })).toBeNull(),
    );
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("open");
    expect(screen.getByTestId("active-ws")).toHaveTextContent("Alpha Project|project=PVT_alpha");
    await waitFor(() => {
      const remainingTab = within(dialog).getByRole("tab", { name: /solo-notes \(문서 전용\)/ });
      expect(remainingTab).toHaveFocus();
    });

    // 3. '사용 중'인 Alpha 탭을 해제하면 남은 solo-notes로 활성 워크스페이스가 자동 전환된다
    await user.click(within(dialog).getByRole("tab", { name: /Alpha Project · 사용 중/ }));
    await user.click(within(dialog).getByRole("button", { name: "워크스페이스 연결 해제" }));
    await user.click(within(dialog).getByRole("button", { name: "연결 해제 확인" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("solo-notes|project=none|docs=Mockly-Company/solo-notes"),
    );
    expect(screen.getByTestId("dialog-open")).toHaveTextContent("open");
    expect(
      within(dialog).getByRole("tab", { name: /solo-notes \(문서 전용\) · 사용 중/ }),
    ).toBeInTheDocument();

    // 4. 마지막 남은 워크스페이스까지 해제하면 모달이 자동으로 닫힌다
    await user.click(within(dialog).getByRole("button", { name: "워크스페이스 연결 해제" }));
    await user.click(within(dialog).getByRole("button", { name: "연결 해제 확인" }));
    await waitFor(() =>
      expect(screen.getByTestId("dialog-open")).toHaveTextContent("closed"),
    );
  });
});
