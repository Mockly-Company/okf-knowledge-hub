import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";
import { DocumentReviewPreview } from "@/stories/fixtures/DocumentReviewPreview";

const meta = {
  id: "pages-documentreview", title: "화면/문서/리뷰",
  component: DocumentReviewPreview,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "문서 한 개의 PR 리뷰 화면. 데이터와 제출 결과는 메모리에만 유지하며 GitHub로 전송하지 않습니다. 작은 상태 차이는 Controls에서 확인합니다." } },
  },
  decorators: [withAppProviders({ router: { initialEntries: ["/documents/docs/api/map-search.md/review/42"] } })],
  args: { view: "document", reviewState: "pending", viewer: "reviewer", loadState: "ready", submissionFails: false, versionChanged: false },
  argTypes: {
    view: { name: "보기", control: { type: "radio", labels: { document: "제안 문서", diff: "변경 비교" } }, options: ["document", "diff"] },
    reviewState: { name: "검토 상태", control: { type: "select", labels: { pending: "검토 대기 중", changes_requested: "수정 요청됨", approved: "승인됨", closed: "검토 종료", merged: "발행 완료" } }, options: ["pending", "changes_requested", "approved", "closed", "merged"] },
    viewer: { name: "현재 사용자", control: { type: "select", labels: { reviewer: "검토자", author: "PR 작성자", read_only: "읽기 전용" } }, options: ["reviewer", "author", "read_only"] },
    loadState: { name: "조회 상태", control: { type: "select", labels: { ready: "정상", loading: "불러오는 중", error: "조회 실패" } }, options: ["ready", "loading", "error"] },
    submissionFails: { name: "제출 실패", control: "boolean" },
    versionChanged: { name: "새 수정본 공유됨", control: "boolean" },
  },
  render: args => <PageStoryFrame><DocumentReviewPreview {...args} /></PageStoryFrame>,
} satisfies Meta<typeof DocumentReviewPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "문서 리뷰" };

export const ReviewInteractionTest: Story = {
  name: "리뷰 보기 전환과 수정 요청 자동 테스트", tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getAllByRole("heading", { name: "지도 검색 API 계약", level: 1 })).toHaveLength(1);
    const title = canvas.getByRole("heading", { name: "지도 검색 API 계약", level: 1 });
    await expect(Number(getComputedStyle(title).fontWeight)).toBeGreaterThanOrEqual(600);
    await expect(parseFloat(getComputedStyle(canvas.getByText("docs/api/map-search.md")).fontSize)).toBeLessThan(parseFloat(getComputedStyle(title).fontSize));
    const drawerButton = canvas.queryByRole("button", { name: "리뷰 열기" });
    if (drawerButton) await userEvent.click(drawerButton);
    const page = within(canvasElement.ownerDocument.body);
    const opinion = await page.findByRole("textbox", { name: "리뷰 의견" });
    await userEvent.type(opinion, "위치 정보가 없을 때의 예시를 추가해주세요.");
    if (drawerButton) {
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(drawerButton).toHaveFocus());
    }
    await userEvent.click(canvas.getByRole("tab", { name: "변경 비교" }));
    await expect(canvas.getByRole("region", { name: "원문 변경사항" })).toBeVisible();
    if (drawerButton) await userEvent.click(drawerButton);
    await expect(page.getByRole("textbox", { name: "리뷰 의견" })).toHaveValue("위치 정보가 없을 때의 예시를 추가해주세요.");
    await userEvent.click(page.getByRole("radio", { name: "수정 요청" }));
    await userEvent.click(page.getByRole("button", { name: "리뷰 제출" }));
    await expect(await within(page.getByRole("region", { name: "리뷰 기록" })).findByText("위치 정보가 없을 때의 예시를 추가해주세요.")).toBeVisible();
    if (drawerButton) await userEvent.keyboard("{Escape}");
    await expect(await canvas.findByText("수정 요청됨")).toBeVisible();
  },
};

export const AuthorInteractionTest: Story = {
  name: "작성자 권한 자동 테스트", tags: ["!dev", "!autodocs"], args: { viewer: "author" },
  play: async ({ canvas, canvasElement }) => {
    const drawerButton = canvas.queryByRole("button", { name: "리뷰 열기" });
    if (drawerButton) await userEvent.click(drawerButton);
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getByRole("radio", { name: "승인" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "수정 요청" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "리뷰 의견" })).toBeEnabled();
  },
};

