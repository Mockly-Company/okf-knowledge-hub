import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge, type StatusTone } from "./StatusBadge";

afterEach(cleanup);

// @ts-expect-error StatusBadge requires visible text instead of icon-only content.
const iconOnlyStatus = <StatusBadge tone="success"><span aria-hidden /></StatusBadge>;
void iconOnlyStatus;

describe("StatusBadge", () => {
  it.each<[StatusTone, string, string]>([
    ["neutral", "bg-[var(--color-canvas)]", "text-[var(--color-text-default)]"],
    ["success", "bg-[var(--color-success-soft)]", "text-[var(--color-success)]"],
    ["info", "bg-[var(--color-info-soft)]", "text-[var(--color-info)]"],
    ["warning", "bg-[var(--color-warning-soft)]", "text-[var(--color-warning)]"],
    ["error", "bg-[var(--color-error-soft)]", "text-[var(--color-error)]"],
  ])("maps the %s tone to semantic tokens while keeping a visible label", (tone, background, foreground) => {
    render(<StatusBadge tone={tone}>{`상태: ${tone}`}</StatusBadge>);

    expect(screen.getByText(`상태: ${tone}`)).toHaveClass(
      "rounded-[var(--radius-full)]",
      background,
      foreground,
    );
  });
});
