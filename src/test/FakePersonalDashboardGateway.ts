import type {
  GetPersonalDashboardOptions,
  PersonalDashboardGateway,
} from "@/features/dashboard/PersonalDashboardGateway";
import type {
  DashboardNotificationItem,
  DashboardTaskItem,
  DashboardWorkspaceFailure,
  PersonalDashboardResult,
} from "@/features/dashboard/model";
import type { BoardAssignee } from "@/features/project-board/model";

export interface FakePersonalDashboardState {
  viewerLogin?: string | null;
  fetchedAt?: string;
  lastSeenAt?: string | null;
  assigneeOptions?: BoardAssignee[];
  tasks?: DashboardTaskItem[];
  notifications?: DashboardNotificationItem[];
  failures?: DashboardWorkspaceFailure[];
}

export class FakePersonalDashboardGateway implements PersonalDashboardGateway {
  viewerLogin: string | null;
  fetchedAt: string;
  lastSeenAt: string | null;
  assigneeOptions: BoardAssignee[];
  tasks: DashboardTaskItem[];
  notifications: DashboardNotificationItem[];
  failures: DashboardWorkspaceFailure[];
  error: Error | null = null;
  calls: GetPersonalDashboardOptions[] = [];
  onRetryWorkspace?: (workspaceId: string) => void;

  constructor(initial: FakePersonalDashboardState = {}) {
    this.viewerLogin = initial.viewerLogin ?? "YoonDongGeun";
    this.fetchedAt = initial.fetchedAt ?? "2026-11-14T08:00:00Z";
    this.lastSeenAt = initial.lastSeenAt ?? null;
    this.assigneeOptions = initial.assigneeOptions ?? [
      { login: this.viewerLogin ?? "YoonDongGeun" },
    ];
    this.tasks = initial.tasks ?? [];
    this.notifications = initial.notifications ?? [];
    this.failures = initial.failures ?? [];
  }

  static empty(viewerLogin: string | null = "YoonDongGeun") {
    return new FakePersonalDashboardGateway({ viewerLogin });
  }

  async getPersonalDashboard(
    options: GetPersonalDashboardOptions = {},
  ): Promise<PersonalDashboardResult> {
    this.calls.push(options);
    if (this.error) {
      throw this.error;
    }
    if (options.retryWorkspaceId) {
      this.onRetryWorkspace?.(options.retryWorkspaceId);
    }

    const filter = options.assigneeFilter?.trim() || null;
    const filteredTasks = this.tasks.filter((task) => {
      if (filter === "*" || filter === "all") {
        return task.kind !== "기능" || task.assignees.length > 0;
      }
      const target = filter ?? this.viewerLogin;
      if (!target) return false;
      return task.assignees.some(
        (a) => a.login.toLowerCase() === target.toLowerCase(),
      );
    });

    const unreadNewCount = filteredTasks.filter((t) => t.isNew).length;
    const viewerUnreadNewCount = this.viewerLogin
      ? this.tasks.filter(
          (task) =>
            task.isNew &&
            task.assignees.some(
              (a) => a.login.toLowerCase() === this.viewerLogin!.toLowerCase(),
            ),
        ).length
      : 0;
    const readyTaskCount = filteredTasks.filter((t) => t.readyToStart).length;
    const unreadNotificationCount = this.notifications.filter((n) => n.isNew).length;
    const totalUnreadCount = viewerUnreadNewCount + unreadNotificationCount;

    return {
      viewerLogin: this.viewerLogin,
      fetchedAt: this.fetchedAt,
      lastSeenAt: this.lastSeenAt,
      assigneeOptions: this.assigneeOptions,
      tasks: filteredTasks,
      unreadNewCount,
      readyTaskCount,
      notifications: this.notifications,
      unreadNotificationCount,
      totalUnreadCount,
      failures: this.failures,
    };
  }

  async getDashboardLastSeenAt(): Promise<string | null> {
    return this.lastSeenAt;
  }

  async markDashboardSeen(timestamp?: string | null): Promise<string> {
    const next = timestamp?.trim() || new Date().toISOString();
    this.lastSeenAt = next;
    this.tasks = this.tasks.map((task) => ({ ...task, isNew: false }));
    this.notifications = this.notifications.map((item) => ({
      ...item,
      isNew: false,
    }));
    return next;
  }
}
