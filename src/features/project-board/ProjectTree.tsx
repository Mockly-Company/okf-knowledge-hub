import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import {
  layerName,
  statusName,
  type BoardIssue,
} from "@/features/project-board/model";

function roleLabel(depth: number, kind: string | null): string {
  if (depth === 0) {
    return "에픽";
  }
  if (depth === 1) {
    if (kind === "기능") {
      return "스토리";
    }
    if (kind === "작업") {
      return "태스크";
    }
    return "하위 항목";
  }
  return "서브태스크";
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

  return (
    <article
      aria-label={`${role} #${issue.number} ${issue.title}`}
      className="grid gap-[var(--space-2)]"
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        {issue.children.length > 0 ? (
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
          <a href={issue.url} target="_blank" rel="noreferrer">
            {role} #{issue.number} {issue.title}
          </a>
        </span>
        <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
        <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
          {layerName(issue.layer)}
          {issue.kind ? ` · ${issue.kind}` : null}
        </span>
      </div>
      {open && issue.children.length > 0 ? (
        <ul
          className="m-0 grid list-none gap-[var(--space-2)] pl-[var(--space-6)]"
          aria-label={`${issue.title} 하위 항목`}
        >
          {issue.children.map((child) => (
            <li key={child.url}>
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
          key={issue.url}
          className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
        >
          <TreeNode issue={issue} depth={0} />
        </div>
      ))}
    </div>
  );
}
