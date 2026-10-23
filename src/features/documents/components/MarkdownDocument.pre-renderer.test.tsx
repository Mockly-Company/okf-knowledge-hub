import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentsProvider,
} from "@/features/documents/DocumentsProvider";
import type { DocumentContent } from "@/features/documents/model";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";

const fixture = vi.hoisted(() => ({ language: "typescript", hasCode: true }));

vi.mock("react-markdown", () => ({
  default: ({ components }: { components: { pre?: (props: Record<string, unknown>) => ReactNode } }) => components.pre?.({
    id: "user-content-preserved-pre-id",
    node: {
      children: fixture.hasCode ? [{
        tagName: "code",
        properties: { className: [`language-${fixture.language}`] },
        children: [{ type: "text", value: "const value = true;" }],
      }] : [],
    },
    children: "fallback source",
  }) ?? null,
}));

vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source }: { source: string }) => <div data-mermaid-source={source} />,
  sanitizeSvg: (source: string) => source,
}));

import { MarkdownDocument } from "./MarkdownDocument";

afterEach(cleanup);

const document: DocumentContent = {
  summary: {
    path: "docs/guide.md",
    fileName: "guide.md",
    title: "Guide",
    documentId: "guide-id",
    frontmatterStatus: { status: "valid" },
    modifiedAtUnixMs: 0,
    size: 0,
  },
  markdown: "```text\nvalue\n```",
  properties: {},
  tableOfContents: [],
  lastCommit: null,
};

function renderDocument(language: string, hasCode = true) {
  fixture.language = language;
  fixture.hasCode = hasCode;
  return render(
    <DocumentsProvider gateway={new FakeDocumentsGateway()} createId={() => "session-id"}>
      <MarkdownDocument document={document} />
    </DocumentsProvider>,
  );
}

describe("MarkdownDocument pre renderer", () => {
  it("preserves the sanitized ID and content of an unrecognized pre fallback", () => {
    const { container } = renderDocument("text", false);
    expect(container.querySelector("pre")).toHaveAttribute("id", "user-content-preserved-pre-id");
    expect(container.querySelector("pre")).toHaveTextContent("fallback source");
    expect(container.querySelector("pre")).not.toHaveAttribute("node");
  });

  it("preserves a sanitized pre ID when replacing a generic fenced code block", () => {
    const { container } = renderDocument("typescript");

    expect(container.querySelector(".markdown-code-block")).toHaveAttribute(
      "id",
      "user-content-preserved-pre-id",
    );
  });

  it("preserves a sanitized pre ID when routing Mermaid before generic code", () => {
    const { container } = renderDocument("mermaid");

    expect(container.querySelector("[data-mermaid-source]")?.parentElement).toHaveAttribute(
      "id",
      "user-content-preserved-pre-id",
    );
  });
});
