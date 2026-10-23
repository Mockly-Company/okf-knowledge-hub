import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { HomePage } from "./HomePage";

afterEach(cleanup);

function renderHome() {
  return render(
    <WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </WorkspaceConnectionProvider>,
  );
}

describe("HomePage", () => {
  it("presents the approved dashboard hierarchy without inventing issue data", async () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: "내 작업" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("안녕하세요, @hyeeun님")).toBeInTheDocument();
    expect(screen.queryByRole("time")).not.toBeInTheDocument();

    const summaries = screen.getByRole("region", { name: "프로젝트 요약" });
    expect(within(summaries).getByText("GitHub 분석이 아직 연결되지 않았습니다.")).toBeInTheDocument();
    const requests = screen.getByRole("region", { name: "나에게 요청된 리뷰" });
    expect(screen.getByRole("region", { name: "내 담당 Issue" })).toBeInTheDocument();
    expect(summaries.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("region", { name: "최근 활동" })).not.toBeInTheDocument();
    expect(within(requests).getByText("GitHub 목록이 아직 연결되지 않았습니다.")).toBeInTheDocument();

    expect(
      screen
        .getByRole("heading", { level: 1, name: "내 작업" })
        .closest("section"),
    ).toHaveClass(
      "pt-[var(--page-block-start)]",
      "pb-[var(--space-10)]",
    );
  });
});
