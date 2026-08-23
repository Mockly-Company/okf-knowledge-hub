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

export const DocumentsSelected: Story = {
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
  play: async ({ canvas, userEvent }) => {
    const menu = canvas.getByRole("navigation", { name: "주 메뉴" });
    const documents = canvas.getByRole("link", { name: "Documents" });

    await expect(menu).toBeVisible();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(documents).toHaveFocus();
    await expect(documents).toHaveAttribute("aria-current", "page");
  },
};

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
};

export const UserAreaShown: Story = {
  decorators: [withAppProviders({ router: { initialEntries: ["/"] } })],
  render: () => <SidebarPreview />,
};

export const ReauthenticationRequired: Story = {
  decorators: [
    withAppProviders({
      workspace: {
        authState: { status: "reauthentication_required" },
        currentWorkspace: null,
      },
      router: { initialEntries: ["/"] },
    }),
  ],
  render: () => <SidebarPreview />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("GitHub 재로그인 필요")).toBeVisible();
    await expect(canvas.getByText("Settings에서 연결")).toBeVisible();
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument();
  },
};
