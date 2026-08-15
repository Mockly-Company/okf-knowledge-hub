import {
  FolderOpen,
  House,
  PanelLeftClose,
  Settings,
  SquareKanban,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DocumentTree } from "@/features/documents/components/DocumentTree";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { cn } from "@/lib/utils";

const navigationItems = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/documents", label: "Documents", icon: FolderOpen, end: false },
  { to: "/project", label: "Project", icon: SquareKanban, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

interface AppSidebarProps {
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
  onCollapse(): void;
}

export function AppSidebar({ collapseButtonRef, onCollapse }: AppSidebarProps) {
  const location = useLocation();
  const {
    state: documentsState,
    selectDocument,
    showDocumentsHome,
  } = useDocuments();
  const { state, account, isCurrentWorkspaceLoading } = useWorkspaceConnection();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const connectedWorkspace =
    state.status === "connected" ? state.connectedWorkspace : null;
  const accountUser =
    account.status === "authenticated" || account.status === "logging_out"
      ? account.user
      : null;
  const accountInitial = accountUser
    ? (Array.from(accountUser.login.trim())[0]?.toLocaleUpperCase() ?? "GH")
    : "GH";

  useEffect(() => {
    setAvatarFailed(false);
  }, [accountUser?.id, accountUser?.avatarUrl]);

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <span className="app-sidebar__logo" aria-hidden="true">
          OK
        </span>
        <strong>OkHub</strong>
        <Tooltip content="사이드바 접기">
          <Button
            ref={collapseButtonRef}
            variant="icon"
            className="app-sidebar__collapse"
            aria-label="사이드바 접기"
            onClick={onCollapse}
          >
            <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </div>
      {isCurrentWorkspaceLoading ? (
        <div
          className="app-sidebar__workspace app-sidebar__skeleton"
          aria-label="워크스페이스 불러오는 중"
        />
      ) : (
        <div
          className="app-sidebar__workspace"
          title={connectedWorkspace?.summary.name}
        >
          {connectedWorkspace?.summary.name ?? "워크스페이스 연결 필요"}
        </div>
      )}
      <div className="app-sidebar__section app-sidebar__section--primary">
        <nav aria-label="주 메뉴" className="app-sidebar__nav">
          {navigationItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={to === "/documents" ? showDocumentsHome : undefined}
              className={({ isActive }) =>
                cn(
                  "app-sidebar__link",
                  isActive && "app-sidebar__link--active",
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
            />
          </div>
        ) : null}
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
                  onError={() => setAvatarFailed(true)}
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
