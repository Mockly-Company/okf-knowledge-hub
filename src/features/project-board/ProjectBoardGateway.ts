import type { ProjectBoard } from "./model";

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
}
