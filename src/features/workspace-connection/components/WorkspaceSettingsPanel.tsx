import { useWorkspaceConnection } from "../WorkspaceConnectionProvider";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";

export function WorkspaceSettingsPanel() {
  const {
    state,
    startReplacement,
    revalidateCurrentWorkspace,
    isWorkspaceValidating,
    workspaceValidation,
  } = useWorkspaceConnection();

  if (state.step !== "initialize" || state.status !== "connected") {
    return null;
  }

  const { connectedWorkspace } = state;
  const validation = workspaceValidation?.inspection ?? null;
  const validationError = workspaceValidation?.error ?? null;

  return (
    <div>
      <SectionHeader
        title="워크스페이스"
        description="이 기기에 연결된 OKF 지식 저장소를 확인하고 교체합니다."
      />
      <dl className="mt-[var(--space-6)] grid gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--panel-padding)]">
        <div>
          <dt className="text-sm text-[var(--color-text-muted)]">GitHub 저장소</dt>
          <dd className="mt-1 font-medium text-[var(--color-text-strong)]">
            {connectedWorkspace.repository?.fullName ?? "저장소 정보 없음"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--color-text-muted)]">로컬 경로</dt>
          <dd className="mt-1 break-all font-mono text-sm text-[var(--color-text-strong)]">
            {connectedWorkspace.path}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-[var(--color-text-muted)]">워크스페이스 설정</dt>
          <dd className="mt-1 flex items-center gap-[var(--space-2)] text-[var(--color-text-strong)]">
            <span>.okf/workspace.yml</span>
            <StatusBadge tone="neutral">
              {`schema v${connectedWorkspace.summary.schemaVersion}`}
            </StatusBadge>
          </dd>
        </div>
      </dl>
      <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-2)]">
        <Button
          type="button"
          variant="secondary"
          disabled={isWorkspaceValidating}
          onClick={() => void revalidateCurrentWorkspace()}
        >
          {isWorkspaceValidating ? "확인 중" : "다시 확인"}
        </Button>
        <Button
          type="button"
          onClick={() => void startReplacement()}
        >
          다른 지식 저장소 연결
        </Button>
      </div>
      {validation?.status === "ready" ? (
        <p role="status" className="mt-3 text-sm text-[var(--color-text-muted)]">
          유효한 워크스페이스입니다.
        </p>
      ) : null}
      {validation?.status === "invalid" ? (
        <ul className="mt-3 grid gap-1 text-sm text-[var(--color-error)]">
          {validation.diagnostics.map((diagnostic) => (
            <li key={`${diagnostic.path}-${diagnostic.code}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
      {validation?.status === "unsupported_version" ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
          지원하지 않는 schema v{validation.foundVersion}입니다.
        </p>
      ) : null}
      {validation?.status === "initialization_required" ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
          .okf/workspace.yml이 없습니다.
        </p>
      ) : null}
      {validationError ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
          {validationError.message}
        </p>
      ) : null}
    </div>
  );
}
