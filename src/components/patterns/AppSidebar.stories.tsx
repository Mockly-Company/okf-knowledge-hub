import { createRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { AppSidebar } from "./AppSidebar";
import { documentFixtures } from "@/stories/fixtures/documents";
import { withAppProviders } from "@/stories/decorators/AppProviders";

function SidebarPreview() {
  return (
    <div className="min-h-dvh max-w-[280px]">
      <AppSidebar collapseButtonRef={createRef<HTMLButtonElement>()} onCollapse={() => {}} />
    </div>
  );
}

const meta = {
  title: "Patterns/AppSidebar",
  component: AppSidebar,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    collapseButtonRef: createRef<HTMLButtonElement>(),
    onCollapse: () => {},
  },
} satisfies Meta<typeof AppSidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const TreeExpanded: Story = {
  decorators: [
    withAppProviders({
      documents: {
        catalog: documentFixtures.defaultCatalog(),
        selectedPath: "docs/api/map-search.md",
      },
      router: { initialEntries: ["/documents"] },
    }),
  ],
  render: () => <SidebarPreview />,
  play: async ({ canvas }) => {
    const menu = canvas.getByRole("navigation", { name: "주 메뉴" });
    const documents = canvas.getByRole("link", { name: "Documents" });
    const docs = await canvas.findByRole("treeitem", { name: "docs" });
    const api = canvas.getByRole("treeitem", { name: "api" });
    const selected = canvas.getByRole("treeitem", { name: "지도 검색 API 계약" });

    await expect(menu).toContainElement(documents);
    await expect(documents).toHaveAttribute("aria-current", "page");
    await expect(docs).toHaveAttribute("aria-expanded", "true");
    await expect(api).toHaveAttribute("aria-expanded", "true");
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(getComputedStyle(docs).display).toBe("flex");
    await expect(getComputedStyle(documents).fontWeight).toBe("400");
    await expect(getComputedStyle(docs).fontWeight).toBe("400");
  },
};

export const TreeCollapsed: Story = {
  decorators: [
    withAppProviders({
      documents: { catalog: documentFixtures.defaultCatalog() },
      router: { initialEntries: ["/documents"] },
    }),
  ],
  render: () => <SidebarPreview />,
  play: async ({ canvas, userEvent }) => {
    const docs = await canvas.findByRole("treeitem", { name: "docs" });

    await expect(canvas.getByText("GitHub 계정")).toBeVisible();
    await expect(docs).toHaveAttribute("aria-expanded", "false");
    docs.focus();
    await expect(docs).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(docs).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("treeitem", { name: "api" })).toHaveFocus();
  },
};
