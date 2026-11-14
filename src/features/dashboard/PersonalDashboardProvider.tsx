import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { useOptionalWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { PersonalDashboardGateway } from "./PersonalDashboardGateway";
import type { PersonalDashboardResult } from "./model";
import { personalDashboardKeys } from "./queryKeys";

export interface PersonalDashboardContextValue {
  dashboard: PersonalDashboardResult | null;
  isLoading: boolean;
  isFetching: boolean;
  isMarkingSeen: boolean;
  error: Error | null;
  assigneeFilter: string | null;
  setAssigneeFilter(next: string | null): void;
  unreadCount: number;
  refresh(): Promise<void>;
  retryWorkspace(workspaceId: string): Promise<void>;
  markSeen(): Promise<void>;
}

const PersonalDashboardContext =
  createContext<PersonalDashboardContextValue | null>(null);

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return new Error((error as { message: string }).message);
  }
  return new Error("대시보드를 불러오지 못했습니다.");
}

export function PersonalDashboardProvider({
  gateway,
  children,
}: PropsWithChildren<{ gateway: PersonalDashboardGateway }>) {
  const queryClient = useQueryClient();
  const activeProject = useOptionalActiveProject();
  const connection = useOptionalWorkspaceConnection();
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const nextSyncOptionsRef = useRef<{
    forceSync?: boolean;
    retryWorkspaceId?: string | null;
  } | null>(null);

  const workspacesKey = useMemo(() => {
    const workspaces = activeProject?.workspaces ?? [];
    return workspaces.map((w) => w.id).join(",");
  }, [activeProject?.workspaces]);

  const workspaceCount = activeProject?.workspaces.length ?? 0;
  const authStatus = connection?.account.status ?? "authenticated";
  const viewerLogin =
    connection?.account.status === "authenticated"
      ? connection.account.user.login
      : null;

  const enabled =
    authStatus === "authenticated" &&
    (activeProject === null || workspaceCount > 0);

  const queryKey = useMemo(
    () =>
      personalDashboardKeys.view(assigneeFilter, workspacesKey, viewerLogin),
    [assigneeFilter, viewerLogin, workspacesKey],
  );

  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const pending = nextSyncOptionsRef.current;
      nextSyncOptionsRef.current = null;
      return gateway.getPersonalDashboard({
        assigneeFilter,
        forceSync: pending?.forceSync ?? false,
        retryWorkspaceId: pending?.retryWorkspaceId ?? null,
      });
    },
  });

  const refresh = useCallback(async () => {
    nextSyncOptionsRef.current = { forceSync: true, retryWorkspaceId: null };
    await queryClient.invalidateQueries({ queryKey: personalDashboardKeys.all });
  }, [queryClient]);

  const retryWorkspace = useCallback(
    async (workspaceId: string) => {
      nextSyncOptionsRef.current = {
        forceSync: false,
        retryWorkspaceId: workspaceId,
      };
      await query.refetch();
    },
    [query],
  );

  const markSeenMutation = useMutation({
    mutationFn: () => gateway.markDashboardSeen(),
    onSuccess: (seenAt) => {
      queryClient.setQueriesData<PersonalDashboardResult | undefined>(
        { queryKey: personalDashboardKeys.all },
        (current) =>
          current
            ? {
                ...current,
                lastSeenAt: seenAt,
                unreadNewCount: 0,
                unreadNotificationCount: 0,
                totalUnreadCount: 0,
                tasks: current.tasks.map((task) => ({ ...task, isNew: false })),
                notifications: current.notifications.map((item) => ({
                  ...item,
                  isNew: false,
                })),
              }
            : current,
      );
    },
  });

  const unreadCount = useMemo(() => {
    if (!query.data) return 0;
    return query.data.totalUnreadCount;
  }, [query.data]);

  const value = useMemo<PersonalDashboardContextValue>(
    () => ({
      dashboard: query.data ?? null,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      isMarkingSeen: markSeenMutation.isPending,
      error: query.error ? toError(query.error) : null,
      assigneeFilter,
      setAssigneeFilter,
      unreadCount,
      refresh,
      retryWorkspace,
      markSeen: async () => {
        await markSeenMutation.mutateAsync();
      },
    }),
    [
      assigneeFilter,
      markSeenMutation,
      query.data,
      query.error,
      query.isFetching,
      query.isLoading,
      refresh,
      retryWorkspace,
      unreadCount,
    ],
  );

  return (
    <PersonalDashboardContext.Provider value={value}>
      {children}
    </PersonalDashboardContext.Provider>
  );
}

export function useOptionalPersonalDashboard(): PersonalDashboardContextValue | null {
  return useContext(PersonalDashboardContext);
}
