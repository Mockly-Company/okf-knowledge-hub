import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  const pendingSyncByKeyRef = useRef<
    Map<
      string,
      { token: symbol; forceSync: boolean; retryWorkspaceId: string | null }
    >
  >(new Map());

  const workspacesKey = useMemo(() => {
    const workspaces = activeProject?.workspaces ?? [];
    return workspaces.map((w) => w.id).join(",");
  }, [activeProject?.workspaces]);

  const workspaceCount = activeProject?.workspaces.length ?? 0;
  // WorkspaceConnectionProvider 밖이나 초기 미연결 상태에서는 안전하게 비활성화한다(M6).
  const authStatus = connection?.account.status ?? "unauthenticated";
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

  const query = useQuery<PersonalDashboardResult>({
    queryKey,
    enabled,
    staleTime: 30_000,
    // 같은 워크스페이스·사용자에서 필터만 바꿀 때는 이전 데이터를 유지해
    // totalUnreadCount 배지가 잠시 0으로 깜빡이지 않게 한다.
    placeholderData: (previousData, previousQuery) =>
      personalDashboardKeys.hasSameScope(
        previousQuery?.queryKey,
        workspacesKey,
        viewerLogin,
      )
        ? previousData
        : undefined,
    queryFn: async ({ queryKey: currentKey }) => {
      const serialized = JSON.stringify(currentKey);
      const pending = pendingSyncByKeyRef.current.get(serialized);
      if (pending) {
        pendingSyncByKeyRef.current.delete(serialized);
      }
      const rawFilter = typeof currentKey[2] === "string" ? currentKey[2] : "__me__";
      const resolvedFilter = rawFilter === "__me__" ? null : rawFilter;
      return gateway.getPersonalDashboard({
        assigneeFilter: resolvedFilter,
        forceSync: pending?.forceSync ?? false,
        retryWorkspaceId: pending?.retryWorkspaceId ?? null,
      });
    },
  });

  useEffect(() => {
    if (!enabled) {
      pendingSyncByKeyRef.current.clear();
    }
  }, [enabled]);

  const runSyncedRefetch = useCallback(
    async (options: { forceSync: boolean; retryWorkspaceId: string | null }) => {
      if (!enabled) {
        return;
      }
      const serializedKey = JSON.stringify(queryKey);
      const token = Symbol();
      pendingSyncByKeyRef.current.clear();
      pendingSyncByKeyRef.current.set(serializedKey, { token, ...options });
      queryClient.removeQueries({
        queryKey: personalDashboardKeys.all,
        type: "inactive",
      });
      try {
        await queryClient.refetchQueries({ queryKey, exact: true });
      } finally {
        if (pendingSyncByKeyRef.current.get(serializedKey)?.token === token) {
          pendingSyncByKeyRef.current.delete(serializedKey);
        }
      }
    },
    [enabled, queryClient, queryKey],
  );

  const refresh = useCallback(
    () => runSyncedRefetch({ forceSync: true, retryWorkspaceId: null }),
    [runSyncedRefetch],
  );

  const retryWorkspace = useCallback(
    (workspaceId: string) =>
      runSyncedRefetch({ forceSync: false, retryWorkspaceId: workspaceId }),
    [runSyncedRefetch],
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
