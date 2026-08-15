import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentCatalog } from "../model";
import { DocumentTree } from "./DocumentTree";

const mapSummary = {
  path: "docs/api/map.md",
  fileName: "map.md",
  title: "지도 API",
  documentId: null,
  frontmatterStatus: { status: "valid" as const },
  modifiedAtUnixMs: 1,
  size: 100,
};

const longTitle = "검색 결과가 없을 때 사용자에게 보여주는 매우 긴 안내 문서";

const catalog: DocumentCatalog = {
  documents: [mapSummary],
  roots: [
    {
      kind: "folder",
      name: "api",
      path: "docs/api",
      children: [
        { kind: "document", summary: mapSummary },
        {
          kind: "document",
          summary: {
            ...mapSummary,
            path: "docs/api/empty-state.md",
            fileName: "empty-state.md",
            title: longTitle,
          },
        },
      ],
    },
  ],
};

afterEach(cleanup);

describe("DocumentTree", () => {
  it("expands folders without navigating and opens documents", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    render(
      <DocumentTree
        entries={catalog.roots}
        selectedPath={null}
        onSelectDocument={onSelectDocument}
      />,
    );

    const folder = screen.getByRole("treeitem", { name: "api" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "지도 API" })).toBeNull();

    await user.click(folder);

    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(onSelectDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole("treeitem", { name: "지도 API" }));
    expect(onSelectDocument).toHaveBeenCalledWith("docs/api/map.md");
  });

  it("supports ArrowRight and ArrowLeft folder navigation", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTree
        entries={catalog.roots}
        selectedPath={null}
        onSelectDocument={() => {}}
      />,
    );
    const folder = screen.getByRole("treeitem", { name: "api" });
    folder.focus();

    await user.keyboard("{ArrowRight}");
    expect(folder).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: "지도 API" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(folder).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(folder).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the selected document ancestors and keeps long labels available", () => {
    render(
      <DocumentTree
        entries={catalog.roots}
        selectedPath="docs/api/empty-state.md"
        onSelectDocument={() => {}}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "api" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const document = screen.getByRole("treeitem", { name: longTitle });
    expect(document).toHaveAttribute("aria-selected", "true");
    expect(document).toHaveAttribute("title", longTitle);
  });

  it("keeps exactly one tree item in the Tab sequence", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTree
        entries={catalog.roots}
        selectedPath={null}
        onSelectDocument={() => {}}
      />,
    );
    const folder = screen.getByRole("treeitem", { name: "api" });
    await user.click(folder);

    const visibleItems = screen.getAllByRole("treeitem");
    expect(visibleItems.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(
      visibleItems.filter((item) => item.tabIndex === -1),
    ).toHaveLength(visibleItems.length - 1);
  });

  it("shows an empty state without adding search to the sidebar", () => {
    render(
      <DocumentTree
        entries={[]}
        selectedPath={null}
        onSelectDocument={() => {}}
      />,
    );

    expect(screen.getByText("표시할 문서가 없습니다.")).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
