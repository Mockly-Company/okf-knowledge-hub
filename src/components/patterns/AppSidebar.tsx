import {
  FolderOpen,
  House,
  PanelLeftClose,
  Settings,
  SquareKanban,
} from "lucide-react";
import type { RefObject } from "react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navigation = [
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
      <div className="app-sidebar__workspace">연결된 워크스페이스 없음</div>
      <nav aria-label="주 메뉴" className="app-sidebar__nav">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn("app-sidebar__link", isActive && "app-sidebar__link--active")
            }
          >
            <Icon aria-hidden="true" strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="app-sidebar__user">
        <span className="app-sidebar__avatar" aria-hidden="true">
          GH
        </span>
        <span>
          <strong>로그인 필요</strong>
          <small>GitHub 계정</small>
        </span>
      </div>
    </aside>
  );
}
