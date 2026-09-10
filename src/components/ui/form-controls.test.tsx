import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Radio } from "./radio";
import { Select, SelectOption } from "./select";
import { TabsList, TabsTrigger } from "./tabs";
import { Textarea } from "./textarea";

afterEach(cleanup);

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
      "aria-[invalid=true]:border-[var(--color-error-border)]",
    );
    expect(input).not.toHaveClass("aria-[invalid=true]:border-2");
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

  it("keeps invalid focused text controls on the error border", () => {
    const view = render(
      <>
        <Input aria-label="제목" aria-invalid="true" />
        <Textarea aria-label="본문" aria-invalid="true" />
        <Select aria-label="유형" aria-invalid="true">
          <SelectOption value="guide">Guide</SelectOption>
        </Select>
      </>,
    );

    expect(within(view.container).getByRole("textbox", { name: "제목" })).toHaveClass(
      "aria-[invalid=true]:focus-visible:border-[var(--color-error-border)]",
    );

    for (const control of [
      within(view.container).getByRole("textbox", { name: "본문" }),
      within(view.container).getByRole("combobox", { name: "유형" }),
    ]) {
      expect(control).toHaveClass(
        "aria-[invalid=true]:focus-visible:border-[var(--color-error)]",
      );
    }
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

  it("supports described SelectOption choices through keyboard selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select aria-label="문서 유형" defaultValue="guide" onValueChange={onValueChange}>
        <SelectOption value="guide" description="읽는 사람을 위한 문서입니다.">
          Guide
        </SelectOption>
        <SelectOption value="decision" description="선택한 근거를 기록합니다.">
          Decision
        </SelectOption>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "문서 유형" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("data-state", "open");
    expect(await screen.findByRole("option", { name: /Guide/ })).toHaveTextContent(
      "읽는 사람을 위한 문서입니다.",
    );
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledWith("decision");
  });

  it("does not give an invalid Select a generic open-state outline reset", async () => {
    const user = userEvent.setup();
    render(
      <Select aria-label="오류 문서 유형" aria-invalid="true" defaultValue="guide">
        <SelectOption value="guide">Guide</SelectOption>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "오류 문서 유형" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("data-state", "open");
    expect(trigger).toHaveAttribute("data-select-trigger", "");
    expect(trigger).not.toHaveClass("data-[state=open]:outline-none");
  });

  it("gives Checkbox and Radio tokenized state and motion affordances", () => {
    render(
      <>
        <Checkbox aria-label="공개" defaultChecked />
        <Checkbox aria-label="공개 불가" disabled />
        <Radio aria-label="기본" defaultChecked />
        <Radio aria-label="기본 불가" disabled />
      </>,
    );

    for (const control of [
      screen.getByRole("checkbox", { name: "공개" }),
      screen.getByRole("radio", { name: "기본" }),
    ]) {
      expect(control).toBeChecked();
      expect(control).toHaveClass(
        "accent-[var(--color-primary)]",
        "transition-[accent-color,outline-color]",
        "duration-[var(--motion-control-duration)]",
      );
    }

    for (const control of [
      screen.getByRole("checkbox", { name: "공개 불가" }),
      screen.getByRole("radio", { name: "기본 불가" }),
    ]) {
      expect(control).toBeDisabled();
      expect(control).toHaveClass("disabled:accent-[var(--color-text-disabled)]");
    }
  });

  it("renders tabs with a shared bottom divider and selected indicator", () => {
    render(
      <TabsList aria-label="편집 모드">
        <TabsTrigger selected>문서 편집</TabsTrigger>
        <TabsTrigger selected={false}>Markdown 원문</TabsTrigger>
      </TabsList>,
    );

    expect(screen.getByRole("tablist")).toHaveClass(
      "border-b",
      "border-[var(--color-border)]",
    );
    const selectedTab = screen.getByRole("tab", { name: "문서 편집" });
    expect(selectedTab).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(selectedTab).toHaveClass(
      "bg-transparent",
      "text-[var(--color-primary-text)]",
    );
    expect(screen.getByTestId("tab-indicator")).toHaveClass(
      "h-0.5",
      "bg-[var(--color-primary)]",
    );
  });

  it("keeps tab triggers aligned with the density-aware control and focus contract", () => {
    render(
      <TabsList aria-label="문서 보기">
        <TabsTrigger selected>미리보기</TabsTrigger>
      </TabsList>,
    );

    expect(screen.getByRole("tab", { name: "미리보기" })).toHaveClass(
      "h-[var(--control-height)]",
      "cursor-pointer",
      "focus-visible:outline-[var(--color-primary)]",
      "duration-[var(--motion-control-duration)]",
    );
  });

  it("uses the readable default text token for an unselected tab", () => {
    render(
      <TabsList aria-label="문서 보기">
        <TabsTrigger selected={false}>Markdown</TabsTrigger>
      </TabsList>,
    );

    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveClass(
      "text-[var(--color-text-default)]",
    );
  });

  it("moves roving focus with Arrow keys, Home, and End without activating another tab", async () => {
    const user = userEvent.setup();
    const view = render(
      <TabsList aria-label="문서 보기">
        <TabsTrigger selected>미리보기</TabsTrigger>
        <TabsTrigger selected={false} disabled>연결</TabsTrigger>
        <TabsTrigger selected={false}>Markdown</TabsTrigger>
        <TabsTrigger selected={false}>History</TabsTrigger>
      </TabsList>,
    );

    const tabs = within(view.container);
    const preview = tabs.getByRole("tab", { name: "미리보기" });
    const markdown = tabs.getByRole("tab", { name: "Markdown" });
    const history = tabs.getByRole("tab", { name: "History" });

    expect(preview).toHaveAttribute("tabindex", "0");
    expect(markdown).toHaveAttribute("tabindex", "-1");

    preview.focus();
    await user.keyboard("{ArrowRight}");
    expect(markdown).toHaveFocus();
    expect(preview).toHaveAttribute("aria-selected", "true");
    expect(markdown).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{End}");
    expect(history).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(preview).toHaveFocus();
    await user.keyboard("{Home}");
    expect(preview).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(history).toHaveFocus();
  });
});
