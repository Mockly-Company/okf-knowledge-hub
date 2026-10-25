import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ResolvedGithubProject,
} from "@/features/project-board/model";

export class FakeProjectBoardGateway implements ProjectBoardGateway {
  readonly calls: Array<
    | { method: "getProjectBoard" }
    | { method: "syncProjectBoard" }
    | { method: "resolveGithubProject"; url: string }
    | { method: "linkGithubProject"; project: ResolvedGithubProject }
  > = [];

  resolveResult: ResolvedGithubProject | Error = {
    id: "PVT_kwDOFake",
    owner: "Mockly-Company",
    number: 1,
    title: "Mockly Board",
    scope: "organization",
  };

  loadError: Error | null = null;

  constructor(public board: ProjectBoard = { issues: [], fetchedAt: null, skipped: 0 }) {}

  static empty(): FakeProjectBoardGateway {
    return new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0 });
  }

  static withIssues(issues: BoardIssue[], fetchedAt: string | null = null) {
    return new FakeProjectBoardGateway({ issues, fetchedAt, skipped: 0 });
  }

  private boardResult: ProjectBoard | { code: string; message: string } | null =
    null;

  static unlinked(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0 });
    gateway.boardResult = {
      code: "workspace_invalid",
      message: "GitHub Project가 연결되지 않았습니다.",
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

  async linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    this.calls.push({ method: "linkGithubProject", project });
    this.boardResult = this.board;
  }
}
