import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalConnectionState, RecoveryAction } from "../types";
import { ConnectionError } from "./ConnectionError";

interface LocalConnectionStepProps {
  state: LocalConnectionState;
  onConnectExisting(): void;
  onClone(): void;
  onPreviewInitialization(): void;
  onRecover(action: RecoveryAction): void;
}

export function LocalConnectionStep({ state, onConnectExisting, onClone, onPreviewInitialization, onRecover }: LocalConnectionStepProps) {
  const isBusy = ["inspecting", "clone_starting", "cloning", "clone_cancelling", "workspace_inspecting", "workspace_connecting", "preview_loading"].includes(state.status);
  const hasInitialization = state.workspaceInspection?.status === "initialization_required";
  const localPath = state.localRepository?.root ?? (state.status === "error" && state.errorContext === "pre_repository" ? state.failedOperation === "local_inspection" ? state.failedLocalInspectionRequest.path : `${state.failedCloneStartRequest.parentDirectory}/${state.selectedRepository.name}` : null);
  return (
    <section className="workspace-connection__step" aria-labelledby="local-connection-title">
      <p className="workspace-connection__eyebrow">3 / 3</p>
      <h1 id="local-connection-title">로컬 연결</h1>
      <p>{state.selectedRepository.fullName}을 이 기기의 폴더에 연결합니다.</p>
      {state.status === "validation_failed" ? (
        <section className="connection-error" aria-label="워크스페이스 검증 오류">
          <h2>워크스페이스 설정을 확인하세요</h2>
          {state.workspaceInspection.status === "invalid" ? state.workspaceInspection.diagnostics.map((diagnostic) => <p key={`${diagnostic.path}-${diagnostic.code}`}><code>{diagnostic.path}</code> {diagnostic.message}</p>) : <p>지원하지 않는 워크스페이스 버전입니다.</p>}
        </section>
      ) : null}
      {state.status === "error" ? <ConnectionError error={state.error} localPath={localPath} onRecover={onRecover} /> : null}
      {hasInitialization ? <Button onClick={onPreviewInitialization}>초기화 내용 확인</Button> : null}
      {!hasInitialization && state.status !== "validation_failed" && state.status !== "error" ? (
        <div className="workspace-connection__local-options">
          <Button autoFocus disabled={isBusy} onClick={onConnectExisting}>
            {isBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} /> : <FolderOpen aria-hidden="true" strokeWidth={1.75} />} 기존 clone 연결
          </Button>
          <Button variant="secondary" disabled={isBusy} onClick={onClone}>새 위치에 clone</Button>
        </div>
      ) : null}
      {state.status === "cloning" || state.status === "clone_cancelling" ? <p role="status" aria-live="polite">clone 중{state.cloneProgress ? ` ${state.cloneProgress.completed}/${state.cloneProgress.total}` : ""}</p> : null}
      {state.status === "cloning" || state.status === "clone_cancelling" ? <p>클론 위치: <code>{state.cloneJob.targetPath}</code></p> : null}
    </section>
  );
}
