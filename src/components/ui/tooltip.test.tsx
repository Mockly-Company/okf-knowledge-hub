import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./button";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tooltip", () => {
  it("describes an accessible icon-only button on keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <IconButton label="설정 열기">
        <Settings aria-hidden="true" />
      </IconButton>,
    );

    await user.tab();

    expect(screen.getByRole("button", { name: "설정 열기" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveClass(
      "border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
      "text-[var(--color-text-default)]",
      "shadow-[var(--shadow-overlay)]",
      "duration-[var(--motion-control-duration)]",
    );
  });

  it("does not add a tooltip to a text button", () => {
    render(<Button>저장</Button>);

    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
