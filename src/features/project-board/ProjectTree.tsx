import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import {
  layerName,
  statusName,
  type BoardIssue,
} from "@/features/project-board/model";

/** TreeNode 재귀 깊이 상한. ProjectPage의 MAX_WALK_DEPTH(50)와 맞춘다. */
const MAX_TREE_NODE_DEPTH = 50;

/** Project `타입` 필드 값 → 트리 역할명. 모르는 값은 원값을 그대로 보여준다. */
const KIND_ROLE: Record<string, string> = {
  기능: "스토리",
  작업: "태스크",
};

function roleLabel(depth: number, kind: string | null): string {
  if (depth === 0) {
    return "에픽";
  }
  if (depth === 1) {
    if (kind) {
      return KIND_ROLE[kind] ?? kind;
    }
    return "하위 항목";
  }
  return "서브태스크";
}

/** 외부 URL은 http(s)만 링크로 렌더한다. 캐시 변조·오염 응답의 javascript: 스킴 차단. */
function isSafeIssueUrl(url: string): boolean {
  try {
    const protocol = new URL(url.trim()).protocol.toLowerCase();
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function TreeNode({
  issue,
  depth,
}: {
  issue: BoardIssue;
  depth: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const role = roleLabel(depth, issue.kind);
  // 구 캐시에는 children이 없을 수 있고, 오염된 캐시는 깊게 중첩될 수 있다.
  const children = issue.children ?? [];
  if (depth > MAX_TREE_NODE_DEPTH) {
    return (
      <article
        aria-label={`${role} #${issue.number} ${issue.title}`}
        className="grid gap-[var(--space-2)]"
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="font-[number:var(--font-weight-control)]">
            {role} #{issue.number} {issue.title}
          </span>
          <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
          <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
            하위 항목 생략됨
          </span>
        </div>
      </article>
    );
  }

  return (
    <article
      aria-label={`${role} #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-2)]"
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        {children.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={`${issue.title} ${open ? "접기" : "펼치기"}`}
          >
            {open ? (
              <ChevronDown aria-hidden="true" />
            ) : (
              <ChevronRight aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <span className="font-[number:var(--font-weight-control)]">
          {isSafeIssueUrl(issue.url) ? (
            <a href={issue.url} target="_blank" rel="noreferrer noopener">
              {role} #{issue.number} {issue.title}
            </a>
          ) : (
            <span>
              {role} #{issue.number} {issue.title}
            </span>
          )}
        </span>
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
          {layerName(issue.layer)}
          {issue.kind ? ` · ${issue.kind}` : null}
        </span>
      </div>
      {open && children.length > 0 ? (
        <ul
          className="m-0 grid list-none gap-[var(--space-2)] pl-[var(--space-6)]"
          aria-label={`${issue.title} 하위 항목`}
        >
          {children.map((child) => (
            <li key={`${child.number}-${child.url}`}>
              <TreeNode issue={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
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
  return (
    <div
      className="grid gap-[var(--space-4)]"
      role="region"
      aria-label="계층 보기"
    >
      {issues.map((issue) => (
        <div
          key={`${issue.number}-${issue.url}`}
          className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
        >
          <TreeNode issue={issue} depth={0} />
        </div>
      ))}
    </div>
  );
}
