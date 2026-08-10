interface MarkdownNode {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
}

function replaceHtmlWithText(node: MarkdownNode): void {
  if (node.type === "html") node.type = "text";
  for (const child of node.children ?? []) replaceHtmlWithText(child);
}

/**
 * Markdown HTML is deliberately literal in document rendering.  Converting it
 * before remark-rehype keeps it visible without ever parsing it as browser DOM.
 */
export function remarkLiteralHtml() {
  return (tree: MarkdownNode) => {
    replaceHtmlWithText(tree);
  };
}
