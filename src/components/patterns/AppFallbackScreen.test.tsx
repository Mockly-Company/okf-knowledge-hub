import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFallbackScreen } from "./AppFallbackScreen";

afterEach(cleanup);

describe("AppFallbackScreen", () => {
  it("renders the not-found fallback screen and triggers 홈으로 돌아가기 / 문서로 이동", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    const onGoDocuments = vi.fn();

    render(
      <AppFallbackScreen
        kind="not_found"
        detail="/unknown-toc-anchor"
        onGoHome={onGoHome}
        onGoDocuments={onGoDocuments}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "요청한 화면을 찾을 수 없습니다" }),
    ).toBeVisible();
    expect(screen.getByText("/unknown-toc-anchor")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "홈으로 돌아가기" }));
    expect(onGoHome).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "문서로 이동" }));
    expect(onGoDocuments).toHaveBeenCalledTimes(1);
  });

  it("renders the error fallback screen with retry action and suppresses sensitive paths/tokens", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    const onRetry = vi.fn();

    const { rerender } = render(
      <AppFallbackScreen
        kind="error"
        detail="Unexpected failure at /Users/alice/secret/repo.ts"
        onGoHome={onGoHome}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "화면을 표시하는 중 문제가 발생했습니다",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/\/Users\/alice/)).toBeNull();

    rerender(
      <AppFallbackScreen
        kind="error"
        detail="Token leak ghu_secret123"
        onGoHome={onGoHome}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText(/ghu_secret123/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
