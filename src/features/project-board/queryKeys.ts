/**
 * 프로젝트 보드 도메인 React Query 키.
 * - linkedProjects: 사이드바용 연결 목록
 * - board(projectId): 프로젝트별 보드. null 키는 disabled 쿼리용(조회 안 함).
 * - LEGACY_BOARD_ID: provider 없이 렌더되는 기존 화면용. 백엔드 단일
 *   프로젝트 경로를 그대로 쓴다.
 */
export const LEGACY_BOARD_ID = "legacy";

export const projectBoardKeys = {
  all: ["projectBoard"] as const,
  linkedProjects: ["projectBoard", "linkedProjects"] as const,
  board: (projectId: string | null) =>
    ["projectBoard", "board", projectId] as const,
};
