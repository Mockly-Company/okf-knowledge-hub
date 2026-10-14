import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor, within } from "storybook/test";
import { DocumentReader } from "@/features/documents/components/DocumentReader";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { documentFixtures } from "@/stories/fixtures/documents";
import { markdownFixtures } from "@/stories/fixtures/markdown";
import "@/features/documents/documents.css";

const summary = documentFixtures.mapSearchApi();
const document = markdownFixtures.referenceDocument();

const meta = {
  title: "Pages/DocumentDetail",
  component: DocumentReader,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    withAppProviders({
      documents: {
        branch: "main",
        catalog: documentFixtures.catalog(summary),
      },
      router: { initialEntries: ["/documents/docs/api/map-search.md"] },
    }),
  ],
  args: {
    document,
    notice: null,
  },
} satisfies Meta<typeof DocumentReader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <section className="documents-page documents-page--reader" style={{ height: "100dvh" }}>
      <DocumentReader {...args} />
    </section>
  ),
  play: async ({ canvas, canvasElement, userEvent, globals }) => {
    await canvasElement.ownerDocument.fonts.ready;
    await canvas.findByRole("button", {name: "다이어그램 크게 보기"});
    const reader = canvas.getByRole("region", { name: "지도 검색 API 계약" });
    if (window.innerWidth > 760) {
      const header = reader.querySelector(".document-reader__header")!;
      const panel = canvas.getByRole("complementary", {name: "문서 문맥"});
      await expect(header.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().left);
      await expect(Math.abs(header.getBoundingClientRect().top - panel.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
      await expect(panel.getBoundingClientRect().left - reader.querySelector(".document-reader__canvas")!.getBoundingClientRect().right).toBeGreaterThan(0);
    }
    await expect(getComputedStyle(reader.querySelector(".document-reader__layout")!).display).toBe("grid");
    const scrollBoundary = reader.querySelector<HTMLElement>(".document-reader__canvas")!;
    await expect(getComputedStyle(reader.closest(".documents-page")!).overflowY).toBe("hidden");
    await expect(scrollBoundary.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(getComputedStyle(scrollBoundary).overflowY).toBe("auto");
    const idleScrollbar = getComputedStyle(scrollBoundary).scrollbarColor;
    await expect(idleScrollbar).toMatch(/^rgba\([^)]*,\s*0\) rgba\([^)]*,\s*0\)$/);
    scrollBoundary.focus();
    await expect(getComputedStyle(scrollBoundary).scrollbarColor).not.toBe(idleScrollbar);
    scrollBoundary.blur();
    scrollBoundary.scrollTop = scrollBoundary.scrollHeight;
    if (scrollBoundary.scrollHeight > scrollBoundary.clientHeight) {
      await expect(scrollBoundary.scrollTop).toBeGreaterThan(0);
    } else {
      await expect(scrollBoundary.scrollTop).toBe(0);
      await expect(reader.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        scrollBoundary.getBoundingClientRect().bottom,
      );
    }
    scrollBoundary.scrollTop = 0;

    if (window.innerWidth <= 760) {
      await expect(canvas.queryByRole("complementary", {name: "문서 문맥"})).not.toBeInTheDocument();
      const open = canvas.getByRole("button", {name: "문서 문맥 펼치기"});
      await userEvent.click(open);
      const drawer = await screen.findByRole("dialog", {name: "문서 문맥"});
      await expect(drawer).toBeVisible();
      await expect(Math.abs(drawer.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
      await expect(Math.abs(drawer.getBoundingClientRect().right - window.innerWidth)).toBeLessThanOrEqual(1);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(open).toHaveFocus());
      await userEvent.click(open);
      const context = within(await screen.findByRole("dialog", {name: "문서 문맥"}));
      await userEvent.click(context.getByRole("link", {name: "응답"}));
      await waitFor(() => expect(screen.queryByRole("dialog", {name: "문서 문맥"})).not.toBeInTheDocument());
      await expect(canvas.getByRole("heading", {name: "응답"})).toHaveFocus();
      await expect(scrollBoundary.scrollTop).toBeGreaterThan(0);
      canvasElement.setAttribute("data-review-ready", "true");
      return;
    }

    await expect(reader.closest(".documents-page")).toHaveClass(
      "documents-page--reader",
    );

    await expect(canvas.getByRole("heading", { level: 1, name: "지도 검색 API 계약" })).toHaveAttribute("id", "지도-검색-api-계약");
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await expect(canvas.getByText("확정본 · main")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "편집" })).toBeVisible();
    await expect(canvas.getByRole("complementary", { name: "문서 문맥" })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "개요" })).toBeVisible();
    await expect(canvas.getByRole("tab", { name: "History" })).toBeVisible();
    const overview = canvas.getByRole("tab", { name: "개요" });
    const history = canvas.getByRole("tab", { name: "History" });
    const toggle = canvas.getByRole("button", { name: "문서 문맥 접기" });
    await expect(history.getBoundingClientRect().left - overview.getBoundingClientRect().right).toBeGreaterThanOrEqual(16);
    await expect(Math.abs(toggle.getBoundingClientRect().top + toggle.getBoundingClientRect().height / 2 - overview.getBoundingClientRect().top - overview.getBoundingClientRect().height / 2)).toBeLessThanOrEqual(1);
    const propertyLabel = canvas.getByText("유형", {exact: true});
    const propertyValue = canvas.getByText("API 계약", {exact: true});
    await expect(Math.abs(propertyLabel.getBoundingClientRect().top - propertyValue.getBoundingClientRect().top)).toBeLessThanOrEqual(2);
    const toc = canvas.getByRole("navigation", {name: "목차"});
    await expect(toc.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    scrollBoundary.scrollTop = scrollBoundary.scrollHeight;
    await waitFor(() => expect(canvas.getByRole("link", {name: "운영 확인"})).toHaveAttribute("aria-current", "location"));
    scrollBoundary.scrollTop = 0;
    await waitFor(() => expect(canvas.getByRole("link", {name: "지도 검색 API 계약"})).toHaveAttribute("aria-current", "location"));
    const requestHeading = canvas.getByRole("heading", {name: "요청"});
    scrollBoundary.scrollTop += requestHeading.getBoundingClientRect().top - scrollBoundary.getBoundingClientRect().top - 20;
    await waitFor(() => expect(canvas.getByRole("link", {name: "요청"})).toHaveAttribute("aria-current", "location"));
    scrollBoundary.scrollTop = 0;
    await waitFor(() => expect(canvas.getByRole("link", {name: "지도 검색 API 계약"})).toHaveAttribute("aria-current", "location"));
    await userEvent.click(canvas.getByRole("link", {name: "응답"}));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await expect(canvas.getByRole("link", {name: "응답"})).toHaveAttribute("aria-current", "location");
    scrollBoundary.focus();
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(canvas.getByRole("link", {name: "운영 확인"})).toHaveAttribute("aria-current", "location"));
    const contextPanel = canvas.getByRole("complementary", {name: "문서 문맥"});
    if (window.innerWidth > 760) await expect(contextPanel.getBoundingClientRect().top).toBeGreaterThanOrEqual(scrollBoundary.getBoundingClientRect().top);
    scrollBoundary.scrollTop = 0;
    await waitFor(() => expect(canvas.getByRole("link", {name: "지도 검색 API 계약"})).toHaveAttribute("aria-current", "location"));
    await userEvent.click(toggle);
    const expandContext = canvas.getByRole("button", {name: "문서 문맥 펼치기"});
    await waitFor(() => expect(expandContext).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(canvas.getByRole("button", {name: "문서 문맥 접기"})).toHaveFocus());
    await expect(
      canvas.queryByRole("tab", { name: "연결" }),
    ).not.toBeInTheDocument();

    const more = canvas.getByRole("button", { name: "더보기" });
    await canvas.findByRole("button", { name: "다이어그램 크게 보기" });
    const body = canvasElement.querySelector(".markdown-document")!;
    const unchangedText = body.textContent;
    const root = canvasElement.ownerDocument.documentElement;
    await userEvent.click(more);
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    const compact = await screen.findByRole("menuitemradio", { name: "작게" });
    await userEvent.click(compact);
    await waitFor(() => expect(root).toHaveAttribute("data-density", "compact"));
    await expect(body.textContent).toBe(unchangedText);
    await waitFor(() => expect(more).toHaveFocus());
    const focusStyle = getComputedStyle(more);
    const focusExtent = parseFloat(focusStyle.outlineWidth) + Math.max(0, parseFloat(focusStyle.outlineOffset));
    await expect(more.getBoundingClientRect().top - focusExtent).toBeGreaterThanOrEqual(scrollBoundary.getBoundingClientRect().top);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "보기 밀도" })).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    await expect(await screen.findByRole("menuitemradio", { name: "작게" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "편안하게" }));
    await waitFor(() => expect(root).toHaveAttribute("data-density", "default"));
    await expect(body.textContent).toBe(unchangedText);
    await waitFor(() => expect(more).toHaveFocus());
    if (globals.displayDensity === "compact") {
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByRole("menuitem", { name: "보기 밀도" })).toHaveFocus());
      await userEvent.keyboard("{ArrowRight}");
      await userEvent.click(await screen.findByRole("menuitemradio", { name: "작게" }));
      await waitFor(() => expect(root).toHaveAttribute("data-density", "compact"));
    }
    canvasElement.setAttribute("data-review-ready", "true");
  },
};
