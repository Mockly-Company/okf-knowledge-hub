import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const documentsCss = readFileSync(
  resolve(process.cwd(), "src/features/documents/documents.css"),
  "utf8",
);
const documentTreeCss = readFileSync(
  resolve(process.cwd(), "src/features/documents/components/DocumentTree.css"),
  "utf8",
);
const tokensCss = readFileSync(
  resolve(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

function blocksFor(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1])
    .join("\n");
}

function declarationBlock(selector: string): string {
  return blocksFor(`${documentsCss}\n${documentTreeCss}`, selector);
}

describe("Documents visual contract", () => {
  it("uses canonical density-aware code metrics for inline, fenced, and failed-diagram source", () => {
    for (const [selector, size, line] of [[":root", "13px", "20px"], [':root[data-density="compact"]', "12px", "18px"]]) {
      expect(blocksFor(tokensCss, selector)).toContain(`--font-code-size: ${size}`);
      expect(blocksFor(tokensCss, selector)).toContain(`--font-code-line: ${line}`);
    }
    for (const selector of [".markdown-document :not(pre) > code", ".markdown-code-block__scroll pre", ".mermaid-block__source"]) {
      expect(declarationBlock(selector)).toContain("font-size: var(--font-code-size)");
      expect(declarationBlock(selector)).toContain("line-height: var(--font-code-line)");
    }
  });

  it("restores a trusted neutral and teal Mermaid theme after sanitization", () => {
    const nodes = declarationBlock(".mermaid-theme .node .label-container");
    expect(nodes).toContain("fill: var(--color-surface)");
    expect(nodes).toContain("stroke: var(--color-border-strong)");
    expect(nodes).toContain("stroke-width: 1px");
    const edges = declarationBlock(".mermaid-theme .flowchart-link");
    expect(edges).toContain("fill: none");
    expect(edges).toContain("stroke: var(--color-border-strong)");
    expect(edges).toContain("stroke-width: 1px");
    expect(declarationBlock(".mermaid-theme marker .arrowMarkerPath")).toContain("fill: var(--color-primary)");
    expect(declarationBlock(".mermaid-theme text")).toContain("fill: var(--color-text-default)");
    expect(documentsCss).not.toMatch(/\.mermaid-theme\s+\.actor\s*[,\{]/);
  });

  it("keeps document result cards bordered at rest and changes only their background on hover", () => {
    expect(declarationBlock(".document-search__result-row")).toContain(
      "border: 1px solid var(--color-border)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "background: var(--color-surface)",
    );
    expect(declarationBlock(".document-search__result-row:hover")).toContain(
      "background: var(--color-canvas)",
    );
    expect(declarationBlock(".document-search__result-row:hover")).not.toContain(
      "border-color",
    );
  });

  it("gives document result rows their own automatic multi-line geometry", () => {
    const row = declarationBlock(".document-search__result-row");
    const copy = declarationBlock(".document-search__result-copy");
    const title = declarationBlock(".document-search__result-copy strong");
    const path = declarationBlock(".document-search__result-copy small");
    const snippet = declarationBlock(".document-search__result-copy > span");

    expect(row).toContain("display: flex");
    expect(row).toContain("width: 100%");
    expect(row).toContain("min-height: var(--control-height)");
    expect(row).toContain("align-items: flex-start");
    expect(row).not.toMatch(/(?:^|\n)\s*height:/);
    expect(row).not.toContain("align-items: center");
    expect(copy).toContain("min-width: 0");
    expect(title).toContain("overflow-wrap: anywhere");
    expect(path).toContain("overflow-wrap: anywhere");
    expect(snippet).toContain("overflow-wrap: anywhere");
    expect(snippet).toContain("white-space: normal");
    expect(snippet).not.toContain("text-overflow");
  });
  it("uses page and search spacing tokens for the Documents home", () => {
    expect(declarationBlock(".documents-page")).toContain(
      "width: 100%",
    );
    expect(declarationBlock(".documents-page")).not.toContain(
      "width: min(100%, 1040px)",
    );
    expect(declarationBlock(".documents-page")).not.toContain(
      "margin: 0 auto",
    );
    expect(declarationBlock(".documents-page")).toContain(
      "padding-block-start: var(--page-block-start)",
    );
    expect(declarationBlock(".documents-page")).toContain(
      "padding-inline: var(--page-padding-inline)",
    );
    expect(declarationBlock(".documents-page")).toContain(
      "padding-inline: var(--space-5)",
    );
    expect(declarationBlock(".document-search__toolbar")).toContain(
      "gap: var(--space-2)",
    );
    expect(declarationBlock(".documents-page__tools")).toContain(
      "margin-top: var(--documents-space-group)",
    );
    expect(declarationBlock(".document-search__results")).toContain(
      "margin-top: var(--documents-space-group)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "border: 1px solid var(--color-border)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "border-radius: var(--radius-md)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "background: var(--color-surface)",
    );
    expect(
      declarationBlock(".document-search__result-row:hover"),
    ).toContain("background: var(--color-canvas)");
    expect(
      declarationBlock(".document-search__result-row:hover"),
    ).not.toContain("border-color");
  });

  it("keeps the search field and new-document action on one toolbar row", () => {
    const toolbar = declarationBlock(".document-search__toolbar");
    const newDocument = declarationBlock(".documents-page__new-document");

    expect(declarationBlock(".document-search")).toContain("width: 100%");
    expect(toolbar).toContain("flex-wrap: nowrap");
    expect(newDocument).toContain("flex: 0 0 auto");
    expect(newDocument).not.toContain("width: 100%");
  });

  it("leaves Documents-page notice tone, surface, and action treatment to StatusFeedback", () => {
    const notice = declarationBlock(".documents-page__notice");

    expect(notice).toContain("margin-top: var(--documents-space-group)");
    expect(notice).not.toContain("border:");
    expect(notice).not.toContain("border-radius:");
    expect(notice).not.toContain("background:");
    expect(notice).not.toContain("padding:");
  });

  it("gives Markdown table headers a calm surface without zebra striping rows", () => {
    expect(declarationBlock(".markdown-table-scroll thead")).toContain(
      "background: var(--color-canvas)",
    );
    expect(documentsCss).not.toMatch(
      /\.markdown-table-scroll[^{}]*tbody[^{}]*nth-child|\.markdown-table-scroll[^{}]*nth-child[^{}]*tbody/,
    );
  });

  it("lets the search wrapper own one thin focus indicator", () => {
    expect(declarationBlock(".document-search__field:focus-within")).toContain(
      "border-color: var(--color-primary)",
    );
    expect(declarationBlock(".document-search__field:focus-within")).toContain(
      "outline: var(--focus-ring-width) solid var(--color-primary)",
    );
    expect(
      declarationBlock(".document-search__field input:focus-visible"),
    ).toContain("box-shadow: none");
    expect(
      declarationBlock(".document-search__field input:focus-visible"),
    ).toContain("outline: 0");
  });

  it("uses shared motion tokens for Documents home interactions", () => {
    for (const selector of [
      ".document-search__field",
      ".document-search__result-row",
      ".document-tree__item",
      ".document-tree__header button",
      ".document-tree__folder-create",
      ".document-tree__chevron",
    ]) {
      const declarations = declarationBlock(selector);
      expect(declarations).toContain("var(--motion-control-duration)");
      expect(declarations).toContain("var(--motion-control-easing)");
    }
  });

  it("changes the search focus ring to the error color for invalid input", () => {
    const invalidFocus = declarationBlock(
      '.document-search__field:has(input[aria-invalid="true"]):focus-within',
    );

    expect(invalidFocus).toContain("border-color: var(--color-error)");
    expect(invalidFocus).toContain(
      "outline-color: var(--color-error)",
    );
    expect(invalidFocus).not.toContain("var(--color-primary)");
  });

  it("defines compact relationship spacing without changing the base scale", () => {
    expect(declarationBlock(":root")).toContain(
      "--documents-space-component: var(--space-4)",
    );
    expect(declarationBlock(":root")).toContain(
      "--documents-space-group: var(--space-6)",
    );
    expect(declarationBlock(":root")).toContain(
      "--documents-space-section: var(--space-8)",
    );
    expect(declarationBlock(":root")).toContain(
      "--documents-space-internal: var(--space-3)",
    );
    expect(declarationBlock(":root")).toContain(
      "--documents-space-repeated: var(--space-3)",
    );
    expect(declarationBlock(":root")).toContain(
      "--documents-heading-flow: var(--space-8)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-space-component: var(--space-3)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-space-group: var(--space-5)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-space-section: var(--space-6)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-space-internal: var(--space-2)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-space-repeated: var(--space-2)",
    );
    expect(declarationBlock(':root[data-density="compact"]')).toContain(
      "--documents-heading-flow: var(--space-6)",
    );
    expect(declarationBlock(".new-document-dialog__fields")).toContain(
      "gap: var(--documents-space-component)",
    );
    expect(declarationBlock(".document-reader__layout")).toContain(
      "gap: 0",
    );
  });

  it("applies density-aware repeated and internal spacing to document rows", () => {
    expect(declarationBlock(".document-search__results ul")).toContain(
      "gap: var(--documents-space-repeated)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "gap: var(--documents-space-internal)",
    );
    expect(declarationBlock(".document-search__result-row")).toContain(
      "padding: var(--documents-space-internal)",
    );
    expect(declarationBlock(".document-history ol")).toContain(
      "gap: var(--documents-space-repeated)",
    );
    expect(declarationBlock(".document-history li button")).toContain(
      "padding: var(--documents-space-internal)",
    );
    expect(declarationBlock(".new-document-dialog__template-grid")).toContain(
      "gap: var(--documents-space-repeated)",
    );
    expect(
      declarationBlock(".new-document-dialog__template-grid button"),
    ).toContain("padding: var(--documents-space-internal)");
  });

  it("uses approved control and metadata typography in the document tree", () => {
    expect(declarationBlock(".document-tree")).toContain(
      "gap: var(--space-1)",
    );
    expect(declarationBlock(".document-tree__header")).toContain(
      "font-weight: var(--font-weight-body)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "height: var(--control-height)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "gap: var(--space-2)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "font-weight: var(--font-weight-body)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "border: 0",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "border-radius: var(--radius-sm)",
    );
    expect(declarationBlock(".document-tree__item:hover")).not.toContain(
      "border-color",
    );
    expect(declarationBlock(".document-tree__item--selected")).not.toContain(
      "border-color",
    );
    expect(declarationBlock(".document-tree__header button")).toContain(
      "border-radius: var(--radius-sm)",
    );
    expect(declarationBlock(".document-tree__folder-create")).toContain(
      "border-radius: var(--radius-sm)",
    );
    expect(declarationBlock(".document-tree__empty")).toContain(
      "font-weight: var(--font-weight-body)",
    );
  });

  it("reserves create-action space on the actual folder row and clips its label", () => {
    const folderRow = declarationBlock(
      ".document-tree__row:has(.document-tree__folder-create)",
    );
    const label = declarationBlock(".document-tree__label");

    expect(folderRow).toContain("padding-right: var(--control-height)");
    expect(
      declarationBlock(
        ".document-tree__row:has(.document-tree__folder-create) .document-tree__item",
      ),
    ).toBe("");
    expect(label).toContain("min-width: 0");
    expect(label).toContain("overflow: hidden");
    expect(label).toContain("text-overflow: ellipsis");
    expect(label).toContain("white-space: nowrap");
  });

  it("uses semantic spacing and type tokens in reader context and history", () => {
    expect(declarationBlock(".document-reader__layout")).toContain(
      "gap: 0",
    );
    expect(declarationBlock(".document-reader__context")).toContain(
      "padding: var(--space-5)",
    );
    expect(declarationBlock(".document-reader__context")).toContain(
      "background: var(--color-surface)",
    );
    expect(declarationBlock(".document-reader__menu button")).toContain(
      "border-radius: var(--radius-sm)",
    );
    expect(
      declarationBlock(".document-overview__properties h2"),
    ).toContain("font-weight: var(--font-weight-section-title)");
    expect(declarationBlock(".document-overview__properties dt")).toContain(
      "font-size: var(--font-meta-size)",
    );
    expect(declarationBlock(".document-history ol")).toContain(
      "gap: var(--documents-space-repeated)",
    );
    expect(declarationBlock(".document-history li button")).toContain(
      "border-radius: var(--radius-sm)",
    );
    expect(declarationBlock(".document-history li button")).toContain(
      "background: transparent",
    );
    expect(declarationBlock(".document-history li span")).toContain(
      "line-height: var(--font-meta-line)",
    );
  });

  it("applies reading typography and width to Markdown prose without card-wrapping paragraphs", () => {
    expect(declarationBlock(".markdown-document")).toContain(
      "font-size: var(--font-document-size)",
    );
    expect(declarationBlock(".markdown-document")).toContain(
      "line-height: var(--font-document-line)",
    );
    expect(declarationBlock(".markdown-document")).toContain(
      "max-width: var(--document-prose-max-width)",
    );
    const paragraph = declarationBlock(".markdown-document p");
    expect(paragraph).toContain("margin: 0 0 var(--document-prose-paragraph-gap)");
    expect(paragraph).not.toContain("background:");
    expect(paragraph).not.toContain("border:");

    expect(
      declarationBlock(
        ".document-draft-editor__mdx .mdxeditor-root-contenteditable",
      ),
    ).toContain("font-size: var(--font-document-size)");
    expect(declarationBlock(".document-draft-editor__source")).toContain(
      "font-size: var(--font-ui-size)",
    );
    expect(declarationBlock(".document-draft-editor__source")).toContain(
      "line-height: var(--font-ui-line)",
    );
  });

  it("defines responsive document heading and prose spacing tokens", () => {
    for (const [name, value] of [
      ["--font-document-h2-size", "24px"],
      ["--font-document-h2-line", "32px"],
      ["--font-document-h3-size", "20px"],
      ["--font-document-h3-line", "28px"],
      ["--font-document-h4-size", "18px"],
      ["--font-document-h4-line", "26px"],
      ["--font-document-h5-size", "16px"],
      ["--font-document-h5-line", "24px"],
      ["--font-document-h6-size", "14px"],
      ["--font-document-h6-line", "20px"],
      ["--document-prose-max-width", "720px"],
      ["--document-prose-paragraph-gap", "var(--space-4)"],
    ]) {
      expect(blocksFor(tokensCss, ":root")).toContain(`${name}: ${value}`);
    }
    for (const [name, value] of [
      ["--font-document-h2-size", "22px"],
      ["--font-document-h2-line", "29px"],
      ["--font-document-h3-size", "18px"],
      ["--font-document-h3-line", "26px"],
      ["--font-document-h4-size", "16px"],
      ["--font-document-h4-line", "24px"],
      ["--font-document-h5-size", "14px"],
      ["--font-document-h5-line", "20px"],
      ["--font-document-h6-size", "13px"],
      ["--font-document-h6-line", "18px"],
      ["--document-prose-max-width", "840px"],
      ["--document-prose-paragraph-gap", "var(--space-3)"],
    ]) {
      expect(blocksFor(tokensCss, ':root[data-density="compact"]')).toContain(`${name}: ${value}`);
    }
  });

  it("scopes explicit H2 through H6 typography to rendered Markdown", () => {
    expect(blocksFor(tokensCss, ":root")).toContain(
      "--font-section-size: 20px",
    );
    expect(blocksFor(tokensCss, ":root")).toContain(
      "--font-section-line: 28px",
    );
    expect(blocksFor(tokensCss, ':root[data-density="compact"]')).toContain(
      "--font-section-size: 18px",
    );
    expect(blocksFor(tokensCss, ':root[data-density="compact"]')).toContain(
      "--font-section-line: 26px",
    );

    for (const selector of [
      ".markdown-document h2",
      ".markdown-document h3",
      ".markdown-document h4",
      ".markdown-document h5",
      ".markdown-document h6",
    ]) {
      expect(declarationBlock(selector)).toContain("font-size: var(--font-document-");
      expect(declarationBlock(selector)).toContain("line-height: var(--font-document-");
    }

    for (const selector of [
      ".document-draft-editor__mdx .mdxeditor-root-contenteditable h1",
    ]) {
      expect(declarationBlock(selector)).toContain(
        "font-size: var(--font-h1-size)",
      );
      expect(declarationBlock(selector)).toContain(
        "line-height: var(--font-h1-line)",
      );
      expect(declarationBlock(selector)).toContain(
        "font-weight: var(--font-weight-page-title)",
      );
    }

    for (const selector of [
      ".document-draft-editor__mdx .mdxeditor-root-contenteditable h2",
    ]) {
      expect(declarationBlock(selector)).toContain(
        "font-size: var(--font-section-size)",
      );
      expect(declarationBlock(selector)).toContain(
        "line-height: var(--font-section-line)",
      );
      expect(declarationBlock(selector)).toContain(
        "font-weight: var(--font-weight-section-title)",
      );
    }

    for (const selector of [
      ".document-draft-editor__mdx .mdxeditor-root-contenteditable h3",
    ]) {
      expect(declarationBlock(selector)).toContain(
        "font-size: var(--font-group-size)",
      );
      expect(declarationBlock(selector)).toContain(
        "line-height: var(--font-group-line)",
      );
      expect(declarationBlock(selector)).toContain(
        "font-weight: var(--font-weight-control)",
      );
    }
  });

  it("restores Markdown list markers, task state, links, quotes, code, and rules", () => {
    const orderedList = declarationBlock(".markdown-document ol");
    const unorderedList = declarationBlock(".markdown-document ul");
    expect(orderedList).toContain("list-style: decimal");
    expect(unorderedList).toContain("list-style: disc");
    expect(declarationBlock(".markdown-document :is(ol, ul) :is(ol, ul)")).toContain(
      "margin-top: var(--document-prose-list-gap)",
    );
    expect(declarationBlock(".markdown-document .contains-task-list")).toContain(
      "list-style: none",
    );
    expect(declarationBlock('.markdown-document input[type="checkbox"]')).toContain(
      "pointer-events: none",
    );
    expect(declarationBlock(".markdown-document a")).toContain("text-decoration: underline");
    expect(declarationBlock(".markdown-document a:focus-visible")).toContain(
      "outline: var(--focus-ring-width) solid var(--color-primary)",
    );
    expect(declarationBlock(".markdown-document blockquote")).toContain(
      "border-left: 3px solid var(--color-border-strong)",
    );
    expect(declarationBlock(".markdown-document :not(pre) > code")).toContain(
      "background: var(--color-canvas)",
    );
    expect(declarationBlock(".markdown-document hr")).toContain(
      "border-top: 1px solid var(--color-border)",
    );
    expect(
      declarationBlock(
        ".document-draft-editor__mdx .mdxeditor-root-contenteditable :is(h1, h2, h3, h4)",
      ),
    ).toContain("margin-top: var(--documents-heading-flow)");
  });

  it("uses dialog and draft controls with approved grouping", () => {
    expect(declarationBlock(".new-document-dialog")).toContain(
      "gap: var(--documents-space-group)",
    );
    expect(declarationBlock(".new-document-dialog__fields")).toContain(
      "gap: var(--documents-space-component)",
    );
    expect(
      declarationBlock(".new-document-dialog__template-grid button"),
    ).toContain("border-radius: var(--radius-md)");
    expect(
      declarationBlock(".new-document-dialog__template-grid button:hover"),
    ).toBe("");
    expect(declarationBlock(".new-document-dialog__team-copy")).toContain(
      "border-radius: var(--radius-md)",
    );
    expect(declarationBlock(".document-draft-switcher")).toContain(
      "font-weight: var(--font-weight-control)",
    );
    expect(declarationBlock(".document-draft-editor__heading input")).toContain(
      "font-weight: var(--font-weight-page-title)",
    );
    expect(declarationBlock(".document-draft-editor__mode-tabs")).toContain(
      "margin-bottom: var(--space-2)",
    );
  });

  it("starts the editor title at the shared page inset without a preceding switcher band", () => {
    expect(declarationBlock(".document-draft-editor")).toContain(
      "padding-block-start: var(--page-block-start)",
    );
    expect(declarationBlock(".document-draft-editor__switcher")).toBe("");
    expect(
      declarationBlock(".document-draft-editor__header-secondary"),
    ).toContain("display: flex");
    expect(
      declarationBlock(".document-draft-editor__header-secondary"),
    ).toContain("flex-wrap: wrap");
  });
});
