import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

afterEach(cleanup);

describe("DropdownMenu", () => {
  it("keeps the consumer-owned trigger and renders an overlay action list", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">문서 작업</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>링크 복사</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.getByText("문서 작업")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass(
      "rounded-[var(--radius-lg)]",
      "border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
      "shadow-[var(--shadow-overlay)]",
      "duration-[var(--motion-control-duration)]",
    );
  });

  it("supports default and compact action geometry with a destructive action after a separator", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuItem>링크 복사</DropdownMenuItem>
          <DropdownMenuItem size="compact">경로 복사</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">문서 삭제</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.getByRole("menuitem", { name: "링크 복사" })).toHaveClass(
      "min-h-[var(--control-height)]",
      "data-[highlighted]:bg-[var(--color-canvas)]",
    );
    expect(screen.getByRole("menuitem", { name: "경로 복사" })).toHaveClass(
      "min-h-[var(--space-8)]",
    );
    expect(screen.getByRole("separator")).toHaveClass("bg-[var(--color-border)]");
    expect(screen.getByRole("menuitem", { name: "문서 삭제" })).toHaveClass(
      "text-[var(--color-error)]",
      "data-[highlighted]:bg-[var(--color-error-soft)]",
    );
  });

  it("highlights items with the keyboard and returns focus to the consumer trigger on Escape", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">문서 작업</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>링크 복사</DropdownMenuItem>
          <DropdownMenuItem>GitHub에서 보기</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "문서 작업" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "링크 복사" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});
