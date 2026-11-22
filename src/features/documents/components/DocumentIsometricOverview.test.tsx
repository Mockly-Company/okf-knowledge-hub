import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardIssue } from "@/features/project-board/model";
import { buildProjectProgressSummary } from "../domain-progress";
import type { DocumentSummary } from "../model";
import {
  computeIsometricScene,
  DocumentIsometricOverview,
  type IsometricBoxBounds,
} from "./DocumentIsometricOverview";

afterEach(cleanup);

function makeDoc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    path: "docs/domains/documents/prd.md",
    fileName: "prd.md",
    title: "Documents PRD",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Product Spec",
    domain: "documents",
    hasCompanionHtml: true,
    modifiedAtUnixMs: 1,
    size: 4096,
    ...overrides,
  };
}

function boxesOverlap(a: IsometricBoxBounds, b: IsometricBoxBounds): boolean {
  return (
    a.minX < b.maxX - 1 &&
    a.maxX > b.minX + 1 &&
    a.minY < b.maxY - 1 &&
    a.maxY > b.minY + 1
  );
}

const sampleDocs: DocumentSummary[] = [
  makeDoc({
    path: "docs/domains/documents/index.md",
    fileName: "index.md",
    title: "Documents 개요",
    docType: null,
    size: 600,
    linkedPaths: ["docs/domains/documents/prd.md"],
  }),
  makeDoc({
    path: "docs/domains/documents/prd.md",
    fileName: "prd.md",
    title: "Documents PRD",
    implStatus: "synced",
    implNote: "전체 구현 반영",
    size: 18000,
    previewHeadings: ["배경", "기능", "예외"],
    linkedPaths: ["docs/domains/documents/screen-spec.md"],
  }),
  makeDoc({
    path: "docs/domains/documents/screen-spec.md",
    fileName: "screen-spec.md",
    title: "Documents 화면명세",
    docType: "Screen Spec",
    implStatus: "partial",
    implNote: "반응형 여백 조정 필요",
    size: 9000,
    wireframes: [{ title: "홈", image: "assets/home.svg" }],
    designs: [{ title: "시안", image: "assets/design.svg" }],
  }),
  makeDoc({
    path: "docs/domains/dashboard/prd.md",
    fileName: "prd.md",
    title: "Dashboard PRD",
    domain: "dashboard",
    implStatus: "unimplemented",
    size: 1200,
  }),
  makeDoc({
    path: "docs/domains/workspace/guide.md",
    fileName: "guide.md",
    title: "Workspace 가이드",
    docType: "Guide",
    domain: "workspace",
    hasCompanionHtml: false,
    size: 3200,
  }),
];

const sampleIssues: BoardIssue[] = [
  {
    number: 1,
    title: "작은 PRD 문서에 많은 이슈",
    url: "https://github.com/org/repo/issues/1",
    layer: "frontend",
    status: "ready",
    kind: "작업",
    linkedDocPaths: ["docs/domains/dashboard/prd.md"],
    assignees: [{ login: "alice", name: "김앨리스" }],
    children: [],
  },
  {
    number: 2,
    title: "대시보드 백엔드",
    url: "https://github.com/org/repo/issues/2",
    layer: "backend",
    status: "in_progress",
    kind: "작업",
    linkedDocPaths: ["docs/domains/dashboard/prd.md"],
    children: [],
  },
  {
    number: 3,
    title: "대시보드 테스트",
    url: "https://github.com/org/repo/issues/3",
    layer: "backend",
    status: "backlog",
    kind: "작업",
    linkedDocPaths: ["docs/domains/dashboard/prd.md"],
    children: [],
  },
];

