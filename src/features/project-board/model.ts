export type BoardLayer = "planning" | "design" | "frontend" | "backend";

export type BoardStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done";

export interface BoardIssue {
  number: number;
  title: string;
  url: string;
  layer: BoardLayer;
  status: BoardStatus;
}

export interface ProjectBoard {
  issues: BoardIssue[];
  /** 마지막으로 GitHub에서 가져온 시각(RFC 3339). 아직 없으면 null. */
  fetchedAt: string | null;
  /** 레이어/상태를 판별할 수 없어 제외한 항목 수. */
  skipped: number;
  /** 페이지 상한에 걸려 일부 항목을 가져오지 못했는지 여부. */
  truncated: boolean;
}

export interface ResolvedGithubProject {
  id: string;
  owner: string;
  number: number;
  title: string;
  scope: "organization" | "user";
}

/** 연결 후보 Project 목록과 잘림 여부. */
export interface ProjectList {
  projects: ResolvedGithubProject[];
  truncated: boolean;
}

export const BOARD_LAYERS: ReadonlyArray<{
  id: BoardLayer;
  name: string;
  label: string;
}> = [
  { id: "planning", name: "기획", label: "layer:planning" },
  { id: "design", name: "디자인", label: "layer:design" },
  { id: "frontend", name: "프론트엔드", label: "layer:frontend" },
  { id: "backend", name: "백엔드", label: "layer:backend" },
];

export const BOARD_STATUSES: ReadonlyArray<{
  id: BoardStatus;
  name: string;
}> = [
  { id: "backlog", name: "Backlog" },
  { id: "ready", name: "Ready" },
  { id: "in_progress", name: "In progress" },
  { id: "in_review", name: "In review" },
  { id: "done", name: "Done" },
];

export function layerName(layer: BoardLayer): string {
  return BOARD_LAYERS.find((entry) => entry.id === layer)?.name ?? layer;
}

export function statusName(status: BoardStatus): string {
  return BOARD_STATUSES.find((entry) => entry.id === status)?.name ?? status;
}