export const ReviewBadgeAlignmentTest: Story = {
  name: "리뷰 아이콘·배지 정렬 자동 테스트", tags: ["!dev", "!autodocs"], args: { reviewState: "approved" },
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.queryByRole("button", { name: "리뷰 열기" });
    if (trigger) await userEvent.click(trigger);
    const record = within(canvasElement.ownerDocument.body).getByRole("article", { name: "Lee의 승인" });
    const memo = within(canvasElement.ownerDocument.body).getByRole("region", { name: "검토 요청 메모" });
    await expect(parseFloat(getComputedStyle(memo).paddingLeft)).toBe(0);
    await expect(parseFloat(getComputedStyle(memo).borderBottomWidth)).toBeGreaterThan(parseFloat(getComputedStyle(record).borderBottomWidth));
    const badge = record.querySelector<HTMLElement>(".document-review__record-kind")!;
    await expect(parseFloat(getComputedStyle(badge).paddingLeft)).toBeGreaterThanOrEqual(4);
    const iconBox = badge.querySelector("svg")!.getBoundingClientRect();
    const labelBox = within(badge).getByText("승인").getBoundingClientRect();
    await expect(Math.abs(iconBox.top + iconBox.height / 2 - labelBox.top - labelBox.height / 2)).toBeLessThanOrEqual(1);
  },
};

export const ReviewDrawerInteractionTest: Story = {
  name: "리뷰 패널 위치·포커스 자동 테스트", tags: ["!dev", "!autodocs"],
  beforeEach: () => {
    const savedWidth = localStorage.getItem("okhub.review-panel-width");
    localStorage.removeItem("okhub.review-panel-width");
    const original = window.matchMedia;
    window.matchMedia = query => {
      const media = original.call(window, query);
      if (query === "(max-width: 960px)") Object.defineProperty(media, "matches", { value: true });
      return media;
    };
    return () => {
      window.matchMedia = original;
      if (savedWidth === null) localStorage.removeItem("okhub.review-panel-width");
      else localStorage.setItem("okhub.review-panel-width", savedWidth);
    };
  },
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole("button", { name: "리뷰 열기" });
    await userEvent.click(trigger);
    const page = within(canvasElement.ownerDocument.body);
    const drawer = await page.findByRole("dialog", { name: /^리뷰$/ });
    const resize = within(drawer).getByRole("separator", { name: "리뷰 패널 너비 조절" });
    const originalWidth = drawer.getBoundingClientRect().width;
    const edge = resize.getBoundingClientRect();
    await userEvent.pointer([
      { target: resize, keys: "[MouseLeft>]", coords: { clientX: edge.left + 3, clientY: edge.top + 100 } },
      { target: resize, coords: { clientX: edge.left - 45, clientY: edge.top + 100 } },
      { target: resize, keys: "[/MouseLeft]" },
    ]);
    await waitFor(() => expect(drawer.getBoundingClientRect().width).toBeGreaterThan(originalWidth));
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(drawer.getBoundingClientRect().width).toBe(280));
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(drawer.getBoundingClientRect().width).toBe(Math.min(520, window.innerWidth)));
    localStorage.removeItem("okhub.review-panel-width");
    await expect(within(drawer).getAllByRole("heading", { name: /^리뷰$/ })).toHaveLength(1);
    const titleBox = within(drawer).getByRole("heading", { name: /^리뷰$/ }).getBoundingClientRect();
    const firstRecordBox = within(drawer).getByRole("region", { name: "검토 요청 메모" }).getBoundingClientRect();
    await expect(firstRecordBox.top - titleBox.bottom).toBeGreaterThanOrEqual(16);
    await waitFor(() => {
      const box = drawer.getBoundingClientRect();
      expect(Math.abs(box.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.right - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.bottom - window.innerHeight)).toBeLessThanOrEqual(1);
    });
    const input = within(drawer).getByRole("textbox", { name: "리뷰 의견" });
    await expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    await expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await userEvent.type(input, "패널 위치 확인");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await expect(within(await page.findByRole("dialog", { name: /^리뷰$/ })).getByRole("textbox", { name: "리뷰 의견" })).toHaveValue("패널 위치 확인");
  },
};
