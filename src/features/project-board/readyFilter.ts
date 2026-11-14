import type { BoardIssue, BoardStatus } from "./model";

export interface IssueReadiness {
  state: "ready" | "blocked" | "other";
  waitingOn: number | null;
}

export interface IssueReadinessIndex {
  getStatus(issue: BoardIssue): IssueReadiness;
}

const MAX_WALK_DEPTH = 16;

export function inferRepositoryFullNameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 4 && (segments[2] === "issues" || segments[2] === "pull")) {
      return `${segments[0]}/${segments[1]}`.toLowerCase();
    }
  } catch {
    // fallback regex for non-standard URLs in tests/stubs
  }
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/\d+/i);
  return match ? match[1].toLowerCase() : null;
}

export function buildIssueReadinessIndex(
  issues: ReadonlyArray<BoardIssue>,
): IssueReadinessIndex {
  const statusByRepoAndNumber = new Map<string, BoardStatus>();
  const statusByUniqueNumber = new Map<number, BoardStatus | "ambiguous">();

  const visit = (
    list: ReadonlyArray<BoardIssue>,
    depth: number,
    visitedUrls: Set<string>,
  ) => {
    if (depth > MAX_WALK_DEPTH) {
      return;
    }
    for (const issue of list) {
      if (visitedUrls.has(issue.url)) {
        continue;
      }
      visitedUrls.add(issue.url);
      const repo = inferRepositoryFullNameFromUrl(issue.url);
      if (repo) {
        statusByRepoAndNumber.set(`${repo}#${issue.number}`, issue.status);
      }
      const existing = statusByUniqueNumber.get(issue.number);
      if (existing === undefined) {
        statusByUniqueNumber.set(issue.number, issue.status);
      } else if (existing !== issue.status) {
        statusByUniqueNumber.set(issue.number, "ambiguous");
      }
      if (issue.children.length > 0) {
        visit(issue.children, depth + 1, visitedUrls);
      }
    }
  };

  visit(issues, 0, new Set<string>());

  const resolvePredecessorStatus = (
    issue: BoardIssue,
    dependsOn: number,
  ): BoardStatus | null => {
    const repo = inferRepositoryFullNameFromUrl(issue.url);
    if (repo) {
      const sameRepo = statusByRepoAndNumber.get(`${repo}#${dependsOn}`);
      if (sameRepo) {
        return sameRepo;
      }
    }
    const unique = statusByUniqueNumber.get(dependsOn);
    if (unique && unique !== "ambiguous") {
      return unique;
    }
    return null;
  };

  return {
    getStatus(issue: BoardIssue): IssueReadiness {
      if (issue.status !== "backlog" && issue.status !== "ready") {
        return { state: "other", waitingOn: null };
      }
      const dep = issue.dependsOn ?? null;
      if (dep === null) {
        return { state: "ready", waitingOn: null };
      }
      const predStatus = resolvePredecessorStatus(issue, dep);
      if (predStatus === "done") {
        return { state: "ready", waitingOn: null };
      }
      return { state: "blocked", waitingOn: dep };
    },
  };
}

export function filterTreeToReadyOnly(
  issues: ReadonlyArray<BoardIssue>,
  index: IssueReadinessIndex,
): BoardIssue[] {
  const filterNodes = (
    nodes: ReadonlyArray<BoardIssue>,
    depth: number,
  ): BoardIssue[] => {
    if (depth > MAX_WALK_DEPTH) {
      return [];
    }
    const kept: BoardIssue[] = [];
    for (const node of nodes) {
      const filteredChildren =
        node.children.length > 0 ? filterNodes(node.children, depth + 1) : [];
      const selfReady = index.getStatus(node).state === "ready";
      if (selfReady || filteredChildren.length > 0) {
        kept.push({
          ...node,
          children: filteredChildren,
        });
      }
    }
    return kept;
  };

  return filterNodes(issues, 0);
}
