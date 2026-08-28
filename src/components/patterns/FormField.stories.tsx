import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Input } from "@/components/ui/input";
import { FormField } from "./FormField";

const meta = {
  title: "Patterns/FormField",
  component: FormField,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof FormField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RequiredWithError: Story = {
  args: {
    label: "문서 제목",
    children: null,
  },
  render: () => (
    <div className="w-80">
      <FormField
        label="문서 제목"
        required
        description="문서 트리와 뷰어에 표시됩니다."
        error="제목을 입력하세요."
      >
        <Input />
      </FormField>
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: /문서 제목/ });

    await expect(input).toBeRequired();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      "문서 트리와 뷰어에 표시됩니다. 제목을 입력하세요.",
    );
  },
};
