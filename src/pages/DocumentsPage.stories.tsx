import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { withAppProviders, useStorybookProviderBoundary } from "@/stories/decorators/AppProviders";
import { documentFixtures } from "@/stories/fixtures/documents";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { DocumentTree } from "@/features/documents/components/DocumentTree";
import { Button } from "@/components/ui/button";
import { DocumentsPage } from "./DocumentsPage";

const meta = {
  id: "pages-documentspage", title: "화면/문서/목록",
  component: DocumentsPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DocumentsPage>;

export default meta;

type Story = StoryObj<typeof meta>;

const primaryGuide = { ...documentFixtures.mapSearchApi(), path: "docs/api/guide.md", title: "API 안내 · 기준 저장소", fileName: "guide.md" };
const secondaryGuide = { ...primaryGuide, path: "repo:team/handbook/docs/api/guide.md", title: "API 안내 · Handbook", documentId: "handbook-guide" };
const multiRepositoryCatalog = {
  documents: [primaryGuide, secondaryGuide],
  roots: [
    { kind: "folder" as const, name: "기준 저장소", path: "docs", children: [{ kind: "document" as const, summary: primaryGuide }] },
    { kind: "folder" as const, name: "team/handbook", path: "repo:team/handbook", children: [{ kind: "document" as const, summary: secondaryGuide }] },
  ],
};

function MultiRepositoryDocumentsPreview() {
  const { state, selectDocument, showDocumentsHome, openNewDocument } = useDocuments();
  const { documents } = useStorybookProviderBoundary();
  documents.markdownByPath = {
    [primaryGuide.path]: `# ${primaryGuide.title}\n\n기준 저장소에서 관리하는 API 계약입니다.\n\n## 요청 규칙\n\n요청에는 프로젝트 식별자를 포함합니다.`,
    [secondaryGuide.path]: `# ${secondaryGuide.title}\n\nHandbook 저장소에서 불러온 운영 안내입니다.\n\n## 운영 절차\n\nAPI 변경 전 담당자 검토를 요청합니다.`,
  };
  documents.historyPage = { items: [{ commitOid: "aabbccddeeff0011223344556677889900112233", shortOid: "aabbccd", authorName: "Lee", authoredAtUnix: 1_795_737_600,
    message: "Handbook API 안내 갱신", pathAtCommit: secondaryGuide.path }], nextCursor: null };
  return <div className="flex min-h-screen bg-[var(--color-canvas)] text-[var(--color-text-default)]">
    <aside aria-label="통합 문서 탐색" className="w-64 shrink-0 border-r border-[var(--color-border)] p-[var(--space-4)]">
      <Button variant="ghost" onClick={showDocumentsHome}>문서 목록</Button>
      <DocumentTree entries={state.catalog.roots} selectedPath={state.selectedPath} onSelectDocument={selectDocument} onNewDocument={openNewDocument} />
    </aside>
    <main className="min-w-0 flex-1 p-[var(--space-6)]"><DocumentsPage /></main>
  </div>;
}

export const MultipleRepositories: Story = {
  name: "여러 저장소 · 통합 문서",
  decorators: [withAppProviders({ documents: {
    catalog: multiRepositoryCatalog,
    repositoryFullName: "team/knowledge",
    searchResults: [primaryGuide, secondaryGuide].map(summary => ({ path: summary.path, title: summary.title, matchField: "body" as const, matchText: "API", snippet: "API 안내 문서입니다." })),
  }, router: { initialEntries: ["/documents"] } })],
  render: () => <MultiRepositoryDocumentsPreview />,
  play: async ({ canvas, userEvent }) => {
    // Home opens the domain map; path labels belong to the searchable result rows.
    const search = await canvas.findByRole("searchbox", { name: "문서 검색" });
    await expect(canvas.getByRole("button", { name: "도메인 맵" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(search, "API");
    await expect(await canvas.findByText("docs/api/guide.md")).toBeVisible();
    await expect(canvas.getByText("team/handbook · docs/api/guide.md")).toBeVisible();
    await expect(await canvas.findByRole("button", { name: /API 안내 · 기준 저장소/ })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: /API 안내 · Handbook/ }));
    await expect(await canvas.findByText("읽기 전용")).toBeVisible();
    await expect(await canvas.findByText("Handbook 저장소에서 불러온 운영 안내입니다.")).toBeVisible();
    await expect(canvas.queryByText("기준 저장소에서 관리하는 API 계약입니다.")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "편집" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "AI로 작업 시작" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: "History" }));
    await expect(await canvas.findByText("Handbook API 안내 갱신")).toBeVisible();
  },
};

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
    // "도메인 맵" is the first grouping mode chip (and the default view).
    await expect(
      canvas.getByRole("button", { name: "도메인 맵" }),
    ).toHaveFocus();
    await expect(
      canvas.getByRole("button", { name: /지도 검색 API 계약/ }),
    ).toBeVisible();
    newDocument.focus();
    await expect(newDocument).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        hidden: true,
      }),
    ).toHaveTextContent("새 문서");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole("dialog")).not.toBeInTheDocument());
    canvasElement.setAttribute("data-review-ready", "true");
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
