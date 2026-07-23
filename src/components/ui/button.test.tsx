import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Settings } from "lucide-react";
import { Button } from "./button";

describe("Button", () => {
  it("renders a primary action", () => {
    render(<Button>연결하기</Button>);
    expect(screen.getByRole("button", { name: "연결하기" })).toHaveAttribute(
      "data-variant",
      "primary",
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
