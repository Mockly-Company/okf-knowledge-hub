interface MarkdownNode {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
}

const htmlTag = /<\/?[a-z][^>]*>/gi;

function literalHtmlNodes(value: string, allowedTags: ReadonlySet<string>): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(htmlTag)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ type: "text", value: value.slice(cursor, index) });
    const tag = match[0];
    const tagName = /^<\/?([a-z]+)/i.exec(tag)?.[1]?.toLocaleLowerCase();
    nodes.push({ type: tagName && allowedTags.has(tagName) && /^<\/?[a-z]+>$/i.test(tag) ? "html" : "text", value: tag });
    cursor = index + tag.length;
  }
  if (cursor < value.length || nodes.length === 0) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}

function replaceHtmlWithText(node: MarkdownNode, allowedTags: ReadonlySet<string>): void {
  if (!node.children) return;
  node.children = (node.children ?? []).flatMap((child) => {
    if (child.type !== "html") {
      replaceHtmlWithText(child, allowedTags);
      return child;
    }
    return literalHtmlNodes(child.value ?? "", allowedTags);
  });
}

/**
 * Markdown HTML is deliberately literal in document rendering.  Converting it
 * before remark-rehype keeps it visible without ever parsing it as browser DOM.
 */
export function remarkLiteralHtml({ allowedTags = ["details", "summary"] }: { allowedTags?: string[] } = {}) {
  const safeAllowedTags = new Set(
    allowedTags
      .map((tag) => tag.toLocaleLowerCase())
      .filter((tag) => tag === "details" || tag === "summary"),
  );
  return () => (tree: MarkdownNode) => {
    replaceHtmlWithText(tree, safeAllowedTags);
  };
}
