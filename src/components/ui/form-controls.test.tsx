import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Radio } from "./radio";
import { Select } from "./select";
import { TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";

describe("form control primitives", () => {
  it("applies the shared control contract to text inputs", () => {
    render(<Input aria-label="제목" />);
    expect(screen.getByRole("textbox", { name: "제목" })).toHaveClass(
      "border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
    );
  });

  it("applies the shared document typography to textareas", () => {
    render(<Textarea aria-label="Markdown" />);
    expect(screen.getByRole("textbox", { name: "Markdown" })).toHaveClass(
      "text-[length:var(--font-document-size)]",
    );
  });

  it("renders native select and checkbox controls with shared focus behavior", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Select aria-label="Draft" defaultValue="main">
          <option value="main">main</option>
          <option value="draft">draft</option>
        </Select>
        <Checkbox aria-label="별도 변경" onChange={onChange} />
        <Radio aria-label="저장소" name="repository" />
      </>,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Draft" }), "draft");
    await user.click(screen.getByRole("checkbox", { name: "별도 변경" }));
    await user.click(screen.getByRole("radio", { name: "저장소" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: "저장소" })).toBeChecked();
  });

  it("expresses selected tabs with semantics and design tokens", () => {
    render(
      <TabsList aria-label="편집 모드">
        <TabsTrigger selected>문서 편집</TabsTrigger>
        <TabsTrigger selected={false}>Markdown 원문</TabsTrigger>
      </TabsList>,
    );

    expect(screen.getByRole("tab", { name: "문서 편집" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "문서 편집" })).toHaveClass(
      "bg-[var(--color-primary-soft)]",
    );
  });
});
