import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ResolvedGithubProject,
} from "@/features/project-board/model";

export class FakeProjectBoardGateway implements ProjectBoardGateway {
  readonly calls: Array<
    | { method: "getProjectBoard" }
    | { method: "resolveGithubProject"; url: string }
    | { method: "linkGithubProject"; project: ResolvedGithubProject }
  > = [];

  resolveResult: ResolvedGithubProject | Error = {
    id: "PVT_kwDOFake",
    owner: "Mockly-Company",
    number: 1,
    title: "Mockly Board",
  };

  loadError: Error | null = null;

  constructor(private board: ProjectBoard = { issues: [], fetchedAt: null }) {}

  static empty(): FakeProjectBoardGateway {
    return new FakeProjectBoardGateway({ issues: [], fetchedAt: null });
  }

  static withIssues(issues: BoardIssue[], fetchedAt: string | null = null) {
    return new FakeProjectBoardGateway({ issues, fetchedAt });
  }

  private boardResult: ProjectBoard | { code: string; message: string } | null =
    null;

  static unlinked(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null });
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
