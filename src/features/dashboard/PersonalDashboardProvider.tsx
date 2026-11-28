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
import { projectBoardKeys } from "@/features/project-board/queryKeys";
import { useOptionalWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  WINDOW_FOCUS_SYNC_COOLDOWN_MS,
  useWindowFocusAndIntervalSync,
} from "@/infrastructure/sync/autoSyncPolicy";
import type { PersonalDashboardGateway } from "./PersonalDashboardGateway";
import {
  isDashboardNotificationChecked,
  isDashboardTimestampNew,
  type PersonalDashboardResult,
} from "./model";
import { personalDashboardKeys } from "./queryKeys";

export interface PersonalDashboardContextValue {
  dashboard: PersonalDashboardResult | null;
  isLoading: boolean;
  isFetching: boolean;
  isMarkingSeen: boolean;
  /** 대시보드가 로그인·포커스·주기 백그라운드 동기화를 담당 중이면 참이다. */
  isAutoSyncActive: boolean;
  /** 백그라운드 또는 수동 전체 동기화(forceSync)가 진행 중이면 참이다. */
  isBackgroundSyncing: boolean;
  error: Error | null;
  assigneeFilter: string | null;
  setAssigneeFilter(next: string | null): void;
  unreadCount: number;
  refresh(): Promise<void>;
  retryWorkspace(workspaceId: string): Promise<void>;
  markSeen(): Promise<void>;
  toggleNotificationChecked(
    notificationId: string,
    checked: boolean,
    itemTimestamp: string,
  ): Promise<void>;
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
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const pendingSyncByKeyRef = useRef<
    Map<
      string,
      { token: symbol; forceSync: boolean; retryWorkspaceId: string | null }
    >
  >(new Map());
  const lastSyncedAtMsRef = useRef<number | null>(null);
  const syncedLoginVersionRef = useRef<number>(0);
  const lastBoardInvalidatedScopeRef = useRef<string | null>(null);

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
  const authSessionVersion = connection?.authSessionVersion ?? 0;
  const authSessionOrigin = connection?.authSessionOrigin ?? null;

  const authSessionVersionRef = useRef(authSessionVersion);
  authSessionVersionRef.current = authSessionVersion;
  const authSessionOriginRef = useRef(authSessionOrigin);
  authSessionOriginRef.current = authSessionOrigin;
  const workspacesKeyRef = useRef(workspacesKey);
  workspacesKeyRef.current = workspacesKey;
  const viewerLoginRef = useRef(viewerLogin);
  viewerLoginRef.current = viewerLogin;

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
      const isFreshLoginSync =
        authSessionOriginRef.current === "login" &&
        authSessionVersionRef.current > 0 &&
        syncedLoginVersionRef.current !== authSessionVersionRef.current;
      if (isFreshLoginSync) {
        syncedLoginVersionRef.current = authSessionVersionRef.current;
      }
      const forceSync = Boolean(pending?.forceSync) || isFreshLoginSync;
      const retryWorkspaceId = pending?.retryWorkspaceId ?? null;
      const rawFilter = typeof currentKey[2] === "string" ? currentKey[2] : "__me__";
      const resolvedFilter = rawFilter === "__me__" ? null : rawFilter;
      const currentScopeKey = `${authSessionVersionRef.current}::${workspacesKeyRef.current}::${viewerLoginRef.current ?? ""}`;
      const isFirstFetchForScope =
        lastBoardInvalidatedScopeRef.current !== currentScopeKey;

