import type { ProjectBoard, ResolvedGithubProject } from "./model";

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
  resolveGithubProject(url: string): Promise<ResolvedGithubProject>;
  linkGithubProject(project: ResolvedGithubProject): Promise<void>;
}
