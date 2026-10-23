export type MarkdownAlertKind = "note" | "tip" | "important" | "warning" | "caution";

interface MarkdownPosition {
  start?: { offset?: number };
  end?: { offset?: number };
}

export interface MarkdownNode {
  type?: string;
  value?: string;
  lang?: string | null;
  children?: MarkdownNode[];
  position?: MarkdownPosition;
  data?: { hProperties?: Record<string, string> };
}

const alertMarker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i;

function visitMarkdown(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) visitMarkdown(child, callback);
}

function normalizedSource(markdown: string, node: MarkdownNode): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return "";
  return markdown.slice(start, end).replace(/\r\n?/g, "\n").trim();
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function markAlert(node: MarkdownNode): void {
  if (node.type !== "blockquote") return;
  const firstParagraph = node.children?.[0];
  const firstText = firstParagraph?.children?.[0];
  if (firstParagraph?.type !== "paragraph" || firstText?.type !== "text") return;
  const match = firstText.value?.match(alertMarker);
  if (!match) return;

  const kind = match[1].toLocaleLowerCase() as MarkdownAlertKind;
  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      dataOkhubAlert: kind,
    },
  };

  const remainder = firstText.value?.slice(match[0].length) ?? "";
  if (remainder) {
    firstText.value = remainder;
  } else {
    firstParagraph.children = firstParagraph.children?.slice(1);
    if (!firstParagraph.children?.length) {
      node.children = node.children?.slice(1);
    }
  }
}

export function remarkOkhubBlocks(input: { markdown: string; documentId: string }) {
  return () => (tree: MarkdownNode) => {
    const occurrences = new Map<string, number>();

    visitMarkdown(tree, (node) => {
      markAlert(node);
      if (node.type !== "code" && node.type !== "table") return;

      const type = node.type === "code" && node.lang === "mermaid" ? "mermaid" : node.type;
      const hash = fnv1a(`${input.documentId}:${normalizedSource(input.markdown, node)}`);
      const occurrenceKey = `${type}:${hash}`;
      const occurrence = occurrences.get(occurrenceKey) ?? 0;
      occurrences.set(occurrenceKey, occurrence + 1);
      const blockId = `okhub-${type}-${hash}-${occurrence}`;

      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id: blockId,
          dataOkhubBlockId: blockId,
        },
      };
    });
  };
}
