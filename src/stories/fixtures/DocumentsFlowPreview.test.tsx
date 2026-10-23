import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { StorybookAppProviders } from "../decorators/AppProviders";
import { documentFixtures } from "./documents";
import { DocumentsFlowPreview } from "./DocumentsFlowPreview";

afterEach(cleanup);
// jsdom lacks text layout; actual geometry is verified by the browser journey.
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
beforeAll(() => Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] }));
afterAll(() => { if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects); else delete (Range.prototype as Partial<Range>).getClientRects; });
function show(reviewState: "pending" | "none" = "pending") {
  return render(<StorybookAppProviders documents={{ catalog: documentFixtures.catalog(documentFixtures.mapSearchApi()) }} router={{ initialEntries: ["/documents"] }}><DocumentsFlowPreview reviewState={reviewState} /></StorybookAppProviders>);
}
describe("connected document Storybook flow", () => {
  it("switches between the confirmed document and the same retained change above the title", async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    const picker = await screen.findByRole("combobox", { name: "문서 작업 전환" });
    const title = screen.getByRole("heading", { level: 1, name: "지도 검색 API 계약" });
    expect(picker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(picker);
    await user.click(screen.getByRole("option", { name: /변경 작업/ }));
    expect(screen.getByText("로컬 초안", { exact: true })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "편집" }));
    const editPicker = screen.getByRole("combobox", { name: "문서 작업 전환" });
    expect(editPicker.compareDocumentPosition(screen.getByRole("textbox", { name: "문서 제목" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(editPicker);
    await user.click(screen.getByRole("option", { name: "확정 문서" }));
    expect(screen.getByText("확정본 · main")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "문서 작업 전환" }));
    await user.click(screen.getByRole("option", { name: /변경 작업/ }));
    expect(screen.getByText("로컬 초안", { exact: true })).toBeVisible();
  });
  it("opens review from the selected document and returns to that document", async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    await user.click(await screen.findByRole("button", { name: "리뷰 보기" }));
    expect(await screen.findByRole("region", { name: "문서 리뷰" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "문서로 돌아가기" }));
    expect(await screen.findByRole("button", { name: "편집" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "문서 목록" }));
    expect(await screen.findByRole("searchbox", { name: "문서 검색" })).toBeVisible();
  });
  it("keeps a local edit when returning through the list", async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    await user.click(await screen.findByRole("button", { name: "편집" }));
    await user.click(await screen.findByRole("tab", { name: "Markdown 원문" }));
    const source = await screen.findByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    const resumedMarkdown = `${source.value}\n\n이어 쓰는 초안`;
    await user.clear(source);
    await user.paste(resumedMarkdown);
    await user.click(screen.getByRole("button", { name: "편집 종료" }));
    await user.click(await screen.findByRole("button", { name: "문서 목록" }));
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    await user.click(await screen.findByRole("button", { name: "편집" }));
    await user.click(await screen.findByRole("tab", { name: "Markdown 원문" }));
    expect((await screen.findByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement).value).toContain("이어 쓰는 초안");
  });
  it("creates a document from the list and opens publication confirmation", async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole("button", { name: "새 문서" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByRole("textbox", { name: "제목" }), "새 안내 문서");
    await user.click(dialog.getByRole("button", { name: "문서 만들기" }));
    await user.click(await screen.findByRole("button", { name: "발행" }));
    const publication = within(await screen.findByRole("dialog", { name: "발행" }));
    expect(publication.getByText("새 안내 문서")).toBeVisible();
    await user.type(publication.getByRole("textbox", { name: /변경 설명/ }), "새 안내 추가");
    await user.click(publication.getByRole("button", { name: "발행하기" }));
    await user.click(await screen.findByRole("button", { name: "문서 목록" }));
    expect(await screen.findByRole("button", { name: /새 안내 문서/ })).toBeVisible();
  });
  it("keeps submitted review comments after returning to the document", async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    await user.click(await screen.findByRole("button", { name: "리뷰 보기" }));
    await user.type(screen.getByRole("textbox", { name: "리뷰 의견" }), "입력 예시를 확인했습니다.");
    await user.click(screen.getByRole("button", { name: "리뷰 제출" }));
    await screen.findByRole("article", { name: "나의 의견" });
    await user.click(screen.getByRole("button", { name: "문서로 돌아가기" }));
    await user.click(screen.getByRole("button", { name: "리뷰 보기" }));
    expect(await screen.findByText("입력 예시를 확인했습니다.")).toBeVisible();
  });
  it("opens the shared proposal without publishing it and prevents self-approval", async () => {
    const user = userEvent.setup(); show("none");
    await user.click(await screen.findByRole("button", { name: /지도 검색 API 계약/ }));
    await user.click(await screen.findByRole("button", { name: "편집" }));
    await user.click(await screen.findByRole("tab", { name: "Markdown 원문" }));
    const source = await screen.findByRole("textbox", { name: "Markdown 원문" }) as HTMLTextAreaElement;
    const proposedMarkdown = `${source.value}\n\n공유한 제안 내용`;
    await user.clear(source);
    await user.paste(proposedMarkdown);
    await user.click(screen.getByRole("button", { name: "발행" }));
    const publication = within(await screen.findByRole("dialog", { name: "발행" }));
    await user.click(publication.getByRole("radio", { name: "검토 요청" }));
    await user.type(publication.getByRole("textbox", { name: /변경 설명/ }), "조건 수정");
    await user.type(publication.getByRole("textbox", { name: /검토 요청 메모/ }), "예시를 확인해주세요.");
    await user.click(publication.getByRole("button", { name: "검토 요청 보내기" }));
    await screen.findByRole("button", { name: "편집" });
    expect(screen.queryByText("공유한 제안 내용")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "리뷰 보기" }));
    expect(screen.getByText("공유한 제안 내용")).toBeVisible();
    expect(screen.getByRole("radio", { name: "승인" })).toBeDisabled();
  });
});
