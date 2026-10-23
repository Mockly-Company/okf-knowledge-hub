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
  id: "documents-documentsearch", title: "문서 컴포넌트/DocumentSearch",
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

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("searchbox", { name: "문서 검색" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /지도 검색 API 계약/ })).toBeVisible();
  },
};
