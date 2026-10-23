import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the approved page hierarchy and action group", () => {
    render(
      <PageHeader
        title="Documents"
        titleId="documents-title"
        description="프로젝트 문서를 찾습니다."
        actions={<Button>새 문서</Button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Documents" })).toHaveClass(
      "font-[number:var(--font-weight-page-title)]",
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "id",
      "documents-title",
    );
    expect(screen.getByText("프로젝트 문서를 찾습니다.")).toHaveClass(
      "mt-[var(--space-2)]",
      "font-[number:var(--font-weight-description)]",
    );
    expect(screen.getByRole("button", { name: "새 문서" })).toBeVisible();
  });
});
