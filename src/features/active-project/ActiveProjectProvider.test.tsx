import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
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

function renderProvider(
  projectGateway: FakeProjectBoardGateway,
  workspaceGateway: FakeWorkspaceConnectionGateway,
) {
  render(
    <TestQueryProvider>
      <ActiveProjectProvider
        projectGateway={projectGateway}
        workspaceGateway={workspaceGateway}
      >
        <Probe />
      </ActiveProjectProvider>
    </TestQueryProvider>,
  );
}

describe("ActiveProjectProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("remembers the connected workspace the first time a project is selected", async () => {
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];
    const workspace = FakeWorkspaceConnectionGateway.connected("/repo/current");

    renderProvider(projects, workspace);

    expect(
      await screen.findByText("active=PVT_1 missing=false"),
    ).toBeInTheDocument();
    await expect(workspace.getWorkspaceForProject("PVT_1")).resolves.toBe(
      "/repo/current",
    );
  });

  it("keeps an existing mapping when another workspace is connected", async () => {
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];
    const workspace = FakeWorkspaceConnectionGateway.connected("/repo/current");
    await workspace.setWorkspaceForProject("PVT_1", "/repo/remembered");

    renderProvider(projects, workspace);

    expect(
      await screen.findByText("active=PVT_1 missing=false"),
    ).toBeInTheDocument();
    await expect(workspace.getWorkspaceForProject("PVT_1")).resolves.toBe(
      "/repo/remembered",
    );
  });

  it("does not report missing docs when the workspace mapping cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];
    const workspace = FakeWorkspaceConnectionGateway.connected();
    vi.spyOn(workspace, "getWorkspaceForProject").mockRejectedValue(
      new Error("기억된 프로젝트 저장소 정보를 읽을 수 없습니다."),
    );

    renderProvider(projects, workspace);

    expect(
      await screen.findByText("active=PVT_1 missing=false"),
    ).toBeInTheDocument();
    expect(console.warn).toHaveBeenCalled();
  });

  it("reports missing docs when no workspace is connected", async () => {
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];
    const workspace = FakeWorkspaceConnectionGateway.connected();
    workspace.currentWorkspace = null;

    renderProvider(projects, workspace);

    expect(
      await screen.findByText("active=PVT_1 missing=true"),
    ).toBeInTheDocument();
  });

  it("aligns the backend with the stored selection once on startup", async () => {
    localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, "PVT_1");
    const projects = FakeProjectBoardGateway.empty();
    projects.linkedProjects = [project];

    renderProvider(projects, FakeWorkspaceConnectionGateway.connected());

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

    renderProvider(projects, FakeWorkspaceConnectionGateway.connected());

    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(screen.getByText("active=PVT_1 missing=false")).toBeInTheDocument();
    expect(localStorage.getItem(LAST_ACTIVE_PROJECT_KEY)).toBe("PVT_1");
  });
});
