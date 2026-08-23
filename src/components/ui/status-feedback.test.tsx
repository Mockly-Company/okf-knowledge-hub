import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusFeedback } from "./status-feedback";

describe("StatusFeedback", () => {
  it("keeps a field error attached to its field without creating a live toast", () => {
    render(<StatusFeedback variant="field" tone="error">경로를 확인해 주세요.</StatusFeedback>);

    expect(screen.getByText("경로를 확인해 주세요.")).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a transient toast without making it modal", () => {
    render(<StatusFeedback variant="toast" tone="success">로컬 저장됨</StatusFeedback>);

    expect(screen.getByRole("status")).toHaveTextContent("로컬 저장됨");
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
});
