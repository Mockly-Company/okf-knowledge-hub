import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const documentsCss = readFileSync(
  resolve(process.cwd(), "src/features/documents/documents.css"),
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
  return blocksFor(documentsCss, selector);
}

describe("Documents visual contract", () => {
  it("keeps document result cards bordered at rest and changes only their background on hover", () => {
    expect(declarationBlock(".document-search__results li button")).toContain(
      "border: 1px solid var(--color-border)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
      "background: var(--color-surface)",
    );
    expect(declarationBlock(".document-search__results li button:hover")).toContain(
      "background: var(--color-canvas)",
    );
    expect(declarationBlock(".document-search__results li button:hover")).not.toContain(
      "border-color",
    );
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
    expect(declarationBlock(".documents-page__toolbar")).toContain(
      "gap: var(--space-2)",
    );
    expect(declarationBlock(".documents-page__tools")).toContain(
      "margin-top: var(--documents-space-group)",
    );
    expect(declarationBlock(".document-search__results")).toContain(
      "margin-top: var(--documents-space-group)",
    );
    expect(declarationBlock(".document-search__results h2")).toContain(
      "font-weight: var(--font-weight-section-title)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
      "border: 1px solid var(--color-border)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
      "border-radius: var(--radius-md)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
      "background: var(--color-surface)",
    );
    expect(
      declarationBlock(".document-search__results li button:hover"),
    ).toContain("background: var(--color-canvas)");
    expect(
      declarationBlock(".document-search__results li button:hover"),
    ).not.toContain("border-color");
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
      "gap: var(--documents-space-section)",
    );
  });

  it("applies density-aware repeated and internal spacing to document rows", () => {
    expect(declarationBlock(".document-search__results ul")).toContain(
      "gap: var(--documents-space-repeated)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
      "gap: var(--documents-space-internal)",
    );
    expect(declarationBlock(".document-search__results li button")).toContain(
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
      "font-weight: var(--font-weight-control)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "height: var(--control-height)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "gap: var(--space-2)",
    );
    expect(declarationBlock(".document-tree__item")).toContain(
      "font-weight: var(--font-weight-control)",
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

  it("uses semantic spacing and type tokens in reader context and history", () => {
    expect(declarationBlock(".document-reader__layout")).toContain(
      "gap: var(--documents-space-section)",
    );
    expect(declarationBlock(".document-reader__context")).toContain(
      "padding-left: var(--space-5)",
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

  it("keeps the viewer on its established prose rhythm while retaining editor typography", () => {
    expect(declarationBlock(".markdown-document")).toContain(
      "line-height: 1.7",
    );
    expect(declarationBlock(".markdown-document")).not.toContain(
      "font-size: var(--font-document-size)",
    );
    expect(declarationBlock(".markdown-document")).not.toContain(
      "font-weight: var(--font-weight-body)",
    );
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

  it("keeps explicit heading typography scoped to MDX editor prose", () => {
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
      ".markdown-document h1",
      ".markdown-document h2",
      ".markdown-document h3",
      ".markdown-document h4",
    ]) {
      expect(declarationBlock(selector)).toBe("");
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

  it("restores viewer heading flow without changing density-aware MDX editor flow", () => {
    expect(declarationBlock(".markdown-document :is(h1, h2, h3, h4)")).toContain(
      "margin-top: 1.7em",
    );
    expect(declarationBlock(".markdown-document :is(h1, h2, h3, h4)")).toContain(
      "scroll-margin-top: 20px",
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
