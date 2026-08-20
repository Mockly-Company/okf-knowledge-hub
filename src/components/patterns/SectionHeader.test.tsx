import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "./SectionHeader";

afterEach(cleanup);

describe("SectionHeader", () => {
  it("renders the approved section hierarchy and action group", () => {
    render(
      <SectionHeader
        title="Typography"
        titleId="typography-title"
        description="승인된 크기와 굵기 위계"
        actions={<Button variant="secondary">편집</Button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Typography" })).toHaveClass(
      "text-[length:var(--font-section-size)]",
      "font-[number:var(--font-weight-section-title)]",
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute(
      "id",
      "typography-title",
    );
    expect(screen.getByText("승인된 크기와 굵기 위계")).toHaveClass(
      "font-[number:var(--font-weight-description)]",
    );
    expect(screen.getByRole("button", { name: "편집" })).toBeVisible();
  });
});
