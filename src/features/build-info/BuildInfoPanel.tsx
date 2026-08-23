import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
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
      <SectionHeader
        title="앱 정보"
        description="현재 실행 중인 앱의 출처와 보안 저장소 구성을 확인합니다."
      />
      {buildInfo ? (
        <dl className="mt-[var(--space-6)] grid grid-cols-[max-content_1fr] gap-x-[var(--space-6)] gap-y-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--panel-padding)]">
          <dt className="text-[var(--color-text-muted)]">빌드</dt>
          <dd className="m-0 font-medium text-[var(--color-text-strong)]">
            {buildInfo.branch}@{buildInfo.commit}
          </dd>
          <dt className="text-[var(--color-text-muted)]">상태</dt>
          <dd className="m-0 text-[var(--color-text-strong)]">
            <StatusBadge tone={buildInfo.dirty ? "warning" : "success"}>
              {buildInfo.dirty ? "변경사항 있음" : "커밋 기준"}
            </StatusBadge>
          </dd>
          <dt className="text-[var(--color-text-muted)]">인증 저장소</dt>
          <dd className="m-0 text-[var(--color-text-strong)]">
            {buildInfo.credentialBackend}
          </dd>
        </dl>
      ) : (
        <p className="mt-[var(--space-6)] text-[var(--color-text-muted)]">
          빌드 정보 확인 중…
        </p>
      )}
    </div>
  );
}
