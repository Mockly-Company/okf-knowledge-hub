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

/** 런타임에 외부 입력(캐시·API 응답)이 섞여 들어올 수 있어 형태를 검증한다. */
export function isIssueLike(value: unknown): value is BoardIssue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.number === "number" &&
    typeof candidate.url === "string" &&
    typeof candidate.title === "string" &&
    LAYER_SET.has(candidate.layer as BoardLayer) &&
    STATUS_SET.has(candidate.status as BoardStatus) &&
    (candidate.kind == null || typeof candidate.kind === "string")
  );
}

/** 오염된 캐시의 비배열·비객체 원소는 버리고 유효한 이슈만 남긴다. */
export function asIssueArray(value: unknown): BoardIssue[] {
  return Array.isArray(value) ? value.filter(isIssueLike) : [];
}
