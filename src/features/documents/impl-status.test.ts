import { describe, expect, it } from "vitest";
import type { BoardIssue } from "@/features/project-board/model";
import type { DocumentSummary } from "./model";
import { resolveDocumentImplStatus } from "./impl-status";

function makeDoc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    path: "docs/domains/documents/prd.md",
    fileName: "prd.md",
    title: "Documents PRD",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Product Spec",
    domain: "documents",
    modifiedAtUnixMs: 1,
    size: 100,
    ...overrides,
  };
}

function makeIssue(
  number: number,
  status: BoardIssue["status"],
  linkedDocPaths: string[],
  children: BoardIssue[] = [],
): BoardIssue {
  return {
    number,
    title: `이슈 #${number}`,
    url: `https://github.com/org/repo/issues/${number}`,
    layer: "frontend",
    status,
    kind: "작업",
    linkedDocPaths,
    children,
  };
}

describe("resolveDocumentImplStatus", () => {
  it("prefers explicit frontmatter implStatus and implNote over board issue status", () => {
    const doc = makeDoc({
      implStatus: "partial",
      implNote: "모바일 뷰어 여백 수정 필요",
    });
    const issues = [
      makeIssue(10, "done", ["docs/domains/documents/prd.md"]),
    ];

    expect(resolveDocumentImplStatus(doc, issues)).toEqual({
      status: "partial",
      source: "frontmatter",
      label: "일부 수정 필요",
      note: "모바일 뷰어 여백 수정 필요",
    });
  });

  it("derives provisional board status across nested children for PRD and Screen Spec", () => {
    const doc = makeDoc({
      path: "docs/domains/documents/screen-spec.md",
      fileName: "screen-spec.md",
      docType: "Screen Spec",
    });

    const epicAllDone = makeIssue(1, "in_progress", [], [
      makeIssue(2, "done", ["./docs/domains/documents/screen-spec.html"]),
      makeIssue(3, "done", ["docs\\domains\\documents\\screen-spec.md"]),
    ]);
    expect(resolveDocumentImplStatus(doc, [epicAllDone])).toEqual({
      status: "synced",
      source: "board",
      label: "이슈 완료 (미점검)",
      note: "연결 이슈 2/2 완료",
      counts: { done: 2, total: 2 },
    });

    const epicPartial = makeIssue(1, "in_progress", [], [
      makeIssue(2, "done", ["docs/domains/documents/screen-spec.md"]),
      makeIssue(3, "ready", ["docs/domains/documents/screen-spec.md"]),
    ]);
    expect(resolveDocumentImplStatus(doc, [epicPartial])).toEqual({
      status: "partial",
      source: "board",
      label: "구현 진행 중 (미점검)",
      note: "연결 이슈 1/2 완료",
      counts: { done: 1, total: 2 },
    });

    const epicUnstarted = [
      makeIssue(4, "backlog", ["docs/domains/documents/screen-spec.md"]),
      makeIssue(5, "ready", ["docs/domains/documents/screen-spec.md"]),
    ];
    expect(resolveDocumentImplStatus(doc, epicUnstarted)).toEqual({
      status: "unimplemented",
      source: "board",
      label: "미착수 (미점검)",
      note: "연결 이슈 0/2 완료",
      counts: { done: 0, total: 2 },
    });
  });

  it("returns null for unrelated issues, substring lookalikes, or non-spec categories", () => {
    const adrDoc = makeDoc({
      path: "docs/architecture/adr-001.md",
      fileName: "adr-001.md",
      docType: "ADR",
    });
    const issues = [
      makeIssue(7, "done", ["docs/architecture/adr-001.md"]),
      makeIssue(8, "done", ["docs/domains/documents/prd.md.bak"]),
    ];

    expect(resolveDocumentImplStatus(adrDoc, issues)).toBeNull();
    expect(resolveDocumentImplStatus(makeDoc(), [issues[1]!])).toBeNull();
    expect(resolveDocumentImplStatus(makeDoc(), [])).toBeNull();
  });
});
