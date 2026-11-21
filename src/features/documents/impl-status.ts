import type { BoardIssue } from "@/features/project-board/model";
import { classifyDocumentCategory } from "./document-taxonomy";
import {
  normalizeDocumentPath,
  type DocumentImplStatus,
  type DocumentSummary,
} from "./model";

export interface ResolvedImplStatus {
  status: DocumentImplStatus;
  source: "frontmatter" | "board";
  label: string;
  note: string | null;
  counts?: { done: number; total: number };
}

export interface LinkedIssueMetrics {
  total: number;
  done: number;
  active: number;
  open: number;
  assignees: string[];
}

export function createEmptyIssueMetrics(): LinkedIssueMetrics {
  return {
    total: 0,
    done: 0,
    active: 0,
    open: 0,
    assignees: [],
  };
}

const VALID_IMPL_STATUSES = new Set<DocumentImplStatus>([
  "synced",
  "partial",
  "unimplemented",
]);

const MAX_WALK_DEPTH = 52;

const FRONTMATTER_STATUS_LABELS: Record<DocumentImplStatus, string> = {
  synced: "코드 반영 완료",
  partial: "일부 수정 필요",
  unimplemented: "미반영",
};

export function canonicalDocPath(path: string): string {
  return normalizeDocumentPath(path)
    .replace(/\.html$/i, ".md")
    .toLowerCase();
}

export function flattenBoardIssues(
  issues: readonly BoardIssue[] | undefined,
): BoardIssue[] {
  if (!issues || issues.length === 0) return [];
  const flat: BoardIssue[] = [];
  const seen = new Set<string>();

  const visit = (items: readonly BoardIssue[], depth: number) => {
    if (depth > MAX_WALK_DEPTH) return;
    for (const issue of items) {
      const key = `${issue.number}:${issue.url ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(issue);
      if (Array.isArray(issue.children) && issue.children.length > 0) {
        visit(issue.children, depth + 1);
      }
    }
  };

  visit(issues, 0);
  return flat;
}

export function isBoardIssueActive(status: BoardIssue["status"]): boolean {
  return status === "in_progress" || status === "in_review";
}

export function isBoardIssueOpen(status: BoardIssue["status"]): boolean {
  return status === "backlog" || status === "ready";
}

function accumulateIssueMetrics(
  acc: {
    total: number;
    done: number;
    active: number;
    open: number;
    assigneeMap: Map<string, string>;
  },
  issue: BoardIssue,
) {
  acc.total += 1;
  if (issue.status === "done") {
    acc.done += 1;
  } else if (isBoardIssueActive(issue.status)) {
    acc.active += 1;
  } else if (isBoardIssueOpen(issue.status)) {
    acc.open += 1;
  }

  for (const assignee of issue.assignees ?? []) {
    const key = assignee.login?.trim();
    if (!key) continue;
    const display = assignee.name?.trim() || key;
    if (!acc.assigneeMap.has(key)) {
      acc.assigneeMap.set(key, display);
    }
  }
}

export function indexLinkedBoardIssues(
  boardIssues?: readonly BoardIssue[],
): ReadonlyMap<string, LinkedIssueMetrics> {
  const flattened = flattenBoardIssues(boardIssues);
  if (flattened.length === 0) {
    return new Map();
  }

  const buckets = new Map<
    string,
    {
      total: number;
      done: number;
      active: number;
      open: number;
      assigneeMap: Map<string, string>;
    }
  >();

  for (const issue of flattened) {
    const refs = issue.linkedDocPaths;
    if (!Array.isArray(refs) || refs.length === 0) continue;

    const matchedPaths = new Set<string>();
    for (const refPath of refs) {
      if (typeof refPath !== "string") continue;
      const canonical = canonicalDocPath(refPath);
      if (canonical) {
        matchedPaths.add(canonical);
      }
    }

    for (const canonical of matchedPaths) {
      let bucket = buckets.get(canonical);
      if (!bucket) {
        bucket = {
          total: 0,
          done: 0,
          active: 0,
          open: 0,
          assigneeMap: new Map(),
        };
        buckets.set(canonical, bucket);
      }
      accumulateIssueMetrics(bucket, issue);
    }
  }

  const result = new Map<string, LinkedIssueMetrics>();
  for (const [docPath, bucket] of buckets.entries()) {
    result.set(docPath, {
      total: bucket.total,
      done: bucket.done,
      active: bucket.active,
      open: bucket.open,
      assignees: [...bucket.assigneeMap.values()],
    });
  }
  return result;
}

export function countLinkedBoardIssues(
  docPath: string,
  boardIssues?: readonly BoardIssue[],
): LinkedIssueMetrics {
  const canonical = canonicalDocPath(docPath);
  if (!canonical) {
    return createEmptyIssueMetrics();
  }
  return indexLinkedBoardIssues(boardIssues).get(canonical) ?? createEmptyIssueMetrics();
}

/**
 * Resolves a document's code-reflection status given pre-indexed linked issue metrics.
 */
export function resolveDocumentImplStatusFromMetrics(
  doc: Pick<DocumentSummary, "path" | "fileName" | "docType" | "implStatus" | "implNote">,
  metrics: LinkedIssueMetrics | undefined,
): ResolvedImplStatus | null {
  if (doc.implStatus && VALID_IMPL_STATUSES.has(doc.implStatus)) {
    return {
      status: doc.implStatus,
      source: "frontmatter",
      label: Object.hasOwn(FRONTMATTER_STATUS_LABELS, doc.implStatus)
        ? FRONTMATTER_STATUS_LABELS[doc.implStatus]
        : "코드 반영 상태",
      note: doc.implNote?.trim() ? doc.implNote.trim() : null,
    };
  }

  const category = classifyDocumentCategory(doc);
  if (category !== "prd" && category !== "screen_spec") {
    return null;
  }

  if (!metrics || metrics.total === 0) {
    return null;
  }

  if (metrics.done === metrics.total) {
    return {
      status: "synced",
      source: "board",
      label: "이슈 완료 (미점검)",
      note: `연결 이슈 ${metrics.done}/${metrics.total} 완료`,
      counts: { done: metrics.done, total: metrics.total },
    };
  }

  if (metrics.done > 0 || metrics.active > 0) {
    return {
      status: "partial",
      source: "board",
      label: "구현 진행 중 (미점검)",
      note: `연결 이슈 ${metrics.done}/${metrics.total} 완료`,
      counts: { done: metrics.done, total: metrics.total },
    };
  }

  return {
    status: "unimplemented",
    source: "board",
    label: "미착수 (미점검)",
    note: `연결 이슈 0/${metrics.total} 완료`,
    counts: { done: 0, total: metrics.total },
  };
}

/**
 * Resolves a document's code-reflection status via a hybrid rule:
 * 1. Explicit frontmatter (`impl_status` + `impl_note`) is the primary source of truth.
 * 2. When unaudited on PRD or Screen Spec documents, infer a provisional hint
 *    from linked GitHub Project issues that reference the document's path.
 */
export function resolveDocumentImplStatus(
  doc: Pick<DocumentSummary, "path" | "fileName" | "docType" | "implStatus" | "implNote">,
  boardIssues?: readonly BoardIssue[],
): ResolvedImplStatus | null {
  if (doc.implStatus && VALID_IMPL_STATUSES.has(doc.implStatus)) {
    return resolveDocumentImplStatusFromMetrics(doc, undefined);
  }
  const metrics = countLinkedBoardIssues(doc.path, boardIssues);
  return resolveDocumentImplStatusFromMetrics(doc, metrics);
}
