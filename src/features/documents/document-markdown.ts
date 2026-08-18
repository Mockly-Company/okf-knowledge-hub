function quotedYaml(value: string): string {
  return JSON.stringify(value.normalize("NFC"));
}

function unquotedYaml(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

export function documentTitle(markdown: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const title = frontmatter?.[1]?.match(/^title:\s*(.+)$/m)?.[1];
  if (title) return unquotedYaml(title);
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "제목 없음";
}

export function updateDocumentTitle(markdown: string, nextTitle: string): string {
  const previousTitle = documentTitle(markdown);
  const normalized = nextTitle.normalize("NFC");
  let updated = markdown.replace(
    /^(---\r?\n[\s\S]*?^title:)\s*.+$/m,
    `$1 ${quotedYaml(normalized)}`,
  );
  const firstHeading = updated.match(/^#\s+(.+)$/m);
  if (firstHeading?.[1]?.trim() === previousTitle) {
    updated = updated.replace(/^#\s+.+$/m, `# ${normalized}`);
  }
  return updated;
}

export function isDocumentTitleLinked(markdown: string): boolean {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading !== undefined && heading === documentTitle(markdown);
}

export function isRichEditorCompatibleMarkdown(markdown: string): boolean {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  return !/<\/?[A-Za-z][^>]*>/.test(withoutCode) &&
    !/^\s*(?:import|export)\s/m.test(withoutCode) &&
    !/^(?:<<<<<<<|=======|>>>>>>>)/m.test(withoutCode) &&
    !/\{[^\n{}]+\}/.test(withoutCode);
}
