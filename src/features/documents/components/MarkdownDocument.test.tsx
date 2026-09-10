import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentsProvider,
  useDocuments,
} from "@/features/documents/DocumentsProvider";
import type { DocumentContent } from "@/features/documents/model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import {
  MarkdownDocument,
  type MarkdownDocumentProps,
} from "./MarkdownDocument";

vi.mock("mermaid", () => ({ default: {
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>stable diagram</text></svg>' }),
} }));

afterEach(cleanup);

function content(markdown: string, documentId: string | null = "guide-id"): DocumentContent {
  return {
    summary: {
      path: "docs/guides/guide.md",
      fileName: "guide.md",
      title: "Guide",
      documentId,
      frontmatterStatus: { status: "valid" },
      modifiedAtUnixMs: 0,
      size: markdown.length,
    },
    markdown,
    properties: {},
    tableOfContents: [
      { level: 1, title: "Guide", id: "guide" },
      { level: 2, title: "Examples", id: "examples-2" },
    ],
    lastCommit: null,
  };
}

function renderMarkdown(
  markdown: string,
  props: Pick<MarkdownDocumentProps, "suppressSourceTitle"> = {},
) {
  const gateway = new FakeDocumentsGateway();
  const view = render(
    <DocumentsProvider gateway={gateway} createId={() => "session-id"}>
      <MarkdownDocument document={content(markdown)} {...props} />
    </DocumentsProvider>,
  );
  return { gateway, ...view };
}

function ReadyMarkdown({ markdown }: { markdown: string }) {
  const { state } = useDocuments();
  return state.status === "ready" ? <MarkdownDocument document={content(markdown)} /> : null;
}

function renderReadyMarkdown(markdown: string) {
  const gateway = new FakeDocumentsGateway();
  const view = render(
    <DocumentsProvider gateway={gateway} createId={() => "session-id"}>
      <ReadyMarkdown markdown={markdown} />
    </DocumentsProvider>,
  );
  return { gateway, ...view };
}

function SearchMatchedMarkdown({
  markdown,
  matchText,
}: {
  markdown: string;
  matchText: string;
}) {
  const { state, selectDocument } = useDocuments();
  useEffect(() => {
    if (state.status !== "ready") return;
    selectDocument("docs/guides/guide.md", {
      matchField: "body",
      matchText,
    });
  }, [matchText, selectDocument, state.status]);
  return <MarkdownDocument document={content(markdown)} />;
}

function renderSearchMatchedMarkdown(markdown: string, matchText: string) {
  const gateway = new FakeDocumentsGateway();
  const view = render(
    <DocumentsProvider gateway={gateway} createId={() => "session-id"}>
      <SearchMatchedMarkdown markdown={markdown} matchText={matchText} />
    </DocumentsProvider>,
  );
  return { gateway, ...view };
}

