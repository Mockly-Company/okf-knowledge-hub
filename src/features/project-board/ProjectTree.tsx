import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import {
  layerName,
  statusName,
  type BoardIssue,
} from "@/features/project-board/model";

import {
  MAX_ISSUE_TREE_DEPTH,
  asIssueArray,
  isIssueLike,
  issueKey,
} from "@/features/project-board/boardUtils";


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
  path = new Set<string>(),
}: {
  issue: BoardIssue;
  depth: number;
  /** 조상 경로 URL 집합. 순환 감지용으로 자식에게 스냅샷을 전달한다. */
  path?: Set<string>;
}) {
  const [open, setOpen] = useState(depth === 0);
  // 비객체 원소가 렌더까지 오면 여기서 걸러낸다(TreeNode는 배열 가드 뒤단이다).
  if (!isIssueLike(issue)) {
    return null;
  }
  // URL 사이클 오염 캐시(A→B→A' 등)에 대비해 경로상 중복은 렌더하지 않는다.
  // React에서는 자식 컴포넌트 함수가 부모 반환 후에 실행되므로 공유 집합의
  // push/pop 타이밍이 맞지 않아, 렌더되는 노드에만 스냅샷을 복사해 전달한다.
  // walkIssues(데이터 집계 쪽)는 동기 제너레이터라 백트래킹을 유지한다.
  const key = issueKey(issue);
  if (path.has(key)) {
    return null;
  }
  const childPath = new Set(path);
  childPath.add(key);
  const role = roleLabel(depth, issue.kind);
  // 구 캐시에는 children이 없을 수 있고, 오염된 캐시는 비배열일 수 있다.
  const children = asIssueArray(issue.children);
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return (
      <article
        aria-label={`${role} #${issue.number} ${issue.title}`}
        className="grid gap-[var(--space-2)]"
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="font-medium">
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
        <span className="font-medium">
          {(() => {
            // 검증과 렌더에 같은 값을 쓴다. trim하지 않은 원본을 href에 넣으면
            // 앞뒤 공백 오염 시 링크가 깨지거나 검증과 동작이 달라진다.
            const safeUrl = issue.url.trim();
            return isSafeIssueUrl(safeUrl) ? (
              <a href={safeUrl} target="_blank" rel="noreferrer noopener">
                {role} #{issue.number} {issue.title}
              </a>
            ) : (
              <span>
                {role} #{issue.number} {issue.title}
              </span>
            );
          })()}
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
              <TreeNode issue={child} depth={depth + 1} path={childPath} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function ProjectTree({ issues }: { issues: BoardIssue[] }) {
  // hideDone=false 등 정규화를 우회하는 경로에서도 안전하도록 최상위도 검증한다.
  const safeIssues = asIssueArray(issues);
  if (safeIssues.length === 0) {
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
      {safeIssues.map((issue) => (
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
