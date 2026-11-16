import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSummary } from "../model";
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

describe("DocumentDomainMap", () => {
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
