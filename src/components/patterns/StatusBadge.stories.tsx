import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./StatusBadge";

const meta = {
  title: "Patterns/StatusBadge",
  component: StatusBadge,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SemanticTones: Story = {
  args: {
    children: "상태",
  },
  render: () => (
    <div className="flex flex-wrap gap-[var(--space-2)]">
      <StatusBadge tone="neutral">준비됨</StatusBadge>
      <StatusBadge tone="success">로컬 저장됨</StatusBadge>
      <StatusBadge tone="info">검토 중</StatusBadge>
      <StatusBadge tone="warning">결정 필요</StatusBadge>
      <StatusBadge tone="error">저장 실패</StatusBadge>
    </div>
  ),
};

export const CompactDensity: Story = {
  args: {
    children: "검토 중",
  },
  globals: { displayDensity: "compact" },
  render: () => <StatusBadge tone="info">검토 중</StatusBadge>,
};
