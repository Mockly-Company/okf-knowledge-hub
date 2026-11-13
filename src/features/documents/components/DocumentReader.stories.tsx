import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { expect } from "storybook/test";
import "../documents.css";
import { DocumentsProvider } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { DocumentReader } from "./DocumentReader";

const dualViewDoc: DocumentContent = {
  summary: {
    path: "docs/product/roadmap-v2.md",
    fileName: "roadmap-v2.md",
    title: "OkHub v2 전체 컨셉 및 자동화 흐름",
    documentId: "a4f8c91e-7b23-4d61-9a18-52e3f01c8b44",
    frontmatterStatus: { status: "valid" },
    modifiedAtUnixMs: 1_731_500_000_000,
    size: 420,
  },
  markdown: "# OkHub v2 전체 컨셉 및 자동화 흐름\n\n## 1. 한 줄 컨셉\n\nAI는 `.md`로 읽고 쓰고 사람은 `.html`로 확인합니다.",
  properties: { type: "Product Spec", status: "approved" },
  tableOfContents: [
    { level: 1, title: "OkHub v2 전체 컨셉 및 자동화 흐름", id: "okhub-v2" },
    { level: 2, title: "1. 한 줄 컨셉", id: "concept" },
  ],
  lastCommit: {
    commitOid: "7fbb020abcdef",
    shortOid: "7fbb020",
    authorName: "OkHub Team",
    authoredAtUnix: 1_731_500_000,
    message: "docs(v2): .md+.html 2벌 문서 체계 정립",
  },
  companionHtml: {
    path: "docs/product/roadmap-v2.html",
    html: "<!doctype html><html lang='ko'><head><style>body{font-family:sans-serif;padding:24px;color:hsl(220 20% 11%)}.badge{background:hsl(162 72% 31%);color:white;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}</style></head><body><p><span class='badge'>NEW</span> 이번 PR에서 달라진 점</p><h1>OkHub v2 사람용 구조화 뷰</h1><p>동반 .html 파일이 존재하면 기본으로 사람용 구조화 화면을 보여줍니다.</p></body></html>",
    modifiedAtUnixMs: 1_731_500_000_500,
  },
  htmlSyncStatus: "in_sync",
};

function ReaderHarness({ document }: { document: DocumentContent }) {
  const gateway = new FakeDocumentsGateway();
  return (
    <TestQueryProvider>
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <MemoryRouter>
          <DocumentsProvider gateway={gateway}>
            <DocumentReader document={document} />
          </DocumentsProvider>
        </MemoryRouter>
      </PreferencesProvider>
    </TestQueryProvider>
  );
}

const meta = {
  id: "documents-documentreader-dualview",
  title: "문서 컴포넌트/DocumentReader (2벌 뷰어)",
  component: ReaderHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReaderHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HumanHtmlDefault: Story = {
  args: { document: dualViewDoc },
  play: async ({ canvas }) => {
    const htmlTab = await canvas.findByRole("tab", { name: "사람용 보기 (.html)" });
    await expect(htmlTab).toHaveAttribute("aria-selected", "true");
  },
};

export const OutdatedHtmlNotice: Story = {
  args: {
    document: {
      ...dualViewDoc,
      htmlSyncStatus: "outdated",
    },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/사람용 \.html 뷰가 \.md 원본보다 오래되었습니다/),
    ).toBeVisible();
  },
};
