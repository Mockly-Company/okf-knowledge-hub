interface MarkdownNode {
  position?: { start?: { offset?: number } };
}

interface MarkdownRoot {
  children?: MarkdownNode[];
}

function lineAt(source: string, start: number): { marker: string; end: number } {
  const newline = source.indexOf("\n", start);
  const end = newline < 0 ? source.length : newline + 1;
  let marker = source.slice(start, end);
  if (marker.endsWith("\n")) marker = marker.slice(0, -1);
  if (marker.endsWith("\r")) marker = marker.slice(0, -1);
  return { marker, end };
}

function frontmatterEndOffset(source: string): number | null {
  const opening = lineAt(source, 0);
  if (opening.marker !== "---" || opening.end === source.length) return null;

  for (let offset = opening.end; offset < source.length;) {
    const line = lineAt(source, offset);
    if (line.marker === "---" || line.marker === "...") return line.end;
    offset = line.end;
  }
  return null;
}

/** Removes only an opening OKF YAML frontmatter block before heading IDs are assigned. */
export function remarkOkfFrontmatter(source: string) {
  const endOffset = frontmatterEndOffset(source);
  return () => (tree: MarkdownRoot) => {
    if (endOffset === null || !tree.children) return;
    tree.children = tree.children.filter(
      (node) => (node.position?.start?.offset ?? Number.POSITIVE_INFINITY) >= endOffset,
    );
  };
}
