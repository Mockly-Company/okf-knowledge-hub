import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "../DocumentsProvider";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { PlanningPrReviewSection } from "./PlanningPrReviewPanel";

afterEach(cleanup);

function renderSection(gateway: FakeDocumentsGateway) {
  return render(
    <TestQueryProvider>
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <MemoryRouter>
          <DocumentsProvider gateway={gateway}>
            <PlanningPrReviewSection />
          </DocumentsProvider>
        </MemoryRouter>
      </PreferencesProvider>
    </TestQueryProvider>,
  );
}

describe("PlanningPrReviewSection", () => {
  it("lists open planning PRs for the active docs repository, switches changed docs, toggles .html vs .md diff, and approves & merges", async () => {
    const user = userEvent.setup();
    const gateway = new FakeDocumentsGateway();
    gateway.openPullRequests = [
      {
        number: 17,
        title: "docs(v2): 기획 로드맵 및 기능 명세 제안",
        body: "이번 PR에서 로드맵과 기능 명세를 갱신했습니다.",
        htmlUrl: "https://github.com/Acme-Org/acme-docs/pull/17",
        authorLogin: "alice",
        headRef: "draft/alice/roadmap",
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
          baseMarkdown: "# OkHub v2 로드맵\n\n기존 내용\n",
          headMarkdown: "# OkHub v2 로드맵\n\n> **[CHANGED]** 신규 계층 백로그 규칙 반영\n",
          companionHtml:
            "<!doctype html><html lang='ko'><body><div class='change-banner'>이번 PR 변경점</div><h1>OkHub v2 로드맵</h1></body></html>",
          hasCompanionHtml: true,
        },
        {
          path: "docs/product/features.md",
          title: "기능 명세",
          status: "added",
          baseMarkdown: null,
          headMarkdown: "# 기능 명세\n\n- 원클릭 승인 및 머지\n",
          companionHtml: null,
          hasCompanionHtml: false,
        },
      ],
    });

    renderSection(gateway);

    expect(
      await screen.findByText(/docs\(v2\): 기획 로드맵 및 기능 명세 제안/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /변경 문서 확인 · 승인/ }),
    );

    const htmlTab = await screen.findByRole("tab", {
      name: "사람용 보기 (.html)",
    });
    expect(htmlTab).toHaveAttribute("aria-selected", "true");
    const frame = screen.getByTitle("OkHub v2 로드맵 사람용 보기");
    expect(frame.getAttribute("srcdoc")).toContain("이번 PR 변경점");

    await user.click(screen.getByRole("tab", { name: "원문 Diff (.md)" }));
    expect(
      await screen.findByText(/신규 계층 백로그 규칙 반영/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /기능 명세/ }));
    expect(
      await screen.findByText(/원클릭 승인 및 머지/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "승인 및 머지" }));

    await waitFor(() => {
      expect(gateway.approvedPullRequests).toEqual([
        { number: 17, comment: undefined },
      ]);
    });
    expect(
      await screen.findByText(/기획 PR #17을 승인하고 머지했습니다/),
    ).toBeInTheDocument();
  });

  it("publishes an active draft from DocumentsPage as a planning review PR", async () => {
    const user = userEvent.setup();
    const gateway = new FakeDocumentsGateway();
    gateway.sessionSnapshot.lastOpenedPath = null;
    gateway.activeRecovery = {
      document: {
        changeId: "change-42",
        documentId: "80a44162-92c6-4f2c-9b77-ef5c42a52e5a",
        path: "docs/product/roadmap-v2.md",
        markdown: "# OkHub v2 로드맵\n\n신규 자동화 규칙 제안 본문입니다.\n",
        contentHash: "hash-42",
        draft: {
          workspaceId: "ws-acme",
          changeId: "change-42",
          authorLogin: "alice",
          baseCommit: "base-01",
          branch: "draft/alice/roadmap-v2",
          createdAtUnixMs: 1_731_500_000_000,
          lastOpenedAtUnixMs: 1_731_500_000_000,
        },
      },
      conflict: null,
      hasUnsavedRecovery: false,
    };

    render(
      <TestQueryProvider>
        <PreferencesProvider repository={new FakePreferencesRepository()}>
          <MemoryRouter>
            <DocumentsProvider gateway={gateway}>
              <DocumentsPage />
            </DocumentsProvider>
          </MemoryRouter>
        </PreferencesProvider>
      </TestQueryProvider>,
    );

    const publishTrigger = await screen.findByRole(
      "button",
      { name: "발행" },
      { timeout: 10_000 },
    );
    await user.click(publishTrigger);

    await user.click(await screen.findByLabelText("검토 요청"));
    await user.type(
      screen.getByLabelText(/변경 설명/),
      "docs(v2): 기획 로드맵 초안 검토 요청",
    );
    await user.type(
      screen.getByLabelText(/검토 요청 메모/),
      "사람용 .html 변경 배너도 함께 확인 부탁드립니다.",
    );
    await user.click(screen.getByRole("button", { name: "검토 요청 보내기" }));

    await waitFor(() => {
      expect(gateway.publishedDrafts).toEqual([
        {
          sessionId: expect.any(String),
          intent: "review",
          message: "docs(v2): 기획 로드맵 초안 검토 요청",
          reviewNote: "사람용 .html 변경 배너도 함께 확인 부탁드립니다.",
        },
      ]);
    });
    expect(
      await screen.findByText(/검토 요청 PR #11을 생성했습니다/),
    ).toBeInTheDocument();
  });
});
