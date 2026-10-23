import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { ProjectPage } from "./ProjectPage";

afterEach(cleanup);

function renderProject() {
  const gateway = FakeWorkspaceConnectionGateway.connected();
  return {
    gateway,
    ...render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <ProjectPage />
      </WorkspaceConnectionProvider>,
    ),
  };
}

describe("ProjectPage", () => {
  it("keeps Project identity generic until GitHub Project data exists", async () => {
    const { gateway } = renderProject();

    await waitFor(() =>
      expect(gateway.calls.some((call) => call.method === "getCurrentWorkspace")).toBe(true),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Project" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Mockly" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("GitHub Project 연결 후 현재 Iteration의 Issue를 표시합니다."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Project 데이터 대기 중")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Iteration" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Iteration" })).toHaveTextContent(
      "현재 Iteration 없음",
    );
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "List" })).toBeDisabled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Project" }).closest("section"),
    ).toHaveClass(
      "pt-[var(--page-block-start)]",
      "pb-[var(--space-10)]",
    );
  });

  it("keeps horizontal board scrolling inside five empty status columns", () => {
    renderProject();

    const board = screen.getByRole("region", { name: "Project Board" });
    expect(board).toHaveClass("overflow-x-auto");
    expect(board).toHaveAttribute("tabindex", "0");
    for (const status of ["Backlog", "Ready", "In progress", "In review", "Done"]) {
      expect(within(board).getByRole("region", { name: status })).toBeInTheDocument();
    }
    expect(within(board).getAllByText("연결된 Issue 없음")).toHaveLength(5);
  });

  it("offers issue creation only from Backlog and explains why it is unavailable", () => {
    renderProject();

    const backlog = screen.getByRole("region", { name: "Backlog" });
    const addIssue = within(backlog).getByRole("button", { name: "새 Issue" });
    expect(addIssue).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "새 Issue" })).toHaveLength(1);
    expect(
      within(backlog).getByText("GitHub Project와 Iteration을 연결하면 만들 수 있습니다."),
    ).toBeInTheDocument();
  });
});
