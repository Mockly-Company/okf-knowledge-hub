import { act, type ReactElement } from "react";
import {
  cleanup,
  render as rtlRender,
  screen,
  waitFor,
  within,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { TestQueryProvider } from "@/test/queryTestUtils";
import {
  ActiveProjectProvider,
  useActiveProject,
} from "@/features/active-project/ActiveProjectProvider";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ResolvedGithubProject,
} from "@/features/project-board/model";
import { MAX_ISSUE_TREE_DEPTH } from "@/features/project-board/boardUtils";
import { ProjectPage } from "./ProjectPage";

afterEach(cleanup);

// 이 파일의 모든 렌더는 QueryClient를 제공한다.
function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }) => (
      <TestQueryProvider>{children}</TestQueryProvider>
    ),
  });
}

function renderProject(board = FakeProjectBoardGateway.empty()) {
  return {
    gateway: board,
    ...render(<ProjectPage gateway={board} />),
  };
}

async function showLayersView(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "영역별" }));
  await screen.findByRole("region", { name: "기획 레이어" });
}

/** 흐름 단계(li)의 제목. 단계 카드의 첫 헤딩에서 `종류 #번호 ` 접두를 뺀다. */
function stepTitle(item: HTMLElement): string {
  const heading = within(item).getAllByRole("heading")[0];
  return (heading.textContent ?? "").replace(/^.*?#\d+ /, "");
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
    await showLayersView(user);

    await user.click(screen.getByRole("button", { name: "디자인" }));

    expect(screen.queryByRole("region", { name: "기획 레이어" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "디자인 레이어" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "백엔드 레이어" })).not.toBeInTheDocument();
  });

  it("loads with a cheap read on mount and syncs with GitHub only on refresh", async () => {
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
    await showLayersView(user);

    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(1);
    expect(
      gateway.calls.filter((call) => call.method === "syncProjectBoard"),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "새로고침" }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "syncProjectBoard"),
      ).toHaveLength(1),
    );
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(1);
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
      setActiveProject: (id: string) => gateway.setActiveProject(id),
    };
    render(<ProjectPage gateway={counting} />);

    expect(
      await screen.findByText("Project 보드를 불러오지 못했습니다. (원인: offline)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(attempts).toBe(2));
  });

  it("shows the sidebar guidance instead of the link UI when none is connected", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "GitHub Project 연결" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Project URL" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
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
        "보드 항목이 많아 일부만 표시됩니다. (보드 최대 500개·에픽별 하위 이슈 최대 520개)",
      ),
    ).toBeInTheDocument();
  });

  it("hides swimlanes until a project is connected", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다.");
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

    await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다.");
    expect(
      screen.queryByRole("region", { name: "기획 레이어" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "레이어 필터" }),
    ).not.toBeInTheDocument();
  });

  it("does not fetch the board when the global None(로컬) state is active", async () => {
    window.localStorage.removeItem("okhub.last-active-project-id");
    const gateway = FakeProjectBoardGateway.withIssues([
      {
        number: 12,
        title: "로컬에서는 숨겨야 할 이슈",
        url: "https://example.test/issues/12",
        layer: "planning",
        status: "in_progress",
        children: [],
        kind: null,
      },
    ]);
    // 조회 가능한 프로젝트가 없으므로 자동 선택이 동작하지 않고 None이 유지된다.
    gateway.projectList = [];
    gateway.linkedProjects = [];
    const workspace = FakeWorkspaceConnectionGateway.connected();
    render(
      <ActiveProjectProvider projectGateway={gateway}>
        <ProjectPage gateway={gateway} />
      </ActiveProjectProvider>,
    );

    await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다.");
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(0);
    expect(
      gateway.calls.filter((call) => call.method === "syncProjectBoard"),
    ).toHaveLength(0);
    expect(screen.queryByText("로컬에서는 숨겨야 할 이슈")).toBeNull();
  });

  it("shows the cause of a string board failure", async () => {
    const gateway = FakeProjectBoardGateway.empty();
    vi.spyOn(gateway, "getProjectBoard").mockRejectedValue("연결이 끊어졌습니다");
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText(
        "Project 보드를 불러오지 못했습니다. (원인: 연결이 끊어졌습니다)",
      ),
    ).toBeInTheDocument();
  });

  it("shows a load error instead of the connect UI for a corrupt workspace file", async () => {
    const gateway = FakeProjectBoardGateway.corruptWorkspaceFile();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByText(/^Project 보드를 불러오지 못했습니다./);
    expect(
      screen.queryByRole("textbox", { name: "Project URL" }),
    ).not.toBeInTheDocument();
  });

  it("shows the sidebar guidance without the legacy link UI", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", {
        name: "Mockly · Mockly-Company #1",
      }),
    ).not.toBeInTheDocument();
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

  it("keeps the deepest node the gateway retains in the layer view", async () => {
    const user = userEvent.setup();
    // 게이트웨이는 depth > 상한 노드를 자식 없는 생략 노드로 남긴다(상한+1 깊이).
    let deepest: BoardIssue = {
      number: MAX_ISSUE_TREE_DEPTH + 2,
      title: "가장 깊은 작업",
      url: `https://example.test/issues/${MAX_ISSUE_TREE_DEPTH + 2}`,
      layer: "backend",
      status: "backlog",
      children: [],
      kind: null,
      childrenTruncated: true,
    };
    for (let number = MAX_ISSUE_TREE_DEPTH + 1; number >= 1; number -= 1) {
      deepest = {
        number,
        title: `단계 ${number}`,
        url: `https://example.test/issues/${number}`,
        layer: "backend",
        status: "backlog",
        children: [deepest],
        kind: null,
      };
    }
    render(
      <ProjectPage gateway={FakeProjectBoardGateway.withIssues([deepest], null)} />,
    );
    await showLayersView(user);

    expect(
      screen.getByRole("article", {
        name: `Issue #${MAX_ISSUE_TREE_DEPTH + 2} 가장 깊은 작업`,
      }),
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
    const flow = within(tree).getByRole("list", { name: "에픽 흐름 요약" });
    const chains = within(flow).getAllByRole("listitem");
    expect(chains.map(stepTitle)).toEqual([
      "기획",
      "디자인",
      "기획 직후 작업",
    ]);
    const steps = within(tree).getAllByRole("article");
    expect(
      steps
        .map((step) => step.getAttribute("aria-label"))
        .filter(
          (label) =>
            label === "스토리 #2 기획" ||
            label === "스토리 #3 디자인" ||
            label === "태스크 #5 기획 직후 작업",
        ),
    ).toEqual(["스토리 #2 기획", "스토리 #3 디자인", "태스크 #5 기획 직후 작업"]);
    expect(
      within(flow).queryByRole("article", { name: "태스크 #4 자유 작업" }),
    ).not.toBeInTheDocument();
    expect(
      within(tree).getByRole("article", { name: "태스크 #4 자유 작업" }),
    ).toBeInTheDocument();
  });

  it("renders flows in nested subtasks", async () => {
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
                  title: "부모 작업",
                  url: "https://example.test/issues/2",
                  layer: "planning",
                  status: "in_progress",
                  children: [
                    {
                      number: 3,
                      title: "먼저 할 일",
                      url: "https://example.test/issues/3",
                      layer: "planning",
                      status: "in_progress",
                      children: [],
                      kind: "작업",
                      dependsOn: null,
                    },
                    {
                      number: 4,
                      title: "나중 할 일",
                      url: "https://example.test/issues/4",
                      layer: "planning",
                      status: "backlog",
                      children: [],
                      kind: "작업",
                      dependsOn: 3,
                    },
                  ],
                  kind: "작업",
                  dependsOn: null,
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
    // 중첩 흐름은 이름 없는 목록으로 렌더된다. 상위 카드가 맥락을 제공한다.
    const card = within(tree).getByRole("article", {
      name: "태스크 #2 부모 작업",
    });
    expect(
      within(card)
        .getAllByRole("listitem")
        .map(stepTitle),
    ).toEqual(["먼저 할 일", "나중 할 일"]);
  });

  it("gives each epic flow a unique accessible name", async () => {
    const gateway = (number: number, title: string) => ({
      number,
      title,
      url: `https://example.test/issues/${number}`,
      layer: "unassigned" as const,
      status: "backlog" as const,
      children: [
        {
          number: number * 10 + 1,
          title: `${title} 첫 단계`,
          url: `https://example.test/issues/${number * 10 + 1}`,
          layer: "planning" as const,
          status: "in_progress" as const,
          children: [],
          kind: "작업" as const,
          dependsOn: null,
        },
        {
          number: number * 10 + 2,
          title: `${title} 다음 단계`,
          url: `https://example.test/issues/${number * 10 + 2}`,
          layer: "planning" as const,
          status: "backlog" as const,
          children: [],
          kind: "작업" as const,
          dependsOn: number * 10 + 1,
        },
      ],
      kind: null,
    });
    render(
      <ProjectPage
        gateway={FakeProjectBoardGateway.withIssues(
          [gateway(1, "첫 번째"), gateway(2, "두 번째")],
          null,
        )}
      />,
    );

    const tree = await screen.findByRole("region", { name: "계층 보기" });
    expect(
      within(tree).getByRole("list", { name: "첫 번째 흐름 요약" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("list", { name: "두 번째 흐름 요약" }),
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

  it("keeps the board read-only without the project switch UI when linked", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    render(<ProjectPage gateway={gateway} />);
    await showLayersView(user);
    expect(
      screen.queryByRole("region", { name: "GitHub Project 연결" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "프로젝트 변경" }),
    ).not.toBeInTheDocument();
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

    await user.click(
      screen.getByRole("checkbox", { name: "완료 항목 숨기기" }),
    );
    expect(
      await screen.findByRole("article", { name: "Issue #1 끝난 에픽" }),
    ).toBeInTheDocument();
  });

  it("shows the sidebar guidance instead of the resolve UI when unconnected", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    gateway.resolveResult = new Error("GitHub Project URL 형식을 확인해 주세요.");
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Project URL" }),
    ).not.toBeInTheDocument();
  });

  it("does not retry unlinked board errors", async () => {
    const gateway = FakeProjectBoardGateway.unlinked();
    render(<ProjectPage gateway={gateway} />);

    expect(
      await screen.findByText("선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다."),
    ).toBeInTheDocument();
    // 첫 재시도 타이머(1s)가 지나도 추가 호출이 없어야 한다.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(1);
    expect(
      gateway.calls.filter((call) => call.method === "syncProjectBoard"),
    ).toHaveLength(0);
  });
});

describe("ProjectPage project switching", () => {
  const alpha: ResolvedGithubProject = {
    id: "PVT_alpha",
    owner: "Mockly-Company",
    number: 1,
    title: "Alpha",
    scope: "organization",
  };
  const beta: ResolvedGithubProject = {
    id: "PVT_beta",
    owner: "Mockly-Company",
    number: 2,
    title: "Beta",
    scope: "organization",
  };

  function boardWith(title: string, url: string): ProjectBoard {
    return {
      issues: [
        {
          number: 1,
          title,
          url,
          layer: "planning",
          status: "in_progress",
          children: [],
          kind: null,
        },
      ],
      fetchedAt: null,
      skipped: 0,
      truncated: false,
    };
  }

  function ProjectSwitcher() {
    const { selectProject, clearActiveProject } = useActiveProject();
    return (
      <div>
        <button type="button" onClick={() => void selectProject(alpha.id)}>
          switch-to-alpha
        </button>
        <button type="button" onClick={() => void selectProject(beta.id)}>
          switch-to-beta
        </button>
        <button type="button" onClick={() => clearActiveProject()}>
          clear-project
        </button>
      </div>
    );
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  /** 보드 조회를 지연시켜 전환 중간 상태를 관찰한다. Alpha까지 로드 후 반환. */
  async function renderWithDeferredBoard() {
    const gateway = FakeProjectBoardGateway.empty();
    gateway.linkedProjects = [alpha, beta];
    const releases: Array<(board: ProjectBoard) => void> = [];
    gateway.getProjectBoard = async () => {
      gateway.calls.push({ method: "getProjectBoard" });
      return new Promise<ProjectBoard>((resolve) => {
        releases.push(resolve);
      });
    };
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    render(
      <ActiveProjectProvider
        projectGateway={gateway}
      >
        <ProjectSwitcher />
        <ProjectPage gateway={gateway} />
      </ActiveProjectProvider>,
    );

    expect(
      await screen.findByText('"Alpha" 보드 가져오는 중'),
    ).toBeInTheDocument();
    await act(async () => {
      releases[0](boardWith("Alpha 작업", "https://example.test/alpha"));
    });
    await screen.findByRole("article", { name: "단일 항목 #1 Alpha 작업" });
    return { gateway, releases };
  }

  it("shows the switching status and replaces the board on project change", async () => {
    const user = userEvent.setup();
    const { gateway, releases } = await renderWithDeferredBoard();

    await user.click(screen.getByRole("button", { name: "switch-to-beta" }));

    // 이전 보드를 그대로 두지 않고 가져오는 중 UI를 보여준다.
    expect(
      await screen.findByText('"Beta" 보드 가져오는 중'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "단일 항목 #1 Alpha 작업" }),
    ).toBeNull();

    await act(async () => {
      releases[1](boardWith("Beta 작업", "https://example.test/beta"));
    });

    expect(
      await screen.findByRole("article", { name: "단일 항목 #1 Beta 작업" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "단일 항목 #1 Alpha 작업" }),
    ).toBeNull();
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(2);
  });

  it("reuses the cached board when switching back without refetching", async () => {
    const user = userEvent.setup();
    const { gateway, releases } = await renderWithDeferredBoard();

    await user.click(screen.getByRole("button", { name: "switch-to-beta" }));
    await screen.findByText('"Beta" 보드 가져오는 중');
    await act(async () => {
      releases[1](boardWith("Beta 작업", "https://example.test/beta"));
    });
    await screen.findByRole("article", { name: "단일 항목 #1 Beta 작업" });

    await user.click(screen.getByRole("button", { name: "switch-to-alpha" }));

    // 캐시 적중: 세 번째 조회 없이 Alpha 보드가 바로 보인다.
    expect(
      await screen.findByRole("article", { name: "단일 항목 #1 Alpha 작업" }),
    ).toBeInTheDocument();
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(2);
  });

  it("syncs when switching to a project whose cached board is empty", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    gateway.linkedProjects = [alpha, beta];
    gateway.boardsByProjectId.set(
      alpha.id,
      boardWith("Alpha 작업", "https://example.test/alpha"),
    );
    gateway.board = boardWith("Beta 작업", "https://example.test/beta");
    const realGet = gateway.getProjectBoard.bind(gateway);
    gateway.getProjectBoard = async () => {
      if (gateway.activeProjectId === beta.id) {
        gateway.calls.push({ method: "getProjectBoard" });
        return { issues: [], fetchedAt: null, skipped: 0, truncated: false };
      }
      return realGet();
    };
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();
    render(
      <ActiveProjectProvider
        projectGateway={gateway}
      >
        <ProjectSwitcher />
        <ProjectPage gateway={gateway} />
      </ActiveProjectProvider>,
    );

    await screen.findByRole("article", { name: "단일 항목 #1 Alpha 작업" });
    await user.click(screen.getByRole("button", { name: "switch-to-beta" }));

    expect(
      await screen.findByRole("article", { name: "단일 항목 #1 Beta 작업" }),
    ).toBeInTheDocument();
    expect(
      gateway.calls.filter((call) => call.method === "syncProjectBoard"),
    ).toHaveLength(1);
  });

  it("shows the unlinked guidance when cleared back to local", async () => {
    const user = userEvent.setup();
    await renderWithDeferredBoard();

    await user.click(screen.getByRole("button", { name: "clear-project" }));

    expect(
      await screen.findByText(
        "선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "단일 항목 #1 Alpha 작업" }),
    ).toBeNull();
  });

  it("shows standalone docs guidance and lets the user attach a GitHub Project board later", async () => {
    const user = userEvent.setup();
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.projectList = [alpha];
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = [
      {
        id: "docs:Mockly-Company/handbook",
        title: "Mockly-Company/handbook",
        project: null,
        docsRepository: {
          repositoryId: "R_2",
          fullName: "Mockly-Company/handbook",
        },
      },
    ];
    docsRepoGateway.activeWorkspaceId = "docs:Mockly-Company/handbook";
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();

    render(
      <WorkspaceConnectionProvider gateway={workspaceGateway}>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsRepoGateway}
        >
          <ProjectPage
            gateway={projectGateway}
            docsRepositoryGateway={docsRepoGateway}
            repositoryGateway={workspaceGateway}
          />
        </ActiveProjectProvider>
      </WorkspaceConnectionProvider>,
    );

    expect(
      await screen.findByText("문서 저장소 단독으로 관리 중인 워크스페이스입니다"),
    ).toBeVisible();
    expect(
      screen.getByText(/Mockly-Company\/handbook/),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "GitHub Project 보드 연결" }),
    );
    expect(
      await screen.findByRole("dialog", { name: /워크스페이스 설정/ }),
    ).toBeVisible();
  });

  it("resets layer filter and updates WorkspaceContextBar when switching between project workspaces", async () => {
    const user = userEvent.setup();
    const projectGateway = FakeProjectBoardGateway.empty();
    projectGateway.boardsByProjectId.set("PVT_alpha", {
      issues: [
        {
          number: 10,
          title: "Alpha 기획 이슈",
          url: "https://example.test/alpha/10",
          layer: "planning",
          status: "in_progress",
          children: [],
          kind: null,
        },
      ],
      fetchedAt: "2026-11-12T00:00:00Z",
      skipped: 0,
      truncated: false,
    });
    projectGateway.boardsByProjectId.set("PVT_beta", {
      issues: [
        {
          number: 20,
          title: "Beta 백엔드 이슈",
          url: "https://example.test/beta/20",
          layer: "backend",
          status: "in_progress",
          children: [],
          kind: null,
        },
      ],
      fetchedAt: "2026-11-12T00:00:00Z",
      skipped: 0,
      truncated: false,
    });

    const docsRepoGateway = new FakeDocsRepositoryGateway();
    await docsRepoGateway.createProjectWorkspace(alpha, {
      repositoryId: "R_alpha",
      fullName: "Mockly-Company/alpha-docs",
    });
    await docsRepoGateway.createProjectWorkspace(beta, {
      repositoryId: "R_beta",
      fullName: "Mockly-Company/beta-docs",
    });
    const originalSetActive =
      docsRepoGateway.setActiveWorkspace.bind(docsRepoGateway);
    docsRepoGateway.setActiveWorkspace = async (workspaceId: string) => {
      const activated = await originalSetActive(workspaceId);
      projectGateway.activeProjectId = activated.workspace.project?.id ?? null;
      return activated;
    };
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");
    const workspaceGateway = FakeWorkspaceConnectionGateway.connected();

    render(
      <WorkspaceConnectionProvider gateway={workspaceGateway}>
        <ActiveProjectProvider
          projectGateway={projectGateway}
          docsRepositoryGateway={docsRepoGateway}
        >
          <ProjectSwitcher />
          <ProjectPage
            gateway={projectGateway}
            docsRepositoryGateway={docsRepoGateway}
            repositoryGateway={workspaceGateway}
          />
        </ActiveProjectProvider>
      </WorkspaceConnectionProvider>,
    );

    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    await waitFor(() =>
      expect(within(contextBar).getByText("Alpha")).toBeInTheDocument(),
    );
    expect(
      within(contextBar).getByText(
        "└ 소속 문서 저장소 · Mockly-Company/alpha-docs",
      ),
    ).toBeInTheDocument();

    // Alpha에서 영역별 보기 + "기획" 필터 선택
    await user.click(await screen.findByRole("button", { name: "영역별" }));
    await user.click(screen.getByRole("button", { name: "기획" }));
    expect(
      screen.getByRole("article", { name: "Issue #10 Alpha 기획 이슈" }),
    ).toBeInTheDocument();

    // Beta로 전환하면 보기 방식(계층별)과 레이어 필터(전체)가 초기화되어 Beta의 백엔드 이슈가 즉시 보인다
    await user.click(screen.getByRole("button", { name: "switch-to-beta" }));
    await waitFor(() =>
      expect(within(contextBar).getByText("Beta")).toBeInTheDocument(),
    );
    expect(
      within(contextBar).getByText(
        "└ 소속 문서 저장소 · Mockly-Company/beta-docs",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("article", {
        name: "단일 항목 #20 Beta 백엔드 이슈",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "영역별" }));
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("article", { name: "Issue #20 Beta 백엔드 이슈" }),
    ).toBeInTheDocument();
  });
});
