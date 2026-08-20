import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";

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
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
