import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, waitFor } from "storybook/test";
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
    <section className="documents-page documents-page--reader" style={{ height: "100dvh", overflowY: "auto" }}>
      <DocumentReader {...args} />
    </section>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const reader = canvas.getByRole("region", { name: "지도 검색 API 계약" });
    await expect(getComputedStyle(reader.querySelector(".document-reader__layout")!).display).toBe("grid");
    const scrollBoundary = reader.closest<HTMLElement>(".documents-page")!;
    await expect(scrollBoundary.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(getComputedStyle(scrollBoundary).overflowY).toBe("auto");
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
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "보기 밀도" })).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    await expect(await screen.findByRole("menuitemradio", { name: "작게" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "편안하게" }));
    await waitFor(() => expect(root).toHaveAttribute("data-density", "default"));
    await expect(body.textContent).toBe(unchangedText);
    await waitFor(() => expect(more).toHaveFocus());
  },
};
