import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { ProjectPage } from "./ProjectPage";

afterEach(cleanup);

function renderProject(board = FakeProjectBoardGateway.empty()) {
  return {
    gateway: board,
    ...render(<ProjectPage gateway={board} />),
  };
}

describe("ProjectPage", () => {
  it("renders one swimlane per layer with five status columns", async () => {
    renderProject();

    for (const layer of ["기획", "디자인", "프론트엔드", "백엔드", "미지정"]) {
      const lane = await screen.findByRole("region", {
        name: `${layer} 레이어`,
      });
      for (const status of [
        "Backlog",
        "Ready",
        "In progress",
        "In review",
        "Done",
      ]) {
        expect(
          within(lane).getByRole("region", { name: `${layer} ${status}` }),
        ).toBeInTheDocument();
      }
    }
  });

  it("shows each fetched issue once inside its own layer and status cell", async () => {
    renderProject(
      FakeProjectBoardGateway.withIssues(
        [
          {
            number: 12,
            title: "기획서 초안",
            url: "https://example.test/issues/12",
            layer: "planning",
            status: "in_progress",
            children: [],
            kind: null,
          },
          {
            number: 34,
            title: "홈 화면 시안",
            url: "https://example.test/issues/34",
            layer: "design",
            status: "backlog",
            children: [],
            kind: null,
          },
        ],
        "2026-10-25T12:00:00+09:00",
      ),
    );

    const planning = await screen.findByRole("region", {
      name: "기획 레이어",
    });
    expect(
      within(planning).getByRole("article", {
        name: "Issue #12 기획서 초안",
      }),
    ).toBeInTheDocument();
    expect(
      within(planning).queryByRole("article", {
        name: "Issue #34 홈 화면 시안",
      }),
    ).not.toBeInTheDocument();

    const design = screen.getByRole("region", { name: "디자인 레이어" });
    expect(
      within(design).getByRole("article", {
        name: "Issue #34 홈 화면 시안",
      }),
    ).toBeInTheDocument();

    const fetchedAt = screen.getByRole("time");
    expect(fetchedAt).toHaveAttribute(
      "datetime",
      "2026-10-25T12:00:00+09:00",
    );
    expect(fetchedAt).toHaveTextContent("2026. 10. 25.");
  });

  it("filters swimlanes by layer", async () => {
    const user = userEvent.setup();
    renderProject();

    await screen.findByRole("region", { name: "기획 레이어" });
    await user.click(screen.getByRole("button", { name: "디자인" }));

    expect(screen.queryByRole("region", { name: "기획 레이어" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "디자인 레이어" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "백엔드 레이어" })).not.toBeInTheDocument();
  });

  it("syncs with GitHub when the refresh button is pressed", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.withIssues(
      [
        {
          number: 12,
          title: "기획서 초안",
          url: "https://example.test/issues/12",
          layer: "planning",
          status: "in_progress",
          children: [],
          kind: null,
        },
      ],
      "2026-10-25T12:00:00+09:00",
    );
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("region", { name: "기획 레이어" });
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "새로고침" }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "syncProjectBoard"),
      ).toHaveLength(1),
    );
    expect(
      await screen.findByRole("article", { name: "Issue #12 기획서 초안" }),
    ).toBeInTheDocument();
  });

  it("offers issue creation only from Backlog and explains why it is unavailable", async () => {
    renderProject();

    const planning = await screen.findByRole("region", {
      name: "기획 레이어",
    });
    const backlog = within(planning).getByRole("region", {
      name: "기획 Backlog",
    });
    const addIssue = within(backlog).getByRole("button", { name: "새 Issue" });
    expect(addIssue).toBeDisabled();
    expect(
      within(backlog).getByText(
        "GitHub Project와 Iteration을 연결하면 만들 수 있습니다.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a retry affordance when loading fails", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    gateway.loadError = new Error("offline");
    let attempts = 0;
    const counting: ProjectBoardGateway = {
      getProjectBoard: async () => {
        attempts += 1;
        return gateway.getProjectBoard();
      },
      syncProjectBoard: () => gateway.syncProjectBoard(),
      resolveGithubProject: (url: string) => gateway.resolveGithubProject(url),
      listGithubProjects: () => gateway.listGithubProjects(),
      linkGithubProject: (project: ResolvedGithubProject) =>
        gateway.linkGithubProject(project),
    };
    render(<ProjectPage gateway={counting} />);

    expect(
      await screen.findByText("Project 보드를 불러오지 못했습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(attempts).toBe(2));
  });

  it("lets users link a project from its URL when none is connected", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    const urlBox = await screen.findByRole("textbox", { name: "Project URL" });
    await user.type(
      urlBox,
      "https://github.com/orgs/Mockly-Company/projects/1",
    );
    await user.click(screen.getByRole("button", { name: "불러오기" }));

    expect(
      await screen.findByText("Mockly Board · Mockly-Company #1"),
    ).toBeInTheDocument();
    expect(
      gateway.calls.filter((call) => call.method === "resolveGithubProject"),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "이 프로젝트 연결" }),
    );

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "linkGithubProject"),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "getProjectBoard"),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "syncProjectBoard"),
      ).toHaveLength(1),
    );
  });

  it("notes items excluded for missing layer or status", async () => {
    const gateway = FakeProjectBoardGateway.empty();
    gateway.board = { issues: [], fetchedAt: null, skipped: 3, truncated: false };
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText(
        "3개 항목은 레이어·상태를 판별할 수 없어 제외됐습니다. Project의 영역 값과 상태 값을 확인해 주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("notes truncation when the board hits the page cap", async () => {
    const gateway = FakeProjectBoardGateway.empty();
    gateway.board = { issues: [], fetchedAt: null, skipped: 0, truncated: true };
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText(
        "보드 항목이 많아 일부만 표시됩니다. (보드 최대 500개·에픽별 하위 이슈 최대 20개)",
      ),
    ).toBeInTheDocument();
  });

  it("hides swimlanes until a project is connected", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("textbox", { name: "Project URL" });
    expect(
      screen.queryByRole("region", { name: "기획 레이어" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
  });

  it("treats a missing workspace as unconnected", async () => {
    const gateway = FakeProjectBoardGateway.missingWorkspace();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("textbox", { name: "Project URL" });
    expect(
      screen.queryByRole("region", { name: "기획 레이어" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
  });

  it("shows a load error instead of the connect UI for a corrupt workspace file", async () => {
    const gateway = FakeProjectBoardGateway.corruptWorkspaceFile();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByText("Project 보드를 불러오지 못했습니다.");
    expect(
      screen.queryByRole("textbox", { name: "Project URL" }),
    ).not.toBeInTheDocument();
  });

  it("lets users pick a project from the fetched list", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("textbox", { name: "Project URL" });
    await user.click(screen.getByRole("button", { name: "목록에서 고르기" }));

    const choice = await screen.findByRole("radio", {
      name: "Mockly · Mockly-Company #1",
    });
    await user.click(choice);
    await user.click(
      screen.getByRole("button", { name: "이 프로젝트 연결" }),
    );

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "listGithubProjects")
          .length,
      ).toBeGreaterThanOrEqual(1),
    );
    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "linkGithubProject"),
      ).toHaveLength(1),
    );
  });

  it("groups layer-less issues into the unassigned swimlane", async () => {
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 7,
              title: "분류 전 이슈",
              url: "https://example.test/issues/7",
              layer: "unassigned",
              status: "backlog",
              children: [],
              kind: null,
            },
          ],
          null,
        )}
      />,
    );

    const lane = await screen.findByRole("region", { name: "미지정 레이어" });
    expect(
      within(lane).getByRole("article", { name: "Issue #7 분류 전 이슈" }),
    ).toBeInTheDocument();
  });

  it("switches between layer and tree views", async () => {
    const user = userEvent.setup();
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 12,
              title: "기획서 초안",
              url: "https://example.test/issues/12",
              layer: "planning",
              status: "in_progress",
              children: [
                {
                  number: 13,
                  title: "하위 작업",
                  url: "https://example.test/issues/13",
                  layer: "planning",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                },
              ],
              kind: "기능",
            },
          ],
          null,
        )}
      />,
    );

    await screen.findByRole("region", { name: "기획 레이어" });
    await user.click(screen.getByRole("button", { name: "계층별" }));

    expect(
      await screen.findByRole("tree", { name: "계층 보기" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "에픽 #12 기획서 초안 상태: In progress, 영역: 기획, 유형: 기능" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: "태스크 #13 하위 작업 상태: Backlog, 영역: 기획, 유형: 작업" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "기획서 초안 접기" }));
    expect(
      screen.queryByRole("treeitem", { name: "태스크 #13 하위 작업 상태: Backlog, 영역: 기획, 유형: 작업" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "영역별" }));
    expect(
      await screen.findByRole("region", { name: "기획 레이어" }),
    ).toBeInTheDocument();
  });

  it("lets linked workspaces switch projects from the list", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("region", { name: "기획 레이어" });
    expect(
      screen.queryByRole("region", { name: "GitHub Project 연결" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "프로젝트 변경" }));
    await user.click(screen.getByRole("button", { name: "목록에서 고르기" }));

    const choice = await screen.findByRole("radio", {
      name: "Mockly · Mockly-Company #1",
    });
    await user.click(choice);
    await user.click(screen.getByRole("button", { name: "이 프로젝트 연결" }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "linkGithubProject"),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "GitHub Project 연결" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("hides done work unless the toggle is off", async () => {
    const user = userEvent.setup();
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 1,
              title: "끝난 에픽",
              url: "https://example.test/issues/1",
              layer: "backend",
              status: "done",
              children: [],
              kind: null,
            },
            {
              number: 2,
              title: "진행 중 작업",
              url: "https://example.test/issues/2",
              layer: "backend",
              status: "in_progress",
              children: [],
              kind: "작업",
            },
          ],
          null,
        )}
      />,
    );

    await screen.findByRole("region", { name: "백엔드 레이어" });
    expect(
      screen.queryByRole("article", { name: "Issue #1 끝난 에픽" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "완료 항목 숨기기" }),
    );
    expect(
      await screen.findByRole("article", { name: "Issue #1 끝난 에픽" }),
    ).toBeInTheDocument();
  });

  it("explains why a project URL cannot be resolved", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.unlinked();
    gateway.resolveResult = new Error("GitHub Project URL 형식을 확인해 주세요.");
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("textbox", { name: "Project URL" });
    await user.type(
      screen.getByRole("textbox", { name: "Project URL" }),
      "not a project url",
    );
    await user.click(screen.getByRole("button", { name: "불러오기" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("GitHub Project URL 형식을 확인해 주세요.");
  });
});
