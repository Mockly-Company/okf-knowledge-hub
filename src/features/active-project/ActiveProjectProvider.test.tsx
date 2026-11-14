import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRunningTerminalCounts,
  terminalStoreFor,
} from "@/features/ai/TerminalSessionStore";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
import { TestQueryProvider } from "@/test/queryTestUtils";
import {
  ActiveProjectProvider,
  LAST_ACTIVE_PROJECT_KEY,
  useActiveProject,
} from "./ActiveProjectProvider";

const project: ResolvedGithubProject = {
  id: "PVT_1",
  owner: "Mockly-Company",
  number: 1,
  title: "Board",
  scope: "organization",
};

const secondProject: ResolvedGithubProject = {
  id: "PVT_2",
  owner: "Mockly-Company",
  number: 2,
  title: "Second Board",
  scope: "organization",
};

function Probe() {
  const { activeProjectId, docsMissing } = useActiveProject();
  return (
    <p>
      active={activeProjectId ?? "none"} missing={String(docsMissing)}
    </p>
  );
}

function renderProvider(projectGateway: FakeProjectBoardGateway) {
  render(
    <TestQueryProvider>
      <ActiveProjectProvider projectGateway={projectGateway}>
        <Probe />
      </ActiveProjectProvider>
    </TestQueryProvider>,
  );
}

