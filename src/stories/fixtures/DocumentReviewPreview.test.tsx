import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentReviewPreview, type DocumentReviewPreviewProps } from "./DocumentReviewPreview";

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.removeItem("okhub.review-panel-width"); });
function show(props: DocumentReviewPreviewProps = {}) {
  return render(<DocumentsProvider gateway={new FakeDocumentsGateway()}><DocumentReviewPreview {...props} /></DocumentsProvider>);
}
describe("Storybook document review", () => {
  it("reveals only the scrolled region scrollbar and hides it after scrolling stops", () => {
    vi.useFakeTimers();
    const rendered = show();
    const canvas = rendered.container.querySelector(".document-review__canvas")!;
    const panel = rendered.container.querySelector(".document-review__panel-scroll")!;
    expect(canvas).toHaveAttribute("data-scrolling", "false");
    expect(panel).toHaveAttribute("data-scrolling", "false");
    fireEvent.scroll(panel);
    expect(panel).toHaveAttribute("data-scrolling", "true");
    expect(canvas).toHaveAttribute("data-scrolling", "false");
    act(() => vi.advanceTimersByTime(500));
    fireEvent.scroll(panel);
    act(() => vi.advanceTimersByTime(500));
    expect(panel).toHaveAttribute("data-scrolling", "true");
    fireEvent.scroll(canvas);
    act(() => vi.advanceTimersByTime(700));
    expect(panel).toHaveAttribute("data-scrolling", "false");
    expect(canvas).toHaveAttribute("data-scrolling", "false");
    fireEvent.scroll(panel);
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("resizes with the keyboard and remembers the width after reopening", async () => {
    const user = userEvent.setup();
    const first = show();
    const handle = screen.getByRole("separator", { name: "리뷰 패널 너비 조절" });
    expect(handle).toHaveAttribute("aria-valuenow", "340");
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", "356");
    expect(localStorage.getItem("okhub.review-panel-width")).toBe("356");
    first.unmount(); show();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "356");
    await user.click(screen.getByRole("separator"));
    await user.keyboard("{End}");
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "520");
    await user.keyboard("{Home}");
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "280");
  });
  it("ignores an invalid saved panel width", () => {
    localStorage.setItem("okhub.review-panel-width", "invalid"); show();
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "340");
  });
  it("identifies the PR requester and separates opinions from review decisions", () => {
    show({ reviewState: "approved" });
    expect(screen.getByText("요청자 Kim")).toBeVisible();
    const history = within(screen.getByRole("region", { name: "리뷰 기록" }));
    expect(screen.getByRole("region", { name: "검토 요청 메모" })).toHaveTextContent("Kim");
    expect(history.queryByRole("article", { name: "Kim의 의견" })).not.toBeInTheDocument();
    const approval = within(history.getByRole("article", { name: "Lee의 승인" }));
    expect(approval.getByText("승인").closest("header")).not.toBeNull();
    expect(screen.queryByText("문서 전체에 남긴 의견")).not.toBeInTheDocument();
  });
  it("preserves a whole-document opinion when switching between the proposal and diff", async () => {
    const user = userEvent.setup(); show();
    await user.type(screen.getByRole("textbox", { name: "리뷰 의견" }), "좌표 예시도 추가해주세요.");
    await user.click(screen.getByRole("tab", { name: "변경 비교" }));
    expect(screen.getByRole("region", { name: "원문 변경사항" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "리뷰 의견" })).toHaveValue("좌표 예시도 추가해주세요.");
    await user.click(screen.getByRole("button", { name: "리뷰 제출" }));
    expect(await within(screen.getByRole("region", { name: "리뷰 기록" })).findByText("좌표 예시도 추가해주세요.")).toBeVisible();
    const comment = within(screen.getByRole("article", { name: "나의 의견" }));
    expect(comment.getByText("의견").closest("header")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "리뷰 기록" })).queryByText("의견 남기기")).not.toBeInTheDocument();
    expect(screen.getByText("검토 대기중")).toBeVisible();
  });
  it("requires a reason for changes requested and does not publish on approval", async () => {
    const user = userEvent.setup(); show();
    await user.click(screen.getByRole("radio", { name: "수정 요청" }));
    expect(screen.getByRole("button", { name: "리뷰 제출" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "리뷰 의견" }), "검색어 제한을 명시해주세요.");
    await user.click(screen.getByRole("button", { name: "리뷰 제출" }));
    expect(await screen.findByText("수정 요청됨")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "승인" }));
    await user.click(screen.getByRole("button", { name: "리뷰 제출" }));
    expect(await screen.findByText("검토 승인됨")).toBeVisible();
    expect(screen.queryByText("발행 완료")).not.toBeInTheDocument();
  });
  it("does not let authors approve their own PR", () => {
    show({ viewer: "author" });
    expect(screen.getByRole("radio", { name: "승인" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "수정 요청" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "리뷰 의견" })).toBeEnabled();
  });
  it("reveals the commit identifier only when opening comparison version details", async () => {
    const user = userEvent.setup(); show();
    expect(screen.queryByText(/Kim · 검토 버전/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "변경 비교" }));
    await user.click(screen.getByText("버전 정보"));
    expect(screen.getByText("b72e5c1")).toBeVisible();
  });
  it("preserves the opinion when submission fails", async () => {
    const user = userEvent.setup(); show({ submissionFails: true });
    await user.type(screen.getByRole("textbox", { name: "리뷰 의견" }), "재시도할 의견");
    await user.click(screen.getByRole("button", { name: "리뷰 제출" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("리뷰를 전송하지 못했습니다.");
    expect(screen.getByRole("textbox", { name: "리뷰 의견" })).toHaveValue("재시도할 의견");
  });
  it.each(["closed", "merged"] as const)("keeps a %s PR read-only", reviewState => {
    show({ reviewState });
    expect(screen.queryByRole("button", { name: "리뷰 제출" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "리뷰 기록" })).toBeVisible();
  });
  it("blocks submitting a review of an outdated version", async () => {
    const user = userEvent.setup(); show({ versionChanged: true });
    await user.click(screen.getByRole("radio", { name: "승인" }));
    expect(screen.getByRole("button", { name: "리뷰 제출" })).toBeDisabled();
    expect(screen.getByText("검토 중 새 수정본이 공유되었습니다. 최신 버전을 확인한 뒤 리뷰해주세요.")).toBeVisible();
  });
});
