import { useId, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  layerName,
  statusName,
  type BoardIssue,
  type BoardLayer,
  type BoardStatus,
} from "@/features/project-board/model";
import {
  MAX_ISSUE_TREE_DEPTH,
  asIssueArray,
  issueKey,
  safeHref,
} from "@/features/project-board/boardUtils";

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

const EMPTY_PATH: ReadonlySet<string> = new Set<string>();

/** 에픽이 이 수 이하일 때만 처음부터 펼친다. 큰 보드는 접힌 채로 시작해 렌더량을 줄인다. */
const EPIC_AUTO_EXPAND_LIMIT = 5;

function sortByPhaseThenStatus(left: BoardIssue, right: BoardIssue): number {
  const phaseDiff =
    PHASE_ORDER.indexOf(left.layer) - PHASE_ORDER.indexOf(right.layer);
  if (phaseDiff !== 0) {
    return phaseDiff;
  }
  return STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
}

/**
 * 렌더할 자식 목록. 오염 캐시의 비정상 원소를 거르고, 조상 경로에 이미 있는
 * URL(순환)은 빼서 재귀가 끝나도록 한다. 영역·상태 순으로 정렬한다.
 */
function childrenOf(issue: BoardIssue, path: ReadonlySet<string>): BoardIssue[] {
  return asIssueArray(issue.children)
    .filter((child) => !path.has(issueKey(child)))
    .sort(sortByPhaseThenStatus);
}

function withKey(path: ReadonlySet<string>, issue: BoardIssue): ReadonlySet<string> {
  const next = new Set(path);
  next.add(issueKey(issue));
  return next;
}

/**
 * 동일 URL·number 형제(다이아몬드 공유·오염 중복)에도 겹치지 않는 React 키를 만든다.
 * 같은 base가 형제 안에서 몇 번째로 나오는지만 접미사로 붙인다.
 */
function siblingKeys(list: BoardIssue[]): string[] {
  const seen = new Map<string, number>();
  return list.map((item) => {
    const base = `${issueKey(item)}#${item.number}`;
    const occ = seen.get(base) ?? 0;
    seen.set(base, occ + 1);
    return occ === 0 ? base : `${base}#${occ + 1}`;
  });
}

export interface EpicProgress {
  done: number;
  total: number;
  percent: number;
}

