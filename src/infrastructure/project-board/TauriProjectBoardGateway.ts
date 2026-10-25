import { invoke } from "@tauri-apps/api/core";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  ProjectBoard,
  ResolvedGithubProject,
} from "@/features/project-board/model";

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const invokeDesktop: InvokeDesktop = (command, args) => invoke(command, args);

export class TauriProjectBoardGateway implements ProjectBoardGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
  ) {}

  getProjectBoard(): Promise<ProjectBoard> {
    return this.invokeCommand<ProjectBoard>("get_project_board");
  }

  resolveGithubProject(url: string): Promise<ResolvedGithubProject> {
    return this.invokeCommand<ResolvedGithubProject>("resolve_github_project", {
      url,
    });
  }

  linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    return this.invokeCommand<void>("link_github_project", { project });
  }
}
