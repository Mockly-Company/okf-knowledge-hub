import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PublicationSuccessToast } from "./PublicationSuccessToast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps an undo action reachable in the toast", async () => {
  const user = userEvent.setup(), undo = vi.fn();
  render(<PublicationSuccessToast message="변경을 취소했습니다." action={<button onClick={undo}>실행 취소</button>} />);
  await user.click(screen.getByRole("button", { name: "실행 취소" }));
  expect(undo).toHaveBeenCalledOnce();
});

it("announces success temporarily without retaining a content banner", () => {
  vi.useFakeTimers();
  render(<PublicationSuccessToast message="PR #42에 수정 내용을 반영했습니다." />);
  expect(screen.getByRole("status")).toHaveAttribute("data-feedback-variant", "toast");
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("shows a later result for its own full duration", () => {
  vi.useFakeTimers();
  const view = render(<PublicationSuccessToast message="검토 요청 완료" />);
  act(() => { vi.advanceTimersByTime(4000); });
  view.rerender(<PublicationSuccessToast message="발행 완료" />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole("status")).toHaveTextContent("발행 완료");
  act(() => { vi.advanceTimersByTime(4000); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
