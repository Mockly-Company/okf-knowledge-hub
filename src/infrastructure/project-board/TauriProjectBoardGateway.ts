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

/** 절단 집계의 노드 예산. 백엔드 MAX_COUNT_NODES와 같은 단위(고유 URL 수)로 통일한다. */
const MAX_HIDDEN_NODES = 100_000;

/** 절단된 서브트리의 숨은 노드 수를 센다(백엔드 count_descendants와 같은 단위).
 * 잘린 노드는 렌더되지 않으므로 다이아몬드 공유 서브트리도 고유 URL 기준으로
 * 한 번만 센다. 명시적 스택 순회라 깊은 체인에서도 스택 오버플로가 없고,
 * 노드 예산을 초과하면 중단한다(초과분은 셀 수 없으므로 호출자가 truncated로 표시).
 * seen은 호출자가 쥔 전역 집합을 그대로 쓴다. 절단마다 새 집합을 만들면
 * 다이아몬드 공유 서브트리가 분기마다 중복 집계되고, 이미 순회한 자식을
 * 잘린 경우 다시 스택 순회해 이중 비용이 든다.
 * 비객체 오염 원소와 isIssueLike 탈락분도 숨은 항목 수에 포함한다.
 * 정상 경로의 dropped 합산과는 겹치지 않는다(절단 시 자식 정규화 루프를
 * 타지 않으므로 중복 가산이 없다). */
function countHiddenNodes(
  issue: BoardIssue,
  seen: Set<string>,
): { count: number; capped: boolean } {
  let count = 0;
  const stack: unknown[] = [];
  // 스프레드 push(...kids)는 인자 개수 상한에 걸려 대량 오염 자식에서
  // throw(RangeError)로 보드 로드가 통째로 깨진다. 루프로 나눠 푸시한다.
  const pushKids = (kids: unknown) => {
    if (!Array.isArray(kids)) {
      return;
    }
    for (const kid of kids) {
      stack.push(kid);
    }
  };
  if (Array.isArray(issue.children)) {
    pushKids(issue.children);
  }
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null || !isIssueLike(current)) {
      // 자식 정규화 루프를 타지 않는 절단 경로 전용 집계이므로 여기서 센다.
      // 정상 경로의 dropped 합산과는 겹치지 않는다(절단 시 해당 루프를 타지 않음).
      // 비객체 원소는 식별 키가 없어 고유 URL 기준 중복 제거 대상이 아니다.
      // JSON에는 공유 참조가 없어 각 슬롯이 별개 항목이므로 슬롯마다 센다.
      count += 1;
    } else {
      const key = issueKey(current);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      count += 1;
      pushKids((current as BoardIssue).children);
    }
    if (count >= MAX_HIDDEN_NODES) {
      return { count, capped: true };
    }
  }
  return { count, capped: false };
}


type NormalizeStats = {
  cuts: number;
  dropped: number;
  hidden: number;
  nodes: number;
  warned: number;
  counted: Set<string>;
};

/**
 * 절단 경고는 처음 몇 건만 상세히 남기고, 나머지는 합산 한 줄로 남긴다.
 * 대량 오염 캐시에서 수백~수천 로그가 쏟아지는 것을 막는다.
 */
function warnTruncated(
  stats: NormalizeStats,
  issue: BoardIssue,
  reason: string,
  depth: number,
) {
  stats.cuts += 1;
  if (stats.warned < 3) {
    stats.warned += 1;
    console.warn(
      `[project-board] issue tree truncated (${reason}) at depth ${depth}: #${issue.number} ${issue.url}`,
    );
  }
}

