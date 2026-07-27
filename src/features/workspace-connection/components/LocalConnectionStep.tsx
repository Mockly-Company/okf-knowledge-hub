import { useEffect, useRef } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CloneTargetPreview } from "../WorkspaceConnectionProvider";
import type { LocalConnectionState, RecoveryAction } from "../types";
import { ConnectionError } from "./ConnectionError";

interface LocalConnectionStepProps {
  state: LocalConnectionState;
  cloneTargetPreview: CloneTargetPreview | null;
  onConnectExisting(): void;
  onClone(): void;
  onConfirmClone(): void;
  onCancelClone(): void;
  onPreviewInitialization(): void;
  onRecover(action: RecoveryAction): void;
}

export function LocalConnectionStep({ state, cloneTargetPreview, onConnectExisting, onClone, onConfirmClone, onCancelClone, onPreviewInitialization, onRecover }: LocalConnectionStepProps) {
  const isBusy = ["inspecting", "clone_starting", "cloning", "clone_cancelling", "workspace_inspecting", "workspace_connecting", "preview_loading"].includes(state.status);
  const cloneStatusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "cloning" || state.status === "clone_cancelling") {
      cloneStatusRef.current?.focus();
    }
  }, [state.status]);
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
      {state.status === "error" && !cloneTargetPreview ? <ConnectionError error={state.error} localPath={localPath} onRecover={onRecover} /> : null}
      {hasInitialization ? <Button onClick={onPreviewInitialization}>초기화 내용 확인</Button> : null}
      {cloneTargetPreview ? (
        <section className="workspace-connection__clone-confirmation" aria-labelledby="clone-target-title">
          <h2 id="clone-target-title">clone 위치 확인</h2>
          <p>다음 위치에 새 폴더를 만들고 저장소를 clone합니다.</p>
          <code>{cloneTargetPreview.targetPath}</code>
          <div className="workspace-connection__actions">
            <Button variant="secondary" onClick={onCancelClone}>취소</Button>
            <Button autoFocus onClick={onConfirmClone}>이 위치에 clone</Button>
          </div>
        </section>
      ) : null}
      {!cloneTargetPreview && !hasInitialization && state.status !== "validation_failed" && state.status !== "error" ? (
        <div className="workspace-connection__local-options">
          <Button autoFocus disabled={isBusy} onClick={onConnectExisting}>
            {isBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} /> : <FolderOpen aria-hidden="true" strokeWidth={1.75} />} 기존 clone 연결
          </Button>
          <Button variant="secondary" disabled={isBusy} onClick={onClone}>새 위치에 clone</Button>
        </div>
      ) : null}
      {state.status === "cloning" || state.status === "clone_cancelling" ? <p ref={cloneStatusRef} role="status" aria-live="polite" tabIndex={-1}>clone 중{state.cloneProgress ? ` ${state.cloneProgress.completed}/${state.cloneProgress.total}` : ""}</p> : null}
      {(state.status === "cloning" || state.status === "clone_cancelling") && state.cloneJob ? <p>클론 위치: <code>{state.cloneJob.targetPath}</code></p> : null}
    </section>
  );
}
