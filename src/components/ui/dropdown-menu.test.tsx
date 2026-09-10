import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

  it("opens a density submenu with ArrowRight and navigates its radio items", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">문서 작업</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>보기 밀도</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value="default">
                <DropdownMenuRadioItem value="default">편안하게</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">작게</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole("button", { name: "문서 작업" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "보기 밀도" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    const comfortable = await screen.findByRole("menuitemradio", { name: "편안하게" });
    const compact = screen.getByRole("menuitemradio", { name: "작게" });
    expect(comfortable).toHaveFocus();
    expect(comfortable).toHaveAttribute("aria-checked", "true");
    expect(compact).toHaveAttribute("aria-checked", "false");

    await user.keyboard("{ArrowDown}");
    expect(compact).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(comfortable).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitemradio", { name: "편안하게" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("selects a radio item from a hovered submenu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">문서 작업</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>보기 밀도</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value="default">
                <DropdownMenuRadioItem value="compact" onSelect={onSelect}>
                  작게
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole("button", { name: "문서 작업" }));
    await user.hover(screen.getByRole("menuitem", { name: "보기 밀도" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "작게" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
