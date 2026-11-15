import type {
  BoardAssignee,
  TeamRoleKey,
  WorkspaceTeamAssignees,
} from "./model";

export interface TeamRoleDefinition {
  key: TeamRoleKey;
  label: string;
}

export const TEAM_ROLES: ReadonlyArray<TeamRoleDefinition> = [
  { key: "planning", label: "기획" },
  { key: "design", label: "디자인" },
  { key: "frontend", label: "프론트엔드" },
  { key: "backend", label: "백엔드" },
];

export const EMPTY_TEAM_ASSIGNEES: WorkspaceTeamAssignees = {
  planning: [],
  design: [],
  frontend: [],
  backend: [],
};

export function cloneTeamAssignees(
  source?: WorkspaceTeamAssignees | null,
): WorkspaceTeamAssignees {
  if (!source) {
    return {
      planning: [],
      design: [],
      frontend: [],
      backend: [],
    };
  }
  return {
    planning: [...source.planning],
    design: [...source.design],
    frontend: [...source.frontend],
    backend: [...source.backend],
  };
}

function normalizedRoleSignature(list: ReadonlyArray<string>): string {
  return Array.from(new Set(list.map((login) => login.trim().toLowerCase())))
    .filter(Boolean)
    .sort()
    .join("\n");
}

export function areTeamAssigneesEqual(
  a: WorkspaceTeamAssignees,
  b: WorkspaceTeamAssignees,
): boolean {
  return TEAM_ROLES.every(
    ({ key }) =>
      normalizedRoleSignature(a[key]) === normalizedRoleSignature(b[key]),
  );
}

export function sortTeamMembers(
  members: ReadonlyArray<BoardAssignee>,
): BoardAssignee[] {
  return [...members].sort((a, b) => {
    const labelA = a.name?.trim() || a.login;
    const labelB = b.name?.trim() || b.login;
    const byName = labelA.localeCompare(labelB, undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) {
      return byName;
    }
    return a.login.localeCompare(b.login, undefined, { sensitivity: "base" });
  });
}

export function hasRoleLogin(
  list: ReadonlyArray<string>,
  login: string,
): boolean {
  const target = login.trim().toLowerCase();
  if (!target) return false;
  return list.some((entry) => entry.trim().toLowerCase() === target);
}

export function toggleRoleMember(
  assignees: WorkspaceTeamAssignees,
  role: TeamRoleKey,
  login: string,
): WorkspaceTeamAssignees {
  const target = login.trim();
  if (!target) {
    return assignees;
  }
  const targetLower = target.toLowerCase();
  const current = assignees[role];
  const exists = current.some(
    (entry) => entry.trim().toLowerCase() === targetLower,
  );
  const nextList = exists
    ? current.filter((entry) => entry.trim().toLowerCase() !== targetLower)
    : [...current, target];
  return {
    ...assignees,
    [role]: nextList,
  };
}

export function removeLoginFromAllRoles(
  assignees: WorkspaceTeamAssignees,
  login: string,
): WorkspaceTeamAssignees {
  const targetLower = login.trim().toLowerCase();
  if (!targetLower) {
    return assignees;
  }
  return {
    planning: assignees.planning.filter(
      (entry) => entry.trim().toLowerCase() !== targetLower,
    ),
    design: assignees.design.filter(
      (entry) => entry.trim().toLowerCase() !== targetLower,
    ),
    frontend: assignees.frontend.filter(
      (entry) => entry.trim().toLowerCase() !== targetLower,
    ),
    backend: assignees.backend.filter(
      (entry) => entry.trim().toLowerCase() !== targetLower,
    ),
  };
}

export function findStaleAssignedLogins(
  assignees: WorkspaceTeamAssignees,
  members: ReadonlyArray<BoardAssignee>,
): string[] {
  const known = new Set(
    members.map((member) => member.login.trim().toLowerCase()).filter(Boolean),
  );
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const { key } of TEAM_ROLES) {
    for (const raw of assignees[key]) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!known.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        stale.push(trimmed);
      }
    }
  }
  return stale;
}

export function findMissingTeamRoles(
  assignees: WorkspaceTeamAssignees,
  members: ReadonlyArray<BoardAssignee>,
  options?: { treatAllConfiguredAsValid?: boolean },
): TeamRoleDefinition[] {
  const treatAll = Boolean(options?.treatAllConfiguredAsValid);
  const known = new Set(
    members.map((member) => member.login.trim().toLowerCase()).filter(Boolean),
  );
  return TEAM_ROLES.filter(({ key }) => {
    const entries = assignees[key].filter((raw) => raw.trim().length > 0);
    if (treatAll) {
      return entries.length === 0;
    }
    return !entries.some((raw) => known.has(raw.trim().toLowerCase()));
  });
}

export function collectConfiguredFallbackMembers(
  assignees: WorkspaceTeamAssignees,
  members: ReadonlyArray<BoardAssignee>,
): BoardAssignee[] {
  const byLower = new Map<string, BoardAssignee>();
  for (const member of members) {
    const lower = member.login.trim().toLowerCase();
    if (lower) {
      byLower.set(lower, member);
    }
  }
  for (const { key } of TEAM_ROLES) {
    for (const raw of assignees[key]) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!byLower.has(lower)) {
        byLower.set(lower, { login: trimmed, avatarUrl: null, name: null });
      }
    }
  }
  return sortTeamMembers(Array.from(byLower.values()));
}

export type IssueOwnership =
  | { kind: "unknown" }
  | { kind: "unassigned" }
  | { kind: "self"; assigneeLogins: string[] }
  | { kind: "other"; assigneeLogins: string[] };

export function classifyIssueOwnership(
  assignees: ReadonlyArray<BoardAssignee> | undefined,
  viewerLogin: string | null | undefined,
): IssueOwnership {
  const trimmedViewer = viewerLogin?.trim() ?? "";
  if (!trimmedViewer) {
    return { kind: "unknown" };
  }
  const assigneeLogins = (assignees ?? [])
    .map((assignee) => assignee.login.trim())
    .filter(Boolean);
  if (assigneeLogins.length === 0) {
    return { kind: "unassigned" };
  }
  const viewerLower = trimmedViewer.toLowerCase();
  if (assigneeLogins.some((login) => login.toLowerCase() === viewerLower)) {
    return { kind: "self", assigneeLogins };
  }
  return { kind: "other", assigneeLogins };
}

export function formatAssigneeHandles(logins: ReadonlyArray<string>): string {
  return logins.map((login) => `@${login}`).join(", ");
}
