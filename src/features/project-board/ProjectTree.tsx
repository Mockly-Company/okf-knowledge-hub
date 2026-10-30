import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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

export interface EpicProgress {
  done: number;
  total: number;
  percent: number;
}

/** 에픽이 이 수 이하일 때만 처음부터 펼친다. 큰 보드는 접힌 채로 시작해 렌더량을 줄인다. */
const EPIC_AUTO_EXPAND_LIMIT = 5;

/**
 * 렌더 전에 트리를 한 번 정리한다. 오염 캐시의 비정상 원소를 거르고,
 * 조상 경로에 이미 있는 URL(순환)은 빼며, 깊이 상한을 넘는 자식은 잘라
 * 생략 표시를 남긴다. `dependsOn`도 정수가 아니면 버린다.
 * 이후 단계(진행률·흐름 계산·렌더)는 유한한 정상 트리만 다룬다.
 */
function sanitizeTree(
  issues: unknown,
  path: ReadonlySet<string> = new Set<string>(),
  depth = 0,
): BoardIssue[] {
  return asIssueArray(issues)
    .filter((issue) => !path.has(issueKey(issue)))
    .map((issue) => {
      const rawChildren = asIssueArray(issue.children);
      const cut = depth >= MAX_ISSUE_TREE_DEPTH;
      const childPath = new Set(path);
      childPath.add(issueKey(issue));
      const dependsOn =
        typeof issue.dependsOn === "number" &&
        Number.isInteger(issue.dependsOn) &&
        issue.dependsOn >= 0
          ? issue.dependsOn
          : null;
      return {
        ...issue,
        dependsOn,
        children: cut ? [] : sanitizeTree(rawChildren, childPath, depth + 1),
        childrenTruncated:
          issue.childrenTruncated === true || (cut && rawChildren.length > 0),
      };
    });
}

/**
 * 에픽 진행률. 렌더 경로는 sanitizeTree를 거친 트리를 넘기지만, 외부에서
 * 정리되지 않은 입력으로 불러도 끝나도록 순환·깊이 가드를 둔다.
 */
