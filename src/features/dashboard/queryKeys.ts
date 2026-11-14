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
};
