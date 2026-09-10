import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./StatusBadge";

const meta = {
  title: "Patterns/StatusBadge",
  component: StatusBadge,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "success", "info", "warning", "error"],
    },
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "준비됨",
    tone: "neutral",
  },
};

export const Compact: Story = {
  args: {
    children: "검토 중",
  },
  globals: { displayDensity: "compact" },
  render: () => <StatusBadge tone="info">검토 중</StatusBadge>,
};
