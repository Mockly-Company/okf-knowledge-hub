import type {
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
} from "./model";

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
  syncProjectBoard(): Promise<ProjectBoard>;
  resolveGithubProject(url: string): Promise<ResolvedGithubProject>;
  listGithubProjects(): Promise<ProjectList>;
  linkGithubProject(project: ResolvedGithubProject): Promise<void>;
}
