import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DocumentsProvider } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";

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

class DelayedPreferencesRepository implements PreferencesRepository {
  readonly writes: DisplayDensity[] = [];
  private resolveInitial!: (value: DisplayDensity) => void;
  private readonly initialValue = new Promise<DisplayDensity>((resolve) => {
    this.resolveInitial = resolve;
  });

  getDisplayDensity(): Promise<DisplayDensity> {
    return this.initialValue;
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.writes.push(value);
  }

  resolve(value: DisplayDensity) {
    this.resolveInitial(value);
  }
}

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
    <PreferencesProvider repository={new FakePreferencesRepository()}>
      <MemoryRouter>
        <DocumentsProvider gateway={gateway}>
          <DocumentsPage />
        </DocumentsProvider>
      </MemoryRouter>
    </PreferencesProvider>,
  );
  return gateway;
}

describe("DocumentReader", () => {
  it("keeps the reader header as the only H1 when the source title matches", async () => {
    const document = invalidFrontmatterDocument();
    document.summary.title = "본문";
    document.markdown = "# 본문\n\n## 세부 내용\n\n읽기 본문";

    renderSelectedDocument(document);

    const [title] = await screen.findAllByRole("heading", { level: 1, name: "본문" });
    const overviewLink = screen.getByRole("link", { name: "본문" });

    expect(title).toHaveAttribute("id", "body");
    expect(overviewLink).toHaveAttribute("href", "#body");
    expect(globalThis.document.getElementById("body")).toBe(title);
    expect(title.closest(".document-reader")).toHaveAttribute("aria-labelledby", "body");
    expect(screen.getByRole("heading", { level: 2, name: "세부 내용" })).toBeVisible();
  });

  it("keeps the reader title fallback ID when the first source heading does not match", async () => {
    renderSelectedDocument();

    const title = await screen.findByRole("heading", { level: 1, name: "읽을 수 있는 문서" });

    expect(title).toHaveAttribute("id", "document-reader-title");
    expect(title.closest(".document-reader")).toHaveAttribute(
      "aria-labelledby",
      "document-reader-title",
    );
  });

  it("keeps quoted and later title headings aligned with depth-first TOC targets", async () => {
    const document = invalidFrontmatterDocument();
    document.summary.title = "Guide";
    document.markdown = "> # Quoted heading\n\n# Guide\n\n## Next";
    document.tableOfContents = [
      { level: 1, title: "Quoted heading", id: "quoted-heading" },
      { level: 1, title: "Guide", id: "guide" },
      { level: 2, title: "Next", id: "next" },
    ];
    renderSelectedDocument(document);

    const quoted = await screen.findByRole("heading", { name: "Quoted heading" });
    expect(quoted.closest("blockquote")).not.toBeNull();
    expect(quoted).toHaveAttribute("id", "quoted-heading");
    const article = quoted.closest("article")!;
    expect(within(article).getByRole("heading", { level: 1, name: "Guide" })).toHaveAttribute("id", "guide");
    expect(within(article).getByRole("heading", { name: "Next" })).toHaveAttribute("id", "next");
    for (const [title, id] of [["Quoted heading", "quoted-heading"], ["Guide", "guide"], ["Next", "next"]]) {
      expect(screen.getByRole("link", { name: title })).toHaveAttribute("href", `#${id}`);
      expect(globalThis.document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    expect(globalThis.document.getElementById("document-reader-title")).toHaveTextContent("Guide");
  });

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

  it("changes the shared display density from the document overflow menu", async () => {
    const repository = new FakePreferencesRepository("default");
    const gateway = new FakeDocumentsGateway();
    const document = invalidFrontmatterDocument();
    gateway.sessionSnapshot.lastOpenedPath = document.summary.path;
    gateway.sessionSnapshot.catalog = {
      documents: [document.summary],
      roots: [{ kind: "document", summary: document.summary }],
    };
    vi.spyOn(gateway, "readDocument").mockResolvedValue(document);
    render(
      <PreferencesProvider repository={repository}>
        <MemoryRouter>
          <DocumentsProvider gateway={gateway}>
            <DocumentsPage />
          </DocumentsProvider>
        </MemoryRouter>
      </PreferencesProvider>,
    );
    const user = userEvent.setup();

    await screen.findByRole("heading", { name: "읽을 수 있는 문서" });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.hover(screen.getByRole("menuitem", { name: "보기 밀도" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "작게" }));

    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
    expect(globalThis.document.documentElement).toHaveAttribute("data-density", "compact");
  });

  it("waits for the initial shared density before allowing document-menu changes", async () => {
    const repository = new DelayedPreferencesRepository();
    const gateway = new FakeDocumentsGateway();
    const document = invalidFrontmatterDocument();
    gateway.sessionSnapshot.lastOpenedPath = document.summary.path;
    gateway.sessionSnapshot.catalog = {
      documents: [document.summary],
      roots: [{ kind: "document", summary: document.summary }],
    };
    vi.spyOn(gateway, "readDocument").mockResolvedValue(document);
    render(
      <PreferencesProvider repository={repository}>
        <MemoryRouter>
          <DocumentsProvider gateway={gateway}>
            <DocumentsPage />
          </DocumentsProvider>
        </MemoryRouter>
      </PreferencesProvider>,
    );
    const user = userEvent.setup();

    await screen.findByRole("heading", { name: "읽을 수 있는 문서" });
    await user.click(screen.getByRole("button", { name: "더보기" }));
    await user.hover(screen.getByRole("menuitem", { name: "보기 밀도" }));
    const compact = await screen.findByRole("menuitemradio", { name: "작게" });
    expect(compact).toHaveAttribute("data-disabled", "");
    fireEvent.click(compact);
    expect(repository.writes).toEqual([]);

    repository.resolve("compact");

    await waitFor(() =>
      expect(screen.getByRole("menuitemradio", { name: "작게" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.getByRole("menuitemradio", { name: "작게" })).not.toHaveAttribute(
      "data-disabled",
    );
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

  it("does not expose a connections tab until the document has connected items", async () => {
    renderSelectedDocument();

    await screen.findByRole("heading", { name: "읽을 수 있는 문서" });

    expect(screen.queryByRole("tab", { name: "연결" })).not.toBeInTheDocument();
    expect(screen.queryByText("관련 항목 파싱이 준비되면 여기에 표시됩니다.")).not.toBeInTheDocument();
  });

  it("uses the shared Documents page inset and a white reader surface", () => {
    expect(declarationBlock(".documents-page")).toContain(
      "padding-inline: var(--page-padding-inline)",
    );
    expect(declarationBlock(".document-reader")).toContain(
      "background: var(--color-surface)",
    );
    expect(declarationBlock(".document-reader__layout")).toContain("gap: 0");
    expect(declarationBlock(".document-reader__canvas")).toContain(
      "background: var(--color-surface)",
    );
    const context = declarationBlock(".document-reader__context");
    expect(context).toContain("border-left: 1px solid var(--color-border)");
    expect(context).toContain("background: var(--color-surface)");
    expect(context).toContain("padding: var(--space-5)");
  });

  it("fills the selected-document page surface without exposing the canvas behind its inset", async () => {
    renderSelectedDocument();

    const reader = await screen.findByRole("region", { name: "읽을 수 있는 문서" });
    const page = reader.closest(".documents-page");

    expect(page).toHaveClass("documents-page--reader");
    expect(declarationBlock(".documents-page--reader")).toContain(
      "background: var(--color-surface)",
    );
    expect(declarationBlock(".documents-page--reader")).toContain(
      "min-height: 100%",
    );
  });
});
