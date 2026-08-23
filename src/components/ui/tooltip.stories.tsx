import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal, Settings } from "lucide-react";
import { expect, waitFor, screen } from "storybook/test";
import { Button } from "./button";
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

export const TextAction: Story = {
  render: () => (
    <Tooltip content="문서 저장">
      <Button variant="secondary">저장</Button>
    </Tooltip>
  ),
};

export const IconOnlyControl: Story = {
  render: () => (
    <Tooltip content="문서 설정 열기">
      <Button variant="icon" aria-label="설정 열기">
        <Settings aria-hidden="true" strokeWidth={1.75} />
      </Button>
    </Tooltip>
  ),
};

export const KeyboardFocusBehavior: Story = {
  render: () => (
    <Tooltip content="문서 더보기 열기">
      <Button variant="icon" aria-label="더보기 열기">
        <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
      </Button>
    </Tooltip>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "더보기 열기" });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await waitFor(() => {
      expect(screen.getByText("문서 더보기 열기")).toBeVisible();
    });
  },
};

export const LongContent: Story = {
  render: () => (
    <Tooltip content="리뷰 기준, 최근 변경 이유, 관련 문서 링크까지 한 번에 확인합니다.">
      <Button variant="icon" aria-label="리뷰 요약 열기">
        <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
      </Button>
    </Tooltip>
  ),
};
