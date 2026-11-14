import { invoke } from "@tauri-apps/api/core";
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
import { normalizeBoardAssignees } from "@/features/project-board/assigneeFilter";

function normalizeTasks(raw: unknown): DashboardTaskItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is DashboardTaskItem =>
      typeof entry === "object" && entry !== null,
  ).map((entry) => ({
    ...entry,
    assignees: normalizeBoardAssignees(entry.assignees),
  }));
}

function normalizeNotifications(raw: unknown): DashboardNotificationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is DashboardNotificationItem =>
      typeof entry === "object" && entry !== null,
  );
}

function normalizeFailures(raw: unknown): DashboardWorkspaceFailure[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is DashboardWorkspaceFailure =>
      typeof entry === "object" && entry !== null,
  );
}

export class TauriPersonalDashboardGateway implements PersonalDashboardGateway {
  async getPersonalDashboard(
    options: GetPersonalDashboardOptions = {},
  ): Promise<PersonalDashboardResult> {
    const raw = await invoke<PersonalDashboardResult>("get_personal_dashboard", {
      forceSync: options.forceSync ?? false,
      assigneeFilter: options.assigneeFilter ?? null,
      retryWorkspaceId: options.retryWorkspaceId ?? null,
    });
    const tasks = normalizeTasks(raw?.tasks);
    const notifications = normalizeNotifications(raw?.notifications);
    const failures = normalizeFailures(raw?.failures);
    return {
      viewerLogin: typeof raw?.viewerLogin === "string" ? raw.viewerLogin : null,
      fetchedAt: typeof raw?.fetchedAt === "string" ? raw.fetchedAt : new Date().toISOString(),
      lastSeenAt: typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : null,
      assigneeOptions: normalizeBoardAssignees(raw?.assigneeOptions),
      tasks,
      unreadNewCount:
        typeof raw?.unreadNewCount === "number"
          ? raw.unreadNewCount
          : tasks.filter((t) => t.isNew).length,
      readyTaskCount:
        typeof raw?.readyTaskCount === "number"
          ? raw.readyTaskCount
          : tasks.filter((t) => t.readyToStart).length,
      notifications,
      unreadNotificationCount:
        typeof raw?.unreadNotificationCount === "number"
          ? raw.unreadNotificationCount
          : notifications.filter((n) => n.isNew).length,
      failures,
    };
  }

  async getDashboardLastSeenAt(): Promise<string | null> {
    return invoke<string | null>("get_dashboard_last_seen_at");
  }

  async markDashboardSeen(timestamp?: string | null): Promise<string> {
    return invoke<string>("mark_dashboard_seen", {
      timestamp: timestamp ?? null,
    });
  }
}
