import type { BoardAssignee, BoardLayer, BoardStatus } from "@/features/project-board/model";

export type DashboardNotificationKind = "open_pr" | "merged_doc";

export type DashboardFailureScope = "board" | "docs";

export interface DashboardTaskItem {
  workspaceId: string;
  workspaceTitle: string;
  projectOwner: string;
  projectNumber: number;
  projectTitle: string;
  repositoryFullName: string | null;
  issueNumber: number;
  title: string;
  url: string;
  status: BoardStatus;
  layer: BoardLayer;
  kind: string | null;
  dependsOn: number | null;
  predecessorDone: boolean;
  readyToStart: boolean;
  isNew: boolean;
  assignees: BoardAssignee[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardNotificationItem {
  id: string;
  workspaceId: string;
  workspaceTitle: string;
  repositoryFullName: string;
  kind: DashboardNotificationKind;
  prNumber: number;
  title: string;
  summary: string;
  authorLogin: string;
  url: string;
  primaryDocPath: string | null;
  hasCompanionHtml: boolean;
  timestamp: string;
  isNew: boolean;
  isChecked?: boolean;
}

export interface DashboardWorkspaceFailure {
  workspaceId: string;
  workspaceTitle: string;
  scope: DashboardFailureScope;
  message: string;
}

export interface PersonalDashboardResult {
  viewerLogin: string | null;
  fetchedAt: string;
  lastSeenAt: string | null;
  assigneeOptions: BoardAssignee[];
  tasks: DashboardTaskItem[];
  unreadNewCount: number;
  readyTaskCount: number;
  notifications: DashboardNotificationItem[];
  unreadNotificationCount: number;
  totalUnreadCount: number;
  failures: DashboardWorkspaceFailure[];
}

export function isDashboardTimestampNew(
  timestamp: string,
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const itemMs = Date.parse(timestamp);
  if (!Number.isFinite(itemMs)) return false;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  if (Number.isFinite(lastSeenMs)) {
    return itemMs > lastSeenMs;
  }
  return itemMs >= nowMs - 7 * 86_400 * 1000;
}
