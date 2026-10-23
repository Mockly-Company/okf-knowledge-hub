import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnstyledButton } from "./unstyled-button";

afterEach(cleanup);

describe("UnstyledButton", () => {
  it("gives composite actions the shared pointer and transition contract", () => {
    render(<UnstyledButton>문서 열기</UnstyledButton>);

    expect(screen.getByRole("button", { name: "문서 열기" })).toHaveClass(
      "cursor-pointer",
      "transition-colors",
      "duration-150",
    );
  });

  it("uses the disabled cursor without blocking pointer hit testing", () => {
    render(<UnstyledButton disabled>문서 열기</UnstyledButton>);

    const button = screen.getByRole("button", { name: "문서 열기" });
    expect(button).toHaveClass("disabled:cursor-not-allowed");
    expect(button).not.toHaveClass("disabled:pointer-events-none");
  });
});
