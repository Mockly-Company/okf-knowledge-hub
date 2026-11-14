import { describe, expect, it, vi } from "vitest";
import { TauriPersonalDashboardGateway } from "./TauriPersonalDashboardGateway";

describe("TauriPersonalDashboardGateway", () => {
  it("drops malformed task, notification, and failure entries and normalizes fields", async () => {
    const invokeMock = vi.fn().mockResolvedValue({
      viewerLogin: "YoonDongGeun",
      fetchedAt: "2026-11-14T10:00:00Z",
      lastSeenAt: null,
      assigneeOptions: [],
      tasks: [
        null,
        { workspaceId: "ws-1", title: "missing number" },
        {
          workspaceId: "ws-1",
          workspaceTitle: "OkHub",
          projectOwner: "Mockly-Company",
          projectNumber: 1,
          projectTitle: "OkHub",
          repositoryFullName: null,
          issueNumber: 74,
          title: "Valid task",
          url: "https://github.com/Mockly-Company/okf-knowledge-hub/issues/74",
          status: "invalid_status",
          layer: "frontend",
        },
        {
          workspaceId: "ws-1",
          workspaceTitle: "OkHub",
          projectOwner: "Mockly-Company",
          projectNumber: 1,
          projectTitle: "OkHub",
          repositoryFullName: "Mockly-Company/okf-knowledge-hub",
          issueNumber: 77,
          title: "Good task",
          url: "https://github.com/Mockly-Company/okf-knowledge-hub/issues/77",
          status: "ready",
          layer: "frontend",
          assignees: [{ login: "YoonDongGeun" }, null],
          isNew: 1,
        },
      ],
      notifications: [
        { id: "bad", workspaceId: "ws-1" },
        {
          id: "open:ws-1:19",
          workspaceId: "ws-1",
          kind: "open_pr",
          prNumber: 19,
          title: "PR #19 missing timestamp",
          url: "https://github.com/Mockly-Company/hub-knowledge/pull/19",
          timestamp: "   ",
        },
        {
          id: "open:ws-1:18",
          workspaceId: "ws-1",
          workspaceTitle: "OkHub",
          repositoryFullName: "Mockly-Company/hub-knowledge",
          kind: "open_pr",
          prNumber: 18,
          title: "PR #18",
          url: "https://github.com/Mockly-Company/hub-knowledge/pull/18",
          timestamp: "2026-11-14T09:00:00Z",
          isNew: true,
        },
      ],
      failures: [
        { workspaceId: "ws-2", scope: "unknown", message: "bad scope" },
        {
          workspaceId: "ws-2",
          workspaceTitle: "Gamma",
          scope: "board",
          message: "timeout",
        },
      ],
    });

    const gateway = new TauriPersonalDashboardGateway(invokeMock);
    const result = await gateway.getPersonalDashboard();

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.issueNumber).toBe(77);
    expect(result.tasks[0]?.isNew).toBe(true);
    expect(result.tasks[0]?.assignees).toEqual([
      { login: "YoonDongGeun", avatarUrl: null, name: null },
    ]);

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.prNumber).toBe(18);
    expect(result.notifications[0]?.summary).toBe("PR #18");

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.scope).toBe("board");
    expect(result.totalUnreadCount).toBe(2);
  });
});
