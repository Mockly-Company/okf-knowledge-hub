import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentsPage } from "@/pages/DocumentsPage";

afterEach(cleanup);

function invalidFrontmatterDocument(): DocumentContent {
  return {
    summary: {
      path: "docs/invalid.md",
      fileName: "invalid.md",
      title: "읽을 수 있는 문서",
      documentId: null,
      frontmatterStatus: {
        status: "invalid",
        error: { line: 3, message: "unexpected token" },
      },
      modifiedAtUnixMs: 1_721_000_000_000,
      size: 120,
    },
    markdown: "# 본문\n\n문서 내용",
    properties: { owner: "platform", draft: false },
    tableOfContents: [{ level: 1, title: "본문", id: "body" }],
    lastCommit: {
      commitOid: "aabbccddeeff",
      shortOid: "aabbccd",
      authorName: "Kim",
      authoredAtUnix: 1_721_000_000,
      message: "문서를 갱신했습니다",
    },
  };
}

function renderSelectedDocument(document = invalidFrontmatterDocument()) {
  const gateway = new FakeDocumentsGateway();
  gateway.sessionSnapshot.lastOpenedPath = document.summary.path;
  gateway.sessionSnapshot.catalog = {
    documents: [document.summary],
    roots: [{ kind: "document", summary: document.summary }],
  };
  vi.spyOn(gateway, "readDocument").mockResolvedValue(document);
  render(
    <MemoryRouter>
      <DocumentsProvider gateway={gateway}>
        <DocumentsPage />
      </DocumentsProvider>
    </MemoryRouter>,
  );
  return gateway;
}

describe("DocumentReader", () => {
  it("shows properties before the table of contents and keeps invalid documents readable", async () => {
    renderSelectedDocument();

    const properties = await screen.findByRole("region", { name: "문서 속성" });
    const toc = screen.getByRole("navigation", { name: "목차" });
    expect(
      properties.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/frontmatter를 읽을 수 없습니다/)).toBeVisible();
    expect(screen.getByText("본문은 계속 표시됩니다")).toBeVisible();
  });

  it("copies repository-relative actions exactly and opens the GitHub blob through the gateway", async () => {
    const gateway = renderSelectedDocument();
    const user = userEvent.setup();

    await screen.findByRole("heading", { name: "읽을 수 있는 문서" });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.click(screen.getByRole("menuitem", { name: "문서 링크 복사" }));
    await user.click(screen.getByRole("menuitem", { name: "Git 파일 경로 복사" }));
    await user.click(screen.getByRole("menuitem", { name: "GitHub에서 보기" }));

    expect(gateway.copiedValues).toEqual([
      "[읽을 수 있는 문서](docs/invalid.md)",
      "docs/invalid.md",
    ]);
    expect(gateway.openedUrls).toEqual([
      "https://github.com/okf/example-knowledge/blob/main/docs%2Finvalid.md",
    ]);
  });

  it("keeps the context panel visible by default and lets the reader collapse and restore it", async () => {
    renderSelectedDocument();
    const user = userEvent.setup();

    expect(await screen.findByRole("complementary", { name: "문서 문맥" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "문서 문맥 접기" }));
    expect(screen.getByRole("button", { name: "문서 문맥 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("complementary", { name: "문서 문맥" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "문서 문맥 펼치기" }));
    expect(await screen.findByRole("complementary", { name: "문서 문맥" })).toBeVisible();
  });
});
