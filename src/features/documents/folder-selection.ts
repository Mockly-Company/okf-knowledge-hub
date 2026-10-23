import type { DocumentTreeEntry } from "./model";

export function collectFolderPaths(roots: DocumentTreeEntry[]): string[] {
  return roots.flatMap(entry => entry.kind === "folder" ? [entry.path, ...collectFolderPaths(entry.children)] : []);
}

export function resolveFolderPath(parent: string, input: string, existing: string[]): { path: string; missing: string[] } {
  const segments = input.trim().normalize("NFC").split("/").map(part => part.trim());
  if (segments.some(part => !part || part === "." || part === ".." || /[\\\u0000-\u001f]/.test(part))) {
    throw new Error("폴더 이름을 /로 구분해주세요. 빈 이름과 . 또는 ..는 사용할 수 없습니다.");
  }
  let path = parent;
  const missing: string[] = [];
  for (const segment of segments) {
    path += `/${segment}`;
    if (!existing.includes(path)) missing.push(path);
  }
  return { path, missing };
}

export function removePendingBranch(existing: string[], pending: string[], selected: string): { pending: string[]; fallback: string } {
  let remaining = pending.filter(path => path !== selected && !path.startsWith(`${selected}/`));
  let fallback = selected.slice(0, selected.lastIndexOf("/"));
  while (!existing.includes(fallback) && remaining.includes(fallback) && !remaining.some(path => path.startsWith(`${fallback}/`))) {
    remaining = remaining.filter(path => path !== fallback);
    fallback = fallback.slice(0, fallback.lastIndexOf("/"));
  }
  return { pending: remaining, fallback };
}
