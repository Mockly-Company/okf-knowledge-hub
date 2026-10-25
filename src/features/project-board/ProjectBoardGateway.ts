import type { ProjectBoard, ResolvedGithubProject } from "./model";

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
  syncProjectBoard(): Promise<ProjectBoard>;
  resolveGithubProject(url: string): Promise<ResolvedGithubProject>;
  listGithubProjects(): Promise<ResolvedGithubProject[]>;
  linkGithubProject(project: ResolvedGithubProject): Promise<void>;
}
