import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor } from "storybook/test";
import { Button } from "./button";
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
  DialogTrigger,
} from "./dialog";

const meta = {
  title: "UI/Dialog",
  component: DialogContent,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof DialogContent>;

export default meta;

type Story = StoryObj<typeof meta>;

function DialogPreview({ wide = false }: { wide?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">{wide ? "충돌 비교 열기" : "문서 만들기"}</Button>
        </DialogTrigger>
        <DialogContent size={wide ? "wide" : "default"}>
          <DialogHeader>
          <div>
            <DialogTitle>{wide ? "디스크 충돌 비교" : "새 문서"}</DialogTitle>
            <DialogDescription>현재 작업을 계속하기 위한 정보를 확인합니다.</DialogDescription>
          </div>
          <DialogCloseButton label="Dialog 닫기" />
          </DialogHeader>
          <DialogBody className="mt-[var(--space-4)]">
            <p className="m-0 font-[number:var(--font-weight-body)] text-[var(--color-text-muted)]">
              {wide ? "두 버전의 차이를 나란히 검토합니다." : "기본 Dialog는 한 작업을 완료하는 흐름에 사용합니다."}
            </p>
          </DialogBody>
          <DialogFooter className="mt-[var(--space-6)]">
            <DialogClose asChild>
              <Button variant="secondary">취소</Button>
            </DialogClose>
            <Button>{wide ? "비교 시작" : "문서 만들기"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button variant="secondary">외부 설정</Button>
    </>
  );
}

export const Default: Story = {
  render: () => <DialogPreview />,
};

export const Interaction: Story = {
  render: () => <DialogPreview />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "문서 만들기" });
    const externalControl = canvas.getByRole("button", { name: "외부 설정" });

    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "새 문서" });
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(screen.getByText("기본 Dialog는 한 작업을 완료하는 흐름에 사용합니다.")).toHaveClass(
      "text-[var(--color-text-muted)]",
      "font-[number:var(--font-weight-body)]",
    );
    await expect(dialog).toHaveAttribute("data-state", "open");
    await expect(getComputedStyle(dialog).animationName).toBe("okhub-dialog-in");
    await expect(getComputedStyle(dialog).animationDuration).toBe("0.18s");
    await waitFor(() => {
      const bounds = dialog.getBoundingClientRect();

      expect(bounds.width).toBeCloseTo(560, 0);
      expect(bounds.left + bounds.width / 2).toBeCloseTo(window.innerWidth / 2, 0);
      expect(bounds.top + bounds.height / 2).toBeCloseTo(window.innerHeight / 2, 0);
    });
    const firstAction = screen.getByRole("button", { name: "Dialog 닫기" });
    const secondAction = screen.getByRole("button", { name: "취소" });
    const lastAction = screen.getByRole("button", { name: "문서 만들기" });

    await expect(firstAction).toHaveFocus();
    await userEvent.tab();
    await expect(secondAction).toHaveFocus();
    await userEvent.tab();
    await expect(lastAction).toHaveFocus();
    await userEvent.tab();
    await expect(firstAction).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(lastAction).toHaveFocus();
    await expect(externalControl).not.toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toHaveAttribute("data-state", "closed");
    await expect(getComputedStyle(dialog).animationName).toBe("okhub-dialog-out");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
