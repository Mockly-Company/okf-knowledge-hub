import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";
import { ConnectionError } from "./components/ConnectionError";
import { GitHubLoginStep } from "./components/GitHubLoginStep";
import { InitializationPreview } from "./components/InitializationPreview";
import { LocalConnectionStep } from "./components/LocalConnectionStep";
import { RepositorySelectionStep } from "./components/RepositorySelectionStep";
import type { ConnectionState, RecoveryAction } from "./types";

const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";
const OKHUB_RELEASES_URL = "https://github.com/Mockly-Company/okf-knowledge-hub/releases";

function localRepositoryRoot(state: ConnectionState): string | null {
  if (state.step === "local") {
    if (state.localRepository) return state.localRepository.root;
    if (state.status === "error" && state.errorContext === "pre_repository") {
      return state.failedOperation === "local_inspection"
        ? state.failedLocalInspectionRequest.path
        : state.failedCloneStartRequest.targetPath;
    }
  }
  if (state.step === "initialize" && state.status !== "connected") {
    return state.localRepository.root;
  }
  return state.recoveryWorkspace?.path ?? null;
}

function workspaceFilePath(state: ConnectionState): string | null {
  const root = localRepositoryRoot(state);
  if (!root) return null;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const trimmed = root.replace(/[\\/]$/, "");
  return `${trimmed}${separator}.okf${separator}workspace.yml`;
}

export function WorkspaceConnectionPage() {
  const connection = useWorkspaceConnection();
  const { state } = connection;
  const [showCleanupGuidance, setShowCleanupGuidance] = useState(false);
  useEffect(() => {
    if (state.error?.recovery !== "clean_working_tree") {
      setShowCleanupGuidance(false);
    }
  }, [state.error]);
  const recover = (action: RecoveryAction) => {
    if (action === "restart_login") {
      void connection.startLogin();
    } else if (action === "reinstall_github_app") {
      void connection.openVerificationUrl(GITHUB_INSTALLATIONS_URL);
    } else if (action === "choose_another_directory") {
      void connection.chooseAnotherCloneDirectory();
    } else if (action === "connect_existing_clone") {
      void connection.connectExistingClone();
    } else if (action === "clean_working_tree") {
      setShowCleanupGuidance(true);
    } else if (action === "open_workspace_file") {
      const path = workspaceFilePath(state);
      if (path) void connection.openLocalPath(path);
    } else if (action === "update_okhub") {
      void connection.openVerificationUrl(OKHUB_RELEASES_URL);
    } else {
      void connection.retryLastAction();
    }
  };
  return (
    <main className="workspace-connection" aria-live="polite">
      <div className="workspace-connection__card">
        {state.mode === "replacement" ? (
          <div className="workspace-connection__actions">
            <Button
              variant="ghost"
              disabled={!connection.canCancelReplacement}
              onClick={() => void connection.cancelReplacement()}
            >
              {connection.canCancelReplacement
                ? "연결 취소"
                : "작업 완료 후 취소 가능"}
            </Button>
          </div>
        ) : null}
        {state.step === "auth" ? <GitHubLoginStep state={state} onStart={() => void connection.startLogin()} onCancel={() => void connection.cancelLogin()} onOpen={(url) => void connection.openVerificationUrl(url)} onRecover={recover} /> : null}
        {state.step === "repository" ? <RepositorySelectionStep state={state} onSelect={connection.selectRepository} onRefresh={() => void connection.refreshRepositories()} onLoadNext={() => void connection.loadNextRepositories()} onRecover={recover} /> : null}
        {state.step === "local" ? <LocalConnectionStep state={state} cloneTargetPreview={connection.cloneTargetPreview} onConnectExisting={() => void connection.connectExistingClone()} onClone={() => void connection.cloneIntoSelectedParent()} onConfirmClone={() => void connection.confirmCloneTarget()} onCancelClone={connection.cancelCloneTarget} onPreviewInitialization={() => void connection.previewInitialization()} onRecover={recover} /> : null}
        {state.step === "initialize" && state.status !== "connected" ? (
          state.status === "preview" || state.status === "initializing" ? <InitializationPreview preview={state.initializationPreview} isInitializing={state.status === "initializing"} onCancel={connection.cancelInitializationPreview} onConfirm={() => void connection.confirmInitialization()} /> : state.status === "error" ? <section className="workspace-connection__step"><h1>로컬 연결</h1><ConnectionError error={state.error} localPath={state.localRepository.root} onRecover={recover} /></section> : <section className="workspace-connection__step" role="status"><h1>로컬 연결</h1><p>워크스페이스를 연결하는 중입니다.</p></section>
        ) : null}
        {state.step === "initialize" && state.status === "connected" ? <section className="workspace-connection__step" role="status"><h1>워크스페이스가 연결되었습니다.</h1><p>{state.connectedWorkspace.summary.name}</p></section> : null}
        {showCleanupGuidance ? (
          <section className="workspace-connection__cleanup-guidance" aria-labelledby="cleanup-guidance-title">
            <h2 id="cleanup-guidance-title">working tree를 직접 정리해 주세요</h2>
            <p>변경 내용을 커밋하거나 필요한 위치에 보관한 뒤 다시 확인하세요. OkHub는 변경 파일을 자동으로 삭제하거나 stash하지 않습니다.</p>
            {localRepositoryRoot(state) ? <code>{localRepositoryRoot(state)}</code> : null}
            <div className="workspace-connection__actions">
              <Button variant="secondary" onClick={() => setShowCleanupGuidance(false)}>닫기</Button>
              <Button onClick={() => { setShowCleanupGuidance(false); void connection.retryLastAction(); }}>정리 상태 다시 확인</Button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
