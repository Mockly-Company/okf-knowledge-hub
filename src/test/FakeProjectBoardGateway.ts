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
    | { method: "listGithubProjects" }
    | { method: "linkGithubProject"; project: ResolvedGithubProject }
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

  listTruncated = false;

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

  private boardResult: ProjectBoard | { code: string; message: string } | null =
    null;

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

  async getProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "getProjectBoard" });
    if (this.loadError) {
      throw this.loadError;
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
    return this.board;
  }

  async resolveGithubProject(url: string): Promise<ResolvedGithubProject> {
    this.calls.push({ method: "resolveGithubProject", url });
    if (this.resolveResult instanceof Error) {
      throw this.resolveResult;
    }
    return this.resolveResult;
  }

  async listGithubProjects(): Promise<ProjectList> {
    this.calls.push({ method: "listGithubProjects" });
    if (this.projectList instanceof Error) {
      throw this.projectList;
    }
    return { projects: this.projectList, truncated: this.listTruncated };
  }

  async linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    this.calls.push({ method: "linkGithubProject", project });
    this.boardResult = this.board;
  }
}
