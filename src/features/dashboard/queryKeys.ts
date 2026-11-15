export const personalDashboardKeys = {
  all: ["personalDashboard"] as const,
  view: (
    assigneeFilter: string | null,
    workspacesKey = "",
    viewerLogin: string | null = null,
  ) =>
    [
      "personalDashboard",
      "view",
      assigneeFilter ?? "__me__",
      workspacesKey,
      viewerLogin ?? "__anon__",
    ] as const,
  hasSameScope: (
    key: readonly unknown[] | undefined,
    workspacesKey: string,
    viewerLogin: string | null,
  ) =>
    Array.isArray(key) &&
    key[0] === "personalDashboard" &&
    key[1] === "view" &&
    key[3] === workspacesKey &&
    key[4] === (viewerLogin ?? "__anon__"),
};
