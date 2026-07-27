import { useWorkspaceConnection } from "../WorkspaceConnectionProvider";

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
      <h2 className="m-0 text-xl font-semibold text-[var(--color-text-strong)]">
        워크스페이스
      </h2>
      <p className="mt-1 text-[var(--color-text-muted)]">
        이 기기에 연결된 OKF 지식 저장소를 확인하고 교체합니다.
      </p>
      <dl className="mt-6 grid gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
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
          <dd className="mt-1 flex items-center gap-2 text-[var(--color-text-strong)]">
            <span>.okf/workspace.yml</span>
            <span className="rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-sm text-[var(--color-success)]">
              schema v{connectedWorkspace.summary.schemaVersion}
            </span>
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isWorkspaceValidating}
          onClick={() => void revalidateCurrentWorkspace()}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-medium text-[var(--color-text-strong)]"
        >
          {isWorkspaceValidating ? "확인 중" : "다시 확인"}
        </button>
        <button
          type="button"
          onClick={() => void startReplacement()}
          className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-semibold text-white"
        >
          다른 지식 저장소 연결
        </button>
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
