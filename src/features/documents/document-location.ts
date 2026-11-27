/** Secondary repository keys stay opaque at gateway boundaries. */
export function documentLocation(key: string): { repository: string | null; path: string } {
  const match = /^repo:([^/]+\/[^/]+)(?:\/(.*))?$/.exec(key);
  return match ? { repository: match[1], path: match[2] ?? "" } : { repository: null, path: key };
}

export function displayDocumentPath(key: string): string {
  const { repository, path } = documentLocation(key);
  return repository ? `${repository} · ${path}` : path;
}
