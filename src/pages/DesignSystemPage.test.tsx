import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { DesignSystemPage } from "./DesignSystemPage";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
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

function renderPage() {
  return render(
    <PreferencesProvider repository={new FakePreferencesRepository()}>
      <DesignSystemPage />
    </PreferencesProvider>,
  );
}

describe("DesignSystemPage", () => {
  it("shows every approved button variant", () => {
    renderPage();

    for (const name of ["Primary", "Secondary", "Ghost", "Destructive"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("explains the icon-only button with a tooltip", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.hover(screen.getByRole("button", { name: "설정 열기" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("설정 열기");
    expect(tooltip).toHaveClass("text-[var(--color-canvas)]");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderPage();

    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });

  it("switches between the approved display densities", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "Compact로 보기" }),
    );

    expect(
      screen.getByRole("button", { name: "Default로 보기" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
  });
});
