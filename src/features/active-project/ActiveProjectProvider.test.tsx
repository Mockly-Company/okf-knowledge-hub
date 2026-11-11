import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
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
            ws={ctx.activeWorkspaceId ?? "none"} title={ctx.activeWorkspaceTitle}
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
        "ws=none title=연결된 워크스페이스 없음",
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
        "ws=repo:R_fast title=fast-docs",
      ),
    );

    releaseRefetch?.();
  });
});