/** 구 캐시의 누락 kind/children을 타입에 맞게 채우고 비객체 원소는 버린다. */
function normalizeIssue(
  issue: BoardIssue,
  depth = 0,
  path = new Set<string>(),
  stats: NormalizeStats = {
    cuts: 0,
    dropped: 0,
    hidden: 0,
    nodes: 0,
    warned: 0,
    counted: new Set<string>(),
  },
): BoardIssue | null {
  if (!isIssueLike(issue)) {
    stats.dropped += 1;
    return null;
  }
  // URL 사이클 오염 캐시는 별개 객체로 오므로 identity가 아닌 URL 경로로 끊는다.
  const release = enterPath(path, issueKey(issue));
  if (!release) {
    stats.dropped += 1;
    // 탈락한 URL도 집계済み로 표시해 이후 절단 집계에서 숨김으로 중복 가산되지 않게 한다.
    stats.counted.add(issueKey(issue));
    return null;
  }
  // 렌더되거나 절단되는 노드는 집계済み로 표시해 이후 절단 집계에서
  // 숨김으로 중복 가산되지 않게 한다.
  stats.counted.add(issueKey(issue));
  try {
    // 정규화 자체에도 총량 예산을 둔다. 다이아몬드 공유가 많은 오염 캐시는
    // 깊이 상한에 걸리지 않아도 재귀가 기하급수 팽창할 수 있다.
    // (백엔드 MAX_COUNT_NODES와 같은 취지의 총량 상한.)
    // try/finally 안에 두어 조기 반환해도 경로 집합이 누수되지 않게 한다.
    stats.nodes += 1;
    if (stats.nodes > MAX_HIDDEN_NODES) {
      warnTruncated(stats, issue, "node budget", depth);
      // 절단 집계용 전역 집합을 재사용한다. 절단마다 새 집합을 만들면
      // 다이아몬드 공유 서브트리가 분기마다 중복 집계되고 이미 순회한
      // 자식을 잘린 경우 다시 스택 순회해 이중 비용이 든다.
      const hidden = countHiddenNodes(issue, stats.counted);
      stats.hidden += hidden.count;
      if (hidden.capped) {
        stats.cuts += 1;
      }
      return {
        ...issue,
        children: [],
        kind: typeof issue.kind === "string" ? issue.kind : null,
        childrenTruncated: true,
      };
    }
    if (depth > MAX_ISSUE_TREE_DEPTH) {
      // 오염 캐시의 비정상 깊이는 여기서 자른다. 조용히 버리면 UI 카운터와
      // 어긋나므로 경고하고 호출자가 truncated를 세우도록 cuts에 기록한다.
      // 잘린 하위 노드 수는 백엔드와 같은 단위(고유 숨김 URL 수)로 skipped에 합치고,
      // 노드 예산 초과분은 셀 수 없으므로 truncated로 표시한다.
      // 잘린 노드임을 플래그로 남겨 TreeNode가 "하위 항목 생략됨"을 표시한다.
      warnTruncated(stats, issue, "depth limit", depth);
      const hidden = countHiddenNodes(issue, stats.counted);
      stats.hidden += hidden.count;
      if (hidden.capped) {
        stats.cuts += 1;
      }
      return {
        ...issue,
        children: [],
        kind: typeof issue.kind === "string" ? issue.kind : null,
        childrenTruncated: true,
      };
    }
    const children: BoardIssue[] = [];
    // asIssueArray는 탈락분을 조용히 버리므로, skipped 합산을 위해 여기서 직접 센다.
    const rawChildren = Array.isArray(issue.children) ? issue.children : [];
    for (const raw of rawChildren) {
      if (!isIssueLike(raw)) {
        stats.dropped += 1;
        continue;
      }
      const normalized = normalizeIssue(raw, depth + 1, path, stats);
      if (normalized) {
        children.push(normalized);
      }
    }
    return {
      ...issue,
      children,
      kind: typeof issue.kind === "string" ? issue.kind : null,
      // 백엔드가 세운 절단 플래그는 그대로 유지한다. 무조건 false로 두면
      // 실제 절단이 있었는데도 표시가 사라진다. 오염된 비불리언 값만 false로
      // 정규화해 구 캐시의 이상치가 다음 세대에 남지 않게 한다.
      childrenTruncated: issue.childrenTruncated === true,
    };
  } finally {
    release();
  }
}

function normalizeBoard(board: ProjectBoard): ProjectBoard {
  // invoke 반환이 런타임 오염으로 null이면 빈 보드로 취급한다.
  if (typeof board !== "object" || board === null) {
    return { issues: [], fetchedAt: null, skipped: 0, truncated: false };
  }
  const stats: NormalizeStats = {
    cuts: 0,
    dropped: 0,
    hidden: 0,
    nodes: 0,
    warned: 0,
    counted: new Set<string>(),
  };
  const issues: BoardIssue[] = [];
  // asIssueArray는 탈락분을 조용히 버리므로, skipped 합산을 위해 여기서 직접 센다.
  const topLevel = Array.isArray(board.issues) ? board.issues : [];
  for (const raw of topLevel) {
    if (!isIssueLike(raw)) {
      stats.dropped += 1;
      continue;
    }
    const normalized = normalizeIssue(raw, 0, new Set<string>(), stats);
    if (normalized) {
      issues.push(normalized);
    }
  }
  const backendSkipped =
    typeof board.skipped === "number" &&
    Number.isInteger(board.skipped) &&
    board.skipped >= 0
      ? board.skipped
      : 0;
  // 상세 경고는 처음 몇 건만 찍었으므로, 합산은 한 줄로 요약한다.
  if (stats.cuts > stats.warned) {
    console.warn(
      `[project-board] issue tree truncated ${stats.cuts} time(s), ` +
        `hidden ${stats.hidden}, dropped ${stats.dropped} (showing first ${stats.warned} details above)`,
    );
  }
  return {
    issues,
    fetchedAt: typeof board.fetchedAt === "string" ? board.fetchedAt : null,
    // 프론트에서 추가로 정화한 탈락분과 절단 하위 노드도 skipped에 합쳐 카운터를 맞춘다.
    // (백엔드는 동일 탈락·절단을 skipped에 가산한다.)
    skipped: backendSkipped + stats.dropped + stats.hidden,
    // 정규화 단계에서 잘린 하위 트리가 있으면 잘림으로 표시한다.
    truncated: board.truncated === true || stats.cuts > 0,
  };
}
