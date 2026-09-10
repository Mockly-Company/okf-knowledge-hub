import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownAlert } from "./MarkdownAlert";

afterEach(cleanup);

it.each(["note", "tip", "important", "warning", "caution"] as const)(
  "renders %s with a visible label and hidden Lucide decoration",
  (kind) => {
    render(<MarkdownAlert kind={kind}>설명</MarkdownAlert>);

    expect(screen.getByText(kind.toUpperCase())).toBeVisible();
    expect(screen.getByText("설명")).toBeVisible();
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  },
);
