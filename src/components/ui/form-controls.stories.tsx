import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen } from "storybook/test";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Radio } from "./radio";
import { Select, SelectOption } from "./select";
import { Textarea } from "./textarea";

const meta = { title: "UI/Form controls", component: Input, parameters: { layout: "centered" } } satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-[var(--space-3)]">
      <Input aria-label="문서 제목" defaultValue="지도 검색 API 계약" />
      <Input aria-label="문서 제목 오류" aria-invalid="true" />
      <Input aria-label="문서 제목 비활성" defaultValue="수정할 수 없음" disabled />
      <Textarea aria-label="Markdown 기본" defaultValue="# 지도 검색 API 계약" rows={3} />
      <Textarea aria-label="Markdown 오류" aria-invalid="true" rows={3} />
      <fieldset className="grid gap-[var(--space-3)] border-0 p-0"><legend>문서 공개 범위</legend><label className="flex cursor-pointer items-center gap-[var(--space-2)]"><Checkbox defaultChecked />공개</label><label className="flex items-center gap-[var(--space-2)] text-[var(--color-text-disabled)]"><Checkbox disabled />공개 불가</label><label className="flex cursor-pointer items-center gap-[var(--space-2)]"><Radio name="visibility" defaultChecked />기본 공개 범위</label></fieldset>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole("checkbox", { name: "공개" });
    await expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await expect(checkbox).not.toBeChecked();
  },
};

export const SelectInteraction: Story = {
  render: () => (
    <div className="grid w-80 gap-[var(--space-4)]">
      <Select aria-label="문서 유형" defaultValue="guide"><SelectOption value="guide" description="읽는 사람을 위한 문서입니다.">Guide</SelectOption><SelectOption value="decision" description="선택한 근거를 기록합니다.">Decision</SelectOption></Select>
      <Select aria-label="오류 문서 유형" aria-invalid="true" defaultValue="guide"><SelectOption value="guide">Guide</SelectOption><SelectOption value="decision">Decision</SelectOption></Select>
      <Button data-state="open" variant="secondary">메뉴 열림</Button>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", { name: "문서 유형" });
    await expect(trigger).toHaveClass("w-full");
    await userEvent.click(trigger);
    await expect(screen.getByRole("listbox")).toHaveClass("rounded-t-none");
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("option", { name: /Decision/ })).toHaveAttribute("data-highlighted", "");
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveTextContent("Decision");
    const invalid = canvas.getByRole("combobox", { name: "오류 문서 유형" });
    await userEvent.click(invalid);
    await expect(getComputedStyle(invalid).outlineStyle).toBe("none");
    await userEvent.keyboard("{Escape}");
  },
};
