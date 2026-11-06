import type {
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
} from "./model";

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
  syncProjectBoard(): Promise<ProjectBoard>;
  resolveGithubProject(url: string): Promise<ResolvedGithubProject>;
  /** owner(Org 로그인)가 있으면 해당 소유자로 필터, 없으면 전체 목록. */
  listGithubProjects(owner?: string): Promise<ProjectList>;
  linkGithubProject(project: ResolvedGithubProject): Promise<void>;
  /**
   * 연결된 프로젝트 중 활성 프로젝트를 바꾼다.
   * 백엔드 lane 작업 중이라 없을 수 있어 optional — 호출자는
   * linkGithubProject 폴백을 쓴다.
   */
  setActiveProject?(id: string): Promise<void>;
  /** 연결된 프로젝트를 해제한다. 백엔드 lane 작업 중이라 optional. */
  unlinkGithubProject?(id: string): Promise<void>;
  /** 사이드바용 연결된 프로젝트 목록. 없으면 listGithubProjects 폴백. 실패 시 [] 취급. */
  listLinkedProjects?(): Promise<ResolvedGithubProject[]>;
}
