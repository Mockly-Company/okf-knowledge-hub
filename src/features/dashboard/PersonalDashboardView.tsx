import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { BoardStatus } from "@/features/project-board/model";
import { useOptionalPersonalDashboard } from "./PersonalDashboardProvider";
import type { DashboardNotificationItem, DashboardTaskItem } from "./model";

const NOTIFICATION_PAGE_SIZE = 10;
const FILTER_ME_VALUE = "__me__";
const FILTER_ALL_VALUE = "*";

const STATUS_META: Record<BoardStatus, { label: string; tone: StatusTone }> = {
  backlog: { label: "Backlog", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  in_review: { label: "In review", tone: "warning" },
  done: { label: "Done", tone: "success" },
};

function formatAssigneeOptionLabel(login: string, name?: string | null): string {
  const trimmedName = name?.trim();
  return trimmedName ? `@${login} (${trimmedName})` : `@${login}`;
}

export function PersonalDashboardView() {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <RoutedPersonalDashboardView />
  ) : (
    <PersonalDashboardInner navigate={null} />
  );
}

function RoutedPersonalDashboardView() {
  const routerNavigate = useNavigate();
  const navigate = useCallback((to: string) => routerNavigate(to), [routerNavigate]);
  return <PersonalDashboardInner navigate={navigate} />;
}

