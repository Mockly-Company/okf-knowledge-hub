import type { HistoryCursor } from "./model";

/**
 * Query keys for the Documents domain. Every key is scoped by the documents
 * session id, so a session restart (structural change) naturally orphans the
 * previous session's cached reads.
 */
export const documentsKeys = {
  all: ["documents"] as const,
  session: (sessionId: string) =>
    [...documentsKeys.all, "session", sessionId] as const,
  read: (
    sessionId: string,
    kind: "current" | "version",
    locator: string,
  ) => [...documentsKeys.session(sessionId), "read", kind, locator] as const,
  search: (sessionId: string, query: string) =>
    [...documentsKeys.session(sessionId), "search", query] as const,
  history: (
    sessionId: string,
    path: string,
    cursor: HistoryCursor | null,
  ) => [...documentsKeys.session(sessionId), "history", path, cursor] as const,
  templates: (sessionId: string) =>
    [...documentsKeys.session(sessionId), "templates"] as const,
  drafts: (sessionId: string) =>
    [...documentsKeys.session(sessionId), "drafts"] as const,
  recovery: (sessionId: string) =>
    [...documentsKeys.session(sessionId), "recovery"] as const,
  pullRequests: (sessionId: string) =>
    [...documentsKeys.session(sessionId), "pullRequests"] as const,
  pullRequestDetail: (sessionId: string, number: number) =>
    [...documentsKeys.session(sessionId), "pullRequestDetail", number] as const,
};
