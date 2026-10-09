import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { Button } from "@/components/ui/button";
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

function RequiredFieldForm() {
  const [title, setTitle] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const missing = submitted && !title.trim();

  return (
    <form
      noValidate
      className="grid w-80 max-w-full gap-[var(--space-4)]"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <FormField
        label="문서 제목"
        required
        error={missing ? "문서 제목을 입력해 주세요." : undefined}
        errorVisuallyHidden
      >
        <Input
          placeholder="문서 제목을 입력하세요"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit">문서 만들기</Button>
      </div>
    </form>
  );
}

export const Default: Story = {
  args: { label: "문서 제목", children: null },
  render: () => <RequiredFieldForm />,
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: /문서 제목/ });
    await expect(input).toBeRequired();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("placeholder", "문서 제목을 입력하세요");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    const required = canvas.getByText("필수");
    const label = required.closest("label")!;
    await expect(parseFloat(getComputedStyle(required).fontSize)).toBe(
      parseFloat(getComputedStyle(label).fontSize),
    );
    await expect(parseFloat(getComputedStyle(required).marginLeft)).toBe(8);
  },
};

export const RequiredWithError: Story = {
  name: "Required Missing After Submit",
  args: {
    label: "문서 제목",
    children: null,
  },
  render: () => <RequiredFieldForm />,
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox", { name: /문서 제목/ });
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "문서 만들기" }));
    await expect(input).toBeRequired();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      "문서 제목을 입력해 주세요.",
    );
    await expect(getComputedStyle(canvas.getByRole("alert")).position).toBe("absolute");
    await userEvent.type(input, "새 문서");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.clear(input);
    await expect(canvas.getByRole("alert")).toHaveTextContent("문서 제목을 입력해 주세요.");
  },
};
