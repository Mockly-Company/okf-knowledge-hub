import type { BoardIssue } from "@/features/project-board/model";
import {
  classifyDocumentCategory,
  groupDocumentsByDomain,
  isOverviewDocument,
  type DocumentCategory,
  type DocumentGroup,
  type DocumentImplStatusFilter,
} from "./document-taxonomy";
import {
  canonicalDocPath,
  flattenBoardIssues,
  indexLinkedBoardIssues,
  isBoardIssueActive,
  isBoardIssueOpen,
  resolveDocumentImplStatusFromMetrics,
  type LinkedIssueMetrics,
  type ResolvedImplStatus,
} from "./impl-status";
import type { DocumentSummary } from "./model";

export type DocumentProgressBucket =
  | "synced"
  | "partial"
  | "unimplemented"
  | "unaudited";

export type DocumentStageKey =
  | "overview"
  | "prd"
  | "screen_spec"
  | "adr"
  | "guide_ref";

export interface DocumentProgressItem {
  key: string;
  doc: DocumentSummary;
  domainKey: string;
  domainLabel: string;
  stage: DocumentStageKey;
  category: DocumentCategory;
  impl: ResolvedImplStatus | null;
  bucket: DocumentProgressBucket;
  issues: LinkedIssueMetrics;
  sizeBytes: number;
  headingCount: number;
  designCount: number;
  wireframeCount: number;
}

export interface ProgressCounts {
  total: number;
  synced: number;
  partial: number;
  unimplemented: number;
  unaudited: number;
  tracked: number;
  trackedCompletionPercent: number;
  issueTotal: number;
  issueDone: number;
  issueActive: number;
  issueOpen: number;
  totalBytes: number;
}

export interface DomainStageCounts {
  overview: number;
  prd: number;
  screen_spec: number;
  design: number;
  adr: number;
  guide_ref: number;
}

export interface DomainProgressSummary {
  group: DocumentGroup;
  counts: ProgressCounts;
  stages: DomainStageCounts;
  items: DocumentProgressItem[];
}

export interface ProjectProgressSummary {
  counts: ProgressCounts;
  domains: DomainProgressSummary[];
  itemsByKey: ReadonlyMap<string, DocumentProgressItem>;
}

const EMPTY_METRICS: LinkedIssueMetrics = {
  total: 0,
  done: 0,
  active: 0,
  open: 0,
  assignees: [],
};

export function canonicalDocumentKey(path: string): string {
  return canonicalDocPath(path);
}

export function resolveDocumentStage(
  doc: Pick<DocumentSummary, "fileName" | "path" | "docType">,
): DocumentStageKey {
  if (isOverviewDocument(doc)) {
    return "overview";
  }
  switch (classifyDocumentCategory(doc)) {
    case "prd":
      return "prd";
    case "screen_spec":
      return "screen_spec";
    case "adr":
      return "adr";
    default:
      return "guide_ref";
  }
}

export function formatDocumentSize(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safeBytes < 1024) {
    return `${Math.round(safeBytes)} B`;
  }
  if (safeBytes < 1048576) {
    return `${(safeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(safeBytes / 1048576).toFixed(1)} MB`;
}

export function matchesImplStatusFilter(
  bucket: DocumentProgressBucket,
  filter: DocumentImplStatusFilter,
): boolean {
  return filter === "all" || bucket === filter;
}

function summarizeUniqueIssuesForKeys(
  docKeys: ReadonlySet<string>,
  flattenedIssues: readonly BoardIssue[],
): { total: number; done: number; active: number; open: number } {
  let total = 0;
  let done = 0;
  let active = 0;
  let open = 0;

  for (const issue of flattenedIssues) {
    const refs = issue.linkedDocPaths;
    if (!Array.isArray(refs) || refs.length === 0) continue;
    const matches = refs.some(
      (refPath) =>
        typeof refPath === "string" && docKeys.has(canonicalDocPath(refPath)),
    );
    if (!matches) continue;

    total += 1;
    if (issue.status === "done") {
      done += 1;
    } else if (isBoardIssueActive(issue.status)) {
      active += 1;
    } else if (isBoardIssueOpen(issue.status)) {
      open += 1;
    }
  }

  return { total, done, active, open };
}

