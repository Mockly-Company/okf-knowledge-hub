import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { useDocuments } from "../DocumentsProvider";
import { StorybookAppProviders } from "@/stories/decorators/AppProviders";
import { markdownFixtures } from "@/stories/fixtures/markdown";
import { MarkdownDocument, type MarkdownDocumentProps } from "./MarkdownDocument";
import "../documents.css";

function ReadyMarkdown(props: MarkdownDocumentProps) {
  const { state } = useDocuments();
  return state.status === "ready" ? (
    <div className="markdown-story">
      <style>{`
        html:has(.markdown-story), body:has(.markdown-story) {
          height: auto;
          min-height: 100%;
          overflow: auto;
          background: var(--color-surface);
        }
      `}</style>
      <MarkdownDocument {...props} />
    </div>
  ) : null;
}

const meta = {
  title: "Documents/MarkdownDocument",
  component: MarkdownDocument,
  parameters: { layout: "padded" },
  decorators: [(Story, context) => (
    <StorybookAppProviders
      documents={{ asset: markdownFixtures.localSvgAsset() }}
      preferences={{ displayDensity: context.globals.displayDensity === "compact" ? "compact" : "default" }}
    >
      <Story />
    </StorybookAppProviders>
  )],
  render: (args) => <ReadyMarkdown {...args} />,
  args: { document: markdownFixtures.referenceDocument(), hideHeader: true },
} satisfies Meta<typeof MarkdownDocument>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { level: 1, name: "지도 검색 API 계약" })).toBeVisible();
    await expect(await canvas.findByRole("button", { name: "다이어그램 크게 보기" })).toBeVisible();
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
};

export const TypographyAndLists: Story = {
  args: { document: markdownFixtures.typographyAndLists() },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const anchor = await canvas.findByRole("link", { name: "응답 규칙으로 이동" });
    await userEvent.tab();
    await expect(anchor).toHaveFocus();
    await expect(getComputedStyle(anchor).outlineStyle).not.toBe("none");
    await expect(canvas.getByRole("heading", { name: "응답 규칙" })).toHaveAttribute("id", "응답-규칙");
    await expect(decodeURIComponent(anchor.getAttribute("href")!)).toBe("#응답-규칙");
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "API 안내" })).toHaveFocus();
    for (const checkbox of canvas.getAllByRole("checkbox")) await expect(checkbox).toBeDisabled();
    await expect(canvas.getAllByRole("heading")).toHaveLength(6);
    await expect(Number.parseFloat(getComputedStyle(canvas.getByRole("heading", { level: 1 })).fontSize))
      .toBeGreaterThan(Number.parseFloat(getComputedStyle(canvas.getByRole("heading", { level: 2 })).fontSize));
  },
};

export const AlertsAndDetails: Story = {
  args: { document: markdownFixtures.alertsAndDetails() },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const summary = await canvas.findByText("오류 응답 예시 보기");
    const details = summary.closest("details")!;
    await expect(details).not.toHaveAttribute("open");
    await expect(canvasElement.querySelectorAll(".markdown-alert")).toHaveLength(5);
    await userEvent.click(summary);
    await expect(details).toHaveAttribute("open");
    await expect(within(details).getByText(/MAP_PROVIDER_UNAVAILABLE/)).toBeVisible();
    await userEvent.tab();
    await expect(within(details).getByRole("button", { name: "코드 복사" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(within(details).getByRole("button", { name: "복사됨" })).toBeVisible();
    // Native summary Tab/Enter/Space defaults are exercised by the Playwright matrix.
    const summaryControl = details.querySelector("summary")!;
    summaryControl.focus();
    await expect(summaryControl).toHaveFocus();
    await userEvent.click(summary);
    await expect(details).not.toHaveAttribute("open");
    await userEvent.click(summary);
    await expect(details).toHaveAttribute("open");
    canvasElement.querySelector(".markdown-story")?.setAttribute("data-interactions", "complete");
  },
};

export const CodeAndTable: Story = {
  args: { document: markdownFixtures.codeAndTable() },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const copy = await canvas.findByRole("button", { name: "코드 복사" });
    await userEvent.tab();
    await expect(copy).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "복사됨" })).toBeVisible();
    const tableScroll = canvas.getByLabelText("표 가로 스크롤");
    await userEvent.tab();
    await expect(canvas.getByRole("region", { name: "코드 가로 스크롤" })).toHaveFocus();
    await userEvent.tab();
    await expect(tableScroll).toHaveFocus();
    await expect(getComputedStyle(tableScroll).outlineStyle).not.toBe("none");
    const article = canvasElement.querySelector<HTMLElement>(".markdown-document")!;
    for (const wrapper of canvasElement.querySelectorAll<HTMLElement>(".markdown-code-block__scroll, .markdown-table-scroll")) {
      await expect(getComputedStyle(wrapper).overflowX).toBe("auto");
      await expect(wrapper.getBoundingClientRect().right).toBeLessThanOrEqual(article.getBoundingClientRect().right + 1);
      await expect(wrapper.scrollWidth).toBeGreaterThan(wrapper.clientWidth);
    }
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const ImagesAndFootnotes: Story = {
  args: { document: markdownFixtures.imagesAndFootnotes() },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const image = await canvas.findByRole("img", { name: "장소 검색 흐름" });
    await expect(image.querySelector("svg")).toBeVisible();
    await expect(canvas.getByText("저장소 안의 SVG로 표시한 검색 흐름")).toBeVisible();
    const footnote = canvasElement.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    await userEvent.tab();
    await expect(footnote).toHaveFocus();
    const noteId = decodeURIComponent(footnote.hash.slice(1));
    await expect(canvasElement.ownerDocument.getElementById(noteId)).toBeVisible();
    const back = canvasElement.querySelector<HTMLAnchorElement>("a[data-footnote-backref]")!;
    await userEvent.tab();
    await expect(back).toHaveFocus();
    await expect(canvasElement.ownerDocument.getElementById(decodeURIComponent(back.hash.slice(1)))).toBe(footnote);
  },
};

export const CompactDensity: Story = {
  globals: { displayDensity: "compact" },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole("button", { name: "다이어그램 크게 보기" })).toBeVisible();
    await waitFor(() => expect(canvasElement.ownerDocument.documentElement).toHaveAttribute("data-density", "compact"));
    await expect(getComputedStyle(canvasElement.querySelector(".markdown-document")!).fontSize).toBe("15px");
  },
};

export const UnsafeContentFallbacks: Story = {
  args: { document: markdownFixtures.unsafeDocument() },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText("외부 이미지는 표시할 수 없습니다.")).toBeVisible();
    await expect(canvas.getByText("blocked-map.svg")).toBeVisible();
    await expect(canvas.getByText(/지원하지 않는 파일 링크입니다/)).toBeVisible();
    await expect(canvasElement.querySelector(".markdown-document script, .markdown-document iframe")).toBeNull();
    await expect(canvasElement.querySelector("img[src^='http']")).toBeNull();
    await expect(canvas.getByRole("link", { name: "안전하지 않은 실행 링크" })).toHaveAttribute("href", "#");
    await expect(canvasElement.querySelector(".markdown-document")).toHaveTextContent("alert('not-executed')");
  },
};
