import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { expect, userEvent } from "storybook/test";
import "../documents.css";
import { DocumentsProvider } from "../DocumentsProvider";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { PlanningPrReviewSection } from "./PlanningPrReviewPanel";

function createPrGateway(): FakeDocumentsGateway {
  const gateway = new FakeDocumentsGateway();
  gateway.openPullRequests = [
    {
      number: 17,
      title: "docs(v2): 기획 로드맵 및 기능 명세 제안",
      body: "이번 PR에서 로드맵과 기능 명세의 2벌(.md + .html) 문서를 갱신했습니다.",
      htmlUrl: "https://github.com/Acme-Org/acme-docs/pull/17",
      authorLogin: "alice",
      headRef: "draft/alice/roadmap-v2",
      headSha: "head17",
      baseRef: "main",
      baseSha: "base17",
      isDraft: false,
      mergeable: true,
      updatedAt: "2026-11-14T00:00:00Z",
    },
  ];
  gateway.pullRequestDetails.set(17, {
    pullRequest: gateway.openPullRequests[0],
    viewerLogin: "bob",
    documents: [
      {
        path: "docs/product/roadmap-v2.md",
        title: "OkHub v2 로드맵",
        status: "modified",
        baseMarkdown: "# OkHub v2 로드맵\n\n기존 로드맵 설명입니다.\n",
        headMarkdown:
          "# OkHub v2 로드맵\n\n> **[CHANGED]** 신규 계층 백로그 파생 규칙을 추가했습니다.\n",
        companionHtml:
          "<!doctype html><html lang='ko'><head><style>body{font-family:sans-serif;padding:24px;color:hsl(220 20% 11%)}.banner{background:hsl(162 72% 94%);border-left:4px solid hsl(162 72% 31%);padding:12px 16px;border-radius:8px;margin-bottom:16px}</style></head><body><div class='banner'><strong>이번 PR에서 달라진 점</strong>: 신규 계층 백로그 파생 규칙 반영</div><h1>OkHub v2 로드맵</h1><p>사람용 .html 구조화 뷰를 기본으로 표시합니다.</p></body></html>",
        hasCompanionHtml: true,
      },
      {
        path: "docs/product/features.md",
        title: "기능 명세",
        status: "added",
        baseMarkdown: null,
        headMarkdown: "# 기능 명세\n\n- 원클릭 기획 PR 승인 및 머지\n",
        companionHtml: null,
        hasCompanionHtml: false,
      },
    ],
  });
  return gateway;
}

function PlanningPrHarness() {
  const gateway = createPrGateway();
  return (
    <TestQueryProvider>
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <MemoryRouter>
          <DocumentsProvider gateway={gateway}>
            <div style={{ padding: "var(--space-5)" }}>
              <PlanningPrReviewSection />
            </div>
          </DocumentsProvider>
        </MemoryRouter>
      </PreferencesProvider>
    </TestQueryProvider>
  );
}

const meta = {
  id: "documents-planningprreviewsection",
  title: "문서 컴포넌트/PlanningPrReviewSection",
  component: PlanningPrHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlanningPrHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenPullRequestList: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(/docs\(v2\): 기획 로드맵 및 기능 명세 제안/),
    ).toBeVisible();
  },
};

export const ReviewPanelOpened: Story = {
  play: async ({ canvas }) => {
    const openBtn = await canvas.findByRole("button", {
      name: /변경 문서 확인 · 승인/,
    });
    await userEvent.click(openBtn);
    const htmlTab = await canvas.findByRole("tab", {
      name: "사람용 보기 (.html)",
    });
    await expect(htmlTab).toHaveAttribute("aria-selected", "true");
  },
};
