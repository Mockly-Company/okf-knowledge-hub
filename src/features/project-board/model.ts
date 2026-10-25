export type BoardLayer =
  | "planning"
  | "design"
  | "frontend"
  | "backend"
  | "unassigned";

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
  /** 하위 이슈(스토리·태스크의 자식). 없으면 빈 배열. */
  children: BoardIssue[];
  /** 프로젝트 `타입` 필드 값(예: 기능, 작업). 없으면 null. */
  kind: string | null;
}

export interface ProjectBoard {
  issues: BoardIssue[];
  /** 마지막으로 GitHub에서 가져온 시각(RFC 3339). 아직 없으면 null. */
  fetchedAt: string | null;
}

export interface ResolvedGithubProject {
  id: string;
  owner: string;
  number: number;
  title: string;
  scope: "organization" | "user";
}

export const BOARD_LAYERS: ReadonlyArray<{
  id: BoardLayer;
  name: string;
  label?: string;
}> = [
  { id: "planning", name: "기획", label: "layer:planning" },
  { id: "design", name: "디자인", label: "layer:design" },
  { id: "frontend", name: "프론트엔드", label: "layer:frontend" },
  { id: "backend", name: "백엔드", label: "layer:backend" },
  { id: "unassigned", name: "미지정" },
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
