import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { TabsList, TabsTrigger } from "./tabs";

const meta = { title: "UI/Tabs", component: TabsList, parameters: { layout: "centered" } } satisfies Meta<typeof TabsList>;
export default meta;
type Story = StoryObj<typeof meta>;

function DocumentModeTabs() { const [selected, setSelected] = useState("preview"); return <TabsList aria-label="문서 보기"><TabsTrigger selected={selected === "preview"} onClick={() => setSelected("preview")}>미리보기</TabsTrigger><TabsTrigger selected={selected === "markdown"} onClick={() => setSelected("markdown")}>Markdown</TabsTrigger><TabsTrigger selected={false} disabled>History</TabsTrigger></TabsList>; }

export const States: Story = { render: () => <DocumentModeTabs /> };

export const Interaction: Story = {
  render: () => <DocumentModeTabs />,
  play: async ({ canvas, userEvent }) => {
    const preview = canvas.getByRole("tab", { name: "미리보기" });
    const markdown = canvas.getByRole("tab", { name: "Markdown" });
    await userEvent.tab(); await expect(preview).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}"); await expect(markdown).toHaveFocus();
    await userEvent.click(markdown); await expect(markdown).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("tab-indicator")).toHaveClass("transition-[transform,width]");
  },
};
