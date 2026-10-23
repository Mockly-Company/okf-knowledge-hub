import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { FormField } from "./FormField";

afterEach(cleanup);

describe("FormField", () => {
  it("keeps a visually hidden validation message associated with the invalid control", () => {
    render(
      <FormField label="문서 제목" required error="문서 제목을 입력해 주세요." errorVisuallyHidden>
        <Input placeholder="문서 제목을 입력하세요" />
      </FormField>,
    );
    const control = screen.getByRole("textbox", { name: /문서 제목/ });
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("문서 제목을 입력해 주세요.");
    expect(screen.getByRole("alert")).toHaveClass("sr-only");
  });
  it("keeps an adjacent action separate from the labelled input and its error", () => {
    render(<FormField label="저장소 폴더" error="다른 폴더를 선택하세요." controlAction={<button type="button">변경</button>}><Input readOnly value="/work" /></FormField>);
    expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveAccessibleDescription("다른 폴더를 선택하세요.");
    expect(screen.getByRole("button", { name: "변경" })).not.toHaveAttribute("aria-invalid");
  });
  it("associates its label, help, and error with the control", () => {
    render(
      <FormField
        label="문서 제목"
        htmlFor="title"
        description="화면에 표시됩니다."
        error="제목을 입력하세요."
      >
        <Input />
      </FormField>,
    );

    const control = screen.getByLabelText("문서 제목");
    expect(control).toHaveAttribute("id", "title");
    expect(control).toHaveAccessibleDescription(
      "화면에 표시됩니다. 제목을 입력하세요.",
    );
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("제목을 입력하세요.")).toHaveAttribute("role", "alert");
  });

  it("preserves existing accessibility tokens before generated help and error ids", () => {
    render(
      <>
        <span id="external-help">외부 도움말</span>
        <FormField
          label="문서 제목"
          htmlFor="title"
          description="화면에 표시됩니다."
          error="제목을 입력하세요."
        >
          <Input aria-describedby="external-help" aria-invalid="false" />
        </FormField>
      </>,
    );

    const control = screen.getByLabelText("문서 제목");
    expect(control).toHaveAttribute(
      "aria-describedby",
      "external-help title-description title-error",
    );
    expect(control).toHaveAccessibleDescription(
      "외부 도움말 화면에 표시됩니다. 제목을 입력하세요.",
    );
    expect(control).toHaveAttribute("aria-invalid", "true");
  });

  it("generates a stable label association and preserves an existing invalid state", () => {
    const { rerender } = render(
      <FormField label="문서 제목">
        <Input aria-invalid="grammar" />
      </FormField>,
    );

    const initialControl = screen.getByLabelText("문서 제목");
    const initialId = initialControl.getAttribute("id");
    expect(initialId).toMatch(/^field-/);
    expect(initialControl).toHaveAttribute("aria-invalid", "grammar");

    rerender(
      <FormField label="문서 제목">
        <Input aria-invalid="grammar" />
      </FormField>,
    );

    expect(screen.getByLabelText("문서 제목")).toHaveAttribute("id", initialId);
  });

  it("uses the child control id and marks a required field in its label", () => {
    render(
      <FormField label="문서 제목" required>
        <Input id="document-title" required />
      </FormField>,
    );

    expect(screen.getByText("필수")).toHaveAttribute("aria-hidden", "true");

    const control = screen.getByRole("textbox");
    expect(control).toHaveAttribute("id", "document-title");
    expect(control).toBeRequired();
  });
});