describe("ActiveProjectProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("reports the docs repository returned by the backend", async () => {
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];
    projects.docsRepositories.set("PVT_1", {
      repositoryId: "R_1",
      fullName: "Mockly-Company/docs",
    });

    renderProvider(projects);

    expect(
      await screen.findByText("active=PVT_1 missing=false"),
    ).toBeInTheDocument();
  });

  it("reports missing docs when the project has no docs repository", async () => {
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];

    renderProvider(projects);

    expect(
      await screen.findByText("active=PVT_1 missing=true"),
    ).toBeInTheDocument();
  });

  it("aligns the backend with the stored selection once on startup", async () => {
    localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, "PVT_1");
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];

    renderProvider(projects);

    await screen.findByText("active=PVT_1 missing=false");
    await waitFor(() =>
      expect(
        projects.calls.filter((call) => call.method === "setActiveProject"),
      ).toHaveLength(1),
    );
  });

  it("keeps the stored selection when the linked project list fails to load", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, "PVT_1");
    const projects = FakeProjectBoardGateway.empty();
    const list = vi
      .spyOn(projects, "listLinkedProjects")
      .mockRejectedValue(new Error("일시적 실패"));

    renderProvider(projects);

    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.getByText("active=PVT_1 missing=false")).toBeInTheDocument();
    expect(localStorage.getItem(LAST_ACTIVE_PROJECT_KEY)).toBe("PVT_1");
  });

  it("manages unified project and standalone document workspaces", async () => {
    const user = userEvent.setup();
    const docsGateway = new FakeDocsRepositoryGateway();
    const projectGateway = FakeProjectBoardGateway.empty();

    function WorkspaceHarness() {
      const ctx = useActiveProject();
      return (
        <div>
          <p data-testid="summary">
            ws={ctx.activeWorkspaceId ?? "none"} title={ctx.activeWorkspaceTitle} project=
            {ctx.activeProjectId ?? "none"} projectTitle={ctx.activeProjectTitle} docs=
            {ctx.activeWorkspace?.docsRepository?.fullName ?? "none"} missing=
            {String(ctx.docsMissing)} count={ctx.workspaces.length}
          </p>
          <button
            type="button"
            onClick={() =>
              void ctx.createStandaloneWorkspace("R_specs", "Mockly-Company/tech-specs")
            }
          >
            단독 생성
          </button>
          <button
            type="button"
            onClick={() =>
              void ctx.createProjectWorkspace(project, {
                repositoryId: "R_board_docs",
                fullName: "Mockly-Company/board-docs",
              })
            }
          >
            프로젝트 생성
          </button>
          <button
            type="button"
            onClick={() => void ctx.selectWorkspace("repo:R_specs")}
          >
            단독 전환
          </button>
          <button
            type="button"
            onClick={() =>
              void ctx.attachProjectToWorkspace("repo:R_specs", {
                ...project,
                id: "PVT_2",
                number: 2,
                title: "Q4 로드맵",
              })
            }
          >
            보드 연결
          </button>
          <button
            type="button"
            onClick={() => void ctx.detachProjectFromWorkspace("repo:R_specs")}
          >
            보드 해제
          </button>
          <button
            type="button"
            onClick={() => void ctx.removeWorkspace("repo:R_specs")}
          >
            단독 삭제
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsGateway}
        >
          <WorkspaceHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    expect(await screen.findByTestId("summary")).toHaveTextContent(
      "ws=none title=연결된 워크스페이스 없음 project=none projectTitle=선택된 프로젝트 없음 docs=none missing=false count=0",
    );

    await user.click(screen.getByRole("button", { name: "단독 생성" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=repo:R_specs title=tech-specs project=none projectTitle=문서 전용 (보드 연결 없음) docs=Mockly-Company/tech-specs missing=false count=1",
      ),
    );

    await user.click(screen.getByRole("button", { name: "프로젝트 생성" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=PVT_1 title=Board project=PVT_1 projectTitle=Board docs=Mockly-Company/board-docs missing=false count=2",
      ),
    );

    await user.click(screen.getByRole("button", { name: "단독 전환" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=repo:R_specs title=tech-specs project=none projectTitle=문서 전용 (보드 연결 없음)",
      ),
    );

    await user.click(screen.getByRole("button", { name: "보드 연결" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=repo:R_specs title=Q4 로드맵 project=PVT_2 projectTitle=Q4 로드맵 docs=Mockly-Company/tech-specs",
      ),
    );

    await user.click(screen.getByRole("button", { name: "보드 해제" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=repo:R_specs title=tech-specs project=none projectTitle=문서 전용 (보드 연결 없음)",
      ),
    );

    await user.click(screen.getByRole("button", { name: "단독 삭제" }));
    await waitFor(() =>
      expect(screen.getByTestId("summary")).toHaveTextContent(
        "ws=PVT_1 title=Board project=PVT_1 projectTitle=Board docs=Mockly-Company/board-docs missing=false count=1",
      ),
    );
  });

  it("optimistically updates active workspace without blocking on a pending listWorkspaces refetch", async () => {
    const user = userEvent.setup();
    const docsGateway = new FakeDocsRepositoryGateway();
    const projectGateway = FakeProjectBoardGateway.empty();

    function OptimisticHarness() {
      const ctx = useActiveProject();
      return (
        <div>
          <p data-testid="optimistic">
            ws={ctx.activeWorkspaceId ?? "none"} title={ctx.activeWorkspaceTitle} listing=
            {String(ctx.isListing)}
          </p>
          <button
            type="button"
            onClick={() =>
              void ctx.createStandaloneWorkspace("R_fast", "Mockly-Company/fast-docs")
            }
          >
            빠른 생성
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsGateway}
        >
          <OptimisticHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("optimistic")).toHaveTextContent(
        "ws=none title=연결된 워크스페이스 없음 listing=false",
      ),
    );

    // 초기 조회 이후 백그라운드 listWorkspaces 재조회가 지연되더라도 낙관 갱신이 즉시 반영된다.
    let releaseRefetch!: () => void;
    const originalList = docsGateway.listWorkspaces.bind(docsGateway);
    vi.spyOn(docsGateway, "listWorkspaces").mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseRefetch = resolve;
      });
      return originalList();
    });

    await user.click(screen.getByRole("button", { name: "빠른 생성" }));

    await waitFor(() =>
      expect(screen.getByTestId("optimistic")).toHaveTextContent(
        "ws=repo:R_fast title=fast-docs listing=false",
      ),
    );

    releaseRefetch?.();
  });

  it("aborts selectWorkspace before mutating backend when registered before-switch guard returns false, and proceeds when it returns true", async () => {
    const user = userEvent.setup();
    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createStandaloneWorkspace("R_a", "Mockly-Company/docs-a");
    await docsGateway.createStandaloneWorkspace("R_b", "Mockly-Company/docs-b");
    await docsGateway.setActiveWorkspace("repo:R_a");

    let allowSwitch = false;
    const guardSpy = vi.fn(async () => allowSwitch);
    const setActiveSpy = vi.spyOn(docsGateway, "setActiveWorkspace");

    function GuardHarness() {
      const ctx = useActiveProject();
      useEffect(() => {
        return ctx.registerBeforeWorkspaceSwitch?.(guardSpy);
      }, [ctx]);
      return (
        <div>
          <output data-testid="active-ws">
            {ctx.activeWorkspaceId ?? "none"}
          </output>
          <output data-testid="select-error">
            {ctx.selectError ?? "none"}
          </output>
          <button
            type="button"
            onClick={() => void ctx.selectWorkspace("repo:R_b")}
          >
            B로 전환
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={FakeProjectBoardGateway.empty()}
          docsRepositoryGateway={docsGateway}
        >
          <GuardHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("repo:R_a"),
    );
    setActiveSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "B로 전환" }));

    await waitFor(() => expect(guardSpy).toHaveBeenCalledWith("repo:R_b"));
    expect(setActiveSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-ws")).toHaveTextContent("repo:R_a");
    expect(screen.getByTestId("select-error")).toHaveTextContent(
      /저장하지 못한 문서 초안/,
    );

    allowSwitch = true;
    await user.click(screen.getByRole("button", { name: "B로 전환" }));

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("repo:R_b"),
    );
    expect(setActiveSpy).toHaveBeenCalledWith("repo:R_b");
    expect(screen.getByTestId("select-error")).toHaveTextContent("none");
  });

  it("blocks createStandaloneWorkspace, createProjectWorkspace, connectWorkspaceDocs replacement, and detachProjectFromWorkspace when a beforeWorkspaceSwitch guard rejects", async () => {
    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createProjectWorkspace(project, {
      repositoryId: "R_a",
      fullName: "Mockly-Company/docs-a",
    });

    const createStandaloneSpy = vi.spyOn(
      docsGateway,
      "createStandaloneWorkspace",
    );
    const createProjectSpy = vi.spyOn(docsGateway, "createProjectWorkspace");
    const connectDocsSpy = vi.spyOn(docsGateway, "connectWorkspaceDocs");
    const detachSpy = vi.spyOn(docsGateway, "detachProject");

    let capturedCtx: ReturnType<typeof useActiveProject> | null = null;
    function CaptureHarness() {
      const ctx = useActiveProject();
      capturedCtx = ctx;
      useEffect(() => {
        return ctx.registerBeforeWorkspaceSwitch?.(async () => false);
      }, [ctx]);
      return (
        <output data-testid="active-ws">
          {ctx.activeWorkspaceId ?? "none"}
        </output>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={FakeProjectBoardGateway.empty()}
          docsRepositoryGateway={docsGateway}
        >
          <CaptureHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_1"),
    );

    await expect(
      capturedCtx!.createStandaloneWorkspace("R_new", "Mockly-Company/new-docs"),
    ).rejects.toThrow(/저장하지 못한 문서 초안/);
    expect(createStandaloneSpy).not.toHaveBeenCalled();

    await expect(
      capturedCtx!.createProjectWorkspace(secondProject, {
        repositoryId: "R_2",
        fullName: "Mockly-Company/docs-2",
      }),
    ).rejects.toThrow(/저장하지 못한 문서 초안/);
    expect(createProjectSpy).not.toHaveBeenCalled();

    await expect(
      capturedCtx!.connectWorkspaceDocs(
        "PVT_1",
        "R_replaced",
        "Mockly-Company/replaced-docs",
      ),
    ).rejects.toThrow(/저장하지 못한 문서 초안/);
    expect(connectDocsSpy).not.toHaveBeenCalled();

    await expect(
      capturedCtx!.detachProjectFromWorkspace("PVT_1"),
    ).rejects.toThrow(/저장하지 못한 문서 초안/);
    expect(detachSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_1");
  });

  it("migrates terminals to the newly detached workspace id instead of a pre-existing standalone workspace sharing the same repositoryId", async () => {
    const user = userEvent.setup();
    const aiGateway = new FakeAiGateway();
    const docsGateway = new FakeDocsRepositoryGateway();
    const makeRenderer = () => new FakeTerminalRenderer();

    await docsGateway.createStandaloneWorkspace(
      "R_shared",
      "Mockly-Company/shared-docs",
    );
    await docsGateway.createProjectWorkspace(project, {
      repositoryId: "R_shared",
      fullName: "Mockly-Company/shared-docs",
    });
    await docsGateway.setActiveWorkspace("PVT_1");

    await terminalStoreFor(aiGateway, makeRenderer, "repo:R_shared").open(
      "codex",
    );
    await terminalStoreFor(aiGateway, makeRenderer, "PVT_1").open("claude");
    expect(getRunningTerminalCounts(aiGateway)).toEqual({
      "repo:R_shared": 1,
      PVT_1: 1,
    });

    function DetachSharedHarness() {
      const ctx = useActiveProject();
      return (
        <div>
          <output data-testid="active-ws">
            {ctx.activeWorkspaceId ?? "none"}
          </output>
          <button
            type="button"
            onClick={() => void ctx.detachProjectFromWorkspace("PVT_1")}
          >
            공유 저장소 보드 해제
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={FakeProjectBoardGateway.empty()}
          docsRepositoryGateway={docsGateway}
          aiGateway={aiGateway}
        >
          <DetachSharedHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_1"),
    );

    await user.click(
      screen.getByRole("button", { name: "공유 저장소 보드 해제" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "repo:R_shared:2",
      ),
    );
    expect(getRunningTerminalCounts(aiGateway)).toEqual({
      "repo:R_shared": 1,
      "repo:R_shared:2": 1,
    });
  });

  it("closes workspace terminals on removeWorkspace or docs repository replacement, and migrates terminals when attachProject / detachProject changes workspace.id with the same docsRepository", async () => {
    const user = userEvent.setup();
    const aiGateway = new FakeAiGateway();
    const docsGateway = new FakeDocsRepositoryGateway();
    const projectGateway = FakeProjectBoardGateway.empty();
    const makeRenderer = () => new FakeTerminalRenderer();

    await docsGateway.createProjectWorkspace(project, {
      repositoryId: "R_board_docs",
      fullName: "Mockly-Company/board-docs",
    });

    await terminalStoreFor(aiGateway, makeRenderer, "PVT_1").open("claude");
    expect(getRunningTerminalCounts(aiGateway)).toEqual({ PVT_1: 1 });

    // 1. detachProject: PVT_1 -> repo:R_board_docs (동일 문서 저장소이므로 터미널 세션 이관)
    function LifecycleHarness() {
      const ctx = useActiveProject();
      return (
        <div>
          <output data-testid="active-ws">
            {ctx.activeWorkspaceId ?? "none"}
          </output>
          <button
            type="button"
            onClick={() => void ctx.detachProjectFromWorkspace("PVT_1")}
          >
            보드 해제
          </button>
          <button
            type="button"
            onClick={() =>
              void ctx.connectWorkspaceDocs(
                "repo:R_board_docs",
                "R_other",
                "Mockly-Company/other-docs",
              )
            }
          >
            문서 저장소 교체
          </button>
          <button
            type="button"
            onClick={() => void ctx.removeWorkspace("repo:R_board_docs")}
          >
            워크스페이스 삭제
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsGateway}
          aiGateway={aiGateway}
        >
          <LifecycleHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_1"),
    );

    await user.click(screen.getByRole("button", { name: "보드 해제" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent(
        "repo:R_board_docs",
      ),
    );
    expect(aiGateway.terminalStops).toEqual([]);
    expect(getRunningTerminalCounts(aiGateway)).toEqual({
      "repo:R_board_docs": 1,
    });

    // 2. connectWorkspaceDocs로 다른 저장소로 교체 시 기존 터미널 종료
    await user.click(screen.getByRole("button", { name: "문서 저장소 교체" }));
    await waitFor(() => expect(aiGateway.terminalStops).toEqual(["session-0"]));
    expect(getRunningTerminalCounts(aiGateway)).toEqual({});

    // 3. 새 터미널을 연 뒤 removeWorkspace 시 터미널 종료
    await terminalStoreFor(aiGateway, makeRenderer, "repo:R_board_docs").open(
      "codex",
    );
    expect(getRunningTerminalCounts(aiGateway)).toEqual({
      "repo:R_board_docs": 1,
    });

    await user.click(screen.getByRole("button", { name: "워크스페이스 삭제" }));
    await waitFor(() =>
      expect(aiGateway.terminalStops).toEqual(["session-0", "session-1"]),
    );
    expect(getRunningTerminalCounts(aiGateway)).toEqual({});
  });

  it("ignores stale activeWorkspaceIdRef when optimistic workspace updates follow removing the active workspace", async () => {
    const user = userEvent.setup();
    const projectGateway = FakeProjectBoardGateway.empty();
    const docsGateway = new FakeDocsRepositoryGateway();
    await docsGateway.createProjectWorkspace(project, {
      repositoryId: "R_1",
      fullName: "Mockly-Company/docs-1",
    });
    await docsGateway.createStandaloneWorkspace("R_2", "Mockly-Company/docs-2");
    await docsGateway.setActiveWorkspace("PVT_1");
    docsGateway.removeWorkspace = async (workspaceId) => {
      docsGateway.workspaces = docsGateway.workspaces.filter(
        (item) => item.id !== workspaceId,
      );
      docsGateway.activeWorkspaceId = null;
      return {
        workspaces: docsGateway.workspaces.map((item) => ({ ...item })),
        activeWorkspaceId: null,
        activeDocsConnected: false,
      };
    };
    docsGateway.attachProject = async (workspaceId, attached) => {
      const target = docsGateway.workspaces.find((item) => item.id === workspaceId);
      if (!target) throw new Error("not found");
      const updated = {
        ...target,
        id: attached.id,
        title: attached.title,
        project: attached,
      };
      docsGateway.workspaces = docsGateway.workspaces.map((item) =>
        item.id === workspaceId ? updated : item,
      );
      return { ...updated };
    };

    function StaleRefHarness() {
      const ctx = useActiveProject();
      return (
        <div>
          <output data-testid="active-ws">{ctx.activeWorkspaceId ?? "none"}</output>
          <output data-testid="active-title">{ctx.activeWorkspace?.title ?? "missing"}</output>
          <button
            type="button"
            onClick={async () => {
              await ctx.removeWorkspace("PVT_1");
              await ctx.attachProjectToWorkspace("repo:R_2", secondProject);
            }}
          >
            기존 삭제 후 연결
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsGateway}
        >
          <StaleRefHarness />
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_1"),
    );

    await user.click(screen.getByRole("button", { name: "기존 삭제 후 연결" }));

    await waitFor(() =>
      expect(screen.getByTestId("active-ws")).toHaveTextContent("PVT_2"),
    );
    expect(screen.getByTestId("active-title")).toHaveTextContent("Second Board");
  });
});