function createEmptyCounts(): ProgressCounts {
  return {
    total: 0,
    synced: 0,
    partial: 0,
    unimplemented: 0,
    unaudited: 0,
    tracked: 0,
    trackedCompletionPercent: 0,
    issueTotal: 0,
    issueDone: 0,
    issueActive: 0,
    issueOpen: 0,
    totalBytes: 0,
  };
}

function buildProgressCounts(
  items: readonly DocumentProgressItem[],
  flattenedIssues: readonly BoardIssue[],
): ProgressCounts {
  const counts = createEmptyCounts();
  const docKeys = new Set<string>();

  for (const item of items) {
    counts.total += 1;
    counts.totalBytes += item.sizeBytes;
    docKeys.add(item.key);
    if (item.bucket === "synced") {
      counts.synced += 1;
    } else if (item.bucket === "partial") {
      counts.partial += 1;
    } else if (item.bucket === "unimplemented") {
      counts.unimplemented += 1;
    } else {
      counts.unaudited += 1;
    }
  }

  counts.tracked = counts.synced + counts.partial + counts.unimplemented;
  counts.trackedCompletionPercent =
    counts.tracked > 0 ? Math.round((counts.synced / counts.tracked) * 100) : 0;

  if (docKeys.size > 0 && flattenedIssues.length > 0) {
    const issueStats = summarizeUniqueIssuesForKeys(docKeys, flattenedIssues);
    counts.issueTotal = issueStats.total;
    counts.issueDone = issueStats.done;
    counts.issueActive = issueStats.active;
    counts.issueOpen = issueStats.open;
  }

  return counts;
}

export function buildProjectProgressSummary(
  documents: readonly DocumentSummary[],
  boardIssues?: readonly BoardIssue[],
): ProjectProgressSummary {
  const groups = groupDocumentsByDomain(documents);
  const flattenedIssues = flattenBoardIssues(boardIssues);
  const issueIndex = indexLinkedBoardIssues(flattenedIssues);
  const itemsByKey = new Map<string, DocumentProgressItem>();
  const allItems: DocumentProgressItem[] = [];

  const domains: DomainProgressSummary[] = groups.map((group) => {
    const stages: DomainStageCounts = {
      overview: 0,
      prd: 0,
      screen_spec: 0,
      design: 0,
      adr: 0,
      guide_ref: 0,
    };

    const items: DocumentProgressItem[] = group.documents.map((doc) => {
      const key = canonicalDocPath(doc.path);
      const stage = resolveDocumentStage(doc);
      const category = classifyDocumentCategory(doc);
      const issues = issueIndex.get(key) ?? EMPTY_METRICS;
      const impl = resolveDocumentImplStatusFromMetrics(doc, issues);
      const bucket: DocumentProgressBucket = impl?.status ?? "unaudited";
      const sizeBytes = Number.isFinite(doc.size) ? Math.max(0, doc.size) : 0;
      const headingCount = doc.previewHeadings?.length ?? 0;
      const designCount = doc.designs?.length ?? 0;
      const wireframeCount = doc.wireframes?.length ?? 0;

      stages[stage] += 1;
      if (stage === "screen_spec") {
        stages.design += designCount;
      }

      const item: DocumentProgressItem = {
        key,
        doc,
        domainKey: group.key,
        domainLabel: group.label,
        stage,
        category,
        impl,
        bucket,
        issues,
        sizeBytes,
        headingCount,
        designCount,
        wireframeCount,
      };
      itemsByKey.set(key, item);
      allItems.push(item);
      return item;
    });

    return {
      group,
      counts: buildProgressCounts(items, flattenedIssues),
      stages,
      items,
    };
  });

  return {
    counts: buildProgressCounts(allItems, flattenedIssues),
    domains,
    itemsByKey,
  };
}
