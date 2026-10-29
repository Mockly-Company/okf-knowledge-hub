import { memo, useState, type KeyboardEvent } from "react";
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
  safeHref,
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

function TreeNodeInner({
  issue,
  depth,
  path = new Set<string>(),
  setSize,
  posInSet,
  className,
}: {
  issue: BoardIssue;
  depth: number;
  /** 조상 경로 URL 집합. 순환 감지용으로 자식에게 스냅샷을 전달한다. */
  path?: Set<string>;
  /** 형제 집합 크기와 순서. treeitem의 aria-setsize/posinset에 쓴다. */
  setSize?: number;
  posInSet?: number;
  /** 루트 카드처럼 tree 구조 밖에 스타일 래퍼를 둘 수 없을 때 쓴다. */
  className?: string;
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
  // treeitem의 aria-label이 내부 콘텐츠를 가리므로 상태·레이어·타입을
  // 라벨에 포함해 스크린리더에 전달한다(뱃지 텍스트는 label 뒤에 가려진다).
  const itemLabel =
    `${role} #${issue.number} ${issue.title}, ` +
    `${statusName(issue.status)}, ${layerName(issue.layer)}` +
    (issue.kind ? `, ${issue.kind}` : "");
  // WAI-ARIA tree 패턴: treeitem은 레벨·펼침·집합 위치를 노출한다.
  // 펼침 토글은 포커스 가능한 Button이라 키보드 조작이 가능하다.
  const treeitemProps = {
    role: "treeitem" as const,
    "aria-level": depth + 1,
    "aria-expanded": children.length > 0 ? open : undefined,
    "aria-setsize": setSize,
    "aria-posinset": posInSet,
  };
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return (
      // article 대신 div: treeitem 안에 랜드마크가 중첩되면 스크린리더에 중복으로 읽힌다.
      <div
        aria-label={`${itemLabel}, 하위 항목 생략됨`}
        className="grid gap-[var(--space-2)]"
        {...treeitemProps}
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
      </div>
    );
  }

  // 트리 키보드 패턴(방향키 펼침/접기). 포커스 이동은 Tab 순서(토글 버튼·링크)를
  // 그대로 쓰고, treeitem 자체에는 tabIndex를 두지 않아 탭 정지를 늘리지 않는다.
  // 자식 노드의 Button/링크에서 발생한 키는 해당 노드의 핸들러에서만 처리하고
  // 조상까지 버블링되지 않게 한다(안 그러면 조상이 전부 닫히고 포커스가 사라진다).
  const handleTreeKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest('[role="treeitem"]');
    if (item !== event.currentTarget) {
      return;
    }
    if (children.length === 0) {
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    // article 대신 div: treeitem 안에 랜드마크가 중첩되면 스크린리더에 중복으로 읽힌다.
    // 루트 카드는 tree 직계 소유 구조를 깨지 않도록 treeitem 루트에 직접 입힌다.
    <div
      aria-label={itemLabel}
      className={className ?? "grid gap-[var(--space-2)]"}
      {...treeitemProps}
      onKeyDown={handleTreeKeys}
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
            const safeUrl = safeHref(issue.url);
            return safeUrl ? (
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
        {/* 백엔드 깊이 제한으로 잘린 노드는 펼침 버튼이 없어 리프로 보이므로,
            전역 배너와 별개로 해당 에픽 위치에 생략을 표시한다. */}
        {issue.childrenTruncated ? (
          <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
            하위 항목 생략됨
          </span>
        ) : null}
      </div>
      {open && children.length > 0 ? (
        <ul
          className="m-0 grid list-none gap-[var(--space-2)] pl-[var(--space-6)]"
          aria-label={`${issue.title} 하위 항목`}
          role="group"
        >
          {children.map((child, index) => (
            // 키는 trim 기준 issueKey와 number를 우선하고, 동일 URL 형제 중복에
            // 대비해 index를 최후 fallback으로 붙인다(중복 key 경고 방지).
            <li key={`${issueKey(child)}#${child.number}-${index}`} role="presentation">
              <TreeNode
                issue={child}
                depth={depth + 1}
                path={childPath}
                setSize={children.length}
                posInSet={index + 1}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 무관한 상태 변경(새로고침 시간 등)으로 부모가 리렌더돼도 같은 위치의
 * 같은 이슈 노드는 다시 렌더하지 않는다. path도 내용 기준으로 비교한다:
 * 순환·공유 노드는 위치(조상 경로)에 따라 렌더 결과가 달라지므로
 * path를 무시하면 오판한다. 집합 복사를 피하려고 크기·포함 여부만 본다.
 */
function samePath(a?: Set<string>, b?: Set<string>): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.size !== b.size) {
    return false;
  }
  for (const key of a) {
    if (!b.has(key)) {
      return false;
    }
  }
  return true;
}

const TreeNode = memo(
  TreeNodeInner,
  (prev, next) =>
    prev.issue === next.issue &&
    prev.depth === next.depth &&
    prev.setSize === next.setSize &&
    prev.posInSet === next.posInSet &&
    prev.className === next.className &&
    samePath(prev.path, next.path),
);

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
      role="tree"
      aria-label="계층 보기"
    >
      {safeIssues.map((issue, index) => (
        <TreeNode
          key={`${issueKey(issue)}#${issue.number}-${index}`}
          issue={issue}
          depth={0}
          setSize={safeIssues.length}
          posInSet={index + 1}
          className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
        />
      ))}
    </div>
  );
}
