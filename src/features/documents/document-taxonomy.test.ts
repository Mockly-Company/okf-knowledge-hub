import { describe, expect, it } from "vitest";
import {
  classifyDocumentCategory,
  groupDocumentsByCategory,
  groupDocumentsByDomain,
  isAuxiliaryDocument,
  resolveDocumentDomain,
} from "./document-taxonomy";
import type { DocumentSummary } from "./model";

function makeDoc(
  path: string,
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  const fileName = path.split("/").pop() ?? path;
  return {
    path,
    fileName,
    title: fileName.replace(/\.md$/i, ""),
    documentId: null,
    frontmatterStatus: { status: "valid" },
    modifiedAtUnixMs: 1,
    size: 100,
    ...overrides,
  };
}

describe("document-taxonomy", () => {
  it("classifies categories from docType first and path conventions as fallback", () => {
    expect(
      classifyDocumentCategory(
        makeDoc("docs/domains/documents/prd.md", { docType: "Product Spec" }),
      ),
    ).toBe("prd");
    expect(
      classifyDocumentCategory(
        makeDoc("docs/domains/documents/custom.md", { docType: "Screen Spec" }),
      ),
    ).toBe("screen_spec");
    expect(
      classifyDocumentCategory(makeDoc("docs/architecture/adr-001.md")),
    ).toBe("adr");
    expect(
      classifyDocumentCategory(makeDoc("docs/product/roadmap-v2-prd.md")),
    ).toBe("prd");
    expect(
      classifyDocumentCategory(makeDoc("docs/product/dashboard-screen-spec.md")),
    ).toBe("screen_spec");
    expect(
      classifyDocumentCategory(makeDoc("docs/user-guide/getting-started.md")),
    ).toBe("guide");
    expect(
      classifyDocumentCategory(makeDoc("docs/domains/documents/index.md")),
    ).toBe("reference");
  });

  it("resolves domains from explicit frontmatter, docs/domains/<slug>, and legacy folders", () => {
    expect(
      resolveDocumentDomain(makeDoc("docs/domains/documents/prd.md")),
    ).toEqual({
      key: "documents",
      label: "Documents (문서)",
      folderPath: "docs/domains/documents",
      isExplicitDomain: true,
    });

    expect(
      resolveDocumentDomain(
        makeDoc("docs/product/auth-prd.md", { domain: "auth" }),
      ),
    ).toEqual({
      key: "auth",
      label: "auth",
      folderPath: "docs/product",
      isExplicitDomain: true,
    });

    expect(
      resolveDocumentDomain(makeDoc("docs/guide.md", { domain: "auth" })),
    ).toEqual({
      key: "auth",
      label: "auth",
      folderPath: "docs",
      isExplicitDomain: true,
    });

    expect(
      resolveDocumentDomain(makeDoc("docs/architecture/system-design.md")),
    ).toEqual({
      key: "architecture",
      label: "아키텍처 (architecture)",
      folderPath: "docs/architecture",
      isExplicitDomain: false,
    });

    expect(resolveDocumentDomain(makeDoc("docs/log.md"))).toEqual({
      key: "general",
      label: "공통 · 일반",
      folderPath: "docs",
      isExplicitDomain: false,
    });
  });

  it("orders explicit domain groups before legacy folders and auxiliary files last inside groups", () => {
    const docs = [
      makeDoc("docs/guide.md", { docType: "Guide" }),
      makeDoc("docs/architecture/system-design.md", { docType: "design-doc" }),
      makeDoc("docs/domains/documents/index.md"),
      makeDoc("docs/domains/documents/screen-spec.md", { docType: "Screen Spec" }),
      makeDoc("docs/domains/documents/prd.md", { docType: "Product Spec" }),
      makeDoc("docs/domains/dashboard/prd.md", { docType: "Product Spec" }),
    ];

    const byDomain = groupDocumentsByDomain(docs);
    expect(byDomain.map((g) => g.key)).toEqual([
      "dashboard",
      "documents",
      "architecture",
      "general",
    ]);
    expect(byDomain[1]?.documents.map((d) => d.fileName)).toEqual([
      "prd.md",
      "screen-spec.md",
      "index.md",
    ]);

    const byCategory = groupDocumentsByCategory(docs);
    expect(byCategory.map((g) => g.key)).toEqual([
      "prd",
      "screen_spec",
      "adr",
      "guide",
      "reference",
    ]);
  });

  it("treats agents.md and .okf/ paths as auxiliary documents alongside index/log/readme", () => {
    expect(isAuxiliaryDocument(makeDoc("AGENTS.md"))).toBe(true);
    expect(isAuxiliaryDocument(makeDoc("docs/AGENTS.md"))).toBe(true);
    expect(isAuxiliaryDocument(makeDoc(".okf/guides/setup.md"))).toBe(true);
    expect(isAuxiliaryDocument(makeDoc("docs/domains/documents/prd.md"))).toBe(false);

    const grouped = groupDocumentsByDomain([
      makeDoc("docs/AGENTS.md"),
      makeDoc("docs/prd.md", { docType: "Product Spec" }),
    ]);
    expect(grouped[0]?.documents.map((doc) => doc.path)).toEqual([
      "docs/prd.md",
      "docs/AGENTS.md",
    ]);
  });

  it("keeps canonical domain folders when mixed with root docs and clears conflicting non-canonical folders", () => {
    const mixedWithCanonical = groupDocumentsByDomain([
      makeDoc("docs/guide.md", { domain: "auth" }),
      makeDoc("docs/domains/auth/prd.md", { domain: "auth" }),
    ]);
    expect(mixedWithCanonical).toHaveLength(1);
    expect(mixedWithCanonical[0]?.folderPath).toBe("docs/domains/auth");

    const conflictingNonCanonical = groupDocumentsByDomain([
      makeDoc("docs/product/auth-prd.md", { domain: "auth" }),
      makeDoc("docs/guides/auth-guide.md", { domain: "auth" }),
    ]);
    expect(conflictingNonCanonical).toHaveLength(1);
    expect(conflictingNonCanonical[0]?.folderPath).toBeNull();
  });
});
