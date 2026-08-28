import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "./status-feedback";

afterEach(cleanup);

describe("StatusFeedback", () => {
  it("uses a title and description hierarchy that matches the approved feedback surfaces", () => {
    render(
      <StatusFeedback variant="content" tone="error">
        <StatusFeedbackTitle>디스크의 문서가 변경되었습니다</StatusFeedbackTitle>
        <StatusFeedbackDescription>
          내 변경과 비교한 뒤 처리 방법을 선택하세요.
        </StatusFeedbackDescription>
      </StatusFeedback>,
    );

    expect(screen.getByText("디스크의 문서가 변경되었습니다")).toHaveClass(
      "font-[number:var(--font-weight-section-title)]",
      "text-[length:var(--font-group-size)]",
      "leading-[var(--font-group-line)]",
      "text-[var(--color-text-strong)]",
    );
    expect(screen.getByText("내 변경과 비교한 뒤 처리 방법을 선택하세요.")).toHaveClass(
      "font-[number:var(--font-weight-description)]",
      "text-[length:var(--font-meta-size)]",
      "leading-[var(--font-meta-line)]",
      "text-[var(--color-text-default)]",
    );
  });

  it("keeps a field error attached to its field without creating a live toast", () => {
    render(<StatusFeedback variant="field" tone="error">경로를 확인해 주세요.</StatusFeedback>);

    expect(screen.getByText("경로를 확인해 주세요.")).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["success", "warning", "error"] as const)("keeps the %s toast at the shared feedback size and spacing", (tone) => {
    render(<StatusFeedback variant="toast" tone={tone}>로컬 저장됨</StatusFeedback>);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("로컬 저장됨");
    expect(toast).toHaveClass(
      "min-h-[68px]",
      "p-[var(--space-3)]",
      "gap-[var(--space-3)]",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps banner and content actions in context", () => {
    const { rerender } = render(
      <StatusFeedback variant="banner" tone="warning" action={<button>다시 연결</button>}>
        GitHub 연결이 끊어졌습니다.
      </StatusFeedback>,
    );

    expect(screen.getByRole("button", { name: "다시 연결" })).toBeInTheDocument();

    rerender(
      <StatusFeedback variant="content" tone="error" action={<button>비교하기</button>}>
        디스크의 문서가 변경되었습니다.
      </StatusFeedback>,
    );
    expect(screen.getByRole("button", { name: "비교하기" })).toBeInTheDocument();
  });

  it("places an explicitly inline banner action beside its message on wide screens", () => {
    render(
      <StatusFeedback
        variant="banner"
        tone="warning"
        actionPlacement="end"
        action={<button>Settings에서 다시 연결</button>}
      >
        GitHub 인증이 만료되었습니다.
      </StatusFeedback>,
    );

    expect(screen.getByText("GitHub 인증이 만료되었습니다.").closest("section")).toHaveAttribute(
      "data-feedback-action-placement",
      "end",
    );
  });

  it("places an inline content action at the end on wide screens and below the message on narrow screens", () => {
    render(
      <StatusFeedback
        variant="content"
        tone="error"
        actionPlacement="end"
        action={<button>비교하기</button>}
      >
        디스크의 문서가 변경되었습니다.
      </StatusFeedback>,
    );

    const feedback = screen.getByText("디스크의 문서가 변경되었습니다.").closest("section");
    expect(feedback).toHaveAttribute("data-feedback-action-placement", "end");
    expect(feedback).toHaveClass("sm:grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(screen.getByRole("button", { name: "비교하기" }).parentElement).toHaveClass(
      "col-span-2",
      "row-start-2",
      "justify-self-end",
      "sm:col-span-1",
      "sm:col-start-3",
      "sm:row-start-1",
    );
  });

  it.each([
    ["banner", "warning", "Settings에서 다시 연결"],
    ["content", "error", "비교하기"],
  ] as const)("gives an action-bearing %s the shared toast density", (variant, tone, label) => {
    render(
      <StatusFeedback
        variant={variant}
        tone={tone}
        actionPlacement="end"
        action={<button>{label}</button>}
      >
        처리 방법을 선택하세요.
      </StatusFeedback>,
    );

    expect(screen.getByText("처리 방법을 선택하세요.").closest("section")).toHaveClass(
      "min-h-[68px]",
      "rounded-[var(--radius-md)]",
      "p-[var(--space-3)]",
      "shadow-[var(--shadow-popover)]",
    );
  });

  it.each([
    ["success", "var(--color-success)", "var(--color-success-icon-surface)"],
    ["info", "var(--color-info)", "var(--color-info-icon-surface)"],
    ["warning", "var(--color-warning)", "var(--color-warning-icon-surface)"],
    ["error", "var(--color-error)", "var(--color-error-icon-surface)"],
  ] as const)("gives %s feedback a distinct larger icon disc", (tone, semantic, soft) => {
    render(
      <StatusFeedback variant="banner" tone={tone} action={<button type="button">문제 해결</button>}>
        동기화 상태를 확인해 주세요.
      </StatusFeedback>,
    );

    const feedback = screen.getByText("동기화 상태를 확인해 주세요.").closest("section");
    expect(feedback?.querySelector("[data-feedback-icon]")).toHaveClass(
      `bg-[${soft}]`,
      `text-[${semantic}]`,
      "size-8",
    );
    expect(feedback?.querySelector("[data-feedback-icon] svg")).toHaveClass("size-5");
  });

  it.each([
    ["warning", "var(--color-warning)", "Settings에서 다시 연결"],
    ["error", "var(--color-error)", "Settings에서 확인"],
  ] as const)("applies the %s semantic action treatment to an asChild link", (tone, semantic, label) => {
    render(
      <StatusFeedback
        variant="banner"
        tone={tone}
        action={(
          <Button asChild variant="secondary">
            <a href="/settings">{label}</a>
          </Button>
        )}
      >
        동기화 상태를 확인해 주세요.
      </StatusFeedback>,
    );

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("data-variant", "secondary");
    expect(link.closest("[data-feedback-action]")).toHaveClass(
      "[&_[data-variant]]:bg-[var(--color-surface)]",
    );
  });

  it("centers the status icon with its message rather than pinning it to the top", () => {
    render(
      <StatusFeedback variant="banner" tone="warning">
        <StatusFeedbackTitle>GitHub 연결이 끊어졌습니다</StatusFeedbackTitle>
        <StatusFeedbackDescription>
          Issue와 저장소 동기화를 다시 시작하려면 연결을 확인하세요.
        </StatusFeedbackDescription>
      </StatusFeedback>,
    );

    expect(screen.getByText("GitHub 연결이 끊어졌습니다").closest("section")).toHaveClass(
      "items-center",
    );
  });

  it("keeps a warning action at the end without a dismiss control", () => {
    render(
      <StatusFeedback
        variant="banner"
        tone="warning"
        actionPlacement="end"
        action={<Button variant="secondary">다시 연결</Button>}
      >
        <StatusFeedbackTitle>GitHub 연결이 끊겼습니다</StatusFeedbackTitle>
        <StatusFeedbackDescription>
          Issue와 저장소 동기화를 다시 시작하려면 연결을 확인하세요.
        </StatusFeedbackDescription>
      </StatusFeedback>,
    );

    expect(screen.queryByRole("button", { name: "안내 닫기" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 연결" }).parentElement).toHaveClass(
      "row-start-2",
      "justify-self-end",
    );
  });
});
