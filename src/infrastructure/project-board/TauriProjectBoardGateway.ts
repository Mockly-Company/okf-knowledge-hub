import { invoke } from "@tauri-apps/api/core";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  BoardIssue,
  ProjectBoard,
  ProjectList,
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

/** 정규화 재귀 깊이 상한. JSON에는 순환 참조가 있을 수 없지만 방어용으로 둔다. */
const MAX_NORMALIZE_DEPTH = 50;

/**
 * 백엔드는 kind=None이면 필드를 생략하므로 구 캐시에는 kind/children이
 * 없을 수 있다. 프론트 타입(kind: string|null, children: 필수)에 맞춰 정규화한다.
 * JSON 파싱 결과에는 순환 참조가 있을 수 없지만 깊이 상한으로 방어한다.
 * 오염된 캐시의 비배열 children(문자열·객체 등)은 빈 배열로 취급한다.
 */
function asIssueArray(value: unknown): BoardIssue[] {
  return Array.isArray(value) ? (value as BoardIssue[]) : [];
}

function normalizeIssue(issue: BoardIssue, depth = 0): BoardIssue {
  if (depth > MAX_NORMALIZE_DEPTH) {
    return { ...issue, children: [], kind: issue.kind ?? null };
  }
  return {
    ...issue,
    children: asIssueArray(issue.children).map((child) =>
      normalizeIssue(child, depth + 1),
    ),
    kind: issue.kind ?? null,
  };
}

function normalizeBoard(board: ProjectBoard): ProjectBoard {
  return {
    ...board,
    issues: asIssueArray(board.issues).map((issue) => normalizeIssue(issue)),
  };
}
