import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen } from "storybook/test";
import { Select, SelectOption } from "./select";

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: { layout: "centered" },
  args: { children: null },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

function DocumentTypeSelect({ invalid = false }: { invalid?: boolean }) {
  return <div className="w-80"><Select aria-label="문서 유형" aria-invalid={invalid || undefined} defaultValue="guide"><SelectOption value="guide" description="읽는 사람을 위한 문서입니다.">Guide</SelectOption><SelectOption value="decision" description="선택한 근거를 기록합니다.">Decision</SelectOption></Select></div>;
}

export const Default: Story = { render: () => <DocumentTypeSelect /> };
export const Invalid: Story = { render: () => <DocumentTypeSelect invalid /> };
export const Keyboard: Story = {
  render: () => <DocumentTypeSelect />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "문서 유형" });
    await userEvent.click(trigger);
    await expect(screen.getByRole("listbox")).toHaveClass("rounded-t-none");
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("option", { name: /Decision/ })).toHaveAttribute("data-highlighted", "");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveTextContent("Decision");
  },
};
