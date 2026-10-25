import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
} from "@/features/project-board/model";

export class FakeProjectBoardGateway implements ProjectBoardGateway {
  readonly calls: Array<{ method: "getProjectBoard" }> = [];

  constructor(private board: ProjectBoard = { issues: [], fetchedAt: null }) {}

  static empty(): FakeProjectBoardGateway {
    return new FakeProjectBoardGateway({ issues: [], fetchedAt: null });
  }

  static withIssues(issues: BoardIssue[], fetchedAt: string | null = null) {
    return new FakeProjectBoardGateway({ issues, fetchedAt });
  }

  async getProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "getProjectBoard" });
    return this.board;
  }
}
