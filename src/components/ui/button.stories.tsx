import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { expect, screen, waitFor } from "storybook/test";
import { Button, IconButton } from "./button";

const meta = { title: "UI/Button", component: Button, parameters: { layout: "centered" } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "저장" },
};

export const Disabled: Story = { args: { children: "저장할 수 없음", disabled: true } };

export const Loading: Story = { args: { children: "저장 중", loading: true } };

export const IconOnly: Story = {
  render: () => <IconButton label="설정 열기" tooltip={false}><Settings aria-hidden="true" strokeWidth={1.75} /></IconButton>,
  play: async ({ canvas, userEvent }) => {
    const icon = canvas.getByRole("button", { name: "설정 열기" });
    await userEvent.hover(icon);
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  },
};

function InteractionPreview() {
  const [count, setCount] = useState(0);
  return <div className="flex flex-col items-start gap-[var(--space-3)]"><Button onClick={() => setCount((value) => value + 1)}>저장</Button><IconButton label="설정 열기" tooltip={false}><Settings aria-hidden="true" strokeWidth={1.75} /></IconButton><output aria-live="polite">활성화 횟수: {count}</output></div>;
}

export const Keyboard: Story = {
  render: () => <InteractionPreview />,
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "저장" });
    const icon = canvas.getByRole("button", { name: "설정 열기" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText("활성화 횟수: 1")).toBeVisible();
    await userEvent.tab();
    await expect(icon).toHaveFocus();
    await userEvent.hover(icon);
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    await expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  },
};
