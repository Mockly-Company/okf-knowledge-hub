import { Outlet } from "react-router-dom";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";

/** 계정 상태를 처음 읽는 동안만 기다린다. 로그인은 설정에서, 문서 저장소는 Documents에서 고른다. */
export function WorkspaceGate() {
  const { isCurrentWorkspaceLoading } = useWorkspaceConnection();
  if (isCurrentWorkspaceLoading) {
    return (
      <main className="workspace-gate__loading">
        <p role="status" aria-label="앱을 준비하는 중" className="m-0">
          앱을 준비하는 중
        </p>
      </main>
    );
  }
  return <Outlet />;
}
