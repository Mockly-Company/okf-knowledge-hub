import { GitPullRequestDraft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InitializationPreview as InitializationPreviewModel } from "../types";

interface InitializationPreviewProps {
  preview: InitializationPreviewModel;
  isInitializing: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function InitializationPreview({ preview, isInitializing, onCancel, onConfirm }: InitializationPreviewProps) {
  const isDraft = preview.strategy.kind === "draft_pull_request";
  return (
    <section className="workspace-connection__step" aria-labelledby="initialization-title">
      <p className="workspace-connection__eyebrow">3 / 3</p>
      <h1 id="initialization-title">로컬 연결</h1>
      <h2>워크스페이스 초기화</h2>
      <p>대상 브랜치: <code>{preview.branch}</code></p>
      <p>{isDraft ? <><GitPullRequestDraft aria-hidden="true" strokeWidth={1.75} /> 기본 브랜치에 바로 반영하지 않고 Draft PR로 제안합니다.</> : <><Upload aria-hidden="true" strokeWidth={1.75} /> 현재 브랜치에 직접 push합니다.</>}</p>
      <div className="workspace-connection__preview-files">
        {preview.files.map((file) => <article key={file.path}><h3>{file.path}{file.overwritesExisting ? " (덮어씀)" : ""}</h3><pre>{file.content}</pre></article>)}
      </div>
      <div className="workspace-connection__actions">
        <Button variant="secondary" disabled={isInitializing} onClick={onCancel}>취소</Button>
        <Button disabled={isInitializing} onClick={onConfirm}>워크스페이스 초기화</Button>
      </div>
    </section>
  );
}
