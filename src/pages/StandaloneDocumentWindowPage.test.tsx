import { act, cleanup, render, screen } from "@testing-library/react";
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
    const user = userEvent.setup();
    vi.spyOn(gateway, "openExternal").mockRejectedValueOnce(new Error("forbidden"));
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
        designs: [
          {
            title: "알림 시안",
            image: "assets/mock.svg",
            url: "https://www.figma.com/file/123",
          },
        ],
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
    // M11: assets are never read against an unresolved (null) workspace first.
    expect(readAssetSpy).toHaveBeenCalledTimes(1);
    expect(readAssetSpy).not.toHaveBeenCalledWith(
      null,
      expect.anything(),
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: "디자인 열기" }));
    expect(
      await screen.findByText("외부 링크를 열 수 없습니다: https://www.figma.com/file/123"),
    ).toBeVisible();
  });

  it("does not refetch design assets when the page re-renders (M9)", async () => {
    const gateway = new FakeDocumentsGateway();
    const user = userEvent.setup();
    vi.spyOn(gateway, "openExternal").mockRejectedValue(new Error("forbidden"));
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
        designs: [
          {
            title: "알림 시안",
            image: "assets/mock.svg",
            url: "https://www.figma.com/file/123",
          },
        ],
      },
      tableOfContents: [],
      lastCommit: null,
    });
    const readAssetSpy = vi
      .spyOn(gateway, "readStandaloneDocumentAsset")
      .mockResolvedValue({
        kind: "svg",
        source: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      });

    renderWindow(
      gateway,
      "/doc-window?workspaceId=ws-1&doc=docs%2Fdomains%2Fdashboard%2Fprd.md&view=markdown",
    );

    expect(await screen.findByAltText("알림 시안")).toBeVisible();
    const callsAfterLoad = readAssetSpy.mock.calls.length;

    // Showing the external-link error re-renders the whole page.
    await user.click(screen.getByRole("button", { name: "디자인 열기" }));
    expect(
      await screen.findByText("외부 링크를 열 수 없습니다: https://www.figma.com/file/123"),
    ).toBeVisible();
    expect(readAssetSpy).toHaveBeenCalledTimes(callsAfterLoad);
  });

  it("switches view or document when an existing window is reused (S19)", async () => {
    const gateway = new FakeDocumentsGateway();
    for (const [name, title] of [
      ["prd", "대시보드 PRD"],
      ["screen-spec", "대시보드 화면명세서"],
    ] as const) {
      gateway.documentsByPath.set(`docs/domains/dashboard/${name}.md`, {
        summary: {
          path: `docs/domains/dashboard/${name}.md`,
          fileName: `${name}.md`,
          title,
          documentId: name,
          frontmatterStatus: { status: "valid" },
          modifiedAtUnixMs: 1,
          size: 120,
        },
        markdown: `# ${title}\n\n${title} 원문`,
        properties: {},
        tableOfContents: [],
        lastCommit: null,
        companionHtml: {
          path: `docs/domains/dashboard/${name}.html`,
          html: `<html><body><h1>${title} HTML</h1></body></html>`,
          modifiedAtUnixMs: 2,
        },
      });
    }

    renderWindow(
      gateway,
      "/doc-window?workspaceId=ws-1&doc=docs%2Fdomains%2Fdashboard%2Fprd.md&view=html",
    );
    expect(await screen.findByTitle("대시보드 PRD 사람용 보기")).toBeVisible();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("okhub:doc-window-navigate", {
          detail: { path: "docs/domains/dashboard/prd.md", view: "markdown" },
        }),
      );
    });
    expect(await screen.findByText("대시보드 PRD 원문")).toBeVisible();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("okhub:doc-window-navigate", {
          detail: { path: "docs/domains/dashboard/screen-spec.md", view: "html" },
        }),
      );
    });
    expect(
      await screen.findByTitle("대시보드 화면명세서 사람용 보기"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "이전 문서" })).toBeEnabled();

    // S26: re-rendering the page (view override on the same document) must not re-subscribe
    // the companion frame's message listener.
    const addListenerSpy = vi.spyOn(window, "addEventListener");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("okhub:doc-window-navigate", {
          detail: { path: "docs/domains/dashboard/screen-spec.md", view: "html" },
        }),
      );
    });
    expect(
      addListenerSpy.mock.calls.filter(([type]) => type === "message"),
    ).toHaveLength(0);
    addListenerSpy.mockRestore();

    // Malformed payloads are ignored.
    act(() => {
      window.dispatchEvent(
        new CustomEvent("okhub:doc-window-navigate", { detail: { path: 42 } }),
      );
    });
    expect(screen.getByTitle("대시보드 화면명세서 사람용 보기")).toBeVisible();
  });
});

function renderWindow(gateway: FakeDocumentsGateway, initialEntry: string) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="doc-window"
            element={<StandaloneDocumentWindowPage documentsGateway={gateway} />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

