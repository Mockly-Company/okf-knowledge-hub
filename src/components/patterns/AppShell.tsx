import { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { AppSidebar } from "./AppSidebar";

export function AppShell() {
  const { account } = useWorkspaceConnection();
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const shouldMoveFocus = useRef(false);

  const updateSidebar = (isOpen: boolean) => {
    shouldMoveFocus.current = true;
    setSidebarOpen(isOpen);
  };

  useEffect(() => {
    if (!shouldMoveFocus.current) return;
    const target = isSidebarOpen ? collapseButtonRef.current : openButtonRef.current;
    target?.focus();
    shouldMoveFocus.current = false;
  }, [isSidebarOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        shouldMoveFocus.current = true;
        setSidebarOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      {isSidebarOpen ? (
        <AppSidebar
          collapseButtonRef={collapseButtonRef}
          onCollapse={() => updateSidebar(false)}
        />
      ) : (
        <div className="app-shell__open-sidebar">
          <Tooltip content="사이드바 열기">
            <Button
              ref={openButtonRef}
              variant="icon"
              aria-label="사이드바 열기"
              onClick={() => updateSidebar(true)}
            >
              <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>
      )}
      <main
        aria-label="OkHub"
        className={`app-shell__main overflow-y-auto bg-[var(--color-surface)]${
          isSidebarOpen ? "" : " app-shell__main--sidebar-collapsed"
        }`}
      >
        {account.status === "reauthentication_required" ? (
          <StatusFeedback
            variant="banner"
            tone="warning"
            actionPlacement="end"
            className="app-shell__reauthentication-banner"
            action={
              <Button asChild variant="secondary">
                <Link to="/settings">Settings에서 다시 연결</Link>
              </Button>
            }
          >
            <strong>GitHub 재로그인 필요</strong>
            <p>GitHub 인증이 만료되었습니다. 다시 로그인해 주세요.</p>
          </StatusFeedback>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
