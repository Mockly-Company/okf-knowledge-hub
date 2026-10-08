import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button, IconButton } from "@/components/ui/button";
import { Radio } from "@/components/ui/radio";
import type { GithubRepositorySummary, RecoveryAction, RepositoryConnectionState } from "../types";
import { ConnectionError } from "./ConnectionError";

interface RepositorySelectionStepProps {
  state: RepositoryConnectionState;
  onCreateRepository?(): void;
  onSelect(repository: GithubRepositorySummary): void;
  onRefresh(): void;
  onLoadNext(): void;
  onRecover(action: RecoveryAction): void;
}

export function RepositorySelectionStep({ state, onCreateRepository, onSelect, onRefresh, onLoadNext, onRecover }: RepositorySelectionStepProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = state.repositories.find((repository) => repository.id === selectedId) ?? null;
  const loading = state.status === "loading";
  return (
    <section className="workspace-connection__step grid gap-[var(--space-4)]" aria-labelledby="repository-selection-title">
      <p className="workspace-connection__eyebrow m-0">2 / 3</p>
      <PageHeader
        titleId="repository-selection-title"
        title="OKF 저장소 선택"
        description="연결할 기존 OKF 지식 저장소를 선택하세요."
      />
      {state.status === "error" ? <ConnectionError error={state.error} onRecover={onRecover} /> : null}
      <div className="mt-[var(--space-5)] grid gap-[var(--space-2)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
        <p className="m-0 text-[length:var(--icon-size)]">{loading ? "저장소 조회 중" : <strong className="font-[number:var(--font-weight-description)] text-[var(--color-text-default)]">조회된 저장소</strong>}</p>
        <IconButton label="새로고침" tooltip={false} onClick={onRefresh} disabled={loading}>
          <RefreshCw aria-hidden="true" strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="workspace-connection__repository-list" role="radiogroup" aria-label="OKF 저장소" aria-busy={loading}>
        {state.repositories.map((repository) => (
          <label key={repository.id} className="workspace-connection__repository-option">
            <Radio name="repository" disabled={loading} checked={selectedId === repository.id} onChange={() => setSelectedId(repository.id)} />
            <span className="min-w-0"><span className="block break-words font-[number:var(--font-weight-control)]">{repository.fullName}</span><small>기본 브랜치: {repository.defaultBranch ?? "없음"}</small></span>
          </label>
        ))}
      </div>
      {loading ? <p role="status" className="m-0 flex items-center gap-[var(--space-2)] text-[var(--color-text-muted)]"><LoaderCircle className="size-[var(--icon-size)] animate-spin" aria-hidden="true" />저장소를 불러오는 중입니다.</p> : null}
      {!loading && state.status !== "error" && state.repositoriesLoaded && state.repositories.length === 0 ? <p role="status" className="m-0 text-[var(--color-text-muted)]">선택할 저장소가 없습니다.</p> : null}
      {state.nextRepositoryCursor ? <Button variant="ghost" onClick={onLoadNext} disabled={state.status === "loading"}>저장소 더 보기</Button> : null}
      </div>
      <div className="grid gap-[var(--space-1)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
        <span>찾는 저장소가 없나요?</span>
        <Button variant="ghost" asChild className="h-auto rounded-none border-0 p-0 font-[number:var(--font-weight-body)] text-[length:var(--font-meta-size)] data-[loading=false]:hover:bg-transparent data-[loading=false]:active:bg-transparent hover:underline underline-offset-4"><a href="https://github.com/new" target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); onCreateRepository?.(); }}>GitHub에서 새 저장소 만들기<span className="sr-only"> (새 창)</span></a></Button>
      </div>
      </div>
      <div className="mt-[var(--space-5)] flex justify-end">
        <Button disabled={!selected || loading || state.status === "error"} onClick={() => selected && onSelect(selected)}>다음</Button>
      </div>
    </section>
  );
}
