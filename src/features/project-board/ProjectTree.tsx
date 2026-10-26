import { StatusBadge } from "@/components/patterns/StatusBadge";
import {
  layerName,
  statusName,
  type BoardIssue,
  type BoardLayer,
  type BoardStatus,
} from "@/features/project-board/model";

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

const STATUS_ORDER: BoardStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
];

const LAYER_GROUPS: BoardLayer[] = [
  "planning",
  "design",
  "frontend",
  "backend",
  "unassigned",
];

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

function LeafRow({ issue, depth }: { issue: BoardIssue; depth: number }) {
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-1)] py-[var(--space-1)]"
      style={{ marginLeft: `${depth * 12}px` }}
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <span>
          {kindLabel(issue.kind)} #{issue.number} {issue.title}
        </span>
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        {issue.kind ? (
          <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
            {issue.kind}
          </span>
        ) : null}
      </div>
      {issue.children.length > 0
        ? [...issue.children]
            .sort(
              (left, right) =>
                STATUS_ORDER.indexOf(left.status) -
                STATUS_ORDER.indexOf(right.status),
            )
            .map((child) => (
              <LeafRow key={child.url} issue={child} depth={depth + 1} />
            ))
        : null}
    </article>
  );
}

function LayerGroup({
  name,
  issues,
}: {
  name: string;
  issues: BoardIssue[];
}) {
  if (issues.length === 0) {
    return null;
  }
  const ordered = [...issues].sort(
    (left, right) =>
      STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
  );
  return (
    <section aria-label={`${name} 묶음`} className="grid min-w-0 gap-[var(--space-2)]">
      <h2 className="m-0 text-[var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--text-muted)]">
        {name}
      </h2>
      <div className="grid gap-[var(--space-2)]">
        {ordered.map((issue) => (
          <ChildCard key={issue.url} issue={issue} />
        ))}
      </div>
    </section>
  );
}

