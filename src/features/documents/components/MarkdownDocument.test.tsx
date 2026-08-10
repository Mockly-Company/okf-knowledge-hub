import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentsProvider,
  useDocuments,
} from "@/features/documents/DocumentsProvider";
import type { DocumentContent } from "@/features/documents/model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { MarkdownDocument } from "./MarkdownDocument";

afterEach(cleanup);

function content(markdown: string): DocumentContent {
  return {
    summary: {
      path: "docs/guides/guide.md",
      fileName: "guide.md",
      title: "Guide",
      documentId: "guide-id",
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

function renderMarkdown(markdown: string) {
  const gateway = new FakeDocumentsGateway();
  const view = render(
    <DocumentsProvider gateway={gateway} createId={() => "session-id"}>
      <MarkdownDocument document={content(markdown)} />
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
  it("renders raw HTML as text and never creates executable elements", () => {
    const { container } = renderMarkdown(
      '<img src=x onerror="alert(1)"><script>alert(2)</script>',
    );

    expect(screen.getByText(/<img src=x/)).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[src='x']")).toBeNull();
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
        args: ["session-id", "docs/api.md"],
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
