import { memo, useCallback, useId, useState, type KeyboardEvent } from "react";
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

/**
 * 동일 URL·number 형제(다이아몬드 공유·오염 중복)에 안정적인 키를 부여한다.
 * 전체 index를 쓰면 순서 변경 시 펼침 상태가 엇갈리므로, 같은 base가
 * 형제 안에서 몇 번째로 등장하는지만 접미사로 붙인다(고유 항목은 위치와 무관).
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

const TreeNode = memo(
  function TreeNode({
    issue,
    depth,
    path = new Set<string>(),
    setSize,
    posInSet,
    className,
    focusedKey,
    onFocusKey,
  }: {
    issue: BoardIssue;
    depth: number;
    /** 조상 경로 URL 집합. 순환 감지용으로 자식에게 스냅샷을 전달한다. */
    path?: Set<string>;
    /** 형제 집합 크기와 순서. treeitem의 aria-setsize/posinset에 쓴다. */
    setSize?: number;
    posInSet?: number;
    /** roving 포커스 식별자. 위치+URL 조합으로 다이아몬드 중복 URL을 구분한다. */
    focusId?: string;
    /** 루트 카드처럼 tree 구조 밖에 스타일 래퍼를 둘 수 없을 때 쓴다. */
    className?: string;
    /** 현재 roving 포커스가 있는 노드 키. Tab 정지는 이 노드에만 둔다. */
    focusedKey?: string | null;
    /** 포커스를 받은 노드 키를 올린다. useCallback 안정 참조를 전달한다. */
    onFocusKey?: (key: string) => void;
  }) {
  const [open, setOpen] = useState(depth === 0);
  // useId는 early return보다 앞에서 호출한다(훅 순서 규칙).
  const titleId = useId();
  const descId = useId();
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
  // roving 식별자는 위치(깊이·형제 순서)+경로 조합으로 만든다. 같은 URL이
  // 다이아몬드로 중복 렌더돼도 서로 다른 노드로 구분돼 Tab 정지가 겹치지 않는다.
  const focusId = `${depth}:${posInSet ?? 0}:${[...childPath].join(">")}`;
  /** roving tabindex: Tab 정지는 포커스 중인 노드 하나에만 둔다.
   * 초기값(포커스 없음)은 첫 루트에 둔다. 화살표·포커스 이동 시 갱신된다. */
  const focused =
    focusedKey === undefined || focusedKey === null
      ? depth === 0 && posInSet === 1
      : focusedKey === focusId;
  const handleFocus = () => {
    if (focusedKey !== focusId) {
      onFocusKey?.(focusId);
    }
  };
  const role = roleLabel(depth, issue.kind);
  // 구 캐시에는 children이 없을 수 있고, 오염된 캐시는 비배열일 수 있다.
  const children = asIssueArray(issue.children);
  // treeitem의 이름은 콘텐츠에서 유도하고, 상태·레이어·타입 보충 정보는
  // aria-labelledby로 연결된 설명에서 전달한다.
  // (aria-label을 직접 주면 내부 토글 Button·링크 이름이 가려진다.)
  const description =
    `상태: ${statusName(issue.status)}, 영역: ${layerName(issue.layer)}` +
    (issue.kind ? `, 유형: ${issue.kind}` : "") +
    (issue.childrenTruncated ? ", 하위 항목 생략됨" : "");
  // WAI-ARIA tree 패턴: treeitem은 레벨·펼침·집합 위치를 노출한다.
  // 펼침 토글은 포커스 가능한 Button이라 키보드 조작이 가능하다.
  // roving 포커스 진입점(첫 루트)만 Tab 순서에 넣고 나머지는 -1로 둔다.
  const treeitemProps = {
    role: "treeitem" as const,
    "aria-level": depth + 1,
    "aria-expanded": children.length > 0 ? open : undefined,
    "aria-setsize": setSize,
    "aria-posinset": posInSet,
    "aria-labelledby": `${titleId} ${descId}`,
    tabIndex: focused ? 0 : -1,
  };
  // 트리 키보드 패턴(방향키 펼침/접기 + 이동). 포커스 이동은 roving tabindex를
  // 갱신하고, treeitem 자체에는 tabIndex를 두지 않아 탭 정지를 늘리지 않는다.
  // 자식 노드의 Button/링크에서 발생한 키는 해당 노드의 핸들러에서만 처리하고
  // 조상까지 버블링되지 않게 한다(안 그러면 조상이 전부 닫히고 포커스가 사라진다).
  // 절단 플레이스홀더 분기보다 위에 정의해 해당 노드에서도 방향키 탐색이 끊기지 않게 한다.
  const handleTreeKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest('[role="treeitem"]');
    if (item !== event.currentTarget) {
      return;
    }
    // 같은 트리 안의 treeitem을 DOM 순서대로 모아 roving 포커스를 이동하고,
    // 이동한 노드를 Tab 정지로 승격한다.
    const moveFocus = (delta: number) => {
      const tree = event.currentTarget.closest('[role="tree"]');
      if (!tree) {
        return;
      }
      const items = Array.from(
        tree.querySelectorAll('[role="treeitem"]'),
      );
      const at = items.indexOf(event.currentTarget);
      const next = items[(at + delta + items.length) % items.length] as
        | HTMLElement
        | undefined;
      next?.focus();
    };
    const focusEdge = (edge: "first" | "last") => {
      const tree = event.currentTarget.closest('[role="tree"]');
      if (!tree) {
        return;
      }
      const items = tree.querySelectorAll('[role="treeitem"]');
      const target =
        edge === "first" ? items.item(0) : items.item(items.length - 1);
      (target as HTMLElement | null)?.focus();
    };
    switch (event.key) {
      case "ArrowRight":
        if (children.length > 0) {
          event.preventDefault();
          setOpen(true);
        }
        break;
      case "ArrowLeft":
        if (children.length > 0) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        focusEdge("first");
        break;
      case "End":
        event.preventDefault();
        focusEdge("last");
        break;
      case "Enter":
      case " ":
        // 포커스가 treeitem 자체에 있을 때만 토글한다.
        // Button/링크에 포커스가 있으면 네이티브 동작에 맡긴다.
        if (event.target === event.currentTarget && children.length > 0) {
          event.preventDefault();
          setOpen((value) => !value);
        }
        break;
      default:
        break;
    }
  };
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return (
      // article 대신 div: treeitem 안에 랜드마크가 중첩되면 스크린리더에 중복으로 읽힌다.
      <div
        className="grid gap-[var(--space-2)]"
        {...treeitemProps}
        onFocus={handleFocus}
        onKeyDown={handleTreeKeys}
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span id={titleId} className="font-medium">
            {role} #{issue.number} {issue.title}
          </span>
          <span id={descId} className="sr-only">
            {description}
          </span>
          <StatusBadge tone="neutral">{statusName(issue.status)}</StatusBadge>
          <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
            하위 항목 생략됨
          </span>
        </div>
      </div>
    );
  }

  // 자식 노드의 Button/링크에서 발생한 키는 해당 노드의 핸들러에서만 처리하고
  // 조상까지 버블링되지 않게 한다(안 그러면 조상이 전부 닫히고 포커스가 사라진다).
  return (
    // article 대신 div: treeitem 안에 랜드마크가 중첩되면 스크린리더에 중복으로 읽힌다.
    // 루트 카드는 tree 직계 소유 구조를 깨지 않도록 treeitem 루트에 직접 입힌다.
    // 이름은 콘텐츠에서 유도하고 보충 정보는 aria-labelledby로 연결한다.
    // (aria-label을 직접 주면 내부 토글 Button·링크 이름이 가려진다.)
    <div
      className={className ?? "grid gap-[var(--space-2)]"}
      {...treeitemProps}
      onKeyDown={handleTreeKeys}
      onFocus={handleFocus}
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
        <span id={titleId} className="font-medium">
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
        <span id={descId} className="sr-only">
          {description}
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
          {siblingKeys(children).map((childKey, index) => {
            const child = children[index];
            return (
              <li key={childKey} role="presentation">
                <TreeNode
                  issue={child}
                  depth={depth + 1}
                  path={childPath}
                  setSize={children.length}
                  posInSet={index + 1}
                  focusedKey={focusedKey}
                  onFocusKey={onFocusKey}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
  },
  (prev, next) =>
    prev.issue === next.issue &&
    prev.depth === next.depth &&
    prev.setSize === next.setSize &&
    prev.posInSet === next.posInSet &&
    prev.className === next.className &&
    prev.focusedKey === next.focusedKey &&
    prev.onFocusKey === next.onFocusKey &&
    samePath(prev.path, next.path),
);

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


export function ProjectTree({ issues }: { issues: BoardIssue[] }) {
  // hideDone=false 등 정규화를 우회하는 경로에서도 안전하도록 최상위도 검증한다.
  const safeIssues = asIssueArray(issues);
  // roving tabindex 상태: Tab 정지는 포커스 중인 노드 하나에만 둔다.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const handleFocusKey = useCallback((key: string) => {
    setFocusKey((current) => (current === key ? current : key));
  }, []);
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
      {siblingKeys(safeIssues).map((rootKey, index) => (
        <TreeNode
          key={rootKey}
          issue={safeIssues[index]}
          depth={0}
          setSize={safeIssues.length}
          posInSet={index + 1}
          className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
          focusedKey={focusKey}
          onFocusKey={handleFocusKey}
        />
      ))}
    </div>
  );
}
