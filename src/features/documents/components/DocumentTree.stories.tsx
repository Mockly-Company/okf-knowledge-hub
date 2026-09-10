import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { documentFixtures } from "@/stories/fixtures/documents";
import { DocumentTree } from "./DocumentTree";

function TreePreview({ selectedPath = null }: { selectedPath?: string | null }) {
  const catalog = documentFixtures.defaultCatalog();

  return (
    <div className="w-[244px] bg-[var(--color-canvas)] p-[var(--space-2)]">
      <DocumentTree
        entries={catalog.roots}
        selectedPath={selectedPath}
        onSelectDocument={() => {}}
        onNewDocument={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Documents/DocumentTree",
  component: TreePreview,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TreePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  render: () => <TreePreview selectedPath={null} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("treeitem", { name: "docs" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  },
};

export const Expanded: Story = {
  render: () => <TreePreview selectedPath={null} />,
  play: async ({ canvas, userEvent }) => {
    const folder = canvas.getByRole("treeitem", { name: "docs" });
    await userEvent.click(folder);

    await expect(folder).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("treeitem", { name: "api" })).toBeVisible();
  },
};

export const Selected: Story = {
  render: () => <TreePreview selectedPath="docs/api/map-search.md" />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("treeitem", { name: "지도 검색 API 계약" }),
    ).toHaveAttribute("aria-selected", "true");
  },
};

export const FolderNewDocument: Story = {
  render: () => <TreePreview selectedPath="docs/api/map-search.md" />,
  play: async ({ canvas, userEvent }) => {
    const create = canvas.getByRole("button", { name: "api에 새 문서" });
    create.focus();
    await expect(create).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
  },
};
