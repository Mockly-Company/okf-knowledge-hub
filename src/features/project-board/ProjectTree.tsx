import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import {
  layerName,
  statusName,
  type BoardIssue,
  type BoardLayer,
  type BoardStatus,
} from "@/features/project-board/model";

const STATUS_ORDER: BoardStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
];

/**
 * 작업 순서: 기획이 먼저 나와야 디자인이 화면을 만들고,
 * 백엔드(DB 설계)가 나와야 프론트가 API를 연결할 수 있다.
 * 미지정은 맨 뒤로 둔다.
 */
const PHASE_ORDER: BoardLayer[] = [
  "planning",
  "design",
  "backend",
  "frontend",
  "unassigned",
];

function sortByPhaseThenStatus(left: BoardIssue, right: BoardIssue): number {
  const phaseDiff =
    PHASE_ORDER.indexOf(left.layer) - PHASE_ORDER.indexOf(right.layer);
  if (phaseDiff !== 0) {
    return phaseDiff;
  }
  return STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
}

export interface EpicProgress {
  done: number;
  total: number;
  percent: number;
}

export function epicProgress(issue: BoardIssue): EpicProgress {
  let done = issue.status === "done" ? 1 : 0;
  let total = 1;
  for (const child of issue.children) {
    const childProgress = epicProgress(child);
    done += childProgress.done;
    total += childProgress.total;
  }
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

function kindLabel(kind: string | null): string {
  if (kind === "기능") {
    return "스토리";
  }
  if (kind === "작업") {
    return "태스크";
  }
  return "하위 항목";
}

function ProgressBar({ progress }: { progress: EpicProgress }) {
  return (
    <div
      className="flex items-center gap-[var(--space-2)]"
      role="progressbar"
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`진행률 ${progress.percent}퍼센트`}
    >
      <div
        aria-hidden="true"
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-[var(--color-control-disabled)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-primary-action)]"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
        {progress.done}/{progress.total} · {progress.percent}%
      </span>
    </div>
  );
}

function LeafRow({ issue }: { issue: BoardIssue }) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)] py-[2px]">
      <span aria-hidden="true" className="text-[var(--text-muted)]">
        ·
      </span>
      <span>
        서브태스크 #{issue.number} {issue.title}
      </span>
      <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
    </div>
  );
}

function ChildCard({ issue }: { issue: BoardIssue }) {
  const progress = epicProgress(issue);
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className="grid w-64 shrink-0 content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
    >
      <div className="font-[number:var(--font-weight-control)]">
        {kindLabel(issue.kind)} #{issue.number} {issue.title}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
          {layerName(issue.layer)}
          {issue.kind ? ` · ${issue.kind}` : null}
        </span>
      </div>
      {issue.children.length > 0 ? (
        <div className="grid gap-[var(--space-1)]">
          <ProgressBar progress={progress} />
          <div>
            {[...issue.children]
              .sort(sortByPhaseThenStatus)
              .map((child) => (
                <LeafRow key={child.url} issue={child} />
              ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EpicCard({ issue }: { issue: BoardIssue }) {
  const progress = epicProgress(issue);
  const ordered = [...issue.children].sort(sortByPhaseThenStatus);
  return (
    <article
      aria-label={`에픽 #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
    >
      <div className="grid gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="font-[number:var(--font-weight-control)] text-[length:var(--font-h3-size,1rem)]">
            에픽 #{issue.number} {issue.title}
          </span>
          <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
          {issue.kind ? (
            <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
              {issue.kind}
            </span>
          ) : null}
        </div>
        <ProgressBar progress={progress} />
      </div>
      {ordered.length > 0 ? (
        <div
          className="flex items-stretch gap-[var(--space-2)] overflow-x-auto pb-[var(--space-1)]"
          aria-label={`${issue.title} 진행 흐름`}
        >
          {ordered.map((child, index) => (
            <div key={child.url} className="flex shrink-0 items-stretch gap-[var(--space-2)]">
              {index > 0 ? (
                <span aria-hidden="true" className="self-center text-[var(--text-muted)]">
                  <ArrowRight />
                </span>
              ) : null}
              <ChildCard issue={child} />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ProjectTree({ issues }: { issues: BoardIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="m-0 text-[var(--text-muted)]">연결된 Issue 없음</p>
    );
  }
  const epics = issues.filter((issue) => issue.children.length > 0);
  const singles = issues.filter((issue) => issue.children.length === 0);
  return (
    <div
      className="mt-[var(--space-4)] grid gap-[var(--space-4)]"
      role="region"
      aria-label="계층 보기"
    >
      <p className="m-0 text-[var(--font-meta-size)] text-[var(--text-muted)]">
        왼쪽부터 기획 → 디자인 → 백엔드 → 프론트 순서로 읽으세요. 앞 단계가
        끝나야 다음 단계가 완성됩니다.
      </p>
      {epics.map((issue) => (
        <EpicCard key={issue.url} issue={issue} />
      ))}
      {singles.length > 0 ? (
        <section aria-label="단일 항목">
          <h2 className="m-0 mb-[var(--space-3)]">단일 항목</h2>
          <div className="grid gap-[var(--space-2)]">
            {singles.map((issue) => (
              <article
                key={issue.url}
                aria-label={`단일 항목 #${issue.number} ${issue.title}`}
                className="flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
              >
                <span>
                  #{issue.number} {issue.title}
                </span>
                <StatusBadge tone="neutral">
                  {statusName(issue.status)}
                </StatusBadge>
                <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  {layerName(issue.layer)}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
