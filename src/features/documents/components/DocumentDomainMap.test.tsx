import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentAsset, DocumentSummary } from "../model";
import { DocumentDomainMap } from "./DocumentDomainMap";

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
});
