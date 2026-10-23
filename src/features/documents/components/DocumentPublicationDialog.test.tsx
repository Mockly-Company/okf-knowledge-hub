import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsProvider } from "../DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentPublicationDialog, type DocumentPublicationDialogProps } from "./DocumentPublicationDialog";

afterEach(cleanup);
function show(props: Partial<DocumentPublicationDialogProps> = {}) {
  const defaults: DocumentPublicationDialogProps = { open: true, intent: "publish", path: "docs/api.md", markdown: "# 지도 API\n\n새 내용", baselineMarkdown: "# 지도 API\n\n이전 내용", onOpenChange: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined) };
  return render(<DocumentsProvider gateway={new FakeDocumentsGateway()}><DocumentPublicationDialog {...defaults} {...props} /></DocumentsProvider>);
}
describe("DocumentPublicationDialog", () => {
  it("does not require a new commit message when publishing an already shared snapshot", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined);
    show({ requiresCommitMessage: false, onSubmit: submit });
    expect(screen.queryByRole("textbox", { name: /변경 설명/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "발행하기" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ intent: "publish", message: "" }));
  });
  it("does not let an ended PR be reused as a successful review submission", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined);
    show({ intent: "review", reviewDisabledReason: "종료된 PR은 갱신할 수 없습니다.", onSubmit: submit });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "새 변경");
    expect(screen.getByRole("button", { name: "검토 요청 보내기" })).toBeDisabled();
    expect(screen.getByText("종료된 PR은 갱신할 수 없습니다.")).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });
  it("blocks direct publication without blocking the review path", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined);
    show({ onSubmit: submit, publishDisabledReason: "수정본을 먼저 검토 요청으로 공유해주세요." });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "수정본 공유");
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
    expect(screen.getByText("수정본을 먼저 검토 요청으로 공유해주세요.")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "검토 요청" }));
    expect(screen.queryByText("수정본을 먼저 검토 요청으로 공유해주세요.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "검토 요청 보내기" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ intent: "review" }));
  });
  it("chooses review inside publication without losing the message", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined);
    show({ onSubmit: submit });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "검토할 변경");
    await user.click(screen.getByRole("radio", { name: "검토 요청" }));
    expect(screen.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("검토할 변경");
    await user.click(screen.getByRole("button", { name: "검토 요청 보내기" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ intent: "review", message: "검토할 변경" }));
  });
  it("keeps document identity visible when comparison is collapsed and preserves expansion across modes", async () => {
    const user = userEvent.setup(); show();
    const toggle = screen.getByRole("button", { name: /지도 API.*docs\/api.md/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("추가 1 · 삭제 1");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "원문 변경사항" })).not.toBeInTheDocument();
    expect(toggle).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "문서 미리보기" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getAllByRole("heading", { name: "지도 API" })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: /변경 설명/ })).not.toHaveAccessibleDescription();
  });
  it("defaults to source diff and offers rendered Markdown preview", async () => {
    const user = userEvent.setup(); show();
    expect(screen.getByRole("tab", { name: "원문 비교" })).toHaveAttribute("aria-selected", "true");
    const diff = within(screen.getByRole("region", { name: "원문 변경사항" }));
    expect(diff.getAllByText("# 지도 API")).toHaveLength(2);
    expect(diff.getByText("이전 내용")).toBeVisible();
    expect(diff.getByText("새 내용")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "문서 미리보기" }));
    expect(screen.queryByRole("region", { name: "원문 변경사항" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "지도 API" })).toHaveLength(2);
  });
  it("requires a nonblank message and submits only the current document", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined);
    show({ onSubmit: submit });
    const button = screen.getByRole("button", { name: "발행하기" });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "   ");
    expect(button).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "검색 조건 수정");
    await user.click(button);
    expect(submit).toHaveBeenCalledExactlyOnceWith({ intent: "publish", path: "docs/api.md", markdown: "# 지도 API\n\n새 내용", message: "검색 조건 수정", reviewNote: "" });
  });
  it("preserves the draft and message after failure without exposing raw errors", async () => {
    const user = userEvent.setup();
    show({ onSubmit: vi.fn().mockRejectedValue(new Error("private remote details")) });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "실패 후 유지");
    await user.click(screen.getByRole("button", { name: "발행하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("초안과 변경 설명은 유지됩니다");
    expect(screen.getByRole("textbox", { name: /변경 설명/ })).toHaveValue("실패 후 유지");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private remote details");
    expect(screen.getByRole("dialog")).toBeVisible();
  });
  it("prevents submission when backend or baseline is unavailable", async () => {
    const user = userEvent.setup();
    show({ onSubmit: undefined, baselineMarkdown: undefined });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "설명");
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
    expect(screen.getByText(/발행 기능이 아직 연결되지 않았습니다/)).toBeVisible();
    expect(screen.queryByText("이전 내용")).not.toBeInTheDocument();
  });
  it("keeps optional review separate from direct publication", async () => {
    const user = userEvent.setup(), submit = vi.fn().mockResolvedValue(undefined), close = vi.fn();
    show({ intent: "review", onSubmit: submit, onOpenChange: close });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "검토용 변경");
    await user.type(screen.getByRole("textbox", { name: /검토 요청 메모/ }), "조건 확인");
    await user.click(screen.getByRole("button", { name: "검토 요청 보내기" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ intent: "review", reviewNote: "조건 확인" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });
  it("locks submission and dismissal while a request is pending", async () => {
    const user = userEvent.setup(), close = vi.fn();
    let complete!: () => void;
    const submit = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    show({ onSubmit: submit, onOpenChange: close });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "전송 중 변경");
    await user.click(screen.getByRole("button", { name: "발행하기" }));
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "변경 확인 닫기" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    complete();
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  });
  it("allows a new document but prevents publishing unchanged content", async () => {
    const user = userEvent.setup();
    const view = show({ baselineMarkdown: null });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "새 문서");
    expect(screen.getByRole("button", { name: "발행하기" })).toBeEnabled();
    view.unmount();
    show({ baselineMarkdown: "# 지도 API\n\n새 내용" });
    await user.type(screen.getByRole("textbox", { name: /변경 설명/ }), "변경 없음");
    expect(screen.getByRole("button", { name: "발행하기" })).toBeDisabled();
    expect(screen.getByText("확정본과 다른 변경 내용이 없습니다.")).toBeVisible();
  });
});
