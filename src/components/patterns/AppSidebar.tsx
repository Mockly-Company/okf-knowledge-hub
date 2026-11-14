import {
  ChevronsUpDown,
  FolderGit2,
  FolderOpen,
  LayoutDashboard,
  PanelLeftClose,
  Plus,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { useOptionalPersonalDashboard } from "@/features/dashboard/PersonalDashboardProvider";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { AiGateway } from "@/features/ai/AiGateway";
import {
  DEFAULT_WORKSPACE_SCOPE,
  getRunningTerminalCounts,
  subscribeRunningTerminalCounts,
} from "@/features/ai/TerminalSessionStore";
import type {
  DocsRepositoryGateway,
  HubWorkspace,
} from "@/features/docs-repository/DocsRepositoryGateway";
import {
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { DocumentTree } from "@/features/documents/components/DocumentTree";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { WorkspaceConnectDialog } from "@/features/workspace-setup/WorkspaceConnectDialog";
import { WorkspaceManageDialog } from "@/features/workspace-setup/WorkspaceManageDialog";
import { cn } from "@/lib/utils";

const workspaceNavigationItems = [
  { to: "/documents", label: "Documents", icon: FolderOpen, end: false },
  { to: "/project", label: "Board", icon: SquareKanban, end: false },
  { to: "/ai", label: "AI", icon: Sparkles, end: false },
] as const;

interface AppSidebarProps {
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
  onCollapse(): void;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
  aiGateway?: AiGateway;
}

const EMPTY_RUNNING_COUNTS: Readonly<Record<string, number>> = Object.freeze({});
const NOOP_UNSUBSCRIBE = () => {};

function describeWorkspaceSubtitle(workspace: HubWorkspace): string {
  if (workspace.project && workspace.docsRepository) {
    return `문서 · ${workspace.docsRepository.fullName}`;
  }
  if (workspace.project && !workspace.docsRepository) {
    return "문서 저장소 연결 필요";
  }
  if (!workspace.project && workspace.docsRepository) {
    return `문서 전용 · ${workspace.docsRepository.fullName}`;
  }
  return "문서 전용";
}

function describeDropdownWorkspaceMeta(workspace: HubWorkspace): string {
  if (workspace.project) {
    const repoLabel = workspace.docsRepository?.fullName ?? "문서 미연결";
    return `${workspace.project.owner} #${workspace.project.number} · 문서 · ${repoLabel}`;
  }
  return `문서 전용 · ${workspace.docsRepository?.fullName ?? "저장소 미연결"}`;
}

export function AppSidebar({
  collapseButtonRef,
  onCollapse,
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
  aiGateway,
}: AppSidebarProps) {
  const location = useLocation();
  const {
    state: documentsState,
    selectDocument,
    showDocumentsHome,
    openNewDocument,
  } = useDocuments();
  const { account } = useWorkspaceConnection();
  const activeProject = useOptionalActiveProject();
  const dashboard = useOptionalPersonalDashboard();
  const isWorkAliasPath =
    location.pathname === "/work" ||
    location.pathname.startsWith("/work/");

  // 실패한 아바타 URL을 기억한다. 계정·URL이 바뀌면 자연히 다시 시도한다.
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  const accountUser =
    account.status === "authenticated" || account.status === "logging_out"
      ? account.user
      : null;
  const avatarFailed =
    accountUser !== null && failedAvatarUrl === accountUser.avatarUrl;
  const accountInitial = accountUser
    ? (Array.from(accountUser.login.trim())[0]?.toLocaleUpperCase() ?? "GH")
    : "GH";

  const currentWorkspace = activeProject?.activeWorkspace ?? null;
  const workspaces = activeProject?.workspaces ?? [];
  const isRootDocumentsAlias = location.pathname === "/" && workspaces.length === 0;
  const isRootDashboardAlias = location.pathname === "/" && workspaces.length > 0;
  const unreadDashboardCount =
    account.status === "authenticated" && dashboard ? dashboard.unreadCount : 0;

  const subscribeCounts = useCallback(
    (listener: () => void) =>
      aiGateway
        ? subscribeRunningTerminalCounts(aiGateway, listener)
        : NOOP_UNSUBSCRIBE,
    [aiGateway],
  );
  const getCounts = useCallback(
    () => (aiGateway ? getRunningTerminalCounts(aiGateway) : EMPTY_RUNNING_COUNTS),
    [aiGateway],
  );
  const runningCounts = useSyncExternalStore(
    subscribeCounts,
    getCounts,
    getCounts,
  );
  const activeScopeKey =
    activeProject?.activeWorkspaceId ??
    currentWorkspace?.id ??
    DEFAULT_WORKSPACE_SCOPE;
  const activeRunningCount = runningCounts[activeScopeKey] ?? 0;
  const backgroundRunningCount = Object.entries(runningCounts).reduce(
    (sum, [scopeKey, count]) =>
      scopeKey === activeScopeKey ? sum : sum + count,
    0,
  );

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <span className="app-sidebar__logo" aria-hidden="true">
          OK
        </span>
        <strong>OkHub</strong>
        <IconButton
          ref={collapseButtonRef}
          label="사이드바 접기"
          className="app-sidebar__collapse"
          onClick={onCollapse}
        >
          <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="app-sidebar__section app-sidebar__section--primary">
        <div className="px-[var(--space-1)] pb-[var(--space-2)]">
          <NavLink
            to="/home"
            end
            className={({ isActive }) =>
              cn(
                "app-sidebar__link",
                (isActive || isRootDashboardAlias) &&
                  "app-sidebar__link--active",
              )
            }
          >
            <LayoutDashboard aria-hidden="true" strokeWidth={1.75} />
            <span className="flex-1">내 대시보드</span>
            {unreadDashboardCount > 0 ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--color-primary-soft)] px-[var(--space-2)] py-0.5 text-[11px] font-[number:var(--font-weight-control)] text-[var(--color-primary-text)] tabular-nums"
                >
                  {unreadDashboardCount > 99 ? "99+" : unreadDashboardCount}
                </span>
                <span className="sr-only">{`, 새 알림 ${unreadDashboardCount}개`}</span>
              </>
            ) : null}
          </NavLink>
        </div>
        {activeProject ? (
          <div
            role="group"
            className="grid gap-[var(--space-2)] px-[var(--space-2)] pb-[var(--space-3)]"
            aria-label="활성 워크스페이스"
          >
            <span className="px-[var(--space-1)] text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-muted)]">
              선택된 Project
            </span>
            {currentWorkspace ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <UnstyledButton
                    type="button"
                    aria-label={`워크스페이스 전환, 현재 ${currentWorkspace.title} (${describeWorkspaceSubtitle(currentWorkspace)})`}
                    disabled={activeProject.isSelecting}
                    className="flex min-h-[var(--control-height)] w-full min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-left hover:border-[var(--color-border-hover)] disabled:opacity-60"
                  >
                    {currentWorkspace.project ? (
                      <SquareKanban
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="size-[var(--icon-size)] shrink-0 text-[var(--color-primary-text)]"
                      />
                    ) : (
                      <FolderGit2
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="size-[var(--icon-size)] shrink-0 text-[var(--color-text-muted)]"
                      />
                    )}
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                        {currentWorkspace.title}
                      </span>
                      <span className="truncate text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
                        {describeWorkspaceSubtitle(currentWorkspace)}
                      </span>
                    </span>
                    <ChevronsUpDown
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-[var(--icon-size)] shrink-0 text-[var(--color-text-muted)]"
                    />
                  </UnstyledButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-64 max-w-[calc(100vw-var(--space-6))]"
                >
                  <DropdownMenuRadioGroup
                    value={currentWorkspace.id}
                    onValueChange={(id) =>
                      void activeProject.selectWorkspace(id).catch(() => undefined)
                    }
                  >
                    {workspaces.map((workspace) => {
                      const workspaceRunningCount =
                        runningCounts[workspace.id] ?? 0;
                      return (
                        <DropdownMenuRadioItem
                          key={workspace.id}
                          value={workspace.id}
                          disabled={activeProject.isSelecting}
                          className="items-start py-[var(--space-2)]"
                        >
                          {workspace.project ? (
                            <SquareKanban
                              aria-hidden="true"
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-[var(--color-primary-text)]"
                            />
                          ) : (
                            <FolderGit2
                              aria-hidden="true"
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                            />
                          )}
                          <span className="grid min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-[var(--space-2)]">
                              <span className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                                {workspace.title}
                              </span>
                              {workspaceRunningCount > 0 ? (
                                <StatusBadge tone="info">
                                  {`AI ${workspaceRunningCount}`}
                                </StatusBadge>
                              ) : null}
                            </span>
                            <span className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                              {describeDropdownWorkspaceMeta(workspace)}
                            </span>
                          </span>
                        </DropdownMenuRadioItem>
                      );
                    })}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConnectDialogOpen(true)}>
                    <Plus aria-hidden="true" strokeWidth={1.75} />
                    <span>새 워크스페이스 추가</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setManageDialogOpen(true)}>
                    <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} />
                    <span>워크스페이스 설정</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : activeProject.isListing ? (
              <div
                role="status"
                className="flex min-h-[var(--control-height)] w-full items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]"
              >
                워크스페이스 불러오는 중…
              </div>
            ) : activeProject.isListError ? null : isRootDocumentsAlias ||
              location.pathname === "/documents" ? (
              <div className="flex min-h-[var(--control-height)] w-full items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                연결된 워크스페이스 없음
              </div>
            ) : (
              <Button
                asChild
                variant="secondary"
                className="w-full justify-start"
              >
                <Link to="/documents">
                  <Plus aria-hidden="true" strokeWidth={1.75} />
                  워크스페이스 시작하기
                </Link>
              </Button>
            )}

            {backgroundRunningCount > 0 ? (
              <p className="m-0 px-[var(--space-1)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                {`다른 워크스페이스 AI 실행 중 ${backgroundRunningCount}개`}
              </p>
            ) : null}

            {activeProject.selectError ? (
              <p
                role="alert"
                className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-error)]"
              >
                {activeProject.selectError}
              </p>
            ) : null}

            <WorkspaceConnectDialog
              open={connectDialogOpen}
              onOpenChange={setConnectDialogOpen}
              docsRepositoryGateway={docsRepositoryGateway}
              repositoryGateway={repositoryGateway}
            />
            <WorkspaceManageDialog
              open={manageDialogOpen}
              onOpenChange={setManageDialogOpen}
              docsRepositoryGateway={docsRepositoryGateway}
              repositoryGateway={repositoryGateway}
            />
          </div>
        ) : null}

        <nav aria-label="주 메뉴" className="app-sidebar__nav">
          {workspaceNavigationItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={to === "/documents" ? showDocumentsHome : undefined}
              className={({ isActive }) =>
                cn(
                  "app-sidebar__link",
                  (isActive ||
                    (to === "/documents" && isRootDocumentsAlias) ||
                    (to === "/project" && isWorkAliasPath)) &&
                    "app-sidebar__link--active",
                )
              }
            >
              <Icon aria-hidden="true" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {to === "/ai" && activeRunningCount > 0 ? (
                <StatusBadge tone="info">{`${activeRunningCount}`}</StatusBadge>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <hr className="app-sidebar__primary-divider" />
        {location.pathname.startsWith("/documents") ? (
          <div className="app-sidebar__documents">
            <DocumentTree
              entries={documentsState.catalog.roots}
              selectedPath={documentsState.selectedPath}
              onSelectDocument={selectDocument}
              onNewDocument={openNewDocument}
            />
          </div>
        ) : null}
      </div>

      <div className="border-t border-[var(--color-border)] px-[var(--space-2)] py-[var(--space-2)]">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn("app-sidebar__link", isActive && "app-sidebar__link--active")
          }
        >
          <Settings aria-hidden="true" strokeWidth={1.75} />
          <span>Settings</span>
        </NavLink>
      </div>

      <div className="app-sidebar__user">
        {account.status === "loading" ? (
          <>
            <span
              className="app-sidebar__avatar app-sidebar__skeleton"
              aria-hidden="true"
            />
            <span
              className="app-sidebar__user-copy app-sidebar__user-copy--loading"
              aria-label="GitHub 계정 불러오는 중"
            >
              <span className="app-sidebar__skeleton" />
              <span className="app-sidebar__skeleton" />
            </span>
          </>
        ) : (
          <>
            <span className="app-sidebar__avatar" aria-hidden="true">
              {accountUser && !avatarFailed ? (
                <img
                  src={accountUser.avatarUrl}
                  alt=""
                  onError={() => setFailedAvatarUrl(accountUser.avatarUrl)}
                />
              ) : (
                accountInitial
              )}
            </span>
            <span className="app-sidebar__user-copy">
              <strong>
                {accountUser
                  ? `@${accountUser.login}`
                  : account.status === "login_beginning" ||
                      account.status === "waiting_for_user"
                    ? "GitHub 연결 중"
                    : "GitHub 재로그인 필요"}
              </strong>
              <small>{accountUser ? "GitHub 계정" : "Settings에서 연결"}</small>
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
