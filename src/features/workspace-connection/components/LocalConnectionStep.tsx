import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { FormField } from "@/components/patterns/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { StatusFeedback } from "@/components/ui/status-feedback";
import type { CloneTargetPreview } from "../WorkspaceConnectionProvider";
import type { LocalConnectionState, RecoveryAction } from "../types";
import { cloneTargetPath } from "../types";
import { ConnectionError } from "./ConnectionError";

interface LocalConnectionStepProps {
  state: LocalConnectionState;
  cloneTargetPreview: CloneTargetPreview | null;
  onPickDirectory(): Promise<string | null>;
  onConnectExisting(path: string): void;
  onClone(parentDirectory: string): void;
  onConfirmClone(): void;
  onCancelClone(): void;
  onPreviewInitialization(): void;
  onRecover(action: RecoveryAction): void;
}

type Method = "existing" | "download";
const methods = [
  { value: "existing", title: "이 기기의 저장소 연결", description: "이미 다운로드한 저장소 폴더를 연결합니다." },
  { value: "download", title: "새로 다운로드해서 연결", description: "GitHub 저장소를 새 폴더에 다운로드합니다." },
] as const;

export function LocalConnectionStep({ state, cloneTargetPreview, onPickDirectory, onConnectExisting, onClone, onConfirmClone, onCancelClone, onPreviewInitialization, onRecover }: LocalConnectionStepProps) {
  const failedClone = state.status === "error" && state.errorContext === "pre_repository" && state.failedOperation === "clone";
  const [method, setMethod] = useState<Method>(failedClone ? "download" : "existing");
  const [paths, setPaths] = useState<Record<Method, string>>({ existing: "", download: "" });
  const [picking, setPicking] = useState(false);
  const selectionRef = useRef(0);
  const isBusy = picking || ["inspecting", "clone_starting", "cloning", "clone_cancelling", "workspace_inspecting", "workspace_connecting", "preview_loading"].includes(state.status);
  const downloading = ["clone_starting", "cloning", "clone_cancelling"].includes(state.status);
  const actionLabel = state.status === "clone_cancelling" ? "다운로드 취소 중…" : downloading ? "다운로드 중…" : isBusy && !picking ? "연결 중…" : method === "existing" ? "연결" : "다운로드해서 연결";
  const hasInitialization = state.workspaceInspection?.status === "initialization_required";
  const failedPath = state.status === "error" && state.errorContext === "pre_repository"
    ? state.failedOperation === "local_inspection" ? state.failedLocalInspectionRequest.path : state.failedCloneStartRequest.parentDirectory
    : "";
  const errorMethod = state.status === "error" && state.errorContext !== "pre_repository" ? method : failedClone ? "download" : "existing";
  const path = paths[method] || (method === errorMethod ? failedPath : "") || (method === "existing" ? state.localRepository?.root : cloneTargetPreview?.parentDirectory) || "";
  const error = state.status === "error" && !cloneTargetPreview && method === errorMethod && (!failedPath || path === failedPath) ? state.error : null;
  const pathError = error?.code === "repository_path_conflict" ? error : null;
  const showForm = !hasInitialization && state.status !== "validation_failed";
  const chooseDirectory = async () => {
    const selection = ++selectionRef.current;
    setPicking(true);
    try {
      const selected = await onPickDirectory();
      if (selected && selection === selectionRef.current) {
        setPaths((current) => ({ ...current, [method]: selected }));
        if (method === "download") onClone(selected);
        else if (cloneTargetPreview) onCancelClone();
      }
    } finally { setPicking(false); }
  };
  return (
    <section className="workspace-connection__step grid gap-[var(--space-4)]" aria-labelledby="local-connection-title">
      <p className="workspace-connection__eyebrow m-0">3 / 3</p>
      <PageHeader titleId="local-connection-title" title="로컬 연결" description={`${state.selectedRepository.fullName}을 이 기기의 폴더에 연결합니다.`} />
      {showForm ? <form aria-label="로컬 연결" className="grid gap-[var(--space-6)]" onSubmit={(event) => {
        event.preventDefault();
        if (isBusy || !path) return;
        if (method === "existing") onConnectExisting(path);
        else if (cloneTargetPreview) onConfirmClone();
      }}>
        <fieldset disabled={isBusy} className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-[var(--space-3)] font-[number:var(--font-weight-control)]">연결 방법</legend>
          <div className="grid grid-cols-1 gap-[var(--space-3)] min-[720px]:grid-cols-2">
            {methods.map((option) => <label key={option.value} className={`flex cursor-pointer items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border p-[var(--space-4)] transition-colors ${method === option.value ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-hover)]"}`}>
              <Radio name="local-connection-method" value={option.value} checked={method === option.value} aria-labelledby={`connection-${option.value}-label`} aria-describedby={`connection-${option.value}-description`} autoFocus={option.value === "existing"} className="mt-1 shrink-0" onChange={() => { selectionRef.current++; setMethod(option.value); if (option.value === "download" && paths.download) onClone(paths.download); else onCancelClone(); }} />
              <span className="grid gap-[var(--space-1)]"><span id={`connection-${option.value}-label`} className="font-[number:var(--font-weight-control)]">{option.title}</span><span id={`connection-${option.value}-description`} className={`text-[length:var(--font-ui-size)] font-[number:var(--font-weight-description)] ${method === option.value ? "text-[var(--color-text-default)]" : "text-[var(--color-text-muted)]"}`}>{option.description}</span></span>
            </label>)}
          </div>
        </fieldset>
        <FormField label={method === "existing" ? "저장소 폴더" : "다운로드 위치"} error={pathError?.message} controlAction={<Button type="button" variant="secondary" disabled={isBusy} loading={picking} onClick={() => void chooseDirectory()} className="shrink-0"><FolderOpen aria-hidden="true" strokeWidth={1.75} />{path ? "변경" : "폴더 선택"}</Button>}>
          <Input value={path} readOnly placeholder="폴더를 선택하세요" aria-describedby={!pathError && method === "download" ? "local-path-hint" : undefined} />
        </FormField>
        {!pathError && method === "download" ? <div id="local-path-hint" className="grid gap-[var(--space-1)] text-[length:var(--font-ui-size)] text-[var(--color-text-muted)]"><p className="m-0">{path ? "다음 위치에 새 폴더를 만들고 저장소를 다운로드합니다." : "다운로드할 상위 폴더를 선택하세요."}</p>{path ? <code className="break-all text-[var(--color-text-default)]">{cloneTargetPreview?.targetPath ?? cloneTargetPath(path, state.selectedRepository.name)}</code> : null}</div> : null}
        {error && !pathError ? <ConnectionError error={error} onRecover={onRecover} /> : null}
        <div className="flex justify-end pt-[var(--space-4)]"><Button type="submit" disabled={isBusy || !path || (method === "download" && !cloneTargetPreview)} loading={isBusy && !picking}>{actionLabel}</Button></div>
      </form> : null}
      {state.status === "validation_failed" ? <StatusFeedback variant="content" tone="error"><div aria-label="워크스페이스 검증 오류"><h2>워크스페이스 설정을 확인하세요</h2>{state.workspaceInspection.status === "invalid" ? state.workspaceInspection.diagnostics.map((diagnostic) => <p key={`${diagnostic.path}-${diagnostic.code}`}><code>{diagnostic.path}</code> {diagnostic.message}</p>) : <p>지원하지 않는 워크스페이스 버전입니다.</p>}</div></StatusFeedback> : null}
      {hasInitialization ? <Button onClick={onPreviewInitialization}>초기화 내용 확인</Button> : null}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{downloading ? `${state.status === "clone_cancelling" ? "다운로드 취소 중" : "다운로드 중"}${state.cloneProgress ? ` ${state.cloneProgress.completed}/${state.cloneProgress.total}` : ""}` : ""}</p>
    </section>
  );
}
