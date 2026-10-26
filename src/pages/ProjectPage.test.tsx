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

async function showLayersView(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "영역별" }));
  await screen.findByRole("region", { name: "기획 레이어" });
}

describe("ProjectPage", () => {
  it("renders one swimlane per layer with five status columns", async () => {
    const user = userEvent.setup();
    renderProject();
    await showLayersView(user);

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
    const user = userEvent.setup();
    renderProject(
      FakeProjectBoardGateway.withIssues(
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
    await showLayersView(user);

    const planning = screen.getByRole("region", {
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

    expect(
      screen.getByText("마지막 새로고침 2026-10-25T12:00:00+09:00"),
    ).toBeInTheDocument();
  });

  it("filters swimlanes by layer", async () => {
    const user = userEvent.setup();
    renderProject();
    await showLayersView(user);

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
          kind: "기능",
        },
      ],
      "2026-10-25T12:00:00+09:00",
    );
    render(<ProjectPage gateway={gateway} />);
    await showLayersView(user);

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
    const user = userEvent.setup();
    renderProject();
    await showLayersView(user);

    const planning = screen.getByRole("region", {
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
      ).toHaveLength(2),
    );
  });

  it("groups layer-less issues into the unassigned swimlane", async () => {
    const user = userEvent.setup();
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
    await showLayersView(user);

    const lane = screen.getByRole("region", { name: "미지정 레이어" });
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

    await screen.findByRole("region", { name: "계층 보기" });
    expect(
      screen.getByRole("article", { name: "에픽 #12 기획서 초안" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "태스크 #13 하위 작업" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "진행률 0퍼센트" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "영역별" }));
    expect(
      await screen.findByRole("region", { name: "기획 레이어" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "계층별" }));
    expect(
      await screen.findByRole("region", { name: "계층 보기" }),
    ).toBeInTheDocument();
  });

  it("groups tree children by layer before status", async () => {
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 1,
              title: "에픽",
              url: "https://example.test/issues/1",
              layer: "unassigned",
              status: "backlog",
              children: [
                {
                  number: 2,
                  title: "프론트 작업",
                  url: "https://example.test/issues/2",
                  layer: "frontend",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                },
                {
                  number: 3,
                  title: "백엔드 작업",
                  url: "https://example.test/issues/3",
                  layer: "backend",
                  status: "in_progress",
                  children: [],
                  kind: "작업",
                },
              ],
              kind: null,
            },
          ],
          null,
        )}
      />,
    );

    const tree = await screen.findByRole("region", { name: "계층 보기" });

    const cards = within(tree).getAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "에픽 #1 에픽",
      "태스크 #2 프론트 작업",
      "태스크 #3 백엔드 작업",
    ]);
  });

  it("shows dependency chains as a flow with predecessor captions", async () => {
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 1,
              title: "에픽",
              url: "https://example.test/issues/1",
              layer: "unassigned",
              status: "backlog",
              children: [
                {
                  number: 2,
                  title: "기획",
                  url: "https://example.test/issues/2",
                  layer: "planning",
                  status: "in_progress",
                  children: [],
                  kind: "기능",
                  dependsOn: null,
                },
                {
                  number: 3,
                  title: "디자인",
                  url: "https://example.test/issues/3",
                  layer: "design",
                  status: "backlog",
                  children: [],
                  kind: "기능",
                  dependsOn: 2,
                },
                {
                  number: 4,
                  title: "자유 작업",
                  url: "https://example.test/issues/4",
                  layer: "backend",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                  dependsOn: null,
                },
                {
                  number: 5,
                  title: "기획 직후 작업",
                  url: "https://example.test/issues/5",
                  layer: "backend",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                  dependsOn: 2,
                },
              ],
              kind: null,
            },
          ],
          null,
        )}
      />,
    );

    const tree = await screen.findByRole("region", { name: "계층 보기" });
    const flow = within(tree).getByRole("region", {
      name: "순서 있는 흐름",
    });
    const steps = within(flow).getAllByRole("article");
    expect(steps.map((step) => step.getAttribute("aria-label"))).toEqual([
      "스토리 #2 기획",
      "스토리 #3 디자인",
      "태스크 #5 기획 직후 작업",
    ]);
    expect(
      within(flow).getAllByText("← #2 기획 다음에 진행"),
    ).toHaveLength(2);
    expect(
      within(flow).queryByRole("article", { name: "태스크 #4 자유 작업" }),
    ).not.toBeInTheDocument();
    expect(
      within(tree).getByRole("article", { name: "태스크 #4 자유 작업" }),
    ).toBeInTheDocument();
  });

  it("renders cyclic dependencies without hanging", async () => {
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [
            {
              number: 1,
              title: "에픽",
              url: "https://example.test/issues/1",
              layer: "unassigned",
              status: "backlog",
              children: [
                {
                  number: 2,
                  title: "순환 A",
                  url: "https://example.test/issues/2",
                  layer: "planning",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                  dependsOn: 3,
                },
                {
                  number: 3,
                  title: "순환 B",
                  url: "https://example.test/issues/3",
                  layer: "design",
                  status: "backlog",
                  children: [],
                  kind: "작업",
                  dependsOn: 2,
                },
              ],
              kind: null,
            },
          ],
          null,
        )}
      />,
    );

    const tree = await screen.findByRole("region", { name: "계층 보기" });
    expect(
      within(tree).getByRole("article", { name: "태스크 #2 순환 A" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("article", { name: "태스크 #3 순환 B" }),
    ).toBeInTheDocument();
  });

  it("lets linked workspaces switch projects from the list", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    render(<ProjectPage gateway={gateway} />);
    await showLayersView(user);
    expect(
      screen.queryByRole("region", { name: "GitHub Project 연결" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "프로젝트 변경" }));

    const combo = await screen.findByRole("combobox", { name: "Project 목록" });
    await user.click(combo);
    const choice = await screen.findByRole("option", {
      name: "Mockly · Mockly-Company #1",
    });
    await user.click(choice);
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
        screen.queryByRole("region", { name: "GitHub Project 연결" }),
      ).not.toBeInTheDocument(),
    );
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

    await showLayersView(user);

    expect(
      screen.queryByRole("article", { name: "Issue #1 끝난 에픽" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "완료 항목 숨기기" }));
    expect(
      await screen.findByRole("article", { name: "Issue #1 끝난 에픽" }),
    ).toBeInTheDocument();
  });
});
