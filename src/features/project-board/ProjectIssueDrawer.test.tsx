import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectIssueDrawer } from "./ProjectIssueDrawer";
import type { BoardIssue } from "./model";
import type { ProjectBoardIssueDetail } from "./ProjectBoardGateway";

afterEach(() => {
  cleanup();
});

const issue: BoardIssue = {
  number: 42,
  title: "[디자인] 결제 실패 안내 모달 설계",
  url: "https://github.com/Acme-Org/acme-web/issues/42",
  layer: "design",
  status: "backlog",
  children: [],
  kind: "작업",
  dependsOn: 41,
};

const detail: ProjectBoardIssueDetail = {
  number: 42,
  title: "[디자인] 결제 실패 안내 모달 설계",
  url: "https://github.com/Acme-Org/acme-web/issues/42",
  repositoryFullName: "Acme-Org/acme-web",
  layer: "design",
  status: "backlog",
  kind: "작업",
  priority: "P1",
  body: "## 완료 조건\n- [ ] 상태별 모달 시안 확정",
  dependsOn: 41,
  predecessorDone: false,
  readyToStart: false,
  subIssues: [],
  linkedDocuments: [
    { path: "docs/design/payment-modal.md", hasCompanionHtml: false },
  ],
  linkedPullRequests: [],
  recommendedWorkingDir: null,
  priorityOptions: ["P0", "P1", "P2"],
};

describe("ProjectIssueDrawer", () => {
  it("renders blocked predecessor badge, linked docs, and triggers derive & AI actions", async () => {
    const user = userEvent.setup();
    const onDerive = vi.fn();
    const onStartWithAi = vi.fn();

    render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={issue}
        detail={detail}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "blocked", waitingOn: 41 }}
        isUpdating={false}
        updateError={null}
        onDeriveBacklog={onDerive}
        onStartWithAi={onStartWithAi}
      />,
    );

    expect(screen.getByText("선행 #41 대기")).toBeVisible();
    expect(screen.getByText("docs/design/payment-modal.md")).toBeVisible();
    expect(screen.getByText(".md 단독")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "하위 백로그 파생" }));
    expect(onDerive).toHaveBeenCalledWith(issue, detail);

    await user.click(screen.getByRole("button", { name: "AI로 작업 시작" }));
    expect(onStartWithAi).toHaveBeenCalledWith(issue, detail);
  });
});
