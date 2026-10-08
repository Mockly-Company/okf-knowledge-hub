import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";

export function WorkspaceGate() {
  const { state, isCurrentWorkspaceLoading } = useWorkspaceConnection();
  const location = useLocation();
  const wasConnected = useRef(false);
  const previousState = useRef(state);
  const connected = state.step === "initialize" && state.status === "connected";
  // Cancelling replacement resumes the page the user was already viewing.
  const cancelledReplacement = previousState.current.mode === "replacement"
    && previousState.current.status !== "workspace_connecting"
    && previousState.current.status !== "connecting";
  const enterHome = connected && !wasConnected.current && !cancelledReplacement;
  useEffect(() => {
    if (!isCurrentWorkspaceLoading) {
      wasConnected.current = connected;
      previousState.current = state;
    }
  }, [connected, isCurrentWorkspaceLoading, state]);

  if (isCurrentWorkspaceLoading) {
    return <main className="workspace-gate__loading" role="status" aria-label="워크스페이스 확인 중">워크스페이스 확인 중</main>;
  }
  if (!connected) return <WorkspaceConnectionPage />;
  if (enterHome && location.pathname !== "/") return <Navigate to="/" replace />;
  return <Outlet />;
}