describe("MarkdownDocument", () => {
  it("keeps both GFM footnote directions linked to existing sanitized IDs", () => {
    const { container } = renderMarkdown("Reference[^distance]\n\n[^distance]: Distance in meters");
    const reference = container.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    const back = container.querySelector<HTMLAnchorElement>("a[data-footnote-backref]")!;
    expect(container.querySelector(`[id="${reference.hash.slice(1)}"]`)).toHaveTextContent("Distance in meters");
    expect(container.querySelector(`[id="${back.hash.slice(1)}"]`)).toBe(reference);
    expect(reference.id).toMatch(/^user-content-/);
  });

  it("keeps captioned figures outside paragraphs and plain inline images inside paragraphs", async () => {
    const { container } = renderReadyMarkdown('![Map](./map.svg "Map caption")\n\nBefore ![Inline](./inline.svg) after');
    await screen.findByRole("img", { name: "Map" });
    expect(container.querySelector("figure figcaption")).toHaveTextContent("Map caption");
    expect(container.querySelector("p figure")).toBeNull();
    expect(screen.getByRole("img", { name: "Inline" }).closest("p")).toHaveTextContent("Before after");
  });

  it("names read-only task checkboxes from their own item text without including nested tasks", async () => {
    renderMarkdown("- [x] **응답** 계약 확인\n  - [ ] 하위 항목 확인\n- [ ] 오류 코드 확인");

    const completed = screen.getByRole("checkbox", { name: "응답 계약 확인" });
    expect(completed).toBeChecked();
    expect(completed).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "하위 항목 확인" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "오류 코드 확인" })).toBeDisabled();
  });

  it("keeps Mermaid DOM ids equal to deterministic block ids across rerenders", async () => {
    const markdown = "```mermaid\nflowchart LR\nA --> B\n```";
    const gateway = new FakeDocumentsGateway();
    const tree = () => <DocumentsProvider gateway={gateway} createId={() => "session-id"}>
      <ReadyMarkdown markdown={markdown} />
    </DocumentsProvider>;
    const view = render(tree());
    const block = (await screen.findByText("stable diagram")).closest("[data-okhub-block-id]")!;
    const id = block.getAttribute("data-okhub-block-id");
    expect(id).toMatch(/^okhub-mermaid-/);
    expect(block).toHaveAttribute("id", id);
    view.rerender(tree());
    await waitFor(() => {
      const next = screen.getByText("stable diagram").closest("[data-okhub-block-id]");
      expect(next).toHaveAttribute("data-okhub-block-id", id);
      expect(next).toHaveAttribute("id", id);
    });
  });

  it("suppresses only the first source H1 that matches the document title", () => {
    render(
      <DocumentsProvider gateway={new FakeDocumentsGateway()} createId={() => "session-id"}>
        <MarkdownDocument
          document={content("# Guide\n\n## 요청\n\n본문")}
          hideHeader
          suppressSourceTitle
        />
      </DocumentsProvider>,
    );

    expect(screen.queryByRole("heading", { level: 1, name: "Guide" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "요청" })).toBeVisible();
  });

  it("keeps a non-matching or later source H1 when title suppression is enabled", () => {
    render(
      <DocumentsProvider gateway={new FakeDocumentsGateway()} createId={() => "session-id"}>
        <MarkdownDocument
          document={content("# Overview\n\n# Guide\n\n본문")}
          hideHeader
          suppressSourceTitle
        />
      </DocumentsProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
  });

  it("renders raw HTML as text and never creates executable elements", () => {
    const { container } = renderMarkdown(
      '<img src=x onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(screen.getByText(/<img src=x/)).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("marks GitHub alerts and removes the marker paragraph", () => {
    const { container } = renderMarkdown("> [!WARNING]\n> 배포 전에 확인합니다.");

    expect(
      container.querySelector(".markdown-alert--warning"),
    ).toBeVisible();
    expect(screen.getByText("WARNING")).toBeVisible();
    expect(container.querySelector(".markdown-alert svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.queryByText("[!WARNING]")).toBeNull();
  });

  it.each([
    ["**bold body**", "strong", "bold body"],
    ["[linked body](https://example.com)", "a", "linked body"],
    ["`inline body`", "code", "inline body"],
  ])("preserves an alert body beginning with %s after consuming its marker", (body, selector, text) => {
    const { container } = renderMarkdown(`> [!NOTE]\n> ${body}`);
    const alert = container.querySelector(".markdown-alert--note")!;

    expect(alert.querySelector(selector)).toHaveTextContent(text);
    expect(alert.textContent).not.toContain("[!NOTE]");
  });

  it("creates deterministic DOM IDs for reviewable blocks", () => {
    const markdown = "```ts\nconst ready = true\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    const first = renderMarkdown(markdown);
    const firstIds = [...first.container.querySelectorAll("[data-okhub-block-id]")]
      .map((node) => ({ id: node.id, blockId: node.getAttribute("data-okhub-block-id") }));
    first.unmount();
    const second = renderMarkdown(markdown);
    const secondIds = [...second.container.querySelectorAll("[data-okhub-block-id]")]
      .map((node) => ({ id: node.id, blockId: node.getAttribute("data-okhub-block-id") }));

    expect(firstIds).toEqual(secondIds);
    expect(firstIds).toHaveLength(2);
    expect(firstIds.every(({ id, blockId }) => id === blockId && id.startsWith("okhub-"))).toBe(true);
  });

  it("creates deterministic nonempty block IDs for documents without frontmatter IDs", () => {
    const markdown = "```ts\nconst legacy = true\n```";
    const first = render(
      <DocumentsProvider gateway={new FakeDocumentsGateway()} createId={() => "session-id"}>
        <MarkdownDocument document={content(markdown, null)} />
      </DocumentsProvider>,
    );
    const firstId = first.container.querySelector("[data-okhub-block-id]")?.id;
    first.unmount();
    const second = render(
      <DocumentsProvider gateway={new FakeDocumentsGateway()} createId={() => "session-id"}>
        <MarkdownDocument document={content(markdown, null)} />
      </DocumentsProvider>,
    );
    const secondId = second.container.querySelector("[data-okhub-block-id]")?.id;

    expect(firstId).toBe(secondId);
    expect(firstId).toMatch(/^okhub-code-/);
  });

  it("renders allowed details collapsed, toggles natively, and keeps every other raw tag literal", async () => {
    const { container } = renderMarkdown(
      "<details><summary>예시</summary>내용</details>\n<div onclick='bad()'>위험</div>",
    );
    const user = userEvent.setup();
    const summary = screen.getByText("예시");
    const details = summary.closest("details");

    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("node");
    expect(summary.closest("summary")).toHaveClass("markdown-document__details-summary");
    expect(summary.closest("summary")).not.toHaveAttribute("node");
    expect(summary.closest("summary")?.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(details).not.toHaveAttribute("open");
    expect(details?.open).toBe(false);
    summary.closest("summary")?.focus();
    expect(summary.closest("summary")).toHaveFocus();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(details?.open).toBe(true);
    expect(screen.getByText(/<div onclick/)).toBeVisible();
    expect(container.querySelector("div[onclick]")).toBeNull();
  });

  it("rejects javascript links and routes relative markdown links internally", async () => {
    const { gateway } = renderMarkdown(
      "[bad](javascript:alert(1)) [API](../api.md)",
    );
    const user = userEvent.setup();

    expect(screen.getByRole("link", { name: "bad" })).not.toHaveAttribute(
      "href",
      expect.stringContaining("javascript:"),
    );
    await user.click(screen.getByRole("link", { name: "API" }));

    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "readDocument",
        args: ["session-id", "session-id", "docs/api.md"],
      }),
    );
  });

  it("rejects relative links that escape the repository root", () => {
    renderMarkdown("[escape](../../../outside.md)");

    expect(screen.getByRole("link", { name: "escape" })).toHaveAttribute(
      "href",
      "#",
    );
  });

  it("uses the Rust TOC ids and renders GFM tables", () => {
    const { container } = renderMarkdown("# Guide\n\n## Examples\n\n| name | value |\n| --- | --- |\n| A | B |");

    expect(container.querySelector("h1#guide")).toHaveTextContent("Guide");
    expect(screen.getByRole("heading", { name: "Examples" })).toHaveAttribute(
      "id",
      "examples-2",
    );
    expect(screen.getByRole("table")).toHaveTextContent("name");
  });

  it("hides OKF frontmatter before matching the Rust heading IDs", () => {
    const { container } = renderMarkdown(
      "---\ntitle: Internal guide\n---\n# Guide\n\n## Examples",
    );

    expect(screen.queryByText("title: Internal guide")).toBeNull();
    expect(container.querySelector("h1#guide")).toHaveTextContent("Guide");
    expect(container.querySelector("h2#examples-2")).toHaveTextContent(
      "Examples",
    );
  });

  it("matches Rust frontmatter delimiters, including an exact ellipsis closer", () => {
    const { container } = renderMarkdown(
      "---\ntitle: Ellipsis metadata\n...\n# Guide\n\n## Examples",
    );

    expect(screen.queryByText("title: Ellipsis metadata")).toBeNull();
    expect(container.querySelector("h1#guide")).toHaveTextContent("Guide");
    expect(container.querySelector("h2#examples-2")).toHaveTextContent(
      "Examples",
    );
  });

  it.each([
    ["a BOM opener", "\uFEFF---\ntitle: BOM metadata\n---\n# Guide", "title: BOM metadata"],
    ["a spaced opener", "--- \ntitle: Spaced metadata\n---\n# Guide", "title: Spaced metadata"],
    ["a spaced closer", "---\ntitle: Spaced closer\n--- \n# Guide", "title: Spaced closer"],
  ])("keeps %s as Markdown because Rust does not recognize it", (_case, markdown, metadata) => {
    renderMarkdown(markdown);

    expect(screen.getByText(metadata)).toBeVisible();
  });

  it("passes a nested image's original document-relative path to the asset gateway", async () => {
    const { gateway } = renderReadyMarkdown(
      "![Architecture](images/architecture.svg)",
    );

    await waitFor(() =>
      expect(gateway.calls).toContainEqual({
        method: "readDocumentAsset",
        args: ["session-id", "docs/guides/guide.md", "images/architecture.svg"],
      }),
    );
  });

  it("uses a Markdown image title as a caption without replacing its alt text", async () => {
    renderReadyMarkdown(
      '![검색 흐름 순서도](images/flow.svg "그림 1. 검색 요청 흐름")',
    );

    expect(
      await screen.findByRole("img", { name: "검색 흐름 순서도" }),
    ).toBeVisible();
    expect(screen.getByText("그림 1. 검색 요청 흐름")).toBeVisible();
  });

  it("marks the first visible body match in code before a hidden GFM footnote heading", async () => {
    const { container } = renderSearchMatchedMarkdown(
      "`Footnotes`\n\nReference[^1]\n\n[^1]: Details",
      "Footnotes",
    );

    await waitFor(() =>
      expect(container.querySelector("mark[data-search-match]")).not.toBeNull(),
    );
    const match = container.querySelector("mark[data-search-match]");
    expect(match?.closest("code")).not.toBeNull();
  });

  it.each([
    ["typescript", "const"],
    ["typescript", "const value"],
    ["unknown-lang", "const value"],
  ])("preserves the first fenced %s search hit %s without marking later prose or changing copied source", async (language, query) => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const source = 'const value = "ok";';
    try {
      const { container, gateway } = renderSearchMatchedMarkdown(
        `\`\`\`${language}\n${source}\n\`\`\`\n\nLater ${query} in prose.`,
        query,
      );
      await waitFor(() => expect(container.querySelector("code mark[data-search-match]")).not.toBeNull());
      const target = container.querySelector("code mark[data-search-match]")!;
      expect([...container.querySelectorAll("code mark")].map((mark) => mark.textContent).join("")).toBe(query);
      expect(container.querySelectorAll("mark[data-search-match]")).toHaveLength(1);
      expect(container.querySelector("p mark")).toBeNull();
      expect(container.querySelector(".markdown-code-block__code")?.textContent).toBe(source);
      if (language === "typescript") expect(container.querySelector(".hljs-keyword")).toHaveTextContent("const");
      await waitFor(() => expect(scroll.mock.instances).toContain(target));
      await userEvent.click(screen.getByRole("button", { name: "코드 복사" }));
      expect(gateway.copiedValues).toEqual([source]);
    } finally {
      scroll.mockRestore();
    }
  });

  it("keeps sanitizer clobber protection for generated non-heading IDs", () => {
    const { container } = renderMarkdown("Reference[^1]\n\n[^1]: Details");

    expect(container.querySelector("#fn-1")).toBeNull();
    expect(container.querySelector('[id^="user-content-"]')).toBeVisible();
  });

  it("preserves the safe hidden class and ID on the final GFM footnote heading", () => {
    const { container } = renderMarkdown("Reference[^1]\n\n[^1]: Details");
    const heading = container.querySelector("section[data-footnotes] h2");

    expect(heading).toHaveClass("sr-only");
    expect(heading).toHaveAttribute("id", expect.stringMatching(/^user-content-/));
    expect(heading).not.toHaveAttribute("data-okhub-heading-id");
  });

  it("preserves the Rust anchor separately from sanitized heading IDs", () => {
    const { container } = renderMarkdown("# Guide");

    expect(container.querySelector("h1#guide")).toHaveAttribute(
      "data-okhub-heading-id",
      "guide",
    );
  });
});
