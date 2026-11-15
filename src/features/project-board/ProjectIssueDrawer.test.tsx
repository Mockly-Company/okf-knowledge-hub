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
  it("renders blocked predecessor badge, linked docs, omits manual creation/derive buttons, and triggers AI action", async () => {
    const user = userEvent.setup();
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
        onStartWithAi={onStartWithAi}
      />,
    );

    expect(screen.getByText("선행 #41 대기")).toBeVisible();
    expect(screen.getByText("docs/design/payment-modal.md")).toBeVisible();
    expect(screen.getByText(".md 단독")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "하위 백로그 파생" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "하위 이슈 추가" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "AI로 작업 시작" }));
    expect(onStartWithAi).toHaveBeenCalledWith(issue, detail);
  });

  it("hides AI launch action for [백엔드]/[프론트엔드] developer backlogs and shows non-implementation handoff badge", () => {
    const backendIssue: BoardIssue = {
      ...issue,
      number: 55,
      title: "[백엔드] 결제 실패 재시도 API 구현",
      layer: "backend",
    };
    const backendDetail: ProjectBoardIssueDetail = {
      ...detail,
      number: 55,
      title: "[백엔드] 결제 실패 재시도 API 구현",
      layer: "backend",
    };

    render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={backendIssue}
        detail={backendDetail}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
        onStartWithAi={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "AI로 작업 시작" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "하위 백로그 파생" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("개발자 구현 백로그 (OkHub 코드 구현 비수행)"),
    ).toBeVisible();
  });

  it("displays assignees in the issue drawer header and shows 미배정 when empty", () => {
    const assignedDetail: ProjectBoardIssueDetail = {
      ...detail,
      assignees: [
        { login: "alice", name: "앨리스" },
        { login: "bob", name: "밥" },
      ],
    };

    const view = render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{ ...issue, assignees: assignedDetail.assignees }}
        detail={assignedDetail}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
      />,
    );

    expect(screen.getByText("@alice")).toBeVisible();
    expect(screen.getByText("@bob")).toBeVisible();
    view.unmount();

    render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{ ...issue, assignees: [] }}
        detail={{ ...detail, assignees: [] }}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
      />,
    );

    expect(screen.getByText("미배정")).toBeVisible();
  });

  it("shows top-of-body ownership banners for other and unassigned backlogs, including developer layers, and hides it for self or unknown viewer (#77)", () => {
    const selfView = render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{
          ...issue,
          assignees: [{ login: "Alice" }, { login: "bob" }],
        }}
        detail={{
          ...detail,
          assignees: [{ login: "Alice" }, { login: "bob" }],
        }}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
        viewerLogin="alice"
      />,
    );
    expect(screen.queryByText(/담당 백로그입니다\./)).toBeNull();
    expect(screen.queryByText("담당자가 없는 백로그입니다.")).toBeNull();
    selfView.unmount();

    const otherView = render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{
          ...issue,
          assignees: [{ login: "bob" }, { login: "carol" }],
        }}
        detail={{
          ...detail,
          assignees: [{ login: "bob" }, { login: "carol" }],
        }}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
        viewerLogin="alice"
      />,
    );
    expect(
      screen.getByText("@bob, @carol 담당 백로그입니다."),
    ).toBeVisible();
    otherView.unmount();

    const unassignedBackendView = render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{
          ...issue,
          layer: "backend",
          title: "[백엔드] 결제 API",
          assignees: [],
        }}
        detail={{
          ...detail,
          layer: "backend",
          title: "[백엔드] 결제 API",
          assignees: [],
        }}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
        viewerLogin="alice"
        onStartWithAi={() => {}}
      />,
    );
    expect(screen.getByText("담당자가 없는 백로그입니다.")).toBeVisible();
    expect(
      screen.getByText("개발자 구현 백로그 (OkHub 코드 구현 비수행)"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "AI로 작업 시작" }),
    ).toBeNull();
    unassignedBackendView.unmount();

    render(
      <ProjectIssueDrawer
        open
        onOpenChange={() => {}}
        issue={{
          ...issue,
          assignees: [{ login: "bob" }],
        }}
        detail={{
          ...detail,
          assignees: [{ login: "bob" }],
        }}
        isLoadingDetail={false}
        detailError={null}
        readiness={{ state: "ready", waitingOn: null }}
        isUpdating={false}
        updateError={null}
        viewerLogin={null}
      />,
    );
    expect(screen.queryByText(/담당 백로그입니다\./)).toBeNull();
  });
});
