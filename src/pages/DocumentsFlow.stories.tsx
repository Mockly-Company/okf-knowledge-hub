import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { PageStoryFrame } from "@/stories/decorators/PageStoryFrame";
import { DocumentsFlowPreview } from "@/stories/fixtures/DocumentsFlowPreview";

const meta = {
  id: "pages-documentsflow", title: "사용 흐름/문서 작성·검토·발행",
  component: DocumentsFlowPreview,
  parameters: { layout: "fullscreen" },
  decorators: [withAppProviders({ router: { initialEntries: ["/documents"] } })],
  args: { reviewState: "pending" },
  argTypes: { reviewState: { control: "select", options: ["none", "pending", "changes_requested", "approved", "closed", "merged"], description: "목록에 있는 예시 문서의 최초 검토 상태. 바꾸면 흐름을 처음부터 시작합니다." } },
  render: args => <PageStoryFrame><DocumentsFlowPreview key={args.reviewState} {...args} /></PageStoryFrame>,
} satisfies Meta<typeof DocumentsFlowPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: "문서 사용 흐름" };

export const ReviewJourneyTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /지도 검색 API 계약/ }));
    await userEvent.click(await canvas.findByRole("button", { name: "리뷰 보기" }));
    await expect(canvas.getByRole("region", { name: "문서 리뷰" })).toBeVisible();
    const open = canvas.queryByRole("button", { name: "리뷰 열기" });
    if (open) await userEvent.click(open);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.type(page.getByRole("textbox", { name: "리뷰 의견" }), "입력 조건을 확인했습니다.");
    await userEvent.click(page.getByRole("radio", { name: "승인" }));
    await userEvent.click(page.getByRole("button", { name: "리뷰 제출" }));
    await page.findByRole("article", { name: "나의 승인" });
    if (open) await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "문서로 돌아가기" }));
    await expect(canvas.getByText("검토 승인됨")).toBeVisible();
    await expect(canvas.getByText("위치 정보는 필수입니다.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "문서 목록" }));
    await expect(canvas.getByRole("searchbox", { name: "문서 검색" })).toBeVisible();
  },
};

export const NewDocumentJourneyTest: Story = {
  tags: ["!dev", "!autodocs"],
  play: async ({ canvas, canvasElement, userEvent }) => {
    const newButtons = await canvas.findAllByRole("button", { name: "새 문서" });
    await userEvent.click(newButtons[newButtons.length - 1]);
    const page = within(canvasElement.ownerDocument.body);
    const creation = within(await page.findByRole("dialog"));
    await userEvent.type(creation.getByRole("textbox", { name: "제목" }), "새 운영 가이드");
    await userEvent.click(creation.getByRole("button", { name: "문서 만들기" }));
    await userEvent.click(await canvas.findByRole("button", { name: "발행" }));
    const publication = within(await page.findByRole("dialog", { name: "발행" }));
    await userEvent.type(publication.getByRole("textbox", { name: /변경 설명/ }), "운영 가이드 추가");
    await userEvent.click(publication.getByRole("button", { name: "발행하기" }));
    await userEvent.click(await canvas.findByRole("button", { name: "문서 목록" }));
    await userEvent.click(await canvas.findByRole("button", { name: /새 운영 가이드/ }));
    await expect(await canvas.findByRole("heading", { name: "새 운영 가이드", level: 1 })).toBeVisible();
  },
};
