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

    for (const layer of ["기획", "디자인", "프론트엔드", "백엔드"]) {
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
          },
          {
            number: 34,
            title: "홈 화면 시안",
            url: "https://example.test/issues/34",
            layer: "design",
            status: "backlog",
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

    expect(
      screen.getByText("마지막 새로고침 2026-10-25T12:00:00+09:00"),
    ).toBeInTheDocument();
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

  it("reloads the board when the refresh button is pressed", async () => {
    const user = userEvent.setup();
    const gateway = FakeProjectBoardGateway.empty();
    render(<ProjectPage gateway={gateway} />);

    await screen.findByRole("region", { name: "기획 레이어" });
    expect(
      gateway.calls.filter((call) => call.method === "getProjectBoard"),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "새로고침" }));

    await waitFor(() =>
      expect(
        gateway.calls.filter((call) => call.method === "getProjectBoard"),
      ).toHaveLength(2),
    );
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
      resolveGithubProject: (url: string) => gateway.resolveGithubProject(url),
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
