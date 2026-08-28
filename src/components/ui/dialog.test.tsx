import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders an accessible modal and reports close requests", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>새 문서</DialogTitle>
          <DialogDescription>문서 정보를 입력합니다.</DialogDescription>
          <button type="button">확인</button>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "새 문서" })).toHaveClass(
      "p-[var(--dialog-padding)]",
      "w-[min(calc(100vw-3rem),35rem)]",
      "shadow-[var(--shadow-overlay)]",
      "duration-[var(--motion-control-duration)]",
    );
    expect(screen.getByText("새 문서")).toHaveClass(
      "font-[number:var(--font-weight-section-title)]",
      "text-[length:var(--font-section-size)]",
      "leading-[var(--font-section-line)]",
      "text-[var(--color-text-strong)]",
    );
    expect(screen.getByText("문서 정보를 입력합니다.")).toHaveClass(
      "font-[number:var(--font-weight-description)]",
      "text-[length:var(--font-meta-size)]",
      "leading-[var(--font-meta-line)]",
      "text-[var(--color-text-muted)]",
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers a fixed header, scrolling body, and footer composition", () => {
    expect(DialogHeader).toBeDefined();
    expect(DialogBody).toBeDefined();
    expect(DialogFooter).toBeDefined();

    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>충돌 해결</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p>두 버전을 검토합니다.</p>
          </DialogBody>
          <DialogFooter>
            <button type="button">비교하기</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("충돌 해결").parentElement).toHaveClass(
      "flex",
      "shrink-0",
      "items-start",
      "justify-between",
      "gap-[var(--space-3)]",
    );
    expect(screen.getByText("두 버전을 검토합니다.").parentElement).toHaveClass(
      "min-h-0",
      "overflow-y-auto",
    );
    expect(screen.getByRole("button", { name: "비교하기" }).parentElement).toHaveClass(
      "shrink-0",
      "justify-end",
      "gap-[var(--space-2)]",
    );
  });

  it("centers the close action with the title line rather than the full title and description block", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>새 문서</DialogTitle>
              <DialogDescription>문서 정보를 입력합니다.</DialogDescription>
            </div>
            <DialogCloseButton label="Dialog 닫기" />
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Dialog 닫기" })).toHaveClass(
      "!size-[var(--font-section-line)]",
      "hover:!bg-[var(--color-canvas)]",
      "focus-visible:!border-transparent",
    );
  });

  it("uses the wide surface only when conflict comparison opts in", () => {
    render(
      <Dialog open>
        <DialogContent size="wide">
          <DialogTitle>두 버전 비교</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "두 버전 비교" })).toHaveClass(
      "w-[min(calc(100vw-3rem),47.5rem)]",
    );
  });

  it("traps focus while open and returns it to the trigger after Escape", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogPrimitive.Trigger asChild>
          <button type="button">새 문서 열기</button>
        </DialogPrimitive.Trigger>
        <DialogContent>
          <DialogTitle>새 문서</DialogTitle>
          <DialogDescription>문서 정보를 입력합니다.</DialogDescription>
          <button type="button">첫 번째 작업</button>
          <button type="button">마지막 작업</button>
        </DialogContent>
      </Dialog>,
    );

    render(<button type="button">외부 설정</button>);

    const trigger = screen.getByRole("button", { name: "새 문서 열기" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "새 문서" })).toBeInTheDocument();

    const firstAction = screen.getByRole("button", { name: "첫 번째 작업" });
    const lastAction = screen.getByRole("button", { name: "마지막 작업" });
    const externalControl = screen.getByRole("button", { name: "외부 설정", hidden: true });

    expect(firstAction).toHaveFocus();
    await user.tab();
    expect(lastAction).toHaveFocus();
    await user.tab();
    expect(firstAction).toHaveFocus();
    await user.tab({ shift: true });
    expect(lastAction).toHaveFocus();
    expect(externalControl).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});
