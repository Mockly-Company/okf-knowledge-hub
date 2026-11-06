import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
} from "@/features/project-board/model";

export class FakeProjectBoardGateway implements ProjectBoardGateway {
  readonly calls: Array<
    | { method: "getProjectBoard" }
    | { method: "syncProjectBoard" }
    | { method: "resolveGithubProject"; url: string }
    | { method: "listGithubProjects"; owner?: string }
    | { method: "listLinkedProjects" }
    | { method: "linkGithubProject"; project: ResolvedGithubProject }
    | { method: "setActiveProject"; id: string }
    | { method: "unlinkGithubProject"; id: string }
  > = [];

  projectList: ResolvedGithubProject[] | Error = [
    {
      id: "PVT_kwDOFake",
      owner: "Mockly-Company",
      number: 1,
      title: "Mockly",
      scope: "organization",
    },
  ];

  /** 사이드바용 연결된 프로젝트 목록. 비어 있으면 None(로컬)만 표시. */
  linkedProjects: ResolvedGithubProject[] = [];

  /** 프로젝트별 보드. 있으면 get/sync가 activeProjectId 기준으로 반환한다. */
  readonly boardsByProjectId = new Map<string, ProjectBoard>();

  listTruncated = false;

  /** 마지막으로 연결·전환된 프로젝트 id. Org 스위처 뼈대용 상태. */
  activeProjectId: string | null = null;

  resolveResult: ResolvedGithubProject | Error = {
    id: "PVT_kwDOFake",
    owner: "Mockly-Company",
    number: 1,
    title: "Mockly Board",
    scope: "organization",
  };

  loadError: Error | null = null;

  constructor(public board: ProjectBoard = { issues: [], fetchedAt: null, skipped: 0, truncated: false }) {}

  static empty(): FakeProjectBoardGateway {
    return new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
  }

  static withIssues(issues: BoardIssue[], fetchedAt: string | null = null) {
    return new FakeProjectBoardGateway({ issues, fetchedAt, skipped: 0, truncated: false });
  }

  private boardResult:
    | ProjectBoard
    | { code: string; message: string; details?: Record<string, string> }
    | null = null;

  static unlinked(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_invalid",
      message: "GitHub Project가 연결되지 않았습니다.",
    };
    return gateway;
  }

  static missingWorkspace(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_missing",
      message: "워크스페이스가 연결되지 않았습니다.",
    };
    return gateway;
  }

  static corruptWorkspaceFile(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_invalid",
      message: "워크스페이스 파일을 읽을 수 없습니다.",
      details: { reason: "workspace_file_unreadable", path: ".okf/workspace.yml" },
    };
    return gateway;
  }

  async getProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "getProjectBoard" });
    if (this.loadError) {
      throw this.loadError;
    }
    if (this.activeProjectId) {
      const perProject = this.boardsByProjectId.get(this.activeProjectId);
      if (perProject) {
        return perProject;
      }
    }
    const current = this.boardResult ?? this.board;
    if ("code" in current) {
      throw current;
    }
    return current;
  }

  async syncProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "syncProjectBoard" });
    if (this.loadError) {
      throw this.loadError;
    }
    if (this.activeProjectId) {
      const perProject = this.boardsByProjectId.get(this.activeProjectId);
      if (perProject) {
        return perProject;
      }
    }
    const current = this.boardResult ?? this.board;
    if ("code" in current) {
      throw current;
    }
    return current;
  }

  async resolveGithubProject(url: string): Promise<ResolvedGithubProject> {
    this.calls.push({ method: "resolveGithubProject", url });
    if (this.resolveResult instanceof Error) {
      throw this.resolveResult;
    }
    return this.resolveResult;
  }

  async listGithubProjects(owner?: string): Promise<ProjectList> {
    this.calls.push({ method: "listGithubProjects", owner });
    if (this.projectList instanceof Error) {
      throw this.projectList;
    }
    return { projects: this.projectList, truncated: this.listTruncated };
  }

  async listLinkedProjects(): Promise<ResolvedGithubProject[]> {
    this.calls.push({ method: "listLinkedProjects" });
    return [...this.linkedProjects];
  }

  async linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    this.calls.push({ method: "linkGithubProject", project });
    this.activeProjectId = project.id;
    this.boardResult = this.board;
  }

  async setActiveProject(id: string): Promise<void> {
    this.calls.push({ method: "setActiveProject", id });
    this.activeProjectId = id;
    this.boardResult = this.board;
  }

  async unlinkGithubProject(id: string): Promise<void> {
    this.calls.push({ method: "unlinkGithubProject", id });
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
    }
  }
}
