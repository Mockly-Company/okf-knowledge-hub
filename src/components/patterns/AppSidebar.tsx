import {
  ChevronsUpDown,
  FolderGit2,
  FolderOpen,
  PanelLeftClose,
  Plus,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import { useState, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
}

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
    return `${workspace.project.owner} #${workspace.project.number} · ${repoLabel}`;
  }
  return `문서 전용 · ${workspace.docsRepository?.fullName ?? "저장소 미연결"}`;
}

export function AppSidebar({
  collapseButtonRef,
  onCollapse,
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
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
  const isWorkAliasPath =
    location.pathname === "/work" ||
    location.pathname.startsWith("/work/");
  const isRootDocumentsAlias = location.pathname === "/";

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
        {activeProject ? (
          <div
            role="group"
            className="grid gap-[var(--space-2)] px-[var(--space-2)] pb-[var(--space-3)]"
            aria-label="활성 워크스페이스"
          >
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
                    {workspaces.map((workspace) => (
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
                          <span className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                            {workspace.title}
                          </span>
                          <span className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                            {describeDropdownWorkspaceMeta(workspace)}
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConnectDialogOpen(true)}>
                    <Plus aria-hidden="true" strokeWidth={1.75} />
                    <span>새 워크스페이스 연결</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setManageDialogOpen(true)}>
                    <SlidersHorizontal aria-hidden="true" strokeWidth={1.75} />
                    <span>워크스페이스 설정</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConnectDialogOpen(true)}
                disabled={activeProject.isListing}
                className="w-full justify-start"
              >
                <Plus aria-hidden="true" strokeWidth={1.75} />
                {activeProject.isListing
                  ? "워크스페이스 불러오는 중"
                  : "워크스페이스 연결"}
              </Button>
            )}

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
              <span>{label}</span>
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