function PersonalDashboardInner({
  navigate,
}: {
  navigate: ((to: string) => void) | null;
}) {
  const dashboardContext = useOptionalPersonalDashboard();
  const activeProject = useOptionalActiveProject();
  const [page, setPage] = useState(0);
  const [actionError, setActionError] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const dashboard = dashboardContext?.dashboard ?? null;
  const isLoading = dashboardContext?.isLoading ?? false;
  const isFetching = dashboardContext?.isFetching ?? false;
  const isMarkingSeen = dashboardContext?.isMarkingSeen ?? false;
  const error = dashboardContext?.error ?? null;
  const assigneeFilter = dashboardContext?.assigneeFilter ?? null;
  const unreadCount = dashboardContext?.unreadCount ?? 0;

  const viewerLogin = dashboard?.viewerLogin ?? null;
  const tasks = dashboard?.tasks ?? [];
  const notifications = dashboard?.notifications ?? [];
  const failures = dashboard?.failures ?? [];

  const totalPages = Math.max(
    1,
    Math.ceil(notifications.length / NOTIFICATION_PAGE_SIZE),
  );
  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);
  const safePage = Math.min(page, totalPages - 1);
  const pagedNotifications = useMemo(
    () =>
      notifications.slice(
        safePage * NOTIFICATION_PAGE_SIZE,
        (safePage + 1) * NOTIFICATION_PAGE_SIZE,
      ),
    [notifications, safePage],
  );

  const otherAssignees = useMemo(() => {
    const seen = new Set<string>();
    if (viewerLogin) {
      seen.add(viewerLogin.toLowerCase());
    }
    const list = [];
    for (const member of dashboard?.assigneeOptions ?? []) {
      const key = member.login.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(member);
    }
    if (
      assigneeFilter &&
      assigneeFilter !== FILTER_ALL_VALUE &&
      !seen.has(assigneeFilter.toLowerCase())
    ) {
      list.push({ login: assigneeFilter, name: null, avatarUrl: null });
    }
    return list;
  }, [assigneeFilter, dashboard?.assigneeOptions, viewerLogin]);

  const selectValue =
    assigneeFilter === null
      ? FILTER_ME_VALUE
      : assigneeFilter === FILTER_ALL_VALUE
        ? FILTER_ALL_VALUE
        : assigneeFilter;

  const handleFilterChange = (next: string) => {
    setPage(0);
    if (!dashboardContext) return;
    if (next === FILTER_ME_VALUE) {
      dashboardContext.setAssigneeFilter(null);
      return;
    }
    dashboardContext.setAssigneeFilter(next);
  };

  const switchWorkspaceIfNeeded = useCallback(
    async (workspaceId: string): Promise<boolean> => {
      if (!activeProject || activeProject.activeWorkspaceId === workspaceId) {
        return true;
      }
      setActionError(null);
      try {
        await activeProject.selectWorkspace(workspaceId);
        return true;
      } catch (err) {
        setActionError({
          title: "워크스페이스 전환 실패",
          message:
            err instanceof Error
              ? err.message
              : "워크스페이스를 전환하지 못했습니다.",
        });
        return false;
      }
    },
    [activeProject],
  );

  const handleMarkSeen = async () => {
    if (!dashboardContext) return;
    setActionError(null);
    try {
      await dashboardContext.markSeen();
    } catch (err) {
      setActionError({
        title: "읽음 처리 실패",
        message:
          err instanceof Error
            ? err.message
            : "모든 항목을 읽음으로 표시하지 못했습니다.",
      });
    }
  };

  const handleOpenTask = async (task: DashboardTaskItem) => {
    const ok = await switchWorkspaceIfNeeded(task.workspaceId);
    if (!ok) return;
    navigate?.(`/project?issue=${task.issueNumber}`);
  };

  const handleOpenNotification = async (item: DashboardNotificationItem) => {
    const ok = await switchWorkspaceIfNeeded(item.workspaceId);
    if (!ok) return;
    if (item.kind === "open_pr") {
      navigate?.(`/documents?pr=${item.prNumber}`);
      return;
    }
    if (item.primaryDocPath) {
      navigate?.(`/documents?doc=${encodeURIComponent(item.primaryDocPath)}`);
      return;
    }
    navigate?.("/documents");
  };

  return (
    <section
      className="home-page min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="home-title"
    >
      <div className="grid gap-[var(--space-6)]">
        <PageHeader
          titleId="home-title"
          title="내 대시보드"
          description={
            viewerLogin
              ? `안녕하세요, @${viewerLogin}님 · 연결된 모든 프로젝트의 내 작업과 바뀐 기획을 모았습니다`
              : "연결된 모든 프로젝트의 작업과 바뀐 기획을 모았습니다"
          }
          actions={
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <div className="min-w-[11rem]">
                <Select
                  aria-label="담당자 보기"
                  value={selectValue}
                  onValueChange={handleFilterChange}
                >
                  <SelectOption value={FILTER_ME_VALUE}>
                    {viewerLogin ? `내 작업 (@${viewerLogin})` : "내 작업"}
                  </SelectOption>
                  {otherAssignees.map((member) => (
                    <SelectOption key={member.login} value={member.login}>
                      {formatAssigneeOptionLabel(member.login, member.name)}
                    </SelectOption>
                  ))}
                  <SelectOption value={FILTER_ALL_VALUE}>전체</SelectOption>
                </Select>
              </div>
              {unreadCount > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isMarkingSeen}
                  onClick={() => void handleMarkSeen()}
                >
                  모두 읽음
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={isFetching}
                onClick={() => void dashboardContext?.refresh()}
              >
                <RefreshCw
                  aria-hidden="true"
                  size={16}
                  strokeWidth={1.75}
                  className={isFetching ? "animate-spin" : undefined}
                />
                {isFetching ? "동기화 중…" : "새로고침"}
              </Button>
            </div>
          }
        />

        {actionError ? (
          <StatusFeedback
            variant="banner"
            tone="error"
            actionPlacement="end"
            action={
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActionError(null)}
              >
                닫기
              </Button>
            }
          >
            <StatusFeedbackTitle>{actionError.title}</StatusFeedbackTitle>
            <StatusFeedbackDescription>{actionError.message}</StatusFeedbackDescription>
          </StatusFeedback>
        ) : null}

        {error ? (
          <StatusFeedback
            variant="banner"
            tone="error"
            actionPlacement="end"
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => void dashboardContext?.refresh()}
              >
                다시 시도
              </Button>
            }
          >
            <StatusFeedbackTitle>
              대시보드를 불러오지 못했습니다
            </StatusFeedbackTitle>
            <StatusFeedbackDescription>
              {error.message}
            </StatusFeedbackDescription>
          </StatusFeedback>
        ) : null}

        {failures.length > 0 ? (
          <div className="grid gap-[var(--space-2)]">
            {failures.map((failure) => (
              <StatusFeedback
                key={`${failure.workspaceId}:${failure.scope}`}
                variant="banner"
                tone="warning"
                actionPlacement="end"
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      void dashboardContext?.retryWorkspace(failure.workspaceId)
                    }
                  >
                    다시 시도
                  </Button>
                }
              >
                <StatusFeedbackTitle>
                  {`${failure.workspaceTitle} (${failure.scope === "board" ? "보드" : "문서 저장소"}) 동기화 일부 실패`}
                </StatusFeedbackTitle>
                <StatusFeedbackDescription>
                  {failure.message}
                </StatusFeedbackDescription>
              </StatusFeedback>
            ))}
          </div>
        ) : null}

        <section
          aria-label="대시보드 요약"
          aria-busy={isFetching}
          className={`grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-3${isFetching ? " opacity-75 transition-opacity" : ""}`}
        >
          <div className="grid gap-[var(--space-1)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-[var(--space-4)] py-[var(--space-3)]">
            <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              새로 배정된 할 일
            </span>
            <strong
              className={
                (dashboard?.unreadNewCount ?? 0) > 0
                  ? "text-[length:var(--font-h2-size)] font-[number:var(--font-weight-page-title)] text-[var(--color-primary-text)] tabular-nums"
                  : "text-[length:var(--font-h2-size)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)] tabular-nums"
              }
            >
              {`${dashboard?.unreadNewCount ?? 0}건`}
            </strong>
          </div>

          <div className="grid gap-[var(--space-1)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-[var(--space-4)] py-[var(--space-3)]">
            <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              시작 가능 작업
            </span>
            <strong className="text-[length:var(--font-h2-size)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)] tabular-nums">
              {`${dashboard?.readyTaskCount ?? 0}건`}
            </strong>
          </div>

          <div className="grid gap-[var(--space-1)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-[var(--space-4)] py-[var(--space-3)]">
            <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              바뀐 기획·화면명세
            </span>
            <strong
              className={
                (dashboard?.unreadNotificationCount ?? 0) > 0
                  ? "text-[length:var(--font-h2-size)] font-[number:var(--font-weight-page-title)] text-[var(--color-warning)] tabular-nums"
                  : "text-[length:var(--font-h2-size)] font-[number:var(--font-weight-page-title)] text-[var(--color-text-strong)] tabular-nums"
              }
            >
              {`${dashboard?.unreadNotificationCount ?? 0}건`}
            </strong>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-[var(--space-5)] lg:grid-cols-2">
          <section
            aria-labelledby="dashboard-tasks-heading"
            className="grid min-w-0 content-start gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
          >
            <div className="flex items-center justify-between gap-[var(--space-2)]">
              <h2
                id="dashboard-tasks-heading"
                className="m-0 text-[length:var(--font-h2-size)] font-[number:var(--font-weight-section-title)] text-[var(--color-text-strong)]"
              >
                내 담당 백로그
              </h2>
              <StatusBadge tone="neutral">{`${tasks.length}건`}</StatusBadge>
            </div>

            {isLoading && !dashboard ? (
              <p className="m-0 py-[var(--space-4)] text-[var(--color-text-muted)]">
                담당 백로그를 불러오는 중…
              </p>
            ) : tasks.length === 0 ? (
              <p className="m-0 py-[var(--space-4)] text-[var(--color-text-muted)]">
                배정된 열린 작업이 없습니다.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-[var(--space-2)] p-0">
                {tasks.map((task) => {
                  const statusMeta = STATUS_META[task.status] ?? {
                    label: task.status,
                    tone: "neutral" as StatusTone,
                  };
                  return (
                    <li key={`${task.workspaceId}:${task.issueNumber}`}>
                      <UnstyledButton
                        type="button"
                        onClick={() => void handleOpenTask(task)}
                        className="grid w-full min-w-0 gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] text-left transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                          <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-muted)]">
                            {`[${task.workspaceTitle}]`}
                          </span>
                          <StatusBadge tone={statusMeta.tone}>
                            {statusMeta.label}
                          </StatusBadge>
                          {task.isNew ? (
                            <StatusBadge tone="info">NEW</StatusBadge>
                          ) : null}
                          {task.readyToStart ? (
                            <StatusBadge tone="success">시작 가능</StatusBadge>
                          ) : task.dependsOn !== null &&
                            !task.predecessorDone ? (
                            <StatusBadge tone="warning">
                              {`선행 #${task.dependsOn} 대기`}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <strong className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                          {`#${task.issueNumber} ${task.title}`}
                        </strong>
                        {task.assignees.length > 0 ? (
                          <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                            {task.assignees.map((a) => `@${a.login}`).join(", ")}
                          </span>
                        ) : null}
                      </UnstyledButton>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="dashboard-docs-heading"
            className="grid min-w-0 content-start gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
          >
            <div className="flex items-center justify-between gap-[var(--space-2)]">
              <h2
                id="dashboard-docs-heading"
                className="m-0 text-[length:var(--font-h2-size)] font-[number:var(--font-weight-section-title)] text-[var(--color-text-strong)]"
              >
                기획 · 화면명세 변경 알림
              </h2>
              <StatusBadge tone="neutral">
                {`${notifications.length}건`}
              </StatusBadge>
            </div>

            {isLoading && !dashboard ? (
              <p className="m-0 py-[var(--space-4)] text-[var(--color-text-muted)]">
                변경 알림을 불러오는 중…
              </p>
            ) : notifications.length === 0 ? (
              <p className="m-0 py-[var(--space-4)] text-[var(--color-text-muted)]">
                최근 변경된 기획·화면명세가 없습니다.
              </p>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-[var(--space-2)] p-0">
                  {pagedNotifications.map((item) => (
                    <li key={item.id}>
                      <UnstyledButton
                        type="button"
                        onClick={() => void handleOpenNotification(item)}
                        className="grid w-full min-w-0 gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] text-left transition-colors hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                          <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-muted)]">
                            {`[${item.workspaceTitle}]`}
                          </span>
                          <StatusBadge
                            tone={item.kind === "open_pr" ? "warning" : "success"}
                          >
                            {item.kind === "open_pr" ? "검토 대기" : "반영 완료"}
                          </StatusBadge>
                          {item.isNew ? (
                            <StatusBadge tone="info">NEW</StatusBadge>
                          ) : null}
                        </div>
                        <strong className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                          {`#${item.prNumber} ${item.title}`}
                        </strong>
                        {item.summary ? (
                          <span className="line-clamp-2 text-[length:var(--font-meta-size)] text-[var(--color-text-default)]">
                            {item.summary}
                          </span>
                        ) : null}
                        <span className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                          {item.primaryDocPath
                            ? `@${item.authorLogin} · ${item.primaryDocPath}`
                            : `@${item.authorLogin}`}
                        </span>
                      </UnstyledButton>
                    </li>
                  ))}
                </ul>

                {totalPages > 1 ? (
                  <div className="flex items-center justify-between pt-[var(--space-2)]">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={safePage === 0}
                      onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                    >
                      이전
                    </Button>
                    <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)] tabular-nums">
                      {`${safePage + 1} / ${totalPages}`}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={safePage >= totalPages - 1}
                      onClick={() =>
                        setPage((prev) => Math.min(totalPages - 1, prev + 1))
                      }
                    >
                      다음
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
