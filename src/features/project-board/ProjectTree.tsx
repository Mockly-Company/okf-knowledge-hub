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
      {issue.children.length > 0 ? (
        <ChildList issues={issue.children} depth={depth + 1} />
      ) : null}
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
          <FlowNodeCard
            key={issue.url}
            issue={issue}
            isBranch={false}
          />
        ))}
      </div>
    </section>
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

interface FlowTreeNode {
  issue: BoardIssue;
  children: FlowTreeNode[];
}

function FlowNodeCard({
  issue,
  isBranch,
}: {
  issue: BoardIssue;
  isBranch: boolean;
}) {
  const progress = epicProgress(issue);
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className={`grid content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] ${isBranch ? "ring-1 ring-[var(--color-primary-action)]" : ""}`}
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
          <ChildList issues={issue.children} depth={1} />
        </div>
      ) : null}
    </article>
  );
}

function FlowElbow({ isLast }: { isLast: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 left-0 top-0 w-[28px]"
    >
      <span
        className={`absolute left-[13px] top-0 w-[2px] bg-[var(--color-primary-action)] ${isLast ? "h-[26px]" : "h-full"}`}
      />
      <span className="absolute left-[13px] top-[24px] h-[2px] w-[15px] bg-[var(--color-primary-action)]" />
    </span>
  );
}

function FlowTreeRow({
  node,
  isLast,
  isRoot,
}: {
  node: FlowTreeNode;
  isLast: boolean;
  isRoot: boolean;
}) {
  return (
    <li aria-label={node.issue.title} className="relative grid">
      {isRoot ? null : <FlowElbow isLast={isLast} />}
      <div className={isRoot ? undefined : "pl-[28px]"}>
        <div className="grid gap-[var(--space-3)] pb-[var(--space-3)]">
          <FlowNodeCard
            issue={node.issue}
            isBranch={node.children.length > 0}
          />
          {node.children.length > 0 ? (
            <ol className="m-0 grid list-none gap-0 p-0">
              {node.children.map((child, index) => (
                <FlowTreeRow
                  key={child.issue.url}
                  node={child}
                  isLast={index === node.children.length - 1}
                  isRoot={false}
                />
              ))}
            </ol>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function buildForest(steps: FlowStep[]): FlowTreeNode[] {
  const stepNumbers = new Set(steps.map((step) => step.issue.number));
  const dependentsOf = new Map<number, BoardIssue[]>();
  for (const step of steps) {
    if (step.predecessor != null && stepNumbers.has(step.predecessor.number)) {
      const list = dependentsOf.get(step.predecessor.number) ?? [];
      list.push(step.issue);
      dependentsOf.set(step.predecessor.number, list);
    }
  }
  const depthOf = new Map(steps.map((step) => [step.issue.number, step.depth]));
  for (const list of dependentsOf.values()) {
    list.sort(
      (left, right) =>
        (depthOf.get(left.number) ?? 0) - (depthOf.get(right.number) ?? 0) ||
        left.number - right.number,
    );
  }
  const buildNode = (
    issue: BoardIssue,
    seen: Set<number>,
  ): FlowTreeNode => {
    const children = (dependentsOf.get(issue.number) ?? []).filter(
      (child) => !seen.has(child.number),
    );
    return {
      issue,
      children: children.map((child) =>
        buildNode(child, new Set([...seen, child.number])),
      ),
    };
  };
  let roots = steps
    .filter(
      (step) =>
        step.predecessor == null || !stepNumbers.has(step.predecessor.number),
    )
    .map((step) => step.issue);
  if (roots.length === 0) {
    roots = steps.map((step) => step.issue);
  }
  const rendered = new Set<number>();
  const collect = (node: FlowTreeNode): void => {
    rendered.add(node.issue.number);
    for (const child of node.children) {
      collect(child);
    }
  };
  const forest: FlowTreeNode[] = [];
  for (const root of roots) {
    if (rendered.has(root.number)) {
      continue;
    }
    const node = buildNode(root, new Set([root.number]));
    collect(node);
    forest.push(node);
  }
  return forest;
}

function ForestList({ forest }: { forest: FlowTreeNode[] }) {
  return (
    <ol
      aria-label="흐름 요약"
      className="m-0 grid list-none gap-0 p-0"
    >
      {forest.map((root, index) => (
        <FlowTreeRow
          key={root.issue.url}
          node={root}
          isLast={index === forest.length - 1}
          isRoot
        />
      ))}
    </ol>
  );
}

function FlowSteps({ steps }: { steps: FlowStep[] }) {
  if (steps.length === 0) {
    return null;
  }
  return <ForestList forest={buildForest(steps)} />;
}

/** 형제 목록을 흐름(의존 연결)과 낱개로 나눠 그린다. 모든 깊이에 적용. */
function ChildList({
  issues,
  depth,
}: {
  issues: BoardIssue[];
  depth: number;
}) {
  const flow = buildFlow(issues);
  const ordered = [...flow.independent].sort(
    (left, right) =>
      STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
  );
  return (
    <div className="grid gap-[var(--space-1)]">
      <FlowSteps steps={flow.steps} />
      {ordered.map((child) => (
        <LeafRow key={child.url} issue={child} depth={depth} />
      ))}
    </div>
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
  const singleFlow = buildFlow(singles);
  const loneSingles = singles.filter(
    (issue) =>
      !singleFlow.steps.some((step) => step.issue.number === issue.number),
  );
  return (
    <div
      className="mt-[var(--space-4)] grid gap-[var(--space-4)]"
      role="region"
      aria-label="계층 보기"
    >
      <p className="m-0 text-[var(--font-meta-size)] text-[var(--text-muted)]">
        아래 트리에서 순서와 갈래를 한눈에 볼 수 있습니다. 본문에{" "}
        <code>이전 단계: #N</code>을 적으면 흐름으로 이어서 보여줍니다.
        묶음 위·아래 순서는 진행 순서가 아닙니다.
      </p>
      {epics.map((issue) => (
        <EpicCard key={issue.url} issue={issue} />
      ))}
      {singles.length > 0 ? (
        <section aria-label="단일 항목">
          <h2 className="m-0 mb-[var(--space-3)]">단일 항목</h2>
          <FlowSteps steps={singleFlow.steps} />
          <div className="grid gap-[var(--space-2)]">
            {loneSingles.map((issue) => (
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
