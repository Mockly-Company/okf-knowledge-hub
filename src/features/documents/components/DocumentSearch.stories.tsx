import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { DocumentSummary } from "../model";
import { DocumentSearch } from "./DocumentSearch";

const document: DocumentSummary = {
  path: "docs/api/map-search.md",
  fileName: "map-search.md",
  title: "지도 검색 API 계약",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  modifiedAtUnixMs: 1,
  size: 100,
};

const meta = {
  title: "Documents/DocumentSearch",
  component: DocumentSearch,
  parameters: { layout: "padded" },
  args: {
    query: "",
    documents: [document],
    results: [],
    searchStatus: "idle",
    searchError: null,
    indexStatus: { status: "ready" },
    onQueryChange: () => {},
    onSelectDocument: () => {},
    onSelectResult: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof DocumentSearch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const IndexPreparing: Story = {
  args: {
    indexStatus: { status: "preparing", indexed: 2, total: 8 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "본문 검색을 준비하는 중… 2/8",
    );
  },
};

export const SearchUnavailable: Story = {
  args: {
    query: "응답 DTO",
    searchStatus: "error",
    searchError: {
      code: "document_index_unavailable",
      message: "본문 검색을 사용할 수 없습니다.",
      recovery: "retry",
      details: {},
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "본문 검색을 사용할 수 없습니다.",
    );
    await expect(canvas.getByRole("button", { name: "검색 다시 시도" })).toBeVisible();
  },
};
