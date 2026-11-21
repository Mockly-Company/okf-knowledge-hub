import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { cn } from "@/lib/utils";
import type { DocumentImplStatusFilter } from "../document-taxonomy";
import {
  formatDocumentSize,
  type DomainProgressSummary,
  type ProjectProgressSummary,
} from "../domain-progress";

interface DocumentProgressOverviewProps {
  summary: ProjectProgressSummary;
  statusFilter: DocumentImplStatusFilter;
  selectedDomainKey: string | null;
  defaultDomainsExpanded?: boolean;
  onStatusFilterChange(next: DocumentImplStatusFilter): void;
  onSelectDomainKey(domainKey: string | null): void;
}

interface FilterOption {
  value: DocumentImplStatusFilter;
  label: string;
  count: number;
  tone: "all" | "synced" | "partial" | "unimplemented" | "unaudited";
}

function buildDomainStageSummary(domain: DomainProgressSummary): string[] {
  const parts: string[] = [];
  if (domain.stages.prd > 0) parts.push(`기획 ${domain.stages.prd}`);
  if (domain.stages.screen_spec > 0) parts.push(`명세 ${domain.stages.screen_spec}`);
  if (domain.stages.design > 0) parts.push(`디자인 ${domain.stages.design}`);
  if (domain.stages.adr > 0) parts.push(`ADR ${domain.stages.adr}`);
  if (domain.stages.guide_ref > 0) parts.push(`가이드 ${domain.stages.guide_ref}`);
  if (parts.length === 0 && domain.stages.overview > 0) {
    parts.push(`개요 ${domain.stages.overview}`);
  }
  return parts;
}

function ProgressSegmentsBar({
  total,
  synced,
  partial,
  unimplemented,
  unaudited,
  className,
  ariaLabel,
  decorative = false,
}: {
  total: number;
  synced: number;
  partial: number;
  unimplemented: number;
  unaudited: number;
  className: string;
  ariaLabel?: string;
  decorative?: boolean;
}) {
  const safeTotal = Math.max(total, 1);
  const pct = (count: number) => `${((count / safeTotal) * 100).toFixed(2)}%`;

  return (
    <div
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : ariaLabel}
      aria-hidden={decorative || undefined}
    >
      {synced > 0 ? (
        <span
          className="document-progress-overview__seg document-progress-overview__seg--synced"
          style={{ width: pct(synced) }}
        />
      ) : null}
      {partial > 0 ? (
        <span
          className="document-progress-overview__seg document-progress-overview__seg--partial"
          style={{ width: pct(partial) }}
        />
      ) : null}
      {unimplemented > 0 ? (
        <span
          className="document-progress-overview__seg document-progress-overview__seg--unimplemented"
          style={{ width: pct(unimplemented) }}
        />
      ) : null}
      {unaudited > 0 ? (
        <span
          className="document-progress-overview__seg document-progress-overview__seg--unaudited"
          style={{ width: pct(unaudited) }}
        />
      ) : null}
    </div>
  );
}

