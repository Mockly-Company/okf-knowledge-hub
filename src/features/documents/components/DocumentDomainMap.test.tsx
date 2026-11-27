import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardIssue } from "@/features/project-board/model";
import type { DocumentAsset, DocumentSummary } from "../model";
import {
  buildDomainEdges,
  DocumentDomainMap,
  layoutDomainEdgePathsWithBounds,
} from "./DocumentDomainMap";

afterEach(cleanup);

const prdDoc: DocumentSummary = {
  path: "docs/domains/documents/prd.md",
  fileName: "prd.md",
  title: "Documents 워크벤치 PRD",
  description: "탭, 도메인 맵, 화면명세 보드 요구사항을 정의합니다.",
  previewHeadings: ["배경 및 목표", "상세 요구사항"],
  linkedPaths: ["docs/domains/documents/screen-spec.md"],
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "Product Spec",
  domain: "documents",
  hasCompanionHtml: true,
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 200,
};

const specDoc: DocumentSummary = {
  path: "docs/domains/documents/screen-spec.md",
  fileName: "screen-spec.md",
  title: "Documents 워크벤치 화면명세서",
  description: "도메인 썸네일 맵과 화면명세 보드의 UI를 정의합니다.",
  previewHeadings: ["도메인 맵", "화면명세 보드"],
  linkedPaths: ["docs/domains/documents/prd.md"],
  designs: [
    {
      title: "도메인 맵 와이어프레임",
      image: "assets/domain-map.svg",
      status: "approved",
    },
  ],
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "Screen Spec",
  domain: "documents",
  hasCompanionHtml: true,
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 250,
};

const indexDoc: DocumentSummary = {
  path: "docs/domains/documents/index.md",
  fileName: "index.md",
  title: "Documents 도메인 개요",
  description: "문서 도메인의 목적과 문서 지도를 소개합니다.",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  domain: "documents",
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 80,
};

const adrDoc: DocumentSummary = {
  path: "docs/domains/documents/adr-001.md",
  fileName: "adr-001.md",
  title: "문서 캐시 ADR",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  docType: "ADR",
  domain: "documents",
  modifiedAtUnixMs: 1_721_000_000_000,
  size: 90,
};

const wiredSpecDoc: DocumentSummary = {
  ...specDoc,
  wireframes: [
    { title: "도메인 맵 화면", image: "assets/domain-map-wireframe.svg" },
  ],
  designs: [
    {
      title: "도메인 맵 시안",
      image: "assets/domain-map.svg",
      status: "approved",
      wireframe: "도메인 맵 화면",
    },
  ],
};

