import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal, Settings } from "lucide-react";
import { expect, waitFor, screen } from "storybook/test";
import { IconButton } from "./button";
import { Tooltip } from "./tooltip";

const meta = {
  title: "UI/Tooltip",
  component: Tooltip,
  parameters: {
    layout: "centered",
  },
  args: {
    content: "",
  },
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <IconButton label="문서 설정 열기">
      <Settings aria-hidden="true" strokeWidth={1.75} />
    </IconButton>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "문서 설정 열기" });

    await userEvent.hover(trigger);
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeVisible());
    const tooltip = screen.getByRole("tooltip");
    await expect(tooltip).toHaveAttribute("data-state", "delayed-open");
    await expect(getComputedStyle(tooltip).animationName).toBe("okhub-popover-in");
    await expect(getComputedStyle(tooltip).animationDuration).toBe("0.18s");
  },
};

export const Interaction: Story = {
  render: () => (
    <IconButton label="문서 더보기 열기">
      <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
    </IconButton>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "문서 더보기 열기" });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByText("문서 더보기 열기")).toBeVisible();
    });
    const tooltip = screen.getByRole("tooltip");
    await expect(tooltip).toHaveAttribute("data-state", "instant-open");
    await expect(getComputedStyle(tooltip).animationName).toBe("okhub-popover-in");
    await expect(getComputedStyle(tooltip).animationDuration).toBe("0.18s");
    await userEvent.keyboard("{Escape}");
    await expect(tooltip).toHaveAttribute("data-state", "closed");
    await expect(getComputedStyle(tooltip).animationName).toBe("okhub-popover-out");
  },
};
