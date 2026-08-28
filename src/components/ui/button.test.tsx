import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "lucide-react";
import { Button } from "./button";

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

// @ts-expect-error Icon-only actions must use IconButton so a Tooltip cannot be skipped.
const unsafeIconButton = <Button variant="icon" aria-label="설정 열기"><Settings aria-hidden="true" /></Button>;
void unsafeIconButton;

const unsafeLoadingAsChildButton = (
  // @ts-expect-error Loading cannot safely suppress an asChild element's own activation handler.
  <Button asChild loading><a href="/documents">문서</a></Button>
);
void unsafeLoadingAsChildButton;

const unsafeDisabledAsChildButton = (
  // @ts-expect-error Disabled cannot safely suppress an asChild element's own activation handler.
  <Button asChild disabled><a href="/documents">문서</a></Button>
);
void unsafeDisabledAsChildButton;

describe("Button", () => {
  it("uses approved control geometry and strong action weight", () => {
    render(<Button>새 문서</Button>);

    expect(screen.getByRole("button", { name: "새 문서" })).toHaveClass(
      "h-[var(--control-height)]",
      "rounded-[var(--radius-md)]",
      "font-[number:var(--font-weight-control)]",
      "cursor-pointer",
      "focus-visible:border-[var(--color-primary)]",
      "duration-[var(--motion-control-duration)]",
    );
    expect(screen.getByRole("button", { name: "새 문서" }).className).not.toContain(
      "focus-visible:ring",
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
      "data-[loading=false]:active:bg-[var(--color-primary-action-pressed)]",
      "data-[loading=false]:hover:bg-[var(--color-primary-action-hover)]",
      "cursor-pointer",
    );
  });

  it("uses explicit disabled design tokens instead of opacity", () => {
    render(<Button disabled>연결하기</Button>);
    const button = screen.getByRole("button", { name: "연결하기" });

    expect(button).toHaveClass(
      "disabled:data-[loading=false]:bg-[var(--color-control-disabled)]",
      "disabled:data-[loading=false]:text-[var(--color-text-disabled)]",
      "disabled:cursor-not-allowed",
    );
    expect(button).not.toHaveClass(
      "disabled:opacity-45",
      "disabled:pointer-events-none",
    );
  });

  it("keeps its variant surface while loading and prevents duplicate activation", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        저장 중
      </Button>,
    );

    const button = screen.getByRole("button", { name: "저장 중" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-loading", "true");
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button.querySelector("svg")).toHaveClass("animate-spin");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("rejects loading asChild before rendering a child-owned activation handler", () => {
    const childActivation = vi.fn();
    const renderer = Button as unknown as {
      render(props: {
        asChild: true;
        loading: true;
        children: ReactNode;
      }, ref: null): ReactNode;
    };

    expect(() => renderer.render({
      asChild: true,
      loading: true,
      children: <a href="/documents" onClick={childActivation}>문서</a>,
    }, null)).toThrow("Button does not support loading when asChild is true");
    expect(childActivation).not.toHaveBeenCalled();
  });

  it.each(["native button", "link"] as const)("rejects disabled asChild before rendering a %s child", (kind) => {
    const childActivation = vi.fn();
    const child = kind === "native button"
      ? <button type="button" onClick={childActivation}>비활성 작업</button>
      : <a href="/documents" onClick={childActivation}>비활성 링크</a>;
    const renderer = Button as unknown as {
      render(props: {
        asChild: true;
        disabled: true;
        children: ReactNode;
      }, ref: null): ReactNode;
    };

    expect(() => renderer.render({
      asChild: true,
      disabled: true,
      children: child,
    }, null)).toThrow("Button does not support disabled when asChild is true");
    expect(childActivation).not.toHaveBeenCalled();
  });

  it("exports an icon action that owns its accessible name and tooltip", async () => {
    const iconButtonModule = await import("./button") as typeof import("./button") & {
      IconButton?: ComponentType<{ label: string; children: ReactNode }>;
    };
    const { IconButton } = iconButtonModule;

    expect(IconButton).toBeDefined();
    if (!IconButton) return;

    const user = userEvent.setup();
    render(
      <IconButton label="설정 열기">
        <Settings aria-hidden="true" />
      </IconButton>,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "설정 열기" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("설정 열기");
  });

  it("uses the neutral icon interaction while allowing non-disruptive icon actions to omit a tooltip", async () => {
    const iconButtonModule = await import("./button") as typeof import("./button") & {
      IconButton?: ComponentType<{ label: string; tooltip?: boolean; children: ReactNode }>;
    };
    const { IconButton } = iconButtonModule;

    expect(IconButton).toBeDefined();
    if (!IconButton) return;

    const user = userEvent.setup();
    render(
      <IconButton label="Dialog 닫기" tooltip={false}>
        <Settings aria-hidden="true" />
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Dialog 닫기" });
    expect(button).toHaveClass(
      "bg-[var(--color-surface)]",
      "data-[loading=false]:hover:!bg-[var(--color-canvas)]",
      "data-[loading=false]:hover:!text-[var(--color-text-strong)]",
      "data-[loading=false]:active:!bg-[var(--color-surface-pressed)]",
      "focus-visible:!border-transparent",
    );

    await user.tab();
    expect(button).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("rejects an empty icon action label in development and test", async () => {
    const iconButtonModule = await import("./button") as typeof import("./button") & {
      IconButton?: ComponentType<{ label: string; children: ReactNode }>;
    };
    const { IconButton } = iconButtonModule;

    expect(IconButton).toBeDefined();
    if (!IconButton) return;

    const renderer = IconButton as unknown as {
      render(props: { label: string; children: ReactNode }, ref: null): ReactNode;
    };

    expect(() => renderer.render({
      label: " \t ",
      children: <Settings aria-hidden="true" />,
    }, null)).toThrow("IconButton requires a nonempty label");
  });
});
