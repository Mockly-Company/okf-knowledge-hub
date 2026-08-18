import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a primary action", () => {
    render(<Button>연결하기</Button>);
    const button = screen.getByRole("button", { name: "연결하기" });
    expect(button).toHaveAttribute(
      "data-variant",
      "primary",
    );
    expect(button).toHaveClass(
      "active:bg-[var(--color-primary-action-pressed)]",
    );
  });

  it("uses explicit disabled design tokens instead of opacity", () => {
    render(<Button disabled>연결하기</Button>);
    const button = screen.getByRole("button", { name: "연결하기" });

    expect(button).toHaveClass(
      "disabled:bg-[var(--color-control-disabled)]",
      "disabled:text-[var(--color-text-disabled)]",
    );
    expect(button).not.toHaveClass("disabled:opacity-45");
  });

  it("supports a named icon action", () => {
    render(
      <Button variant="icon" aria-label="설정 열기">
        <Settings aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
  });
});
