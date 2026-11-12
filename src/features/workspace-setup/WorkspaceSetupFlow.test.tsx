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

  it("creates a standalone document workspace without a project and can attach/detach a board later", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    workspaceGateway.currentWorkspace = null;
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.projectList = [
      {
        id: "PVT_roadmap",
        owner: "Mockly-Company",
        number: 7,
        title: "제품 로드맵",
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

    // 관리 다이얼로그에서 나중에 GitHub Project 보드를 연결할 수 있다.
    await user.click(
      await screen.findByRole("button", { name: "GitHub Project 보드 연결" }),
    );
    await user.click(await screen.findByRole("button", { name: /제품 로드맵/ }));

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "제품 로드맵|project=PVT_roadmap|docs=Mockly-Company/mockly-knowledge",
      ),
    );

    // 보드만 연결 해제해도 문서 저장소 단독 워크스페이스는 그대로 유지된다.
    await user.click(
      await screen.findByRole("button", { name: "보드만 연결 해제" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "mockly-knowledge|project=none|docs=Mockly-Company/mockly-knowledge",
      ),
    );
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

  it("renders nested Project > 소속 문서 저장소 hierarchy in WorkspaceManageDialog and WorkspaceContextBar", async () => {
    const user = userEvent.setup();
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.projectList = [
      {
        id: "PVT_roadmap",
        owner: "Mockly-Company",
        number: 7,
        title: "제품 로드맵",
        scope: "organization",
      },
    ];
    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createStandaloneWorkspace(
      "R_1",
      "Mockly-Company/mockly-knowledge",
    );
    const documentsGateway = new FakeDocumentsGateway();

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={workspaceGateway}>
          <ActiveProjectProvider
            projectGateway={projectGateway}
            docsRepositoryGateway={docsGateway}
          >
            <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
              <WorkspaceContextBar
                docsRepositoryGateway={docsGateway}
                repositoryGateway={workspaceGateway}
              />
            </DocumentsProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    // 1. 단독 문서 모드: WorkspaceContextBar에서 단독 상태 확인 후 설정 다이얼로그 열기
    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    expect(within(contextBar).getByText("문서 저장소 단독")).toBeInTheDocument();
    expect(
      within(contextBar).getByText("Mockly-Company/mockly-knowledge"),
    ).toBeInTheDocument();
    expect(within(contextBar).getByText("상위 Project 없음")).toBeInTheDocument();

    await user.click(
      within(contextBar).getByRole("button", { name: "워크스페이스 설정" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /워크스페이스 설정/,
    });
    const unlinkedParent = within(dialog).getByRole("region", {
      name: "상위 GitHub Project 미연결",
    });
    const standaloneDocsSection = within(dialog).getByRole("region", {
      name: "단독 문서 저장소 설정",
    });
    expect(
      within(unlinkedParent).queryByRole("region", {
        name: "단독 문서 저장소 설정",
      }),
    ).toBeNull();
    expect(standaloneDocsSection).toHaveTextContent(
      "Mockly-Company/mockly-knowledge",
    );

    // 2. Project 연결 후: 상위 GitHub Project 설정 컨테이너 내부에 소속 문서 저장소 설정이 중첩된다
    await user.click(
      within(unlinkedParent).getByRole("button", {
        name: "GitHub Project 보드 연결",
      }),
    );
    await user.click(await screen.findByRole("button", { name: /제품 로드맵/ }));

    const projectSection = await within(dialog).findByRole("region", {
      name: "상위 GitHub Project 설정",
    });
    const nestedDocsGroup = within(projectSection).getByRole("group", {
      name: "소속 문서 저장소 설정",
    });
    expect(nestedDocsGroup).toHaveTextContent(
      "Mockly-Company/mockly-knowledge",
    );

    await user.click(within(dialog).getByRole("button", { name: "닫기" }));

    const updatedBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    expect(
      within(updatedBar).getByText("Project · Mockly-Company #7"),
    ).toBeInTheDocument();
    expect(within(updatedBar).getByText("제품 로드맵")).toBeInTheDocument();
    expect(
      within(updatedBar).getByText(
        "└ 소속 문서 저장소 · Mockly-Company/mockly-knowledge",
      ),
    ).toBeInTheDocument();
  });
});
