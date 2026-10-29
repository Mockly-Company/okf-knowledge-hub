import type { BoardIssue, BoardLayer, BoardStatus } from "./model";
import { BOARD_LAYERS, BOARD_STATUSES } from "./model";

const LAYER_SET: ReadonlySet<string> = new Set(
  BOARD_LAYERS.map((layer) => layer.id as string),
);
const STATUS_SET: ReadonlySet<string> = new Set(
  BOARD_STATUSES.map((status) => status.id as string),
);

/** 프론트 재귀 깊이 상한. 백엔드 MAX_TREE_DEPTH(10)보다 여유 있게 둔다. */
export const MAX_ISSUE_TREE_DEPTH = 50;

/**
 * 렌더에 쓸 안전한 href를 돌려준다. 검증과 렌더에 같은 값을 써야
 * 앞뒤 공백 오염 시 링크가 깨지거나 검증과 동작이 달라지지 않는다.
 * GitHub Issue URL만 쓰이는 맥락이므로 https + github.com 호스트만 허용한다.
 * (혼합 콘텐츠·임의 호스트 피싱 표면 축소. 그 외는 텍스트로 폴백.)
 * 비문자열 오염 입력에도 throw 없이 null을 돌려준다.
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol.toLowerCase() !== "https:") {
      return null;
    }
    // userinfo가 있으면 사용자 확인 없이 자격증명이 새나갈 수 있으므로 거부한다.
    // (예: https://id:pw@github.com/... → github.com으로 가지만 정보가 노출됨)
    if (parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    // 서브도메인 와일드카드까지 허용하면 피싱 표면이 넓어지므로,
    // Issue URL 호스트(github.com)와 정확히 일치할 때만 허용한다.
    if (parsed.hostname.toLowerCase() !== "github.com") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/** 이슈 식별 키. 백엔드 visiting/path(url 기준)와 일치시킨다.
 * 오염 입력에도 throw하지 않는다(비문자열 url은 빈 문자열로 취급). */
export function issueKey(issue: unknown): string {
  const url = (issue as { url?: unknown } | null | undefined)?.url;
  return typeof url === "string" ? url.trim() : "";
}

/**
 * 재귀 경로 집합에 키를 추가하고 정리 함수를 반환한다.
 * 이미 경로상에 있으면(순환) null을 반환해 건너뛰도록 한다.
 * 호출자는 사용 후 반드시 정리 함수를 호출해 형제 브랜치와 공유한다(push/pop 백트래킹).
 */
export function enterPath(
  path: Set<string>,
  key: string,
): (() => void) | null {
  if (path.has(key)) {
    return null;
  }
  path.add(key);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      path.delete(key);
    }
  };
}

/** 런타임에 외부 입력(캐시·API 응답)이 섞여 들어올 수 있어 형태를 검증한다. */
export function isIssueLike(value: unknown): value is BoardIssue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.number === "number" &&
    Number.isInteger(candidate.number) &&
    candidate.number >= 0 &&
    typeof candidate.url === "string" &&
    candidate.url.trim().length > 0 &&
    typeof candidate.title === "string" &&
    LAYER_SET.has(candidate.layer as BoardLayer) &&
    STATUS_SET.has(candidate.status as BoardStatus)
    // kind는 표시용 힌트라 여기서 검증하지 않는다. 오염값은 정규화 단계에서
    // null로 강제한다(하나의 오염 필드 때문에 이슈 전체를 버리지 않는다).
  );
}

/** 오염된 캐시의 비배열·비객체 원소는 버리고 유효한 이슈만 남긴다. */
export function asIssueArray(value: unknown): BoardIssue[] {
  return Array.isArray(value) ? value.filter(isIssueLike) : [];
}
