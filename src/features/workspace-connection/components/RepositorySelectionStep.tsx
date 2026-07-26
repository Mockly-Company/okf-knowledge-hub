import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { GithubRepositorySummary, RecoveryAction, RepositoryConnectionState } from "../types";
import { ConnectionError } from "./ConnectionError";

interface RepositorySelectionStepProps {
  state: RepositoryConnectionState;
  onSelect(repository: GithubRepositorySummary): void;
  onRefresh(): void;
  onLoadNext(): void;
  onRecover(action: RecoveryAction): void;
}

export function RepositorySelectionStep({ state, onSelect, onRefresh, onLoadNext, onRecover }: RepositorySelectionStepProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = state.repositories.find((repository) => repository.id === selectedId) ?? null;
  return (
    <section className="workspace-connection__step" aria-labelledby="repository-selection-title">
      <p className="workspace-connection__eyebrow">2 / 3</p>
      <h1 id="repository-selection-title">OKF 저장소 선택</h1>
      <p>연결할 기존 OKF 지식 저장소를 선택하세요.</p>
      {state.status === "error" ? <ConnectionError error={state.error} onRecover={onRecover} /> : null}
      <div className="workspace-connection__repository-list" role="radiogroup" aria-label="OKF 저장소">
        {state.repositories.map((repository) => (
          <label key={repository.id} className="workspace-connection__repository-option">
            <input type="radio" name="repository" checked={selectedId === repository.id} onChange={() => setSelectedId(repository.id)} />
            <span><strong>{repository.fullName}</strong><small>기본 브랜치: {repository.defaultBranch ?? "없음"}</small></span>
          </label>
        ))}
      </div>
      {state.nextRepositoryCursor ? <Button variant="ghost" onClick={onLoadNext} disabled={state.status === "loading"}>저장소 더 보기</Button> : null}
      <div className="workspace-connection__actions">
        <Button variant="secondary" onClick={onRefresh} disabled={state.status === "loading"}>
          {state.status === "loading" ? <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} /> : <RefreshCw aria-hidden="true" strokeWidth={1.75} />} 새로고침
        </Button>
        <Button variant="secondary" asChild><a href="https://github.com/new" target="_blank" rel="noreferrer">GitHub에서 새 저장소 만들기</a></Button>
        <Button disabled={!selected} onClick={() => selected && onSelect(selected)}>다음</Button>
      </div>
    </section>
  );
}
