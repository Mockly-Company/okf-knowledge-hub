import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("uses approved control geometry and strong action weight", () => {
    render(<Button>새 문서</Button>);

    expect(screen.getByRole("button", { name: "새 문서" })).toHaveClass(
      "h-[var(--control-height)]",
      "rounded-[var(--radius-md)]",
      "font-[number:var(--font-weight-control)]",
      "cursor-pointer",
    );
  });

  it("renders a primary action", () => {
    render(<Button>연결하기</Button>);
    const button = screen.getByRole("button", { name: "연결하기" });
    expect(button).toHaveAttribute(
      "data-variant",
      "primary",
    );
    expect(button).toHaveClass(
      "active:bg-[var(--color-primary-action-pressed)]",
      "cursor-pointer",
    );
  });

  it("uses explicit disabled design tokens instead of opacity", () => {
    render(<Button disabled>연결하기</Button>);
    const button = screen.getByRole("button", { name: "연결하기" });

    expect(button).toHaveClass(
      "disabled:bg-[var(--color-control-disabled)]",
      "disabled:text-[var(--color-text-disabled)]",
      "disabled:cursor-not-allowed",
    );
    expect(button).not.toHaveClass(
      "disabled:opacity-45",
      "disabled:pointer-events-none",
    );
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
