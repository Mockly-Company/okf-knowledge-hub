import { Outlet } from "react-router-dom";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";

export function WorkspaceGate() {
  const { state, isCurrentWorkspaceLoading } = useWorkspaceConnection();
  if (isCurrentWorkspaceLoading) {
    return <main className="workspace-gate__loading" role="status" aria-label="워크스페이스 확인 중">워크스페이스 확인 중</main>;
  }
  // 첫 진입 강제 연결 플로우를 제거한다. 저장된 워크스페이스가 없을 때의
  // 초기 idle(auth+idle+initial mode)은 앱 셸을 그대로 보여주고,
  // Documents 미연결 안내는 "저장소 연결하기"에서 처리한다.
  // 연결 화면은 진행 중인 플로우(로그인 진행·에러, 저장소·로컬·초기화 단계,
  // replacement mode 전체)일 때만 보여준다.
  const isConnected = state.step === "initialize" && state.status === "connected";
  const isInitialIdle =
    state.mode === "initial" && state.step === "auth" && state.status === "idle";
  return isConnected || isInitialIdle ? <Outlet /> : <WorkspaceConnectionPage />;
}