const svgAsset: DocumentAsset = {
  kind: "svg",
  source:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

function columnTitles(): string[] {
  return screen
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label") ?? "");
}

describe("DocumentDomainMap", () => {
  it("orders stage columns as overview → PRD → screen spec → design, then ADR", () => {
    render(
      <DocumentDomainMap
        documents={[adrDoc, wiredSpecDoc, prdDoc, indexDoc]}
        onSelectDocument={vi.fn()}
        readAsset={vi.fn(async () => svgAsset)}
      />,
    );

    expect(columnTitles()).toEqual([
      "개요",
      "기획 · PRD",
      "화면명세",
      "디자인",
      "설계 · ADR",
    ]);
    const overview = screen.getByRole("group", { name: "개요" });
    const indexCard = within(overview).getByRole("article", {
      name: "Documents 도메인 개요",
    });
    expect(within(indexCard).getByText("개요")).toBeVisible();
  });

  it("uses the first wireframe as the screen spec thumbnail and flags specs without one", async () => {
    const readAsset = vi.fn(async () => svgAsset);
    const bareSpec: DocumentSummary = {
      ...specDoc,
      path: "docs/domains/documents/settings-screen-spec.md",
      fileName: "settings-screen-spec.md",
      title: "설정 화면명세서",
      designs: [],
      linkedPaths: [],
    };
    render(
      <DocumentDomainMap
        documents={[prdDoc, wiredSpecDoc, bareSpec]}
        onSelectDocument={vi.fn()}
        readAsset={readAsset}
      />,
    );

    const wiredCard = screen.getByRole("article", { name: specDoc.title });
    expect(
      await within(wiredCard).findByAltText("도메인 맵 화면"),
    ).toBeVisible();
    expect(readAsset).toHaveBeenCalledWith(
      specDoc.path,
      "assets/domain-map-wireframe.svg",
    );
    expect(within(wiredCard).getByText("와이어프레임 1")).toBeVisible();

    const bareCard = screen.getByRole("article", { name: "설정 화면명세서" });
    expect(within(bareCard).getByText("와이어프레임 없음")).toBeVisible();
  });

  it("shows each linked design as a card after its screen spec, with an expandable preview", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    render(
      <DocumentDomainMap
        documents={[prdDoc, wiredSpecDoc]}
        onSelectDocument={onSelectDocument}
        readAsset={vi.fn(async () => svgAsset)}
      />,
    );

    const designColumn = screen.getByRole("group", { name: "디자인" });
    const designCard = within(designColumn).getByRole("article", {
      name: "도메인 맵 시안 디자인 시안",
    });
    expect(within(designCard).getByText("approved")).toBeVisible();
    expect(within(designCard).getByText("와이어프레임 · 도메인 맵 화면")).toBeVisible();

    await user.click(
      await within(designCard).findByRole("button", { name: "도메인 맵 시안 크게 보기" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "도메인 맵 시안" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "미리보기 닫기" }));

    await user.click(
      within(designCard).getByRole("button", {
        name: `← ${specDoc.title}`,
      }),
    );
    expect(onSelectDocument).toHaveBeenCalledWith(specDoc.path, "html");
  });

  it("groups cards into domain stage columns with title above thumbnail and clickable title relation chips without raw paths", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    const onSelectScreenSpecs = vi.fn();
    const onOpenInNewWindow = vi.fn();

    render(
      <DocumentDomainMap
        documents={[prdDoc, specDoc]}
        onSelectDocument={onSelectDocument}
        onSelectScreenSpecs={onSelectScreenSpecs}
        onOpenInNewWindow={onOpenInNewWindow}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Documents (문서)" }),
    ).toBeVisible();

    const prdCard = screen.getByRole("article", {
      name: "Documents 워크벤치 PRD",
    });
    expect(within(prdCard).getByText("배경 및 목표")).toBeVisible();
    expect(within(prdCard).getByText("HTML")).toBeVisible();
    expect(
      within(prdCard).queryByText("docs/domains/documents/prd.md"),
    ).not.toBeInTheDocument();

    // Clicking the title relation chip navigates using target document title.
    await user.click(
      within(prdCard).getByRole("button", {
        name: "→ Documents 워크벤치 화면명세서",
      }),
    );
    expect(onSelectDocument).toHaveBeenCalledWith(
      "docs/domains/documents/screen-spec.md",
      "html",
    );

    // Popout opens in a separate OS window.
    await user.click(
      within(prdCard).getByRole("button", { name: "새 창으로 열기" }),
    );
    expect(onOpenInNewWindow).toHaveBeenCalledWith(
      "docs/domains/documents/prd.md",
      "html",
      "Documents 워크벤치 PRD",
    );

    // Quick-jump button switches to Screen Spec Deck filtered to this domain.
    await user.click(
      screen.getByRole("button", { name: "화면명세 모아보기" }),
    );
    expect(onSelectScreenSpecs).toHaveBeenCalledWith("documents");
  });

  it("prevents stage-skipping overview→screen_spec edges when PRDs exist and drops reverse arrows", () => {
    const overviewSkipping: DocumentSummary = {
      ...indexDoc,
      linkedPaths: [
        "docs/domains/documents/prd.md",
        "docs/domains/documents/screen-spec.md",
      ],
    };
    const prdOnlyReverseTarget: DocumentSummary = {
      ...prdDoc,
      linkedPaths: ["docs/domains/documents/index.md"],
    };
    const specLinkingReverse: DocumentSummary = {
      ...specDoc,
      designs: [],
      linkedPaths: ["docs/domains/documents/prd.md"],
    };
    const adrLinkingReverse: DocumentSummary = {
      ...adrDoc,
      linkedPaths: ["docs/domains/documents/screen-spec.md"],
    };

    const edges = buildDomainEdges([
      overviewSkipping,
      prdOnlyReverseTarget,
      specLinkingReverse,
      adrLinkingReverse,
    ]);
    const ids = edges.map((e) => e.id);

    expect(ids).toContain(
      "docs/domains/documents/index.md->docs/domains/documents/prd.md",
    );
    expect(ids).not.toContain(
      "docs/domains/documents/index.md->docs/domains/documents/screen-spec.md",
    );
    // Reverse link screen_spec → prd is normalized forward as prd → screen_spec instead of backwards.
    expect(ids).toContain(
      "docs/domains/documents/prd.md->docs/domains/documents/screen-spec.md",
    );
    expect(ids).not.toContain(
      "docs/domains/documents/screen-spec.md->docs/domains/documents/prd.md",
    );
    expect(ids).not.toContain(
      "docs/domains/documents/prd.md->docs/domains/documents/index.md",
    );
    expect(ids).not.toContain(
      "docs/domains/documents/adr-001.md->docs/domains/documents/screen-spec.md",
    );

    // Without any PRD in the domain, overview → screen_spec flow is allowed.
    const noPrdEdges = buildDomainEdges([indexDoc, specLinkingReverse]);
    expect(noPrdEdges.map((e) => e.id)).toContain(
      "docs/domains/documents/index.md->docs/domains/documents/screen-spec.md",
    );
  });

  it("renders color-coded impl status cards from frontmatter/board and triggers domain code-sync audit", async () => {
    const user = userEvent.setup();
    const onAuditCodeSync = vi.fn();

    const syncedPrd: DocumentSummary = {
      ...prdDoc,
      implStatus: "synced",
      implNote: "전체 엔드포인트 반영됨",
    };
    const partialSpec: DocumentSummary = {
      ...specDoc,
      designs: [],
      implStatus: "partial",
      implNote: "모바일 필터 바 미구현",
    };
    const unimplementedPrd: DocumentSummary = {
      ...prdDoc,
      path: "docs/domains/documents/billing-prd.md",
      fileName: "billing-prd.md",
      title: "결제 PRD",
      linkedPaths: [],
    };
    const boardIssues: BoardIssue[] = [
      {
        number: 201,
        title: "[프론트] 결제 UI",
        url: "https://github.com/org/repo/issues/201",
        layer: "frontend",
        status: "backlog",
        kind: "작업",
        linkedDocPaths: ["docs/domains/documents/billing-prd.md"],
        children: [],
      },
    ];

    render(
      <DocumentDomainMap
        documents={[syncedPrd, partialSpec, unimplementedPrd]}
        boardIssues={boardIssues}
        onSelectDocument={vi.fn()}
        onAuditCodeSync={onAuditCodeSync}
      />,
    );

    const legend = screen.getByRole("region", { name: "코드 반영 상태 범례" });
    expect(within(legend).getByText("코드 반영 완료")).toBeVisible();
    expect(within(legend).getByText("일부 수정 필요")).toBeVisible();
    expect(within(legend).getByText("미반영")).toBeVisible();

    const syncedCard = screen.getByRole("article", { name: syncedPrd.title });
    expect(syncedCard).toHaveAttribute("data-impl-status", "synced");
    expect(syncedCard).toHaveClass("document-map-card--impl-synced");
    expect(within(syncedCard).getByText("전체 엔드포인트 반영됨")).toBeVisible();

    const partialCard = screen.getByRole("article", { name: partialSpec.title });
    expect(partialCard).toHaveAttribute("data-impl-status", "partial");
    expect(partialCard).toHaveClass("document-map-card--impl-partial");
    expect(within(partialCard).getByText("모바일 필터 바 미구현")).toBeVisible();

    const boardCard = screen.getByRole("article", { name: "결제 PRD" });
    expect(boardCard).toHaveAttribute("data-impl-status", "unimplemented");
    expect(boardCard).toHaveClass("document-map-card--impl-unimplemented");
    expect(within(boardCard).getByText("미착수 (미점검)")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "AI 코드 반영 점검" }));
    expect(onAuditCodeSync).toHaveBeenCalledTimes(1);
    expect(onAuditCodeSync.mock.calls[0]?.[0]?.key).toBe("documents");
  });

  it("highlights connected edges and dims unrelated edges on keyboard focus of a card control (S2)", () => {
    const colLeft: Record<string, number> = {
      overview: 0,
      prd: 300,
      screen_spec: 600,
      adr: 900,
    };
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.classList.contains("document-domain-map__board")) {
          return new DOMRect(0, 0, 1200, 400);
        }
        const cat = this.getAttribute("data-category");
        if (cat && cat in colLeft) {
          return new DOMRect(colLeft[cat], 20, 220, 120);
        }
        return new DOMRect(0, 0, 0, 0);
      });

    try {
      const bareSpec: DocumentSummary = {
        ...specDoc,
        designs: [],
        linkedPaths: ["docs/domains/documents/adr-001.md"],
      };
      const { container } = render(
        <DocumentDomainMap
          documents={[indexDoc, prdDoc, bareSpec, adrDoc]}
          onSelectDocument={vi.fn()}
        />,
      );

      const overviewCard = screen.getByRole("article", { name: indexDoc.title });
      const overviewBtn = within(overviewCard).getAllByRole("button")[0]!;
      const connectedPath = () =>
        container.querySelector(
          'path[data-edge-from="docs/domains/documents/index.md"][data-edge-to="docs/domains/documents/prd.md"]',
        );
      const unrelatedPath = () =>
        container.querySelector(
          'path[data-edge-from="docs/domains/documents/screen-spec.md"][data-edge-to="docs/domains/documents/adr-001.md"]',
        );

      expect(connectedPath()).not.toBeNull();
      expect(unrelatedPath()).not.toBeNull();

      fireEvent.focus(overviewBtn);
      expect(overviewCard).toHaveAttribute("data-focused-or-hovered", "true");
      expect(connectedPath()).toHaveAttribute("opacity", "1");
      expect(connectedPath()).toHaveAttribute("stroke-width", "2.25");
      expect(unrelatedPath()).toHaveAttribute("opacity", "0.14");

      fireEvent.blur(overviewBtn, { relatedTarget: null });
      expect(overviewCard).not.toHaveAttribute("data-focused-or-hovered");
      expect(unrelatedPath()).not.toHaveAttribute("opacity", "0.14");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("routes single-source fan-out through a shared bus X, orders downward trunks outer-to-inner, and routes skip-column edges below intermediate cards", () => {
    const makeEl = (left: number, top: number, width = 220, height = 100) => {
      const el = document.createElement("article");
      el.getBoundingClientRect = () => new DOMRect(left, top, width, height);
      return el;
    };
    const board = document.createElement("div");
    const boardRect = new DOMRect(0, 0, 1200, 600);

    // Helper to extract vertical segments x coordinates from an SVG path string
    const verticalXs = (d: string): number[] => {
      const xs: number[] = [];
      const tokens = d.match(/[MLQ]\s*[^MLQ]+/g) ?? [];
      let cx = 0;
      let cy = 0;
      for (const tok of tokens) {
        const cmd = tok[0];
        const nums = tok.slice(1).trim().split(/\s+/).map(Number);
        if (cmd === "M") {
          [cx, cy] = nums;
        } else if (cmd === "L") {
          const [nx, ny] = nums;
          if (Math.abs(nx - cx) < 0.5 && Math.abs(ny - cy) > 4) {
            xs.push(nx);
          }
          cx = nx;
          cy = ny;
        } else if (cmd === "Q") {
          [, , cx, cy] = nums;
        }
      }
      return xs;
    };

    const horizontalYs = (d: string): number[] => {
      const ys: number[] = [];
      const tokens = d.match(/[MLQ]\s*[^MLQ]+/g) ?? [];
      let cx = 0;
      let cy = 0;
      for (const tok of tokens) {
        const cmd = tok[0];
        const nums = tok.slice(1).trim().split(/\s+/).map(Number);
        if (cmd === "M") {
          [cx, cy] = nums;
        } else if (cmd === "L") {
          const [nx, ny] = nums;
          if (Math.abs(ny - cy) < 0.5 && Math.abs(nx - cx) > 4) {
            ys.push(ny);
          }
          cx = nx;
          cy = ny;
        } else if (cmd === "Q") {
          [, , cx, cy] = nums;
        }
      }
      return ys;
    };

    // 1) Fan-out from one source card shares ONE vertical trunk X
    const fanRefs = new Map<string, HTMLElement>([
      ["overview", makeEl(0, 100)],
      ["prd1", makeEl(280, 20)],
      ["prd2", makeEl(280, 140)],
      ["prd3", makeEl(280, 260)],
    ]);
    const fanCols = new Map<string, number>([
      ["overview", 0],
      ["prd1", 1],
      ["prd2", 1],
      ["prd3", 1],
    ]);
    const fanEdges = layoutDomainEdgePathsWithBounds(
      [
        { id: "overview->prd1", fromKey: "overview", toKey: "prd1", kind: "explicit" },
        { id: "overview->prd2", fromKey: "overview", toKey: "prd2", kind: "explicit" },
        { id: "overview->prd3", fromKey: "overview", toKey: "prd3", kind: "explicit" },
      ],
      fanRefs,
      board,
      boardRect,
      fanCols,
    );
    const fanVerts = fanEdges.edges.flatMap((e) => verticalXs(e.path));
    expect(fanVerts.length).toBeGreaterThanOrEqual(2);
    for (const vx of fanVerts) {
      expect(Math.abs(vx - fanVerts[0]!)).toBeLessThan(0.5);
    }

    // 2) Two downward-trending sources place higher anchor outer-right (> lower anchor X)
    const crossRefs = new Map<string, HTMLElement>([
      ["p1", makeEl(0, 20)],
      ["p2", makeEl(0, 150)],
      ["s1", makeEl(280, 280)],
      ["s2", makeEl(280, 410)],
    ]);
    const crossCols = new Map<string, number>([
      ["p1", 0],
      ["p2", 0],
      ["s1", 1],
      ["s2", 1],
    ]);
    const crossRes = layoutDomainEdgePathsWithBounds(
      [
        { id: "p1->s1", fromKey: "p1", toKey: "s1", kind: "explicit" },
        { id: "p2->s2", fromKey: "p2", toKey: "s2", kind: "explicit" },
      ],
      crossRefs,
      board,
      boardRect,
      crossCols,
    );
    const p1VertX = verticalXs(crossRes.edges.find((e) => e.id === "p1->s1")!.path)[0]!;
    const p2VertX = verticalXs(crossRes.edges.find((e) => e.id === "p2->s2")!.path)[0]!;
    expect(p1VertX).toBeGreaterThan(p2VertX + 5);

    // 3) Multi-column skip edge routes underneath intermediate column obstacle card
    const skipRefs = new Map<string, HTMLElement>([
      ["idx", makeEl(0, 40, 220, 120)],
      ["adr", makeEl(280, 40, 220, 240)], // col 1 obstacle: bottom = 280
      ["guide", makeEl(560, 40, 220, 120)],
    ]);
    const skipCols = new Map<string, number>([
      ["idx", 0],
      ["adr", 1],
      ["guide", 2],
    ]);
    const skipRes = layoutDomainEdgePathsWithBounds(
      [{ id: "idx->guide", fromKey: "idx", toKey: "guide", kind: "explicit" }],
      skipRefs,
      board,
      boardRect,
      skipCols,
    );
    const bypassYs = horizontalYs(skipRes.edges[0]!.path);
    expect(bypassYs.some((y) => y > 280)).toBe(true);
    expect(skipRes.maxY).toBeGreaterThan(280);
  });
});
