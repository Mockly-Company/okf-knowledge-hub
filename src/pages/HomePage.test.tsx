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
      screen.getByRole("heading", { level: 1, name: "프로젝트 진행 상황" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("안녕하세요, @hyeeun님")).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );

    const summaries = screen.getByRole("region", { name: "Issue 요약" });
    for (const label of ["열린 Issue", "진행 중인 Issue", "이번 주 완료 Issue"]) {
      expect(within(summaries).getByText(label)).toBeInTheDocument();
    }
    expect(within(summaries).getAllByText("Project 데이터 없음")).toHaveLength(3);

    expect(screen.getByRole("heading", { name: "기능 진행 상황" })).toBeInTheDocument();
    const requests = screen.getByRole("region", { name: "내가 확인할 항목" });
    for (const category of ["검토 필요", "결정 필요", "작업 시작 가능", "응답 필요"]) {
      expect(
        within(requests).getByRole("listitem", { name: `${category}: 0개` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "최근 활동" })).toBeInTheDocument();
    expect(screen.getByText("연결된 기능별 Issue가 아직 없습니다.")).toBeInTheDocument();
    expect(within(requests).getByText("연결된 확인 항목 없음")).toBeInTheDocument();
    expect(screen.getByText("표시할 활동 기록이 아직 없습니다.")).toBeInTheDocument();

    expect(
      screen
        .getByRole("heading", { level: 1, name: "프로젝트 진행 상황" })
        .closest("section"),
    ).toHaveClass(
      "pt-[var(--page-block-start)]",
      "pb-[var(--space-10)]",
    );
  });
});
