import type { BoardAssignee, BoardIssue } from "./model";

export const ASSIGNEE_FILTER_ALL = "__all__";
export const ASSIGNEE_FILTER_UNASSIGNED = "__unassigned__";

export function normalizeBoardAssignees(raw: unknown): BoardAssignee[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized: BoardAssignee[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.login !== "string" || !candidate.login.trim()) continue;
    normalized.push({
      login: candidate.login.trim(),
      avatarUrl:
        typeof candidate.avatarUrl === "string" && candidate.avatarUrl.trim()
          ? candidate.avatarUrl.trim()
          : null,
      name:
        typeof candidate.name === "string" && candidate.name.trim()
          ? candidate.name.trim()
          : null,
    });
  }
  return normalized;
}

const MAX_WALK_DEPTH = 32;

export function collectBoardAssignees(
  issues: ReadonlyArray<BoardIssue>,
  preferredLogin?: string | null,
): BoardAssignee[] {
  const byLower = new Map<string, BoardAssignee>();
  const visited = new Set<string>();

  const walk = (list: ReadonlyArray<BoardIssue>, depth: number) => {
    if (depth > MAX_WALK_DEPTH) return;
    for (const issue of list) {
      const key = issue.url?.trim();
      if (key) {
        if (visited.has(key)) continue;
        visited.add(key);
      }
      for (const assignee of issue.assignees ?? []) {
        const login = assignee.login?.trim();
        if (!login) continue;
        const lower = login.toLowerCase();
        const prev = byLower.get(lower);
        if (!prev) {
          byLower.set(lower, {
            login,
            avatarUrl: assignee.avatarUrl ?? null,
            name: assignee.name ?? null,
          });
        } else {
          byLower.set(lower, {
            login: prev.login,
            avatarUrl: prev.avatarUrl ?? assignee.avatarUrl ?? null,
            name: prev.name ?? assignee.name ?? null,
          });
        }
      }
      if (issue.children?.length) {
        walk(issue.children, depth + 1);
      }
    }
  };

  walk(issues, 0);

  const preferred = preferredLogin?.trim();
  const preferredLower = preferred?.toLowerCase() ?? null;
  if (preferred && preferredLower && !byLower.has(preferredLower)) {
    byLower.set(preferredLower, { login: preferred });
  }

  return Array.from(byLower.values()).sort((a, b) => {
    if (preferredLower) {
      const aIsMe = a.login.toLowerCase() === preferredLower;
      const bIsMe = b.login.toLowerCase() === preferredLower;
      if (aIsMe !== bIsMe) return aIsMe ? -1 : 1;
    }
    return a.login.toLowerCase().localeCompare(b.login.toLowerCase());
  });
}

export function matchesAssigneeFilter(
  issue: BoardIssue,
  filter: string,
): boolean {
  if (!filter || filter === ASSIGNEE_FILTER_ALL) {
    return true;
  }
  const assignees = issue.assignees ?? [];
  if (filter === ASSIGNEE_FILTER_UNASSIGNED) {
    return assignees.length === 0;
  }
  const target = filter.trim().toLowerCase();
  return assignees.some((a) => a.login.trim().toLowerCase() === target);
}

export function filterTreeByAssignee(
  issues: ReadonlyArray<BoardIssue>,
  filter: string,
): BoardIssue[] {
  if (!filter || filter === ASSIGNEE_FILTER_ALL) {
    return issues as BoardIssue[];
  }
  const filterNodes = (
    nodes: ReadonlyArray<BoardIssue>,
    depth: number,
  ): BoardIssue[] => {
    if (depth > MAX_WALK_DEPTH) return [];
    const kept: BoardIssue[] = [];
    for (const node of nodes) {
      const kids = Array.isArray(node.children) ? node.children : [];
      const filteredChildren =
        kids.length > 0 ? filterNodes(kids, depth + 1) : [];
      if (matchesAssigneeFilter(node, filter) || filteredChildren.length > 0) {
        kept.push({
          ...node,
          children: filteredChildren,
        });
      }
    }
    return kept;
  };

  return filterNodes(issues, 0);
}

export function formatAssigneeBadgeLabel(
  assignees?: ReadonlyArray<BoardAssignee>,
): string {
  const list = assignees ?? [];
  if (list.length === 0) {
    return "미배정";
  }
  if (list.length === 1) {
    return `@${list[0].login}`;
  }
  return `@${list[0].login} 외 ${list.length - 1}`;
}
