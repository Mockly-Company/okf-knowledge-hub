import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/queryTestUtils";
import type { DocumentAsset, DocumentContent, DocumentSummary } from "../model";
import { extractDesignsFromProperties } from "./DesignLinksBar";
import { ScreenSpecDeck } from "./ScreenSpecDeck";

afterEach(cleanup);

const prdDoc: DocumentSummary = {
  path: "docs/domains/documents/prd.md",
  fileName: "prd.md",
  title: "문서 도메인 PRD",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "Product Spec",
  domain: "documents",
  hasCompanionHtml: true,
  modifiedAtUnixMs: 1,
  size: 100,
};

const docSpecSummary: DocumentSummary = {
  path: "docs/domains/documents/screen-spec.md",
  fileName: "screen-spec.md",
  title: "문서 화면명세서",
  description: "도메인 맵과 화면명세 보드 UI",
  linkedPaths: ["docs/domains/documents/prd.md"],
  designs: [
    {
      title: "도메인 맵 시안",
      image: "assets/map-mock.svg",
      status: "approved",
    },
  ],
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "Screen Spec",
  domain: "documents",
  hasCompanionHtml: true,
  modifiedAtUnixMs: 2,
  size: 150,
};

const dashSpecSummary: DocumentSummary = {
  path: "docs/domains/dashboard/screen-spec.md",
  fileName: "screen-spec.md",
  title: "대시보드 화면명세서",
  description: "알림 바로 보기 UI",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "Screen Spec",
  domain: "dashboard",
  hasCompanionHtml: false,
  modifiedAtUnixMs: 3,
  size: 120,
};

const mockContents: Record<string, DocumentContent> = {
  "docs/domains/documents/screen-spec.md": {
    summary: docSpecSummary,
    markdown: "# 문서 화면명세서",
    properties: {},
    tableOfContents: [],
    lastCommit: null,
    companionHtml: {
      path: "docs/domains/documents/screen-spec.html",
      html: "<html><body><h1>문서 화면명세 HTML</h1></body></html>",
      modifiedAtUnixMs: 2,
    },
  },
  "docs/domains/dashboard/screen-spec.md": {
    summary: dashSpecSummary,
    markdown: "# 대시보드 화면명세서\n\n알림 카드 상세 내용",
    properties: {},
    tableOfContents: [],
    lastCommit: null,
  },
};

const svgAsset: DocumentAsset = {
  kind: "svg",
  source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

describe("ScreenSpecDeck", () => {
  it("renders all screen specs in continuous strip mode with design previews and switches to slide mode", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    const readPreviewAsset = vi.fn(async () => svgAsset);

    render(
      <TestQueryProvider>
        <ScreenSpecDeck
          documents={[prdDoc, docSpecSummary, dashSpecSummary]}
          onSelectDocument={onSelectDocument}
          readDocumentPreview={async (path) => mockContents[path]!}
          readPreviewAsset={readPreviewAsset}
        />
      </TestQueryProvider>,
    );

    const firstCard = await screen.findByRole("article", {
      name: "문서 화면명세서 화면명세",
    });
    const secondCard = await screen.findByRole("article", {
      name: "대시보드 화면명세서 화면명세",
    });

    expect(firstCard).toBeVisible();
    expect(secondCard).toBeVisible();
    expect(
      within(firstCard).getByTitle("문서 화면명세서 화면명세 보기"),
    ).toBeInTheDocument();
    expect(await within(firstCard).findByAltText("도메인 맵 시안")).toBeVisible();
    expect(await within(secondCard).findByText("알림 카드 상세 내용")).toBeVisible();

    // Linked PRD chip opens connected PRD directly.
    await user.click(
      within(firstCard).getByRole("button", { name: "연결 · 문서 도메인 PRD" }),
    );
    expect(onSelectDocument).toHaveBeenCalledWith(
      "docs/domains/documents/prd.md",
      "html",
    );

    // Switch to slide-by-slide mode.
    await user.click(screen.getByRole("button", { name: "한 화면씩 넘기기" }));
    expect(screen.getByText("1 / 2")).toBeVisible();
    expect(
      screen.getByRole("tabpanel", { name: "1. 문서 화면명세서" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "대시보드 화면명세서 화면명세" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음 화면명세" }));
    expect(screen.getByText("2 / 2")).toBeVisible();
    expect(
      await screen.findByRole("article", { name: "대시보드 화면명세서 화면명세" }),
    ).toBeVisible();
  });

  it("classifies string designs with the same image extensions as Rust and batches strip loading", async () => {
    expect(
      extractDesignsFromProperties({
        designs: [
          "assets/map-mock.svg",
          "notes.txt",
          "assets/spec.pdf",
          "https://www.figma.com/file/123",
        ],
      }),
    ).toEqual([
      { title: "디자인 시안 1", url: null, image: "assets/map-mock.svg", status: null },
      { title: "디자인 시안 2", url: "notes.txt", image: null, status: null },
      { title: "디자인 시안 3", url: "assets/spec.pdf", image: null, status: null },
      {
        title: "디자인 시안 4",
        url: "https://www.figma.com/file/123",
        image: null,
        status: null,
      },
    ]);

    const user = userEvent.setup();
    const specs: DocumentSummary[] = Array.from({ length: 6 }, (_, idx) => ({
      path: `docs/domains/documents/screen-spec-${idx + 1}.md`,
      fileName: `screen-spec-${idx + 1}.md`,
      title: `화면명세 ${idx + 1}`,
      documentId: null,
      frontmatterStatus: { status: "valid" },
      docType: "Screen Spec",
      domain: "documents",
      hasCompanionHtml: false,
      modifiedAtUnixMs: idx + 1,
      size: 100,
    }));
    const readDocumentPreview = vi.fn(
      async (path: string): Promise<DocumentContent> => ({
        summary: specs.find((item) => item.path === path)!,
        markdown: `# ${path}`,
        properties: { designs: ["notes.txt"] },
        tableOfContents: [],
        lastCommit: null,
      }),
    );

    render(
      <TestQueryProvider>
        <ScreenSpecDeck
          documents={specs}
          onSelectDocument={vi.fn()}
          readDocumentPreview={readDocumentPreview}
        />
      </TestQueryProvider>,
    );

    expect(
      await screen.findByRole("article", { name: "화면명세 4 화면명세" }),
    ).toBeVisible();
    expect(readDocumentPreview).toHaveBeenCalledTimes(4);
    expect(
      screen.queryByRole("article", { name: "화면명세 5 화면명세" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "화면명세 더 불러오기 (2개 남음)" }),
    );
    expect(
      await screen.findByRole("article", { name: "화면명세 6 화면명세" }),
    ).toBeVisible();
    expect(readDocumentPreview).toHaveBeenCalledTimes(6);
  });
});
