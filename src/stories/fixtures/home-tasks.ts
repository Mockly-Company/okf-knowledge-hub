import type { HomeTaskData, HomeTaskState, IssueTask, ReviewTask, ProjectStatusTone } from "@/pages/home/HomeTasks";
import { analyzeHomeProject, type HomeInsightData, type ProjectAnalysisSource } from "@/pages/home/HomeInsights";

/** Storybook-only GitHub snapshot; URLs identify examples, not live data. */
const asOf = "2026-10-22T15:00:00Z";
const repository = "Mockly-Company/okf-knowledge-hub";
const issueRepository = "mockly/product";
const projectStatuses: { id: string; projectStatus: string; projectStatusTone: ProjectStatusTone; inProgress: boolean }[] = [
  { id: "in-progress", projectStatus: "In progress", projectStatusTone: "primary", inProgress: true },
  { id: "backlog", projectStatus: "Backlog", projectStatusTone: "neutral", inProgress: false },
  { id: "ready", projectStatus: "Ready", projectStatusTone: "info", inProgress: false },
  { id: "in-review", projectStatus: "In review", projectStatusTone: "warning", inProgress: false },
];
const titles = [
  "문서 검색 결과의 키보드 탐색과 스크린 리더 안내를 개선하고 접근성 회귀 테스트 기준을 정의합니다",
  "초대 링크 만료 정책", "알림 설정 API 계약", "파일 업로드 예외 처리",
  "계정 권한 변경 정책", "문서 이력 조회 성능", "검색 인덱스 복구 절차",
];
const reviews: ReviewTask[] = [
  { id: "map-search-review", title: "지도 검색 API 계약", repository, number: 42, requester: "Kim", requestedAt: "2026-10-14T01:10:00Z", updatedAt: "2026-10-21T01:10:00Z" },
  ...titles.map((title, index) => ({ id: `review-many-${index}`, title, repository, number: 43 + index, requester: "Kim", requestedAt: `2026-10-${15 + index}T01:00:00Z`, updatedAt: `2026-10-${String(Math.max(20 - index, 15 + index)).padStart(2, "0")}T02:00:00Z` })),
];
type ExampleIssue = IssueTask & { projectStatusId: string };
const issue = (number: number, title: string, status: typeof projectStatuses[number], dueDate: string | undefined, updatedAt: string, id = `issue-${number}`): ExampleIssue => ({
  id, title, repository: issueRepository, number, url: `https://github.com/${issueRepository}/issues/${number}`,
  projectStatusId: status.id, projectStatus: status.projectStatus, projectStatusTone: status.projectStatusTone, dueDate, updatedAt,
});
const issues: ExampleIssue[] = [
  issue(28, "문서 검색 결과에 키보드 탐색 추가", projectStatuses[0], "2026-10-21", "2026-10-14T01:00:00Z"),
  issue(31, "초대 링크 만료와 재발급 흐름 정리", projectStatuses[1], "2026-10-24", "2026-10-20T07:40:00Z"),
  ...titles.map((title, index) => issue(32 + index, title, projectStatuses[(index + 2) % projectStatuses.length], index === 6 ? undefined : `2026-10-${25 + index}`, `2026-10-${String(19 - index).padStart(2, "0")}T01:00:00Z`, `issue-many-${index}`)),
];
const completed: ProjectAnalysisSource["completed"] = [
  { id: "merged-38", kind: "pr", title: "문서 업로드 오류 처리 정책", repository, number: 38, url: `https://github.com/${repository}/pull/38`, completedAt: "2026-10-21T01:00:00Z" },
  { id: "closed-24", kind: "issue", title: "초대 링크 만료 안내 개선", repository: issueRepository, number: 24, url: `https://github.com/${issueRepository}/issues/24`, completedAt: "2026-10-20T01:00:00Z" },
  { id: "merged-39", kind: "pr", title: "사용자 알림 설정 API", repository, number: 39, url: `https://github.com/${repository}/pull/39`, completedAt: "2026-10-19T01:00:00Z" },
];

export function homeInsightExample(status: HomeTaskState = "ready"): HomeInsightData {
  const empty = status === "empty";
  const inProgressStatusIds = new Set(projectStatuses.filter(status => status.inProgress).map(status => status.id));
  const result = analyzeHomeProject({
    projectName: "Mockly 제품 개발", asOf, complete: true,
    pendingReviews: empty ? [] : reviews.map(review => ({ ...review, requestedAt: review.requestedAt!, url: `https://github.com/${review.repository}/pull/${review.number}` })),
    inProgressIssues: empty ? [] : issues.filter(issue => inProgressStatusIds.has(issue.projectStatusId)),
    completed: empty ? [] : completed.map(item => ({ ...item })),
  });
  return { ...result, status: empty ? "ready" : status };
}

export function homeTaskExample(status: HomeTaskState = "ready", listSize: "few" | "many" = "few"): HomeTaskData {
  // "few" previews a shorter personal list; project analysis always uses the full snapshot.
  return {
    status, updatedAt: asOf,
    reviews: reviews.slice(0, listSize === "few" ? 1 : undefined).map(item => ({ ...item })),
    issues: issues.slice(0, listSize === "few" ? 2 : undefined).map(({ projectStatusId: _id, ...item }) => ({ ...item })),
  };
}

export const homeListSizeControl = { name: "홈 항목 수", options: ["few", "many"], control: { type: "radio" as const, labels: { few: "기본", many: "항목 많음" } } };
export const homeStateControl = {
  name: "홈 목록 상태",
  options: ["ready", "empty", "loading", "error", "stale"],
  control: { type: "select" as const, labels: { ready: "정상", empty: "빈 목록", loading: "로딩", error: "조회 실패", stale: "오래된 캐시" } },
};
