import { useEffect, useState } from "react";
import type {
  BuildInfo,
  BuildInfoGateway,
} from "./BuildInfoGateway";

export function BuildInfoPanel({ gateway }: { gateway: BuildInfoGateway }) {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let active = true;
    void gateway.getBuildInfo().then((info) => {
      if (active) setBuildInfo(info);
    });
    return () => {
      active = false;
    };
  }, [gateway]);

  return (
    <div>
      <h2 className="m-0 text-xl font-semibold text-[var(--color-text-strong)]">
        앱 정보
      </h2>
      <p className="mt-1 text-[var(--color-text-muted)]">
        현재 실행 중인 앱의 출처와 보안 저장소 구성을 확인합니다.
      </p>
      {buildInfo ? (
        <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <dt className="text-[var(--color-text-muted)]">빌드</dt>
          <dd className="m-0 font-medium text-[var(--color-text-strong)]">
            {buildInfo.branch}@{buildInfo.commit}
          </dd>
          <dt className="text-[var(--color-text-muted)]">상태</dt>
          <dd className="m-0 text-[var(--color-text-strong)]">
            {buildInfo.dirty ? "변경사항 있음" : "커밋 기준"}
          </dd>
          <dt className="text-[var(--color-text-muted)]">인증 저장소</dt>
          <dd className="m-0 text-[var(--color-text-strong)]">
            {buildInfo.credentialBackend}
          </dd>
        </dl>
      ) : (
        <p className="mt-6 text-[var(--color-text-muted)]">빌드 정보 확인 중…</p>
      )}
    </div>
  );
}
