import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";

export function AppShell() {
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
        className={`app-shell__main${
          isSidebarOpen ? "" : " app-shell__main--sidebar-collapsed"
        }`}
      >
        <Outlet />
      </main>
    </div>
  );
}
