import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { DocumentsPage } from "./DocumentsPage";

const meta = {
  title: "Pages/DocumentsPage",
  component: DocumentsPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DocumentsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Home: Story = {
  decorators: [
    withAppProviders({ router: { initialEntries: ["/documents"] } }),
  ],
  play: async ({ canvas, canvasElement, userEvent }) => {
    const search = await canvas.findByRole("searchbox", { name: "문서 검색" });
    const newDocument = canvas.getByRole("button", { name: "새 문서" });

    await expect(canvas.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "모든 문서" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("combobox", { name: "문서 작업 전환" })).not.toBeInTheDocument();
    await expect(newDocument).toBeVisible();

    search.focus();
    await expect(search).toHaveFocus();
    await userEvent.tab();
    await expect(newDocument).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: /지도 검색 API 계약/ }),
    ).toHaveFocus();
    newDocument.focus();
    await expect(newDocument).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        hidden: true,
      }),
    ).toHaveTextContent("새 문서");
    await userEvent.keyboard("{Escape}");
  },
};

export const SearchResults: Story = {
  decorators: [
    withAppProviders({
      documents: {
        searchResults: [
          {
            path: "docs/api/map-search.md",
            title: "지도 검색 API 계약",
            matchField: "body",
            matchText: "응답 DTO",
            snippet: "응답 DTO와 오류 응답을 정리합니다.",
          },
        ],
      },
      router: { initialEntries: ["/documents"] },
    }),
  ],
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("searchbox", { name: "문서 검색" }),
      "응답 DTO",
    );

    await expect(
      await canvas.findByRole("button", { name: /지도 검색 API 계약/ }),
    ).toHaveTextContent("응답 DTO와 오류 응답을 정리합니다.");
  },
};

export const EmptySearch: Story = {
  decorators: [
    withAppProviders({
      documents: { initialSearchQuery: "존재하지 않는 문서" },
      router: { initialEntries: ["/documents"] },
    }),
  ],
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("searchbox", { name: "문서 검색" }),
    ).toHaveValue("존재하지 않는 문서");
    await expect(await canvas.findByText("검색 결과가 없습니다.")).toBeVisible();
  },
};
