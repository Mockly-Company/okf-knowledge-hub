import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { StandaloneDocumentWindowPage } from "./StandaloneDocumentWindowPage";

afterEach(cleanup);

describe("StandaloneDocumentWindowPage", () => {
  it("loads the requested standalone document and supports in-window link navigation with history", async () => {
    const user = userEvent.setup();
    const gateway = new FakeDocumentsGateway();
    gateway.documentsByPath.set("docs/domains/dashboard/prd.md", {
      summary: {
        path: "docs/domains/dashboard/prd.md",
        fileName: "prd.md",
        title: "대시보드 PRD",
        documentId: "dash-prd",
        frontmatterStatus: { status: "valid" },
        modifiedAtUnixMs: 1,
        size: 120,
      },
      markdown: "# 대시보드 PRD\n\nPRD 본문",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
      companionHtml: {
        path: "docs/domains/dashboard/prd.html",
        html: "<html><body><h1>대시보드 PRD HTML</h1></body></html>",
        modifiedAtUnixMs: 2,
      },
    });
    gateway.documentsByPath.set("docs/domains/dashboard/screen-spec.md", {
      summary: {
        path: "docs/domains/dashboard/screen-spec.md",
        fileName: "screen-spec.md",
        title: "대시보드 화면명세서",
        documentId: "dash-spec",
        frontmatterStatus: { status: "valid" },
        modifiedAtUnixMs: 3,
        size: 150,
      },
      markdown: "# 대시보드 화면명세서\n\n화면명세 본문",
      properties: {},
      tableOfContents: [],
      lastCommit: null,
      companionHtml: {
        path: "docs/domains/dashboard/screen-spec.html",
        html: "<html><body><h1>대시보드 화면명세서 HTML</h1></body></html>",
        modifiedAtUnixMs: 4,
      },
    });
    const readSpy = vi.spyOn(gateway, "readStandaloneDocument");

    render(
      <TestQueryProvider>
        <MemoryRouter
          initialEntries={[
            "/doc-window?workspaceId=ws-1&doc=docs%2Fdomains%2Fdashboard%2Fprd.md&view=html",
          ]}
        >
          <Routes>
            <Route
              path="doc-window"
              element={
                <StandaloneDocumentWindowPage documentsGateway={gateway} />
              }
            />
          </Routes>
        </MemoryRouter>
      </TestQueryProvider>,
    );

    expect(readSpy).toHaveBeenCalledWith("ws-1", "docs/domains/dashboard/prd.md");
    const firstFrame = (await screen.findByTitle(
      "대시보드 PRD 사람용 보기",
    )) as HTMLIFrameElement;
    expect(firstFrame).toBeVisible();

    const srcDoc = firstFrame.getAttribute("srcdoc") ?? "";
    const channel = /var ch="([^"]+)"/.exec(srcDoc)![1]!;

    // Navigate inside the standalone window to screen-spec.html.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: firstFrame.contentWindow,
        data: {
          type: "okhub:companion-link",
          channel,
          kind: "document",
          href: "screen-spec.html",
        },
      }),
    );

    expect(
      await screen.findByTitle("대시보드 화면명세서 사람용 보기"),
    ).toBeVisible();

    // Navigate back & forward within the standalone window.
    await user.click(screen.getByRole("button", { name: "이전 문서" }));
    expect(
      await screen.findByTitle("대시보드 PRD 사람용 보기"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "다음 문서" }));
    expect(
      await screen.findByTitle("대시보드 화면명세서 사람용 보기"),
    ).toBeVisible();

    // Switching to raw Markdown outside DocumentsProvider renders without crashing.
    await user.click(screen.getByRole("tab", { name: "원문 (.md)" }));
    expect(await screen.findByText("화면명세 본문")).toBeVisible();
  });

  it("passes explicit null workspaceId when omitted from standalone window search params", async () => {
    const gateway = new FakeDocumentsGateway();
    gateway.documentsByPath.set("docs/domains/dashboard/prd.md", {
      summary: {
        path: "docs/domains/dashboard/prd.md",
        fileName: "prd.md",
        title: "대시보드 PRD",
        documentId: "dash-prd",
        frontmatterStatus: { status: "valid" },
        modifiedAtUnixMs: 1,
        size: 120,
      },
      markdown: "# 대시보드 PRD\n\n본문",
      properties: {
        designs: [{ title: "알림 시안", image: "assets/mock.svg" }],
      },
      tableOfContents: [],
      lastCommit: null,
    });
    const readDocSpy = vi.spyOn(gateway, "readStandaloneDocument");
    const readAssetSpy = vi
      .spyOn(gateway, "readStandaloneDocumentAsset")
      .mockResolvedValue({
        kind: "svg",
        source: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      });

    render(
      <TestQueryProvider>
        <MemoryRouter
          initialEntries={[
            "/doc-window?doc=docs%2Fdomains%2Fdashboard%2Fprd.md&view=markdown",
          ]}
        >
          <Routes>
            <Route
              path="doc-window"
              element={
                <StandaloneDocumentWindowPage documentsGateway={gateway} />
              }
            />
          </Routes>
        </MemoryRouter>
      </TestQueryProvider>,
    );

    expect(await screen.findByText("본문")).toBeVisible();
    expect(readDocSpy).toHaveBeenCalledWith(null, "docs/domains/dashboard/prd.md");
    expect(await screen.findByAltText("알림 시안")).toBeVisible();
    expect(readAssetSpy).toHaveBeenCalledWith(
      gateway.sessionSnapshot.workspaceId,
      "docs/domains/dashboard/prd.md",
      "assets/mock.svg",
    );
  });
});