export function DocumentProgressOverview({
  summary,
  statusFilter,
  selectedDomainKey,
  defaultDomainsExpanded = true,
  onStatusFilterChange,
  onSelectDomainKey,
}: DocumentProgressOverviewProps) {
  const [domainsExpanded, setDomainsExpanded] = useState(
    defaultDomainsExpanded,
  );
  useEffect(() => {
    setDomainsExpanded(defaultDomainsExpanded);
  }, [defaultDomainsExpanded]);
  const { counts, domains } = summary;

  if (counts.total === 0) {
    return null;
  }

  const filterOptions: FilterOption[] = [
    { value: "all", label: "전체 상태", count: counts.total, tone: "all" },
    {
      value: "unimplemented",
      label: "미반영",
      count: counts.unimplemented,
      tone: "unimplemented",
    },
    { value: "partial", label: "일부 수정", count: counts.partial, tone: "partial" },
    { value: "synced", label: "반영 완료", count: counts.synced, tone: "synced" },
    { value: "unaudited", label: "미점검", count: counts.unaudited, tone: "unaudited" },
  ];

  const barSummaryLabel = `문서 ${counts.total}건 중 반영 완료 ${counts.synced}건, 일부 수정 ${counts.partial}건, 미반영 ${counts.unimplemented}건, 미점검 ${counts.unaudited}건`;

  return (
    <section
      className="document-progress-overview"
      aria-label="문서 진행도 요약"
    >
      <div className="document-progress-overview__header">
        <div className="document-progress-overview__summary">
          <div className="document-progress-overview__title-row">
            <h2 className="document-progress-overview__title">전체 진행 현황</h2>
            <span className="document-progress-overview__pill">
              {`총 ${counts.total}건`}
            </span>
            <span className="document-progress-overview__pill document-progress-overview__pill--muted">
              {formatDocumentSize(counts.totalBytes)}
            </span>
          </div>
          <div className="document-progress-overview__metrics">
            {counts.tracked > 0 ? (
              <span>
                {`코드 반영 `}
                <strong>{`${counts.synced}/${counts.tracked}`}</strong>
                {` (${counts.trackedCompletionPercent}%)`}
              </span>
            ) : (
              <span>코드 반영 점검 전 문서 중심</span>
            )}
            {counts.issueTotal > 0 ? (
              <span>
                {`연결 이슈 `}
                <strong>{`${counts.issueDone}/${counts.issueTotal}`}</strong>
                {` 완료`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="document-progress-overview__controls">
          <ProgressSegmentsBar
            total={counts.total}
            synced={counts.synced}
            partial={counts.partial}
            unimplemented={counts.unimplemented}
            unaudited={counts.unaudited}
            className="document-progress-overview__bar"
            ariaLabel={barSummaryLabel}
          />
          {selectedDomainKey !== null ? (
            <UnstyledButton
              type="button"
              className="document-progress-overview__reset-domain"
              onClick={() => onSelectDomainKey(null)}
            >
              <RotateCcw aria-hidden="true" size={13} />
              모든 도메인 보기
            </UnstyledButton>
          ) : null}
          {domains.length > 1 ? (
            <UnstyledButton
              type="button"
              className="document-progress-overview__toggle"
              aria-expanded={domainsExpanded}
              onClick={() => setDomainsExpanded((prev) => !prev)}
            >
              {domainsExpanded ? (
                <>
                  <span>도메인 요약 접기</span>
                  <ChevronUp aria-hidden="true" size={14} />
                </>
              ) : (
                <>
                  <span>도메인 요약 펼치기</span>
                  <ChevronDown aria-hidden="true" size={14} />
                </>
              )}
            </UnstyledButton>
          ) : null}
        </div>
      </div>

      <div
        className="document-progress-overview__filters"
        role="group"
        aria-label="코드 반영 상태 필터"
      >
        {filterOptions.map((option) => {
          const isActive = statusFilter === option.value;
          return (
            <UnstyledButton
              key={option.value}
              type="button"
              className="document-progress-overview__filter-chip"
              data-active={isActive}
              aria-pressed={isActive}
              onClick={() =>
                onStatusFilterChange(
                  option.value === "all" || !isActive ? option.value : "all",
                )
              }
            >
              {option.tone !== "all" ? (
                <span
                  className={cn(
                    "document-progress-overview__dot",
                    `document-progress-overview__dot--${option.tone}`,
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span>{option.label}</span>
              <span className="document-progress-overview__chip-count">
                {option.count}
              </span>
            </UnstyledButton>
          );
        })}
      </div>

      {domainsExpanded && domains.length > 1 ? (
        <div
          className="document-progress-overview__domains"
          role="group"
          aria-label="도메인별 진행 현황"
        >
          {domains.map((domain) => {
            const isSelected = selectedDomainKey === domain.group.key;
            const stageParts = buildDomainStageSummary(domain);
            return (
              <UnstyledButton
                key={domain.group.key}
                type="button"
                className="document-progress-overview__domain-tile"
                data-active={isSelected ? "true" : undefined}
                aria-pressed={isSelected}
                onClick={() =>
                  onSelectDomainKey(isSelected ? null : domain.group.key)
                }
              >
                <div className="document-progress-overview__domain-top">
                  <strong className="document-progress-overview__domain-name">
                    {domain.group.label}
                  </strong>
                  <span className="document-progress-overview__domain-count">
                    {`${domain.counts.total}건`}
                  </span>
                </div>
                <ProgressSegmentsBar
                  total={domain.counts.total}
                  synced={domain.counts.synced}
                  partial={domain.counts.partial}
                  unimplemented={domain.counts.unimplemented}
                  unaudited={domain.counts.unaudited}
                  className="document-progress-overview__domain-bar"
                  decorative
                />
                <div className="document-progress-overview__domain-meta">
                  <span className="document-progress-overview__domain-stages">
                    {stageParts.join(" · ") || formatDocumentSize(domain.counts.totalBytes)}
                  </span>
                  {domain.counts.issueTotal > 0 ? (
                    <span className="document-progress-overview__domain-issues">
                      {`이슈 ${domain.counts.issueDone}/${domain.counts.issueTotal}`}
                    </span>
                  ) : null}
                </div>
              </UnstyledButton>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