export function epicProgress(
  issue: BoardIssue,
  path: ReadonlySet<string> = EMPTY_PATH,
  depth = 0,
): EpicProgress {
  let done = issue.status === "done" ? 1 : 0;
  let total = 1;
  // 깊이 상한과 순환 차단으로 오염 캐시에서도 집계가 끝나게 한다.
  if (depth < MAX_ISSUE_TREE_DEPTH) {
    const childPath = withKey(path, issue);
    for (const child of childrenOf(issue, childPath)) {
      const childProgress = epicProgress(child, childPath, depth + 1);
      done += childProgress.done;
      total += childProgress.total;
    }
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

/** 검증된 GitHub 주소일 때만 링크로, 아니면 텍스트로 렌더한다. */
function IssueTitle({ issue, label }: { issue: BoardIssue; label: string }) {
  const href = safeHref(issue.url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function OmittedNote() {
  return (
    <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
      하위 항목 생략됨
    </span>
  );
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

function LeafRow({
  issue,
  path,
  depth,
}: {
  issue: BoardIssue;
  path: ReadonlySet<string>;
  depth: number;
}) {
  const childPath = withKey(path, issue);
  // 깊이 상한을 넘으면 자식을 펼치지 않고 생략 표시만 남긴다.
  const cut = depth >= MAX_ISSUE_TREE_DEPTH;
  const ordered = cut ? [] : childrenOf(issue, childPath);
  const omitted =
    issue.childrenTruncated ||
    (cut && asIssueArray(issue.children).length > 0);
  return (
    <div className="grid gap-[var(--space-1)] py-[2px]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <IssueTitle
          issue={issue}
          label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
        />
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        {omitted ? <OmittedNote /> : null}
      </div>
      {ordered.length > 0 ? (
        <ul className="m-0 ml-[var(--space-2)] grid list-none gap-[var(--space-1)] border-l border-[var(--border)] p-0 pl-[var(--space-2)]">
          {siblingKeys(ordered).map((key, index) => (
            <li key={key}>
              <LeafRow issue={ordered[index]} path={childPath} depth={depth + 1} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChildCard({
  issue,
  path,
}: {
  issue: BoardIssue;
  path: ReadonlySet<string>;
}) {
  // 정렬·진행률 재귀는 이슈가 바뀔 때만 다시 계산한다.
  const { childPath, ordered, progress } = useMemo(() => {
    const nextPath = withKey(path, issue);
    return {
      childPath: nextPath,
      ordered: childrenOf(issue, nextPath),
      progress: epicProgress(issue, path, 1),
    };
  }, [issue, path]);
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className="grid w-64 shrink-0 content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
    >
      <h3 className="m-0 text-[length:inherit] font-[number:var(--font-weight-control)]">
        <IssueTitle
          issue={issue}
          label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
        />
      </h3>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
          {layerName(issue.layer)}
          {issue.kind ? ` · ${issue.kind}` : null}
        </span>
        {issue.childrenTruncated ? <OmittedNote /> : null}
      </div>
      {ordered.length > 0 ? (
        <div className="grid gap-[var(--space-1)]">
          <ProgressBar progress={progress} />
          <ul className="m-0 grid list-none gap-[var(--space-1)] p-0">
            {siblingKeys(ordered).map((key, index) => (
              <li key={key}>
                <LeafRow issue={ordered[index]} path={childPath} depth={2} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function EpicCard({
  issue,
  defaultOpen,
}: {
  issue: BoardIssue;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const flowId = useId();
  const { childPath, ordered, progress } = useMemo(() => {
    const nextPath = withKey(EMPTY_PATH, issue);
    return {
      childPath: nextPath,
      ordered: childrenOf(issue, nextPath),
      progress: epicProgress(issue),
    };
  }, [issue]);
  return (
    <article
      aria-label={`에픽 #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
    >
      <div className="grid gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {ordered.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={flowId}
              aria-label={`${issue.title} ${open ? "접기" : "펼치기"}`}
            >
              {open ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronRight aria-hidden="true" />
              )}
            </Button>
          ) : null}
          <h2 className="m-0 font-[number:var(--font-weight-control)] text-[length:var(--font-h3-size,1rem)]">
            <IssueTitle
              issue={issue}
              label={`에픽 #${issue.number} ${issue.title}`}
            />
          </h2>
          <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
          {issue.kind ? (
            <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
              {issue.kind}
            </span>
          ) : null}
          {issue.childrenTruncated ? <OmittedNote /> : null}
        </div>
        <ProgressBar progress={progress} />
      </div>
      {open && ordered.length > 0 ? (
        <div
          id={flowId}
          className="flex items-stretch gap-[var(--space-2)] overflow-x-auto pb-[var(--space-1)]"
          role="group"
          tabIndex={0}
          aria-label={`${issue.title} 진행 흐름`}
        >
          {siblingKeys(ordered).map((key, index) => (
            <div key={key} className="flex shrink-0 items-stretch gap-[var(--space-2)]">
              {index > 0 ? (
                <span aria-hidden="true" className="self-center text-[var(--text-muted)]">
                  <ArrowRight />
                </span>
              ) : null}
              <ChildCard issue={ordered[index]} path={childPath} />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ProjectTree({ issues }: { issues: BoardIssue[] }) {
  // hideDone=false 등 정규화를 우회하는 경로에서도 안전하도록 최상위도 검증한다.
  const { epics, singles } = useMemo(() => {
    const safeIssues = asIssueArray(issues);
    const hasChildren = (issue: BoardIssue) =>
      asIssueArray(issue.children).length > 0;
    return {
      epics: safeIssues.filter(hasChildren),
      singles: safeIssues.filter((issue) => !hasChildren(issue)),
    };
  }, [issues]);
  if (epics.length === 0 && singles.length === 0) {
    return (
      <p className="m-0 text-[var(--text-muted)]">연결된 Issue 없음</p>
    );
  }
  const autoExpand = epics.length <= EPIC_AUTO_EXPAND_LIMIT;
  return (
    <div
      className="mt-[var(--space-4)] grid gap-[var(--space-4)]"
      role="region"
      aria-label="계층 보기"
    >
      <p className="m-0 text-[var(--font-meta-size)] text-[var(--text-muted)]">
        화살표는 상위-하위 항목의 실제 연결입니다. 같은 줄의 카드는
        기획 → 디자인 → 백엔드 → 프론트 영역 순서대로 나열됩니다.
      </p>
      {siblingKeys(epics).map((key, index) => (
        <EpicCard key={key} issue={epics[index]} defaultOpen={autoExpand} />
      ))}
      {singles.length > 0 ? (
        <section aria-labelledby="singles-heading">
          <h2 id="singles-heading" className="m-0 mb-[var(--space-3)]">단일 항목</h2>
          <div className="grid gap-[var(--space-2)]">
            {siblingKeys(singles).map((key, index) => {
              const issue = singles[index];
              return (
                <article
                  key={key}
                  aria-label={`단일 항목 #${issue.number} ${issue.title}`}
                  className="flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
                >
                  <IssueTitle issue={issue} label={`#${issue.number} ${issue.title}`} />
                  <StatusBadge tone="neutral">
                    {statusName(issue.status)}
                  </StatusBadge>
                  <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
                    {layerName(issue.layer)}
                  </span>
                  {issue.childrenTruncated ? <OmittedNote /> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
