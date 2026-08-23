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
  it("applies the shared focus and invalid contract to text inputs", () => {
    render(<Input aria-label="제목" aria-invalid="true" />);
    const input = screen.getByRole("textbox", { name: "제목" });

    expect(input).toHaveClass(
      "border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
      "font-[number:var(--font-weight-description)]",
      "cursor-text",
      "focus-visible:border-[var(--color-primary)]",
      "aria-[invalid=true]:border-[var(--color-error)]",
    );
    expect(input.className).not.toContain("focus-visible:ring");
    expect(input.className).not.toContain("focus-visible:outline-none");
  });

  it("applies the shared document typography to textareas", () => {
    render(<Textarea aria-label="Markdown" />);
    expect(screen.getByRole("textbox", { name: "Markdown" })).toHaveClass(
      "text-[length:var(--font-document-size)]",
      "font-[number:var(--font-weight-description)]",
      "cursor-text",
    );
  });

  it("renders the non-native select with shared focus behavior", async () => {
    const onValueChange = vi.fn();
    const onCheckboxChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Select
          aria-label="Draft"
          defaultValue="main"
          onValueChange={onValueChange}
        >
          <option value="main">main</option>
          <option value="draft">draft</option>
        </Select>
        <Checkbox aria-label="별도 변경" onChange={onCheckboxChange} />
        <Radio aria-label="저장소" name="repository" />
      </>,
    );

    const select = screen.getByRole("combobox", { name: "Draft" });
    expect(select.tagName).toBe("BUTTON");
    expect(select).toHaveClass(
      "focus-visible:border-[var(--color-primary)]",
      "duration-[var(--motion-control-duration)]",
    );
    expect(select.className).not.toContain("focus-visible:ring");
    expect(select.className).not.toContain("focus-visible:outline-none");
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "draft" }));
    await user.click(screen.getByRole("checkbox", { name: "별도 변경" }));
    await user.click(screen.getByRole("radio", { name: "저장소" }));
    expect(onValueChange).toHaveBeenCalledWith("draft");
    expect(onCheckboxChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: "저장소" })).toBeChecked();
  });

  it("renders tabs as a segmented control", () => {
    render(
      <TabsList aria-label="편집 모드">
        <TabsTrigger selected>문서 편집</TabsTrigger>
        <TabsTrigger selected={false}>Markdown 원문</TabsTrigger>
      </TabsList>,
    );

    expect(screen.getByRole("tablist")).toHaveClass(
      "rounded-[var(--radius-md)]",
      "bg-[var(--color-control-disabled)]",
    );
    const selectedTab = screen.getByRole("tab", { name: "문서 편집" });
    expect(selectedTab).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(selectedTab).toHaveClass(
      "bg-[var(--color-surface)]",
    );
  });
});
