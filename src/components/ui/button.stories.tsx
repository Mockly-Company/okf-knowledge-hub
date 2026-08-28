import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { expect, screen, waitFor } from "storybook/test";
import { Button, IconButton } from "./button";

const meta = { title: "UI/Button", component: Button, parameters: { layout: "centered" } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => <div className="flex flex-wrap items-center gap-[var(--space-3)]"><Button>저장</Button><Button variant="secondary">초안으로 저장</Button><Button variant="ghost">나중에 하기</Button><Button variant="destructive">문서 삭제</Button><Button disabled>저장할 수 없음</Button><Button loading>저장 중</Button><IconButton label="설정 열기"><Settings aria-hidden="true" strokeWidth={1.75} /></IconButton></div>,
};

function InteractionPreview() {
  const [count, setCount] = useState(0);
  return <div className="flex flex-col items-start gap-[var(--space-3)]"><Button onClick={() => setCount((value) => value + 1)}>저장</Button><IconButton label="설정 열기"><Settings aria-hidden="true" strokeWidth={1.75} /></IconButton><output aria-live="polite">활성화 횟수: {count}</output></div>;
}

export const Interaction: Story = {
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
    await waitFor(() => expect(screen.getByText("설정 열기")).toBeVisible());
  },
};
