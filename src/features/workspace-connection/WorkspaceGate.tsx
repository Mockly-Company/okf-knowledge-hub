import { Outlet } from "react-router-dom";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";

export function WorkspaceGate() {
  const { state, isCurrentWorkspaceLoading } = useWorkspaceConnection();
  if (isCurrentWorkspaceLoading) {
    return <main className="workspace-gate__loading" role="status" aria-label="워크스페이스 확인 중">워크스페이스 확인 중</main>;
  }
  return state.step === "initialize" && state.status === "connected" ? <Outlet /> : <WorkspaceConnectionPage />;
}
