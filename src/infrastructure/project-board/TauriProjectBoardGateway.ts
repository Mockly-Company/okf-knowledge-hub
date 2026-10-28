import { invoke } from "@tauri-apps/api/core";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
} from "@/features/project-board/model";
import {
  MAX_ISSUE_TREE_DEPTH,
  asIssueArray,
  isIssueLike,
} from "@/features/project-board/boardUtils";

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
    return this.invokeCommand<ProjectBoard>("get_project_board").then(
      normalizeBoard,
    );
  }

  syncProjectBoard(): Promise<ProjectBoard> {
    return this.invokeCommand<ProjectBoard>("sync_project_board").then(
      normalizeBoard,
    );
  }

  resolveGithubProject(url: string): Promise<ResolvedGithubProject> {
    return this.invokeCommand<ResolvedGithubProject>("resolve_github_project", {
      url,
    });
  }

  listGithubProjects(): Promise<ProjectList> {
    return this.invokeCommand<ProjectList>("list_github_projects");
  }

  linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    return this.invokeCommand<void>("link_github_project", { project });
  }
}


/** 구 캐시의 누락 kind/children을 타입에 맞게 채우고 비객체 원소는 버린다. */
function normalizeIssue(issue: BoardIssue, depth = 0): BoardIssue | null {
  if (!isIssueLike(issue)) {
    return null;
  }
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return { ...issue, children: [], kind: issue.kind ?? null };
  }
  const children: BoardIssue[] = [];
  for (const child of asIssueArray(issue.children)) {
    const normalized = normalizeIssue(child, depth + 1);
    if (normalized) {
      children.push(normalized);
    }
  }
  return { ...issue, children, kind: issue.kind ?? null };
}

function normalizeBoard(board: ProjectBoard): ProjectBoard {
  const issues: BoardIssue[] = [];
  for (const issue of asIssueArray(board.issues)) {
    const normalized = normalizeIssue(issue);
    if (normalized) {
      issues.push(normalized);
    }
  }
  return { ...board, issues };
}