describe("DocumentIsometricOverview", () => {
  it("computes non-overlapping isometric domain islands, valid coordinates, and metric-sensitive block heights", () => {
    const summary = buildProjectProgressSummary(sampleDocs, sampleIssues);
    const volumeScene = computeIsometricScene(summary, "volume");
    const issueScene = computeIsometricScene(summary, "issues");

    expect(volumeScene.islands).toHaveLength(3);
    for (let i = 0; i < volumeScene.islands.length; i += 1) {
      for (let j = i + 1; j < volumeScene.islands.length; j += 1) {
        expect(
          boxesOverlap(volumeScene.islands[i]!.bounds, volumeScene.islands[j]!.bounds),
        ).toBe(false);
      }
      const island = volumeScene.islands[i]!;
      for (const block of island.blocks) {
        expect(block.topPoints).not.toContain("NaN");
        expect(block.leftPoints).not.toContain("NaN");
        expect(block.rightPoints).not.toContain("NaN");
      }
      // Painter's order: non-decreasing sortKey
      for (let k = 1; k < island.blocks.length; k += 1) {
        expect(island.blocks[k]!.sortKey).toBeGreaterThanOrEqual(
          island.blocks[k - 1]!.sortKey,
        );
      }
    }

    const findHeight = (
      scene: ReturnType<typeof computeIsometricScene>,
      key: string,
    ) =>
      scene.islands.flatMap((isl) => isl.blocks).find((b) => b.key === key)!.height;

    // Volume mode: large Documents PRD (18KB) > small Dashboard PRD (1.2KB)
    expect(findHeight(volumeScene, "docs/domains/documents/prd.md")).toBeGreaterThan(
      findHeight(volumeScene, "docs/domains/dashboard/prd.md"),
    );
    // Issue mode: Dashboard PRD (3 issues) > Documents PRD (0 issues)
    expect(findHeight(issueScene, "docs/domains/dashboard/prd.md")).toBeGreaterThan(
      findHeight(issueScene, "docs/domains/documents/prd.md"),
    );
  });

  it("updates 2D HUD on focus/hover, switches height metrics, opens documents, and drills into domain maps", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    const onOpenDomainMap = vi.fn();
    const onOpenInNewWindow = vi.fn();
    const onAuditCodeSync = vi.fn();

    render(
      <DocumentIsometricOverview
        documents={sampleDocs}
        allDocuments={sampleDocs}
        boardIssues={sampleIssues}
        onSelectDocument={onSelectDocument}
        onOpenDomainMap={onOpenDomainMap}
        onOpenInNewWindow={onOpenInNewWindow}
        onAuditCodeSync={onAuditCodeSync}
      />,
    );

    const hud = screen.getByRole("complementary", { name: "선택 문서 상세 정보" });
    // Priority picks first unimplemented doc initially (Dashboard PRD)
    expect(within(hud).getByRole("heading", { name: "Dashboard PRD" })).toBeVisible();
    expect(within(hud).getByText("0/3 완료")).toBeVisible();
    expect(within(hud).getByText("김앨리스")).toBeVisible();

    // Hovering / focusing Documents PRD updates HUD
    const docsPrdBlock = screen.getByRole("button", { name: /Documents PRD/ });
    fireEvent.focus(docsPrdBlock);
    expect(within(hud).getByRole("heading", { name: "Documents PRD" })).toBeVisible();
    expect(within(hud).getByText("전체 구현 반영")).toBeVisible();
    expect(within(hud).getByText("17.6 KB")).toBeVisible();

    // Toggle height metric to issues
    await user.click(screen.getByRole("button", { name: "업무량 (이슈)" }));
    const blockAfter = screen.getByRole("button", { name: /Dashboard PRD/ });
    const blockDoc = screen.getByRole("button", { name: /Documents PRD/ });
    expect(
      Number(blockAfter.getAttribute("data-block-height")),
    ).toBeGreaterThan(Number(blockDoc.getAttribute("data-block-height")));

    // Clicking block opens the document
    await user.click(blockDoc);
    expect(onSelectDocument).toHaveBeenCalledWith(
      "docs/domains/documents/prd.md",
      "html",
    );

    // Keyboard focus + Enter on block also opens the document and updates HUD
    const guideBlock = screen.getByRole("button", { name: /Workspace 가이드/ });
    fireEvent.focus(guideBlock);
    fireEvent.keyDown(guideBlock, { key: "Enter" });
    expect(onSelectDocument).toHaveBeenCalledWith(
      "docs/domains/workspace/guide.md",
      "markdown",
    );

    // Drill-down to domain map from HUD
    await user.click(within(hud).getByRole("button", { name: "도메인 맵 보기" }));
    expect(onOpenDomainMap).toHaveBeenCalledWith("workspace");

    // Audit action from HUD
    fireEvent.focus(docsPrdBlock);
    await user.click(within(hud).getByRole("button", { name: "AI 코드 반영 점검" }));
    expect(onAuditCodeSync).toHaveBeenCalledTimes(1);
  });

  it("exposes accessible group role on SVG and clears dimmed state when hover/focus leaves while keeping HUD target", () => {
    render(
      <DocumentIsometricOverview
        documents={sampleDocs}
        allDocuments={sampleDocs}
        boardIssues={sampleIssues}
        onSelectDocument={vi.fn()}
      />,
    );

    const mapGroup = screen.getByRole("group", { name: "문서 전체 조망 2.5D 맵" });
    expect(mapGroup).toBeVisible();
    expect(
      screen.queryByRole("img", { name: "문서 전체 조망 2.5D 맵" }),
    ).not.toBeInTheDocument();

    const indexBlock = screen.getByRole("button", { name: /Documents 개요/ });
    const specBlock = screen.getByRole("button", { name: /Documents 화면명세/ });
    const hud = screen.getByRole("complementary", { name: "선택 문서 상세 정보" });

    // At rest: no blocks are dimmed
    expect(specBlock).not.toHaveClass("document-iso-block--dimmed");

    // Focusing indexBlock highlights its edge neighbor (PRD) and dims unrelated specBlock
    fireEvent.focus(indexBlock);
    expect(specBlock).toHaveClass("document-iso-block--dimmed");
    expect(within(hud).getByRole("heading", { name: "Documents 개요" })).toBeVisible();

    // Moving focus/mouse away clears dimming immediately while keeping HUD on the inspected doc
    fireEvent.blur(indexBlock);
    expect(specBlock).not.toHaveClass("document-iso-block--dimmed");
    expect(within(hud).getByRole("heading", { name: "Documents 개요" })).toBeVisible();
  });

  it("clears stale selectedKey when the selected document is filtered out so clearing the filter does not jump back to it", () => {
    const view = render(
      <DocumentIsometricOverview
        documents={sampleDocs}
        allDocuments={sampleDocs}
        boardIssues={sampleIssues}
        onSelectDocument={vi.fn()}
      />,
    );

    const hud = screen.getByRole("complementary", { name: "선택 문서 상세 정보" });
    // Initially fallback prioritizes Dashboard PRD (unimplemented)
    expect(within(hud).getByRole("heading", { name: "Dashboard PRD" })).toBeVisible();

    // Select Workspace 가이드
    fireEvent.focus(screen.getByRole("button", { name: /Workspace 가이드/ }));
    expect(within(hud).getByRole("heading", { name: "Workspace 가이드" })).toBeVisible();

    // Filter out Workspace 가이드
    view.rerender(
      <DocumentIsometricOverview
        documents={sampleDocs.filter((d) => d.domain !== "workspace")}
        allDocuments={sampleDocs}
        boardIssues={sampleIssues}
        onSelectDocument={vi.fn()}
      />,
    );
    expect(within(hud).getByRole("heading", { name: "Dashboard PRD" })).toBeVisible();

    // Restore full document set: HUD should stay on fallback (Dashboard PRD), NOT jump back to stale Workspace 가이드
    view.rerender(
      <DocumentIsometricOverview
        documents={sampleDocs}
        allDocuments={sampleDocs}
        boardIssues={sampleIssues}
        onSelectDocument={vi.fn()}
      />,
    );
    expect(within(hud).getByRole("heading", { name: "Dashboard PRD" })).toBeVisible();
  });
});
