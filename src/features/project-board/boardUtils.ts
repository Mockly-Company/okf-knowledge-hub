import type { BoardIssue } from "./model";

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
    typeof candidate.layer === "string" &&
    typeof candidate.status === "string"
  );
}

/** 오염된 캐시의 비배열·비객체 원소는 버리고 유효한 이슈만 남긴다. */
export function asIssueArray(value: unknown): BoardIssue[] {
  return Array.isArray(value) ? value.filter(isIssueLike) : [];
}
