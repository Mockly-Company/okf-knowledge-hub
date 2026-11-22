import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardIssue } from "@/features/project-board/model";
import { buildProjectProgressSummary } from "../domain-progress";
import type { DocumentSummary } from "../model";
import { DocumentProgressOverview } from "./DocumentProgressOverview";

afterEach(cleanup);

const sampleDocs: DocumentSummary[] = [
  {
    path: "docs/domains/documents/prd.md",
    fileName: "prd.md",
    title: "Documents PRD",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Product Spec",
    domain: "documents",
    implStatus: "synced",
    modifiedAtUnixMs: 1,
    size: 4096,
  },
  {
    path: "docs/domains/documents/screen-spec.md",
    fileName: "screen-spec.md",
    title: "Documents 화면명세",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Screen Spec",
    domain: "documents",
    implStatus: "partial",
    designs: [{ title: "시안", image: "assets/d.svg" }],
    modifiedAtUnixMs: 1,
    size: 6144,
  },
  {
    path: "docs/domains/dashboard/prd.md",
    fileName: "prd.md",
    title: "Dashboard PRD",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    docType: "Product Spec",
    domain: "dashboard",
    implStatus: "unimplemented",
    modifiedAtUnixMs: 1,
    size: 2048,
  },
  {
    path: "docs/domains/dashboard/index.md",
    fileName: "index.md",
    title: "Dashboard 개요",
    documentId: null,
    frontmatterStatus: { status: "valid" },
    domain: "dashboard",
    modifiedAtUnixMs: 1,
    size: 512,
  },
];

const sampleIssues: BoardIssue[] = [
  {
    number: 10,
    title: "문서 UI 반영",
    url: "https://github.com/org/repo/issues/10",
    layer: "frontend",
    status: "done",
    kind: "작업",
    linkedDocPaths: ["docs/domains/documents/prd.md"],
    children: [],
  },
  {
    number: 11,
    title: "대시보드 API",
    url: "https://github.com/org/repo/issues/11",
    layer: "backend",
    status: "ready",
    kind: "작업",
    linkedDocPaths: ["docs/domains/dashboard/prd.md"],
    children: [],
  },
];

describe("DocumentProgressOverview", () => {
  it("renders project progress summary, status filter chips, and domain tiles", async () => {
    const user = userEvent.setup();
    const summary = buildProjectProgressSummary(sampleDocs, sampleIssues);
    const onStatusFilterChange = vi.fn();
    const onSelectDomainKey = vi.fn();

    render(
      <DocumentProgressOverview
        summary={summary}
        statusFilter="all"
        selectedDomainKey={null}
        onStatusFilterChange={onStatusFilterChange}
        onSelectDomainKey={onSelectDomainKey}
      />,
    );

    const region = screen.getByRole("region", { name: "문서 진행도 요약" });
    expect(within(region).getByText("총 4건")).toBeVisible();
    expect(within(region).getByText("12.5 KB")).toBeVisible();
    expect(within(region).getByText("1/3")).toBeVisible();
    expect(within(region).getByText("1/2")).toBeVisible();

    await user.click(within(region).getByRole("button", { name: /미반영/ }));
    expect(onStatusFilterChange).toHaveBeenCalledWith("unimplemented");

    await user.click(within(region).getByRole("button", { name: /Documents \(문서\)/ }));
    expect(onSelectDomainKey).toHaveBeenCalledWith("documents");

    await user.click(within(region).getByRole("button", { name: "도메인 요약 접기" }));
    expect(
      within(region).queryByRole("button", { name: /Documents \(문서\)/ }),
    ).not.toBeInTheDocument();
  });

  it("toggles active status filter and active domain tile back to default and provides domain reset action", async () => {
    const user = userEvent.setup();
    const summary = buildProjectProgressSummary(sampleDocs, sampleIssues);
    const onStatusFilterChange = vi.fn();
    const onSelectDomainKey = vi.fn();

    render(
      <DocumentProgressOverview
        summary={summary}
        statusFilter="partial"
        selectedDomainKey="documents"
        onStatusFilterChange={onStatusFilterChange}
        onSelectDomainKey={onSelectDomainKey}
      />,
    );

    await user.click(screen.getByRole("button", { name: /일부 수정/ }));
    expect(onStatusFilterChange).toHaveBeenCalledWith("all");

    await user.click(screen.getByRole("button", { name: "모든 도메인 보기" }));
    expect(onSelectDomainKey).toHaveBeenCalledWith(null);
  });
});
