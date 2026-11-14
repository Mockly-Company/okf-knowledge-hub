import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { ActiveProjectProvider } from "@/features/active-project/ActiveProjectProvider";
import {
  PersonalDashboardProvider,
  useOptionalPersonalDashboard,
} from "@/features/dashboard/PersonalDashboardProvider";
import { PersonalDashboardView } from "@/features/dashboard/PersonalDashboardView";
import type {
  DashboardNotificationItem,
  DashboardTaskItem,
} from "@/features/dashboard/model";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakePersonalDashboardGateway } from "@/test/FakePersonalDashboardGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import {
  createTestQueryClient,
  TestQueryProvider,
} from "@/test/queryTestUtils";
import { HomePage } from "./HomePage";
import { unavailableHomeTasks } from "./home/HomeTasks";

afterEach(cleanup);

function RouteEcho() {
  const location = useLocation();
  return (
    <div data-testid="route-location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function makeTask(overrides: Partial<DashboardTaskItem> = {}): DashboardTaskItem {
  return {
    workspaceId: "PVT_alpha",
    workspaceTitle: "Alpha Project",
    projectOwner: "Mockly-Company",
    projectNumber: 1,
    projectTitle: "Alpha Project",
    repositoryFullName: "Mockly-Company/alpha",
    issueNumber: 74,
    title: "개인 대시보드 구현",
    url: "https://github.com/Mockly-Company/alpha/issues/74",
    status: "ready",
    layer: "frontend",
    kind: "작업",
    dependsOn: null,
    predecessorDone: true,
    readyToStart: true,
    isNew: true,
    assignees: [{ login: "YoonDongGeun", name: "윤동근" }],
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T01:00:00Z",
    ...overrides,
  };
}

function makeNotification(
  overrides: Partial<DashboardNotificationItem> = {},
): DashboardNotificationItem {
  return {
    id: "open_pr:PVT_alpha:18",
    workspaceId: "PVT_alpha",
    workspaceTitle: "Alpha Project",
    repositoryFullName: "Mockly-Company/alpha-docs",
    kind: "open_pr",
    prNumber: 18,
    title: "대시보드 화면명세서 리뷰 요청",
    summary: "내 담당 백로그 및 기획 변경 알림 패널 추가",
    authorLogin: "alice",
    url: "https://github.com/Mockly-Company/alpha-docs/pull/18",
    primaryDocPath: "docs/dashboard/screen-spec.md",
    hasCompanionHtml: true,
    timestamp: "2026-11-14T02:00:00Z",
    isNew: true,
    ...overrides,
  };
}

async function createDefaultDocsRepoGateway() {
  const gateway = new FakeDocsRepositoryGateway();
  await gateway.createProjectWorkspace(
    {
      id: "PVT_alpha",
      owner: "Mockly-Company",
      number: 1,
      title: "Alpha Project",
      scope: "organization",
    },
    { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
  );
  await gateway.setActiveWorkspace("PVT_alpha");
  return gateway;
}

function renderDashboard({
  dashboardGateway,
  docsRepoGateway,
  initialEntry = "/home",
}: {
  dashboardGateway: FakePersonalDashboardGateway;
  docsRepoGateway?: FakeDocsRepositoryGateway;
  initialEntry?: string;
}) {
  const connectionGateway = FakeWorkspaceConnectionGateway.connected();
  if (connectionGateway.authState.status === "authenticated") {
    connectionGateway.authState = {
      status: "authenticated",
      user: {
        ...connectionGateway.authState.user,
        login: dashboardGateway.viewerLogin ?? "YoonDongGeun",
      },
    };
  }

  return render(
    <TestQueryProvider>
      <WorkspaceConnectionProvider gateway={connectionGateway}>
        <ActiveProjectProvider
          projectGateway={FakeProjectBoardGateway.empty()}
          docsRepositoryGateway={docsRepoGateway}
        >
          <PersonalDashboardProvider gateway={dashboardGateway}>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route
                  path="/home"
                  element={
                    <>
                      <HomePage />
                      <RouteEcho />
                    </>
                  }
                />
                <Route path="/project" element={<RouteEcho />} />
                <Route path="/documents" element={<RouteEcho />} />
              </Routes>
            </MemoryRouter>
          </PersonalDashboardProvider>
        </ActiveProjectProvider>
      </WorkspaceConnectionProvider>
    </TestQueryProvider>,
  );
}

describe("HomePage (내 대시보드)", () => {
  it("renders summary cards, assigned tasks, notifications, and clears NEW via 모두 읽음", async () => {
    const user = userEvent.setup();
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      tasks: [
        makeTask({
          issueNumber: 74,
          title: "개인 대시보드 구현",
          isNew: true,
          readyToStart: true,
        }),
        makeTask({
          workspaceId: "PVT_beta",
          workspaceTitle: "Beta Project",
          issueNumber: 77,
          title: "팀 담당 설정 구현",
          status: "backlog",
          dependsOn: 74,
          predecessorDone: false,
          readyToStart: false,
          isNew: false,
        }),
      ],
      notifications: [makeNotification()],
    });

    renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway: await createDefaultDocsRepoGateway(),
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "내 대시보드" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "안녕하세요, @YoonDongGeun님 · 연결된 모든 프로젝트의 내 작업과 바뀐 기획을 모았습니다",
      ),
    ).toBeInTheDocument();

    const summary = await screen.findByRole("region", { name: "대시보드 요약" });
    expect(within(summary).getByText("새로 배정된 할 일").parentElement).toHaveTextContent("1건");
    expect(within(summary).getByText("시작 가능 작업").parentElement).toHaveTextContent("1건");
    expect(within(summary).getByText("바뀐 기획·화면명세").parentElement).toHaveTextContent("1건");

    const tasksPanel = screen.getByRole("region", { name: "내 담당 백로그" });
    expect(within(tasksPanel).getByText("#74 개인 대시보드 구현")).toBeInTheDocument();
    expect(within(tasksPanel).getByText("시작 가능")).toBeInTheDocument();
    expect(within(tasksPanel).getByText("선행 #74 대기")).toBeInTheDocument();

    const docsPanel = screen.getByRole("region", {
      name: "기획 · 화면명세 변경 알림",
    });
    expect(within(docsPanel).getByText("검토 대기")).toBeInTheDocument();
    expect(
      within(docsPanel).getByText("#18 대시보드 화면명세서 리뷰 요청"),
    ).toBeInTheDocument();

    expect(screen.getAllByText("NEW")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "모두 읽음" }));

    await waitFor(() => {
      expect(screen.queryByText("NEW")).toBeNull();
    });
    expect(
      screen.queryByRole("button", { name: "모두 읽음" }),
    ).toBeNull();
    expect(within(summary).getByText("새로 배정된 할 일").parentElement).toHaveTextContent("0건");
  });

  it("filters by teammate or all via 담당자 보기 and retries failed workspaces", async () => {
    const user = userEvent.setup();
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      assigneeOptions: [
        { login: "YoonDongGeun", name: "윤동근" },
        { login: "alice", name: "앨리스" },
      ],
      tasks: [
        makeTask({ issueNumber: 74, assignees: [{ login: "YoonDongGeun" }] }),
        makeTask({
          issueNumber: 90,
          title: "앨리스 백엔드 작업",
          layer: "backend",
          assignees: [{ login: "alice" }],
          isNew: false,
        }),
      ],
      failures: [
        {
          workspaceId: "PVT_gamma",
          workspaceTitle: "Gamma Project",
          scope: "board",
          message: "API rate limit exceeded",
        },
      ],
    });

    renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway: await createDefaultDocsRepoGateway(),
    });

    await screen.findByText("#74 개인 대시보드 구현");
    expect(screen.queryByText("#90 앨리스 백엔드 작업")).toBeNull();

    // 부분 실패 경고 배너 및 다시 시도
    const warning = screen.getByText(/Gamma Project/).closest('[role="status"]');
    expect(warning).not.toBeNull();
    await user.click(
      within(warning as HTMLElement).getByRole("button", { name: "다시 시도" }),
    );
    await waitFor(() => {
      expect(gateway.calls.some((c) => c.retryWorkspaceId === "PVT_gamma")).toBe(
        true,
      );
    });

    // 담당자 보기 변경 (alice)
    await user.click(screen.getByRole("combobox", { name: "담당자 보기" }));
    await user.click(await screen.findByRole("option", { name: "@alice (앨리스)" }));
    await waitFor(() => {
      expect(screen.getByText("#90 앨리스 백엔드 작업")).toBeInTheDocument();
    });
    expect(screen.queryByText("#74 개인 대시보드 구현")).toBeNull();

    // 담당자 보기 전체
    await user.click(screen.getByRole("combobox", { name: "담당자 보기" }));
    await user.click(await screen.findByRole("option", { name: "전체" }));
    await waitFor(() => {
      expect(screen.getByText("#74 개인 대시보드 구현")).toBeInTheDocument();
      expect(screen.getByText("#90 앨리스 백엔드 작업")).toBeInTheDocument();
    });
  });

  it("paginates doc change notifications at 10 items per page", async () => {
    const user = userEvent.setup();
    const notifications: DashboardNotificationItem[] = Array.from(
      { length: 12 },
      (_, index) =>
        makeNotification({
          id: `merged_doc:PVT_alpha:${index + 1}`,
          kind: "merged_doc",
          prNumber: index + 100,
          title: `문서 변경 #${index + 1}`,
          summary: `요약 ${index + 1}`,
          primaryDocPath: `docs/doc-${index + 1}.md`,
          isNew: false,
        }),
    );
    const gateway = new FakePersonalDashboardGateway({ notifications });
    renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway: await createDefaultDocsRepoGateway(),
    });

    await screen.findByText("#100 문서 변경 #1");
    expect(screen.getByText("#109 문서 변경 #10")).toBeInTheDocument();
    expect(screen.queryByText("#110 문서 변경 #11")).toBeNull();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByText("#110 문서 변경 #11")).toBeInTheDocument();
    expect(screen.getByText("#111 문서 변경 #12")).toBeInTheDocument();
    expect(screen.queryByText("#100 문서 변경 #1")).toBeNull();
  });

  it("switches active workspace and deep-links to /project?issue=, /documents?pr=, and /documents?doc=", async () => {
    const user = userEvent.setup();
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha Project",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_beta",
        owner: "Mockly-Company",
        number: 2,
        title: "Beta Project",
        scope: "organization",
      },
      { repositoryId: "R_beta", fullName: "Mockly-Company/beta-docs" },
    );
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");
    const selectSpy = vi.spyOn(docsRepoGateway, "setActiveWorkspace");

    const gateway = new FakePersonalDashboardGateway({
      tasks: [
        makeTask({
          workspaceId: "PVT_beta",
          workspaceTitle: "Beta Project",
          issueNumber: 77,
          title: "팀원 배정 UI",
        }),
      ],
      notifications: [
        makeNotification({
          id: "open_pr:PVT_beta:25",
          workspaceId: "PVT_beta",
          workspaceTitle: "Beta Project",
          kind: "open_pr",
          prNumber: 25,
          title: "기획 PR 리뷰 요청",
        }),
        makeNotification({
          id: "merged_doc:PVT_beta:24",
          workspaceId: "PVT_beta",
          workspaceTitle: "Beta Project",
          kind: "merged_doc",
          prNumber: 24,
          title: "PRD 확정 반영",
          primaryDocPath: "docs/auth/prd.md",
          isNew: false,
        }),
      ],
    });

    // 1) Task deep-link
    const view1 = renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway,
    });
    await user.click(await screen.findByRole("button", { name: /#77 팀원 배정 UI/ }));
    await waitFor(() => {
      expect(selectSpy).toHaveBeenCalledWith("PVT_beta");
      expect(screen.getByTestId("route-location")).toHaveTextContent(
        "/project?issue=77",
      );
    });
    view1.unmount();

    // 2) Open PR deep-link
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");
    selectSpy.mockClear();
    const view2 = renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway,
    });
    await user.click(
      await screen.findByRole("button", { name: /#25 기획 PR 리뷰 요청/ }),
    );
    await waitFor(() => {
      expect(selectSpy).toHaveBeenCalledWith("PVT_beta");
      expect(screen.getByTestId("route-location")).toHaveTextContent(
        "/documents?pr=25",
      );
    });
    view2.unmount();

    // 3) Merged doc deep-link
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");
    selectSpy.mockClear();
    renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway,
    });
    await user.click(
      await screen.findByRole("button", { name: /#24 PRD 확정 반영/ }),
    );
    await waitFor(() => {
      expect(selectSpy).toHaveBeenCalledWith("PVT_beta");
      expect(screen.getByTestId("route-location")).toHaveTextContent(
        "/documents?doc=docs%2Fauth%2Fprd.md",
      );
    });
  });

  it("preserves legacy HomeTasks/HomeInsights preview layout when explicit preview props are provided", async () => {
    render(
      <WorkspaceConnectionProvider
        gateway={FakeWorkspaceConnectionGateway.connected()}
      >
        <MemoryRouter>
          <HomePage tasks={unavailableHomeTasks} />
        </MemoryRouter>
      </WorkspaceConnectionProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "내 작업" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("안녕하세요, @hyeeun님")).toBeInTheDocument();
  });

  it("renders PersonalDashboardView safely outside a Router without crashing on navigation clicks", async () => {
    const user = userEvent.setup();
    const docsRepoGateway = await createDefaultDocsRepoGateway();
    const connectionGateway = FakeWorkspaceConnectionGateway.connected();
    if (connectionGateway.authState.status === "authenticated") {
      connectionGateway.authState = {
        status: "authenticated",
        user: {
          ...connectionGateway.authState.user,
          login: "YoonDongGeun",
        },
      };
    }
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      tasks: [makeTask({ issueNumber: 74, title: "대시보드 렌더링 확인" })],
    });
    const fetchSpy = vi.spyOn(gateway, "getPersonalDashboard");

    render(
      <TestQueryProvider>
        <WorkspaceConnectionProvider gateway={connectionGateway}>
          <ActiveProjectProvider
            projectGateway={FakeProjectBoardGateway.empty()}
            docsRepositoryGateway={docsRepoGateway}
          >
            <PersonalDashboardProvider gateway={gateway}>
              <PersonalDashboardView />
            </PersonalDashboardProvider>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    const taskBtn = await screen.findByRole("button", {
      name: /#74 대시보드 렌더링 확인/,
    });
    await user.click(taskBtn);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy).toHaveBeenLastCalledWith({
      assigneeFilter: null,
      forceSync: true,
      retryWorkspaceId: null,
    });
  });

  it("keeps sidebar unreadCount stable when switching assigneeFilter and clears across views on markSeen", async () => {
    const user = userEvent.setup();
    const docsRepoGateway = await createDefaultDocsRepoGateway();
    const connectionGateway = FakeWorkspaceConnectionGateway.connected();
    if (connectionGateway.authState.status === "authenticated") {
      connectionGateway.authState = {
        status: "authenticated",
        user: {
          ...connectionGateway.authState.user,
          login: "YoonDongGeun",
        },
      };
    }
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      assigneeOptions: [
        { login: "YoonDongGeun", name: "윤동근" },
        { login: "alice", name: "앨리스" },
      ],
      tasks: [
        makeTask({
          issueNumber: 74,
          title: "내 미확인 백로그",
          assignees: [{ login: "YoonDongGeun" }],
          isNew: true,
        }),
        makeTask({
          issueNumber: 90,
          title: "앨리스 읽은 백로그",
          assignees: [{ login: "alice" }],
          isNew: false,
        }),
      ],
      notifications: [
        makeNotification({
          id: "open_pr:PVT_alpha:18",
          prNumber: 18,
          isNew: true,
        }),
      ],
    });

    function SidebarUnreadProbe() {
      const ctx = useOptionalPersonalDashboard();
      return <span data-testid="sidebar-unread-count">{ctx?.unreadCount ?? 0}</span>;
    }

    render(
      <TestQueryProvider>
        <MemoryRouter initialEntries={["/"]}>
          <WorkspaceConnectionProvider gateway={connectionGateway}>
            <ActiveProjectProvider
              projectGateway={FakeProjectBoardGateway.empty()}
              docsRepositoryGateway={docsRepoGateway}
            >
              <PersonalDashboardProvider gateway={gateway}>
                <SidebarUnreadProbe />
                <PersonalDashboardView />
              </PersonalDashboardProvider>
            </ActiveProjectProvider>
          </WorkspaceConnectionProvider>
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await screen.findByText("#74 내 미확인 백로그");
    expect(screen.getByTestId("sidebar-unread-count")).toHaveTextContent("2");

    // 앨리스 필터 로딩 중에도 placeholderData 덕분에 unreadCount가 0으로 깜빡이지 않는다(S9)
    let resolveFiltered!: () => void;
    const filteredGate = new Promise<void>((resolve) => {
      resolveFiltered = resolve;
    });
    const origGet = gateway.getPersonalDashboard.bind(gateway);
    vi.spyOn(gateway, "getPersonalDashboard").mockImplementation(async (opts) => {
      if (opts?.assigneeFilter === "alice") {
        await filteredGate;
      }
      return origGet(opts);
    });

    await user.click(screen.getByRole("combobox", { name: "담당자 보기" }));
    await user.click(await screen.findByRole("option", { name: "@alice (앨리스)" }));
    expect(screen.getByTestId("sidebar-unread-count")).toHaveTextContent("2");

    resolveFiltered();
    await screen.findByText("#90 앨리스 읽은 백로그");
    expect(screen.getByTestId("sidebar-unread-count")).toHaveTextContent("2");

    await user.click(screen.getByRole("button", { name: "모두 읽음" }));
    await waitFor(() => {
      expect(screen.getByTestId("sidebar-unread-count")).toHaveTextContent("0");
    });
  });

  it("drops stale inactive filter cache on retryWorkspace so switching views reflects fresh state", async () => {
    const user = userEvent.setup();
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      assigneeOptions: [
        { login: "YoonDongGeun", name: "윤동근" },
        { login: "alice", name: "앨리스" },
      ],
      tasks: [
        makeTask({ issueNumber: 74, title: "내 작업", assignees: [{ login: "YoonDongGeun" }] }),
        makeTask({ issueNumber: 90, title: "앨리스 작업", assignees: [{ login: "alice" }] }),
      ],
      failures: [
        {
          workspaceId: "PVT_gamma",
          workspaceTitle: "Gamma Project",
          scope: "board",
          message: "temporary error",
        },
      ],
    });
    gateway.onRetryWorkspace = () => {
      gateway.failures = [];
    };

    renderDashboard({
      dashboardGateway: gateway,
      docsRepoGateway: await createDefaultDocsRepoGateway(),
    });

    await screen.findByText("#74 내 작업");
    expect(screen.getByText(/Gamma Project/)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "담당자 보기" }));
    await user.click(await screen.findByRole("option", { name: "@alice (앨리스)" }));
    await screen.findByText("#90 앨리스 작업");

    const warning = screen.getByText(/Gamma Project/).closest('[role="status"]');
    expect(warning).not.toBeNull();
    await user.click(within(warning as HTMLElement).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => {
      expect(screen.queryByText(/Gamma Project/)).toBeNull();
    });

    await user.click(screen.getByRole("combobox", { name: "담당자 보기" }));
    await user.click(await screen.findByRole("option", { name: /내 작업/ }));
    await screen.findByText("#74 내 작업");
    expect(screen.queryByText(/Gamma Project/)).toBeNull();
  });

  it("ignores refresh/retryWorkspace while disabled so enabling later never triggers stale forceSync (M8)", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const gateway = new FakePersonalDashboardGateway({
      viewerLogin: "YoonDongGeun",
      tasks: [makeTask({ issueNumber: 74, title: "새로 연결된 작업" })],
    });
    const getSpy = vi.spyOn(gateway, "getPersonalDashboard");

    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = [];
    docsRepoGateway.activeWorkspaceId = null;

    function Probe() {
      const ctx = useOptionalPersonalDashboard();
      return (
        <div>
          <button type="button" onClick={() => void ctx?.refresh()}>
            trigger-refresh
          </button>
          <button type="button" onClick={() => void ctx?.retryWorkspace("PVT_alpha")}>
            trigger-retry
          </button>
          <span data-testid="task-count">{ctx?.dashboard?.tasks.length ?? 0}</span>
        </div>
      );
    }

    render(
      <TestQueryProvider client={queryClient}>
        <MemoryRouter initialEntries={["/home"]}>
          <WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}>
            <ActiveProjectProvider
              projectGateway={FakeProjectBoardGateway.empty()}
              docsRepositoryGateway={docsRepoGateway}
            >
              <PersonalDashboardProvider gateway={gateway}>
                <Probe />
              </PersonalDashboardProvider>
            </ActiveProjectProvider>
          </WorkspaceConnectionProvider>
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "trigger-refresh" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "trigger-refresh" }));
    await user.click(screen.getByRole("button", { name: "trigger-retry" }));
    expect(getSpy).not.toHaveBeenCalled();

    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha Project",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");

    await act(async () => {
      await queryClient.invalidateQueries();
    });

    await waitFor(() => {
      expect(screen.getByTestId("task-count")).toHaveTextContent("1");
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      expect.objectContaining({ forceSync: false, retryWorkspaceId: null }),
    );
  });
});
