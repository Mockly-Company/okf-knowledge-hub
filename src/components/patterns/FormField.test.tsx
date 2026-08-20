import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";
import { FormField } from "./FormField";

afterEach(cleanup);

describe("FormField", () => {
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
});
