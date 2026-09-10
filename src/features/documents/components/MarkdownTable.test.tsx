import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownTable } from "./MarkdownTable";

afterEach(cleanup);

describe("MarkdownTable", () => {
  it("keeps table semantics inside a labeled, focusable horizontal scroll wrapper", () => {
    render(
      <MarkdownTable>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Value</th></tr>
        </thead>
        <tbody>
          <tr><td>Build</td><td className="markdown-table__cell--numeric">1,024</td></tr>
        </tbody>
      </MarkdownTable>,
    );

    const table = screen.getByRole("table");
    const wrapper = table.parentElement;
    expect(wrapper).toHaveClass("markdown-table-scroll");
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper).toHaveAccessibleName("표 가로 스크롤");
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "1,024" })).toHaveClass(
      "markdown-table__cell--numeric",
    );
  });
});
