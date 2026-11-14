import { invoke } from "@tauri-apps/api/core";
import type {
  GetPersonalDashboardOptions,
  PersonalDashboardGateway,
} from "@/features/dashboard/PersonalDashboardGateway";
import type {
  DashboardFailureScope,
  DashboardNotificationItem,
  DashboardNotificationKind,
  DashboardTaskItem,
  DashboardWorkspaceFailure,
  PersonalDashboardResult,
} from "@/features/dashboard/model";
import { normalizeBoardAssignees } from "@/features/project-board/assigneeFilter";
import type { BoardLayer, BoardStatus } from "@/features/project-board/model";

const VALID_STATUSES = new Set<BoardStatus>([
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
]);
const VALID_LAYERS = new Set<BoardLayer>([
  "planning",
  "design",
  "frontend",
  "backend",
  "unassigned",
]);
const VALID_NOTIFICATION_KINDS = new Set<DashboardNotificationKind>([
  "open_pr",
  "merged_doc",
]);
const VALID_FAILURE_SCOPES = new Set<DashboardFailureScope>(["board", "docs"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTasks(raw: unknown): DashboardTaskItem[] {
  if (!Array.isArray(raw)) return [];
  const tasks: DashboardTaskItem[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const workspaceId = asNonEmptyString(record.workspaceId);
    const title = asNonEmptyString(record.title);
    const url = asNonEmptyString(record.url);
    const issueNumber = record.issueNumber;
    const projectNumber = record.projectNumber;
    const status = record.status;
    const layer = record.layer;
    if (
      !workspaceId ||
      !title ||
      !url ||
      typeof issueNumber !== "number" ||
      !Number.isInteger(issueNumber) ||
      typeof projectNumber !== "number" ||
      !Number.isInteger(projectNumber) ||
      typeof status !== "string" ||
      !VALID_STATUSES.has(status as BoardStatus) ||
      typeof layer !== "string" ||
      !VALID_LAYERS.has(layer as BoardLayer)
    ) {
      continue;
    }
    tasks.push({
      workspaceId,
      workspaceTitle:
        asNonEmptyString(record.workspaceTitle) ?? workspaceId,
      projectOwner: asNonEmptyString(record.projectOwner) ?? "",
      projectNumber,
      projectTitle:
        asNonEmptyString(record.projectTitle) ??
        asNonEmptyString(record.workspaceTitle) ??
        "",
      repositoryFullName:
        typeof record.repositoryFullName === "string"
          ? record.repositoryFullName
          : null,
      issueNumber,
      title,
      url,
      status: status as BoardStatus,
      layer: layer as BoardLayer,
      kind: typeof record.kind === "string" ? record.kind : null,
      dependsOn:
        typeof record.dependsOn === "number" ? record.dependsOn : null,
      predecessorDone: Boolean(record.predecessorDone),
      readyToStart: Boolean(record.readyToStart),
      isNew: Boolean(record.isNew),
      assignees: normalizeBoardAssignees(record.assignees),
      createdAt:
        typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt:
        typeof record.updatedAt === "string" ? record.updatedAt : null,
    });
  }
  return tasks;
}

function normalizeNotifications(raw: unknown): DashboardNotificationItem[] {
  if (!Array.isArray(raw)) return [];
  const items: DashboardNotificationItem[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = asNonEmptyString(record.id);
    const workspaceId = asNonEmptyString(record.workspaceId);
    const title = asNonEmptyString(record.title);
    const url = asNonEmptyString(record.url);
    const timestamp = asNonEmptyString(record.timestamp);
    const prNumber = record.prNumber;
    const kind = record.kind;
    if (
      !id ||
      !workspaceId ||
      !title ||
      !url ||
      !timestamp ||
      typeof prNumber !== "number" ||
      !Number.isInteger(prNumber) ||
      typeof kind !== "string" ||
      !VALID_NOTIFICATION_KINDS.has(kind as DashboardNotificationKind)
    ) {
      continue;
    }
    items.push({
      id,
      workspaceId,
      workspaceTitle:
        asNonEmptyString(record.workspaceTitle) ?? workspaceId,
      repositoryFullName:
        asNonEmptyString(record.repositoryFullName) ?? "",
      kind: kind as DashboardNotificationKind,
      prNumber,
      title,
      summary: typeof record.summary === "string" ? record.summary : title,
      authorLogin:
        typeof record.authorLogin === "string" ? record.authorLogin : "",
      url,
      primaryDocPath:
        typeof record.primaryDocPath === "string"
          ? record.primaryDocPath
          : null,
      hasCompanionHtml: Boolean(record.hasCompanionHtml),
      timestamp,
      isNew: Boolean(record.isNew),
    });
  }
  return items;
}

function normalizeFailures(raw: unknown): DashboardWorkspaceFailure[] {
  if (!Array.isArray(raw)) return [];
  const failures: DashboardWorkspaceFailure[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const workspaceId = asNonEmptyString(record.workspaceId);
    const message = asNonEmptyString(record.message);
    const scope = record.scope;
    if (
      !workspaceId ||
      !message ||
      typeof scope !== "string" ||
      !VALID_FAILURE_SCOPES.has(scope as DashboardFailureScope)
    ) {
      continue;
    }
    failures.push({
      workspaceId,
      workspaceTitle:
        asNonEmptyString(record.workspaceTitle) ?? workspaceId,
      scope: scope as DashboardFailureScope,
      message,
    });
  }
  return failures;
}

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const invokeDesktop: InvokeDesktop = (command, args) => invoke(command, args);

export class TauriPersonalDashboardGateway implements PersonalDashboardGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
  ) {}

  async getPersonalDashboard(
    options: GetPersonalDashboardOptions = {},
  ): Promise<PersonalDashboardResult> {
    const raw = await this.invokeCommand<PersonalDashboardResult>(
      "get_personal_dashboard",
      {
        forceSync: options.forceSync ?? false,
        assigneeFilter: options.assigneeFilter ?? null,
        retryWorkspaceId: options.retryWorkspaceId ?? null,
      },
    );
    const tasks = normalizeTasks(raw?.tasks);
    const notifications = normalizeNotifications(raw?.notifications);
    const failures = normalizeFailures(raw?.failures);
    const unreadNewCount =
      typeof raw?.unreadNewCount === "number"
        ? raw.unreadNewCount
        : tasks.filter((t) => t.isNew).length;
    const unreadNotificationCount =
      typeof raw?.unreadNotificationCount === "number"
        ? raw.unreadNotificationCount
        : notifications.filter((n) => n.isNew).length;
    return {
      viewerLogin: typeof raw?.viewerLogin === "string" ? raw.viewerLogin : null,
      fetchedAt: typeof raw?.fetchedAt === "string" ? raw.fetchedAt : new Date().toISOString(),
      lastSeenAt: typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : null,
      assigneeOptions: normalizeBoardAssignees(raw?.assigneeOptions),
      tasks,
      unreadNewCount,
      readyTaskCount:
        typeof raw?.readyTaskCount === "number"
          ? raw.readyTaskCount
          : tasks.filter((t) => t.readyToStart).length,
      notifications,
      unreadNotificationCount,
      totalUnreadCount:
        typeof raw?.totalUnreadCount === "number"
          ? raw.totalUnreadCount
          : unreadNewCount + unreadNotificationCount,
      failures,
    };
  }

  async getDashboardLastSeenAt(): Promise<string | null> {
    return this.invokeCommand<string | null>("get_dashboard_last_seen_at");
  }

  async markDashboardSeen(timestamp?: string | null): Promise<string> {
    return this.invokeCommand<string>("mark_dashboard_seen", {
      timestamp: timestamp ?? null,
    });
  }
}
