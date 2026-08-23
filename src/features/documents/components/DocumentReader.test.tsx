import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { DocumentsPage } from "@/pages/DocumentsPage";

const documentsCss = readFileSync(
  resolve(process.cwd(), "src/features/documents/documents.css"),
  "utf8",
);

function declarationBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = documentsCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

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
  it("uses the approved semantic grouping and tokenized header visual contract", async () => {
    renderSelectedDocument();

    const title = await screen.findByRole("heading", {
      name: "읽을 수 있는 문서",
    });
    const heading = title.closest(".document-reader__heading");
    const meta = heading?.querySelector(".document-reader__meta");

    expect(heading).not.toBeNull();
    expect(meta).toHaveTextContent("확정본 · main");
    expect(meta).toHaveTextContent("마지막 수정 · Kim");
    expect(title.closest(".document-reader")).not.toBeNull();
    expect(title.closest(".documents-page")).not.toBeNull();
    expect(declarationBlock(".documents-page")).toContain(
      "padding-block-start: var(--page-block-start)",
    );

    expect(declarationBlock(".document-reader__header")).toContain(
      "gap: var(--documents-space-component)",
    );
    expect(declarationBlock(".document-reader__header")).toContain(
      "margin-bottom: var(--documents-space-section)",
    );
    expect(declarationBlock(".document-reader__heading")).toContain(
      "display: grid",
    );
    expect(declarationBlock(".document-reader__heading")).toContain(
      "gap: var(--space-2)",
    );
    expect(declarationBlock(".document-reader__heading h1")).toContain(
      "font-size: var(--font-h1-size)",
    );
    expect(declarationBlock(".document-reader__heading h1")).toContain(
      "font-weight: var(--font-weight-page-title)",
    );
    expect(declarationBlock(".document-reader__heading h1")).toContain(
      "line-height: var(--font-h1-line)",
    );
    expect(declarationBlock(".document-reader__meta")).toContain(
      "display: flex",
    );
    expect(declarationBlock(".document-reader__meta")).toContain(
      "flex-wrap: wrap",
    );
    expect(declarationBlock(".document-reader__meta")).toContain(
      "row-gap: var(--space-1)",
    );
    expect(declarationBlock(".document-reader__meta")).toContain(
      "column-gap: var(--space-2)",
    );
    expect(declarationBlock(".document-reader__meta p")).toContain(
      "font-size: var(--font-ui-size)",
    );
    expect(declarationBlock(".document-reader__meta p")).toContain(
      "font-weight: var(--font-weight-control)",
    );
    expect(declarationBlock(".document-reader__meta p")).toContain(
      "line-height: var(--font-ui-line)",
    );
    expect(declarationBlock(".document-reader__meta small")).toContain(
      "font-size: var(--font-meta-size)",
    );
    expect(declarationBlock(".document-reader__meta small")).toContain(
      "font-weight: var(--font-weight-body)",
    );
    expect(declarationBlock(".document-reader__meta small")).toContain(
      "line-height: var(--font-meta-line)",
    );
    expect(declarationBlock(".document-reader__meta small")).toContain(
      "color: var(--color-text-muted)",
    );
    expect(declarationBlock(".document-reader__actions")).toContain(
      "display: flex",
    );
    expect(declarationBlock(".document-reader__actions")).toContain(
      "gap: var(--space-2)",
    );
  });

  it("offers an Edit action for the current document", async () => {
    const gateway = renderSelectedDocument();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "편집" }));

    expect(await screen.findByRole("region", { name: "새 문서 편집" })).toBeVisible();
    expect(
      gateway.calls.filter((call) => call.method === "editExistingDocumentDraft"),
    ).toHaveLength(1);
  });

  it("keeps draft switching in the editor header so the title owns the page inset", async () => {
    renderSelectedDocument();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "편집" }));

    const editor = await screen.findByRole("region", { name: "새 문서 편집" });
    const title = within(editor).getByRole("textbox", { name: "문서 제목" });
    const header = title.closest(".document-draft-editor__header");
    const switcher = screen.getByRole("combobox", { name: "문서 작업 전환" });

    expect(header).not.toBeNull();
    expect(header).toContainElement(switcher);
    expect(
      title.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(editor).getByText("로컬 저장됨")).toBeVisible();
    expect(within(editor).getByRole("button", { name: "편집기 닫기" })).toBeVisible();
  });

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
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.click(screen.getByRole("menuitem", { name: "Git 파일 경로 복사" }));
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.click(screen.getByRole("menuitem", { name: "GitHub에서 보기" }));

    expect(gateway.copiedValues).toEqual([
      "[읽을 수 있는 문서](docs/invalid.md)",
      "docs/invalid.md",
    ]);
    expect(gateway.openedUrls).toEqual([
      "https://github.com/okf/example-knowledge/blob/main/docs%2Finvalid.md",
    ]);
  });

  it("closes the action menu and returns focus after an action is selected", async () => {
    renderSelectedDocument();
    const user = userEvent.setup();

    const trigger = await screen.findByRole("button", { name: "더보기" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "문서 링크 복사" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
