import { describe, expect, it } from "vitest";
import type { BoardIssue } from "@/features/project-board/model";
import type { DocumentSummary } from "./model";
import {
  buildProjectProgressSummary,
  canonicalDocumentKey,
  formatDocumentSize,
  matchesImplStatusFilter,
  resolveDocumentStage,
} from "./domain-progress";

function makeDoc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    path: "docs/domains/documents/prd.md",
    fileName: "prd.md",
    title: "문서 PRD",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Product Spec",
    domain: "documents",
    modifiedAtUnixMs: 1,
    size: 2048,
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

describe("domain-progress", () => {
  it("formats document sizes and resolves document stages accurately", () => {
    expect(formatDocumentSize(0)).toBe("0 B");
    expect(formatDocumentSize(512)).toBe("512 B");
    expect(formatDocumentSize(1536)).toBe("1.5 KB");
    expect(formatDocumentSize(2 * 1024 * 1024)).toBe("2.0 MB");

    expect(canonicalDocumentKey("./docs/domains/documents/prd.HTML")).toBe(
      "docs/domains/documents/prd.md",
    );

    expect(
      resolveDocumentStage(makeDoc({ path: "docs/domains/documents/index.md", fileName: "index.md", docType: null })),
    ).toBe("overview");
    expect(resolveDocumentStage(makeDoc())).toBe("prd");
    expect(
      resolveDocumentStage(makeDoc({ path: "docs/domains/documents/screen-spec.md", fileName: "screen-spec.md", docType: "Screen Spec" })),
    ).toBe("screen_spec");
    expect(
      resolveDocumentStage(makeDoc({ path: "docs/domains/documents/adr-001.md", fileName: "adr-001.md", docType: "ADR" })),
    ).toBe("adr");
    expect(
      resolveDocumentStage(makeDoc({ path: "docs/domains/documents/guide.md", fileName: "guide.md", docType: "Guide" })),
    ).toBe("guide_ref");
  });

  it("matches status filters against progress buckets", () => {
    expect(matchesImplStatusFilter("synced", "all")).toBe(true);
    expect(matchesImplStatusFilter("unaudited", "all")).toBe(true);
    expect(matchesImplStatusFilter("partial", "partial")).toBe(true);
    expect(matchesImplStatusFilter("partial", "synced")).toBe(false);
    expect(matchesImplStatusFilter("unaudited", "unaudited")).toBe(true);
  });

  it("aggregates domain and project progress, stage coverage, and deduplicated linked issues", () => {
    const docsIndex = makeDoc({
      path: "docs/domains/documents/index.md",
      fileName: "index.md",
      title: "Documents 개요",
      docType: null,
      size: 500,
    });
    const docsPrd = makeDoc({
      path: "docs/domains/documents/prd.md",
      fileName: "prd.md",
      title: "Documents PRD",
      implStatus: "synced",
      implNote: "전체 반영 완료",
      size: 4096,
      previewHeadings: ["개요", "요구사항"],
    });
    const docsSpec = makeDoc({
      path: "docs/domains/documents/screen-spec.md",
      fileName: "screen-spec.md",
      title: "Documents 화면명세",
      docType: "Screen Spec",
      size: 8192,
      wireframes: [{ title: "메인", image: "assets/w.svg" }],
      designs: [
        { title: "시안 A", image: "assets/a.svg", status: "approved" },
        { title: "시안 B", image: "assets/b.svg", status: "draft" },
      ],
    });
    const dashPrd = makeDoc({
      path: "docs/domains/dashboard/prd.md",
      fileName: "prd.md",
      title: "Dashboard PRD",
      domain: "dashboard",
      implStatus: "unimplemented",
      size: 3000,
    });

    const boardIssues: BoardIssue[] = [
      makeIssue(10, "done", [
        "docs/domains/documents/prd.md",
        "docs/domains/documents/screen-spec.md",
      ]),
      makeIssue(11, "in_progress", ["docs/domains/documents/screen-spec.md"], [
        makeIssue(12, "ready", ["docs/domains/dashboard/prd.md"]),
      ]),
      makeIssue(99, "done", ["docs/other/unrelated.md"]),
    ];

    const summary = buildProjectProgressSummary(
      [docsIndex, docsPrd, docsSpec, dashPrd],
      boardIssues,
    );

    expect(summary.counts).toEqual({
      total: 4,
      synced: 1,
      partial: 1,
      unimplemented: 1,
      unaudited: 1,
      tracked: 3,
      trackedCompletionPercent: 33,
      issueTotal: 3,
      issueDone: 1,
      issueActive: 1,
      issueOpen: 1,
      totalBytes: 500 + 4096 + 8192 + 3000,
    });

    const docsDomain = summary.domains.find((d) => d.group.key === "documents")!;
    expect(docsDomain.stages).toEqual({
      overview: 1,
      prd: 1,
      screen_spec: 1,
      designAssets: 2,
      adr: 0,
      guide_ref: 0,
    });
    // Issue #10 links to both prd & screen_spec in documents, so domain unique issueTotal is 2 (#10, #11).
    expect(docsDomain.counts).toEqual({
      total: 3,
      synced: 1,
      partial: 1,
      unimplemented: 0,
      unaudited: 1,
      tracked: 2,
      trackedCompletionPercent: 50,
      issueTotal: 2,
      issueDone: 1,
      issueActive: 1,
      issueOpen: 0,
      totalBytes: 500 + 4096 + 8192,
    });

    const specItem = summary.itemsByKey.get("docs/domains/documents/screen-spec.md")!;
    expect(specItem.bucket).toBe("partial");
    expect(specItem.issues.total).toBe(2);
    expect(specItem.designCount).toBe(2);
    expect(specItem.wireframeCount).toBe(1);
    expect(specItem.headingCount).toBe(0);
  });
});