export function epicProgress(
  issue: BoardIssue,
  path: ReadonlySet<string> = new Set<string>(),
  depth = 0,
): EpicProgress {
  let done = issue.status === "done" ? 1 : 0;
  let total = 1;
  if (depth < MAX_ISSUE_TREE_DEPTH) {
    const childPath = new Set(path);
    childPath.add(issueKey(issue));
    for (const child of asIssueArray(issue.children)) {
      if (childPath.has(issueKey(child))) {
        continue;
      }
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

function OmittedNote({ issue }: { issue: BoardIssue }) {
  return issue.childrenTruncated ? (
    <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
      하위 항목 생략됨
    </span>
  ) : null;
}

const STATUS_ORDER: BoardStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
];

/**
 * 묶음 표시 순서. BOARD_LAYERS 선언과 같은 순서로 둔다.
 * 진행 순서를 뜻하지 않으며(이전 PHASE_ORDER의 백엔드→프론트 정렬은
 * 흐름 트리로 역할을 옮겼다), 순서는 `이전 단계` 흐름으로 보여준다.
 */
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
      style={{ marginInlineStart: `${depth * 12}px` }}
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span aria-hidden="true" className="text-[var(--text-muted)]">
          ·
        </span>
        <IssueTitle
          issue={issue}
          label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
        />
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        {issue.kind ? (
          <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
            {issue.kind}
          </span>
        ) : null}
        <OmittedNote issue={issue} />
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
  const ordered = useMemo(
    () =>
      [...issues].sort(
        (left, right) =>
          STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
      ),
    [issues],
  );
  const headingId = useId();
  if (ordered.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-[var(--space-2)]">
      <h3 id={headingId} className="m-0 text-[var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--text-muted)]">
        {name}
      </h3>
      <div className="grid gap-[var(--space-2)]">
        {siblingKeys(ordered).map((key, index) => (
          <FlowNodeCard key={key} issue={ordered[index]} isBranch={false} />
        ))}
      </div>
    </section>
  );
}

/** 이슈가 속한 저장소 경로(`owner/repo`). 번호는 저장소마다 겹칠 수 있다. */
function repoOf(issue: BoardIssue): string {
  const match = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\//i.exec(issueKey(issue));
  return match ? match[1].toLowerCase() : "";
}

/** 흐름 계산용 식별 키. `이전 단계: #N`은 같은 저장소의 N번을 뜻하므로 저장소로 범위를 묶는다. */
function flowKey(issue: BoardIssue): string {
  return `${repoOf(issue)}#${issue.number}`;
}

function predecessorKey(issue: BoardIssue): string | null {
  return issue.dependsOn != null ? `${repoOf(issue)}#${issue.dependsOn}` : null;
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
  const byKey = new Map(children.map((child) => [flowKey(child), child]));
  const predecessorOf = (issue: BoardIssue) => {
    const key = predecessorKey(issue);
    return key != null ? (byKey.get(key) ?? null) : null;
  };
  const hasDependent = new Set(
    children
      .map(predecessorKey)
      .filter((key): key is string => key != null && byKey.has(key)),
  );
  const chained = children.filter(
    (issue) => predecessorOf(issue) != null || hasDependent.has(flowKey(issue)),
  );
  const chainedKeys = new Set(chained.map(flowKey));
  const depthOf = (issue: BoardIssue): number => {
    let depth = 0;
    const seen = new Set<string>([flowKey(issue)]);
    let current = predecessorOf(issue);
    while (current != null && !seen.has(flowKey(current))) {
      seen.add(flowKey(current));
      current = predecessorOf(current);
      depth += 1;
    }
    return depth;
  };
  const steps = chained
    .map((issue) => ({
      issue,
      predecessor: predecessorOf(issue),
      depth: depthOf(issue),
    }))
    .sort(
      (left, right) =>
        left.depth - right.depth || left.issue.number - right.issue.number,
    );
  return {
    steps,
    independent: children.filter((issue) => !chainedKeys.has(flowKey(issue))),
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
  const progress = useMemo(() => epicProgress(issue), [issue]);
  return (
    <article
      aria-label={`${kindLabel(issue.kind)} #${issue.number} ${issue.title}`}
      className={`grid content-start gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] ${isBranch ? "ring-1 ring-[var(--color-primary-action)]" : ""}`}
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
        <OmittedNote issue={issue} />
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
  const childKeys = siblingKeys(node.children.map((child) => child.issue));
  return (
    <li className="relative grid">
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
                  key={childKeys[index]}
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
  const stepKeys = new Set(steps.map((step) => flowKey(step.issue)));
  const dependentsOf = new Map<string, BoardIssue[]>();
  for (const step of steps) {
    if (step.predecessor != null && stepKeys.has(flowKey(step.predecessor))) {
      const key = flowKey(step.predecessor);
      const list = dependentsOf.get(key) ?? [];
      list.push(step.issue);
      dependentsOf.set(key, list);
    }
  }
  const depthOf = new Map(steps.map((step) => [flowKey(step.issue), step.depth]));
  for (const list of dependentsOf.values()) {
    list.sort(
      (left, right) =>
        (depthOf.get(flowKey(left)) ?? 0) - (depthOf.get(flowKey(right)) ?? 0) ||
        left.number - right.number,
    );
  }
  const buildNode = (
    issue: BoardIssue,
    seen: Set<string>,
  ): FlowTreeNode => {
    const children = (dependentsOf.get(flowKey(issue)) ?? []).filter(
      (child) => !seen.has(flowKey(child)),
    );
    return {
      issue,
      children: children.map((child) =>
        buildNode(child, new Set([...seen, flowKey(child)])),
      ),
    };
  };
  let roots = steps
    .filter(
      (step) =>
        step.predecessor == null || !stepKeys.has(flowKey(step.predecessor)),
    )
    .map((step) => step.issue);
  if (roots.length === 0) {
    roots = steps.map((step) => step.issue);
  }
  const rendered = new Set<string>();
  const collect = (node: FlowTreeNode): void => {
    rendered.add(flowKey(node.issue));
    for (const child of node.children) {
      collect(child);
    }
  };
  const forest: FlowTreeNode[] = [];
  for (const root of roots) {
    if (rendered.has(flowKey(root))) {
      continue;
    }
    const node = buildNode(root, new Set([flowKey(root)]));
    collect(node);
    forest.push(node);
  }
  return forest;
}

function ForestList({
  forest,
  label,
}: {
  forest: FlowTreeNode[];
  label?: string;
}) {
  const rootKeys = siblingKeys(forest.map((root) => root.issue));
  return (
    <ol
      aria-label={label}
      className="m-0 grid list-none gap-0 p-0"
    >
      {forest.map((root, index) => (
        <FlowTreeRow
          key={rootKeys[index]}
          node={root}
          isLast={index === forest.length - 1}
          isRoot
        />
      ))}
    </ol>
  );
}

function FlowSteps({ steps, label }: { steps: FlowStep[]; label?: string }) {
  const forest = useMemo(() => buildForest(steps), [steps]);
  if (steps.length === 0) {
    return null;
  }
  return <ForestList forest={forest} label={label} />;
}

/** 형제 목록을 흐름(의존 연결)과 낱개로 나눠 그린다. 모든 깊이에 적용. */
function ChildList({
  issues,
  depth,
}: {
  issues: BoardIssue[];
  depth: number;
}) {
  const flow = useMemo(() => buildFlow(issues), [issues]);
  const ordered = useMemo(
    () =>
      [...flow.independent].sort(
        (left, right) =>
          STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status),
      ),
    [flow],
  );
  return (
    <div className="grid gap-[var(--space-1)]">
      <FlowSteps steps={flow.steps} />
      {siblingKeys(ordered).map((key, index) => (
        <LeafRow key={key} issue={ordered[index]} depth={depth} />
      ))}
    </div>
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
  const bodyId = useId();
  const progress = useMemo(() => epicProgress(issue), [issue]);
  const flow = useMemo(() => buildFlow(issue.children), [issue.children]);
  const groups = useMemo(
    () =>
      LAYER_GROUPS.map((layer) => ({
        layer,
        issues: flow.independent.filter((child) => child.layer === layer),
      })).filter((group) => group.issues.length > 0),
    [flow],
  );
  return (
    <article
      aria-label={`에픽 #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
    >
      <div className="grid gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            // 접힌 동안에는 본문이 DOM에 없으므로 가리키지 않는다.
            aria-controls={open ? bodyId : undefined}
            aria-label={`${issue.title} ${open ? "접기" : "펼치기"}`}
          >
            {open ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronRight aria-hidden="true" />
            )}
          </Button>
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
          <OmittedNote issue={issue} />
        </div>
        <ProgressBar progress={progress} />
      </div>
      {open ? (
        <div id={bodyId} className="grid gap-[var(--space-3)]">
          <FlowSteps steps={flow.steps} label={`${issue.title} 흐름 요약`} />
          {groups.map((group) => (
            <LayerGroup
              key={group.layer}
              name={layerName(group.layer)}
              issues={group.issues}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function ProjectTree({ issues }: { issues: BoardIssue[] }) {
  // 훅은 early return보다 앞에서 호출한다(훅 순서 규칙).
  const { epics, singles, singleFlow, loneSingles } = useMemo(() => {
    const safeIssues = sanitizeTree(issues);
    const epicList = safeIssues.filter((issue) => issue.children.length > 0);
    const singleList = safeIssues.filter((issue) => issue.children.length === 0);
    const flow = buildFlow(singleList);
    const stepKeys = new Set(flow.steps.map((step) => flowKey(step.issue)));
    return {
      epics: epicList,
      singles: singleList,
      singleFlow: flow,
      loneSingles: singleList.filter((issue) => !stepKeys.has(flowKey(issue))),
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
        아래 트리에서 순서와 갈래를 한눈에 볼 수 있습니다. 본문에{" "}
        <code>이전 단계: #N</code>을 적으면 흐름으로 이어서 보여줍니다.
        묶음 위·아래 순서는 진행 순서가 아닙니다.
      </p>
      {siblingKeys(epics).map((key, index) => (
        <EpicCard key={key} issue={epics[index]} defaultOpen={autoExpand} />
      ))}
      {singles.length > 0 ? (
        <section aria-labelledby="singles-heading">
          <h2 id="singles-heading" className="m-0 mb-[var(--space-3)]">단일 항목</h2>
          <FlowSteps steps={singleFlow.steps} label="단일 항목 흐름 요약" />
          <div className="grid gap-[var(--space-2)]">
            {siblingKeys(loneSingles).map((key, index) => {
              const issue = loneSingles[index];
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
                  <OmittedNote issue={issue} />
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