      if (forceSync) {
        setIsBackgroundSyncing(true);
      }
      try {
        const result = await gateway.getPersonalDashboard({
          assigneeFilter: resolvedFilter,
          forceSync,
          retryWorkspaceId,
        });
        lastSyncedAtMsRef.current = Date.now();
        // 백엔드가 보드 캐시를 갱신할 수 있는 조회(세션 첫 로드·전체 동기화·워크스페이스 재시도)
        // 직후에는 Board 화면 쿼리도 무효화해 화면 간 불일치를 없앤다.
        if (forceSync || retryWorkspaceId !== null || isFirstFetchForScope) {
          lastBoardInvalidatedScopeRef.current = currentScopeKey;
          void queryClient.invalidateQueries({
            queryKey: projectBoardKeys.boards,
          });
        }
        return result;
      } finally {
        if (forceSync) {
          setIsBackgroundSyncing(false);
        }
      }
    },
  });

  useEffect(() => {
    if (!enabled) {
      pendingSyncByKeyRef.current.clear();
      lastSyncedAtMsRef.current = null;
      lastBoardInvalidatedScopeRef.current = null;
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

  // 대화형 신규 로그인 직후 이미 같은 키의 캐시가 남아 있는 경우에도 1회 강제 동기화를 보장한다.
  useEffect(() => {
    if (
      !enabled ||
      authSessionOrigin !== "login" ||
      authSessionVersion <= 0 ||
      syncedLoginVersionRef.current === authSessionVersion ||
      query.isFetching
    ) {
      return;
    }
    syncedLoginVersionRef.current = authSessionVersion;
    void runSyncedRefetch({ forceSync: true, retryWorkspaceId: null });
  }, [
    authSessionOrigin,
    authSessionVersion,
    enabled,
    query.isFetching,
    runSyncedRefetch,
  ]);

  // 창 포커스 복귀(60초 쿨다운)와 5분 주기 백그라운드 동기화로 모든 워크스페이스 보드·알림을 최신화한다.
  useWindowFocusAndIntervalSync({
    enabled,
    intervalMs: BACKGROUND_SYNC_INTERVAL_MS,
    focusCooldownMs: WINDOW_FOCUS_SYNC_COOLDOWN_MS,
    getLastSyncAtMs: () => lastSyncedAtMsRef.current,
    onSync: () => {
      if (query.isFetching) {
        return;
      }
      void runSyncedRefetch({ forceSync: true, retryWorkspaceId: null });
    },
  });

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

  const isMarkingSeen = markSeenMutation.isPending;
  const markDashboardSeen = markSeenMutation.mutateAsync;
  const markSeen = useCallback(async () => {
    await markDashboardSeen();
  }, [markDashboardSeen]);

  const checkNotificationMutation = useMutation({
    mutationFn: ({
      notificationId,
      checked,
      itemTimestamp,
    }: {
      notificationId: string;
      checked: boolean;
      itemTimestamp: string;
    }) =>
      gateway.setDashboardNotificationChecked(
        notificationId,
        checked,
        itemTimestamp,
      ),
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData<PersonalDashboardResult | undefined>(
        { queryKey: personalDashboardKeys.all },
        (current) => {
          if (!current) return current;
          const fetchedMs = Date.parse(current.fetchedAt);
          const fallbackNowMs = Number.isFinite(fetchedMs) ? fetchedMs : Date.now();
          const nextNotifications = current.notifications.map((item) => {
            if (item.id !== variables.notificationId) return item;
            if (
              variables.checked &&
              isDashboardNotificationChecked(item.timestamp, variables.itemTimestamp)
            ) {
              return { ...item, isChecked: true, isNew: false };
            }
            const restoredNew = isDashboardTimestampNew(
              item.timestamp,
              current.lastSeenAt,
              fallbackNowMs,
            );
            return { ...item, isChecked: false, isNew: restoredNew };
          });
          const prevUnreadNotif = current.unreadNotificationCount;
          const nextUnreadNotif = nextNotifications.filter((n) => n.isNew).length;
          const delta = nextUnreadNotif - prevUnreadNotif;
          return {
            ...current,
            notifications: nextNotifications,
            unreadNotificationCount: nextUnreadNotif,
            totalUnreadCount: Math.max(0, current.totalUnreadCount + delta),
          };
        },
      );
      void queryClient.invalidateQueries({ queryKey: personalDashboardKeys.all });
    },
  });

  const mutateNotificationChecked = checkNotificationMutation.mutateAsync;
  const toggleNotificationChecked = useCallback(
    async (notificationId: string, checked: boolean, itemTimestamp: string) => {
      await mutateNotificationChecked({ notificationId, checked, itemTimestamp });
    },
    [mutateNotificationChecked],
  );

  const unreadCount = useMemo(() => {
    if (!query.data) return 0;
    return query.data.totalUnreadCount;
  }, [query.data]);

  const value = useMemo<PersonalDashboardContextValue>(
    () => ({
      dashboard: query.data ?? null,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      isMarkingSeen,
      isAutoSyncActive: enabled,
      isBackgroundSyncing,
      error: query.error ? toError(query.error) : null,
      assigneeFilter,
      setAssigneeFilter,
      unreadCount,
      refresh,
      retryWorkspace,
      markSeen,
      toggleNotificationChecked,
    }),
    [
      assigneeFilter,
      enabled,
      isBackgroundSyncing,
      isMarkingSeen,
      markSeen,
      query.data,
      query.error,
      query.isFetching,
      query.isLoading,
      refresh,
      retryWorkspace,
      toggleNotificationChecked,
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
