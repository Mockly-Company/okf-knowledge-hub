import { useWorkspaceConnection } from "./WorkspaceConnectionProvider";
import { ConnectionError } from "./components/ConnectionError";
import { GitHubLoginStep } from "./components/GitHubLoginStep";
import { InitializationPreview } from "./components/InitializationPreview";
import { LocalConnectionStep } from "./components/LocalConnectionStep";
import { RepositorySelectionStep } from "./components/RepositorySelectionStep";
import type { RecoveryAction } from "./types";

export function WorkspaceConnectionPage() {
  const connection = useWorkspaceConnection();
  const { state } = connection;
  const recover = (action: RecoveryAction) => {
    if (action === "restart_login") {
      void connection.startLogin();
    } else if (action === "choose_another_directory") {
      void connection.chooseAnotherCloneDirectory();
    } else if (action === "connect_existing_clone") {
      void connection.connectExistingClone();
    } else {
      void connection.retryLastAction();
    }
  };
  return (
    <main className="workspace-connection" aria-live="polite">
      <div className="workspace-connection__card">
        {state.step === "auth" ? <GitHubLoginStep state={state} onStart={() => void connection.startLogin()} onCancel={() => void connection.cancelLogin()} onOpen={(url) => void connection.openVerificationUrl(url)} onRecover={recover} /> : null}
        {state.step === "repository" ? <RepositorySelectionStep state={state} onSelect={connection.selectRepository} onRefresh={() => void connection.refreshRepositories()} onLoadNext={() => void connection.loadNextRepositories()} onRecover={recover} /> : null}
        {state.step === "local" ? <LocalConnectionStep state={state} cloneTargetPreview={connection.cloneTargetPreview} onConnectExisting={() => void connection.connectExistingClone()} onClone={() => void connection.cloneIntoSelectedParent()} onConfirmClone={() => void connection.confirmCloneTarget()} onCancelClone={connection.cancelCloneTarget} onPreviewInitialization={() => void connection.previewInitialization()} onRecover={recover} /> : null}
        {state.step === "initialize" && state.status !== "connected" ? (
          state.status === "preview" || state.status === "initializing" ? <InitializationPreview preview={state.initializationPreview} isInitializing={state.status === "initializing"} onCancel={connection.cancelInitializationPreview} onConfirm={() => void connection.confirmInitialization()} /> : state.status === "error" ? <section className="workspace-connection__step"><h1>로컬 연결</h1><ConnectionError error={state.error} localPath={state.localRepository.root} onRecover={recover} /></section> : <section className="workspace-connection__step" role="status"><h1>로컬 연결</h1><p>워크스페이스를 연결하는 중입니다.</p></section>
        ) : null}
        {state.step === "initialize" && state.status === "connected" ? <section className="workspace-connection__step" role="status"><h1>워크스페이스가 연결되었습니다.</h1><p>{state.connectedWorkspace.summary.name}</p></section> : null}
      </div>
    </main>
  );
}
