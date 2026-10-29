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
  enterPath,
  isIssueLike,
  issueKey,
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
function normalizeIssue(
  issue: BoardIssue,
  depth = 0,
  path = new Set<string>(),
  stats: { cuts: number } = { cuts: 0 },
): BoardIssue | null {
  if (!isIssueLike(issue)) {
    return null;
  }
  // URL 사이클 오염 캐시는 별개 객체로 오므로 identity가 아닌 URL 경로로 끊는다.
  const release = enterPath(path, issueKey(issue));
  if (!release) {
    return null;
  }
  try {
    if (depth > MAX_ISSUE_TREE_DEPTH) {
      // 오염 캐시의 비정상 깊이는 여기서 자른다. 조용히 버리면 UI 카운터와
      // 어긋나므로 경고하고 호출자가 truncated를 세우도록 cuts에 기록한다.
      // (백엔드는 동일 절단을 skipped에 합산한다.)
      stats.cuts += 1;
      console.warn(
        `[project-board] issue tree truncated at depth ${depth}: #${issue.number} ${issue.url}`,
      );
      return { ...issue, children: [], kind: issue.kind ?? null };
    }
    const children: BoardIssue[] = [];
    for (const child of asIssueArray(issue.children)) {
      const normalized = normalizeIssue(child, depth + 1, path, stats);
      if (normalized) {
        children.push(normalized);
      }
    }
    return { ...issue, children, kind: issue.kind ?? null };
  } finally {
    release();
  }
}

function normalizeBoard(board: ProjectBoard): ProjectBoard {
  // invoke 반환이 런타임 오염으로 null이면 빈 보드로 취급한다.
  if (typeof board !== "object" || board === null) {
    return { issues: [], fetchedAt: null, skipped: 0, truncated: false };
  }
  const stats = { cuts: 0 };
  const issues: BoardIssue[] = [];
  for (const issue of asIssueArray(board.issues)) {
    const normalized = normalizeIssue(issue, 0, new Set<string>(), stats);
    if (normalized) {
      issues.push(normalized);
    }
  }
  return {
    issues,
    fetchedAt: typeof board.fetchedAt === "string" ? board.fetchedAt : null,
    skipped:
      typeof board.skipped === "number" &&
      Number.isInteger(board.skipped) &&
      board.skipped >= 0
        ? board.skipped
        : 0,
    // 정규화 단계에서 잘린 하위 트리가 있으면 잘림으로 표시한다.
    truncated: board.truncated === true || stats.cuts > 0,
  };
}
