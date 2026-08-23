import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoaderCircle, Settings } from "lucide-react";
import { expect, screen, waitFor } from "storybook/test";
import { Button } from "./button";
import { Tooltip } from "./tooltip";

const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "저장",
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "초안으로 저장",
  },
};

export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "나중에 하기",
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: "문서 삭제",
  },
};

export const IconOnly: Story = {
  render: () => (
    <Tooltip content="설정 열기">
      <Button variant="icon" aria-label="설정 열기">
        <Settings aria-hidden="true" strokeWidth={1.75} />
      </Button>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "설정 열기" });

    await expect(button).toHaveAttribute("aria-label", "설정 열기");
    await expect(button).toHaveAccessibleName("설정 열기");
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByText("설정 열기")).toBeVisible();
    });
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: "저장할 수 없음",
  },
};

export const Loading: Story = {
  args: {
    disabled: true,
    "aria-busy": true,
    children: (
      <>
        <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} />
        저장 중
      </>
    ),
  },
};

function KeyboardActivationPreview() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-start gap-[var(--space-3)]">
      <Button onClick={() => setCount((value) => value + 1)}>저장</Button>
      <output aria-live="polite">활성화 횟수: {count}</output>
    </div>
  );
}

export const PrimaryKeyboardActivation: Story = {
  render: () => <KeyboardActivationPreview />,
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "저장" });

    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText("활성화 횟수: 1")).toBeVisible();
  },
};
