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

function canonicalDocPath(path: string): string {
  return normalizeDocumentPath(path)
    .replace(/\.html$/i, ".md")
    .toLowerCase();
}

function flattenBoardIssues(
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
    return {
      status: doc.implStatus,
      source: "frontmatter",
      label: FRONTMATTER_STATUS_LABELS[doc.implStatus],
      note: doc.implNote?.trim() ? doc.implNote.trim() : null,
    };
  }

  const category = classifyDocumentCategory(doc);
  if (category !== "prd" && category !== "screen_spec") {
    return null;
  }

  const normalizedPath = canonicalDocPath(doc.path);
  if (!normalizedPath) {
    return null;
  }

  const flattened = flattenBoardIssues(boardIssues);
  if (flattened.length === 0) {
    return null;
  }

  let total = 0;
  let done = 0;
  let active = 0;

  for (const issue of flattened) {
    const refs = issue.linkedDocPaths;
    if (!Array.isArray(refs) || refs.length === 0) continue;
    const matches = refs.some(
      (refPath) =>
        typeof refPath === "string" && canonicalDocPath(refPath) === normalizedPath,
    );
    if (!matches) continue;
    total += 1;
    if (issue.status === "done") {
      done += 1;
    } else if (
      issue.status === "in_progress" ||
      issue.status === "in_review"
    ) {
      active += 1;
    }
  }

  if (total === 0) {
    return null;
  }

  if (done === total) {
    return {
      status: "synced",
      source: "board",
      label: "이슈 완료 (미점검)",
      note: `연결 이슈 ${done}/${total} 완료`,
      counts: { done, total },
    };
  }

  if (done > 0 || active > 0) {
    return {
      status: "partial",
      source: "board",
      label: "구현 진행 중 (미점검)",
      note: `연결 이슈 ${done}/${total} 완료`,
      counts: { done, total },
    };
  }

  return {
    status: "unimplemented",
    source: "board",
    label: "미착수 (미점검)",
    note: `연결 이슈 0/${total} 완료`,
    counts: { done: 0, total },
  };
}