function ChildCard({ issue }: { issue: BoardIssue }) {
  const progress = epicProgress(issue);
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className="grid content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
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
            {issue.children.map((child) => (
              <LeafRow key={child.url} issue={child} depth={1} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

interface FlowStep {
  issue: BoardIssue;
  predecessor: BoardIssue | null;
  depth: number;
}

/** 같은 에픽 안에서 `이전 단계`로 이어진 흐름과, 순서 없는 항목을 나눈다. */
function buildFlow(children: BoardIssue[]): {
  steps: FlowStep[];
  independent: BoardIssue[];
} {
  const byNumber = new Map(children.map((child) => [child.number, child]));
  const chained = children.filter(
    (issue) =>
      (issue.dependsOn != null && byNumber.has(issue.dependsOn)) ||
      children.some((other) => other.dependsOn === issue.number),
  );
  const chainedNumbers = new Set(chained.map((issue) => issue.number));
  const depthOf = (issue: BoardIssue): number => {
    let depth = 0;
    const seen = new Set<number>([issue.number]);
    let current = issue;
    while (
      current.dependsOn != null &&
      byNumber.has(current.dependsOn) &&
      !seen.has(current.dependsOn)
    ) {
      seen.add(current.dependsOn);
      const next = byNumber.get(current.dependsOn);
      if (!next) {
        break;
      }
      current = next;
      depth += 1;
    }
    return depth;
  };
  const steps = chained
    .map((issue) => ({
      issue,
      predecessor:
        issue.dependsOn != null
          ? (byNumber.get(issue.dependsOn) ?? null)
          : null,
      depth: depthOf(issue),
    }))
    .sort(
      (left, right) =>
        left.depth - right.depth || left.issue.number - right.issue.number,
    );
  return {
    steps,
    independent: children.filter((issue) => !chainedNumbers.has(issue.number)),
  };
}

function FlowSteps({ steps }: { steps: FlowStep[] }) {
  if (steps.length === 0) {
    return null;
  }
  const byNumber = new Map(steps.map((step) => [step.issue.number, step.issue]));
  const predecessorNumbers = new Set<number>();
  for (const step of steps) {
    if (step.predecessor != null) {
      predecessorNumbers.add(step.predecessor.number);
    }
  }
  const paths: BoardIssue[][] = steps
    .filter((step) => !predecessorNumbers.has(step.issue.number))
    .map((leaf) => {
      const path = [leaf.issue];
      const seen = new Set<number>([leaf.issue.number]);
      let current = leaf.issue;
      while (
        current.dependsOn != null &&
        byNumber.has(current.dependsOn) &&
        !seen.has(current.dependsOn)
      ) {
        const previous = byNumber.get(current.dependsOn);
        if (!previous) {
          break;
        }
        seen.add(previous.number);
        path.unshift(previous);
        current = previous;
      }
      return path;
    })
    .sort(
      (left, right) =>
        (left[0]?.number ?? 0) - (right[0]?.number ?? 0) ||
        left.length - right.length,
    );
  return (
    <section
      aria-label="순서 있는 흐름"
      className="grid min-w-0 gap-[var(--space-2)]"
    >
      <h2 className="m-0 text-[var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--text-muted)]">
        순서 있는 흐름
      </h2>
      <ol
        aria-label="흐름 요약"
        className="m-0 grid list-none gap-[var(--space-2)] p-0"
      >
        {paths.map((path) => (
          <li
            key={path.map((node) => node.number).join("-")}
            aria-label={path.map((node) => node.title).join(" 다음 ")}
            className="flex flex-wrap items-center gap-x-[var(--space-1)] gap-y-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
          >
            {path.map((node, index) => (
              <span key={node.url} className="flex items-center gap-x-[var(--space-1)]">
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="text-[length:1.1rem] font-bold text-[var(--color-primary-action)]"
                  >
                    →
                  </span>
                ) : null}
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--font-meta-size)] font-[number:var(--font-weight-control)]">
                  {node.title}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ol>
      <ol className="m-0 grid list-none gap-[var(--space-1)] p-0">
        {steps.map((step, index) => (
          <li key={step.issue.url} className="grid gap-[var(--space-1)]">
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="text-[length:1.1rem] font-bold text-[var(--color-primary-action)]"
              >
                ↓
              </span>
            ) : null}
            <article
              aria-label={`${kindLabel(step.issue.kind)} #${step.issue.number} ${step.issue.title}`}
              className="grid content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
            >
              {step.predecessor ? (
                <p className="m-0 text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  ← #{step.predecessor.number} {step.predecessor.title}{" "}
                  다음에 진행
                </p>
              ) : null}
              <div className="font-[number:var(--font-weight-control)]">
                {kindLabel(step.issue.kind)} #{step.issue.number}{" "}
                {step.issue.title}
              </div>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <StatusBadge tone="neutral">
                  {statusName(step.issue.status)}
                </StatusBadge>
                <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  {layerName(step.issue.layer)}
                  {step.issue.kind ? ` · ${step.issue.kind}` : null}
                </span>
              </div>
              {step.issue.children.length > 0 ? (
                <div>
                  {step.issue.children.map((child) => (
                    <LeafRow key={child.url} issue={child} depth={1} />
                  ))}
                </div>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EpicCard({ issue }: { issue: BoardIssue }) {
  const progress = epicProgress(issue);
  const flow = buildFlow(issue.children);
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
      <FlowSteps steps={flow.steps} />
      {LAYER_GROUPS.map((layer) => {
        const group = flow.independent.filter(
          (child) => child.layer === layer,
        );
        if (group.length === 0) {
          return null;
        }
        return (
          <LayerGroup
            key={layer}
            name={layerName(layer)}
            issues={group}
          />
        );
      })}
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
        ↓로 이어진 카드는 순서가 있습니다. 본문에{" "}
        <code>이전 단계: #N</code>을 적으면 흐름으로 보여줍니다. 묶음
        위·아래 순서는 진행 순서가 아닙니다.
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
