import { describe, expect, it } from "vitest";
import { documentsKeys } from "./queryKeys";

describe("documentsKeys", () => {
  it("builds stable hierarchical keys scoped by session", () => {
    expect(documentsKeys.all).toEqual(["documents"]);
    expect(documentsKeys.session("session-1")).toEqual([
      "documents",
      "session",
      "session-1",
    ]);
    expect(
      documentsKeys.read("session-1", "current", "docs/guide.md"),
    ).toEqual([
      "documents",
      "session",
      "session-1",
      "read",
      "current",
      "docs/guide.md",
    ]);
    expect(
      documentsKeys.read("session-1", "version", "abc123:docs/guide.md"),
    ).toEqual([
      "documents",
      "session",
      "session-1",
      "read",
      "version",
      "abc123:docs/guide.md",
    ]);
    expect(documentsKeys.search("session-1", "alpha")).toEqual([
      "documents",
      "session",
      "session-1",
      "search",
      "alpha",
    ]);
    expect(
      documentsKeys.history("session-1", "docs/guide.md", null),
    ).toEqual([
      "documents",
      "session",
      "session-1",
      "history",
      "docs/guide.md",
      null,
    ]);
    expect(documentsKeys.templates("session-1")).toEqual([
      "documents",
      "session",
      "session-1",
      "templates",
    ]);
    expect(documentsKeys.drafts("session-1")).toEqual([
      "documents",
      "session",
      "session-1",
      "drafts",
    ]);
    expect(documentsKeys.recovery("session-1")).toEqual([
      "documents",
      "session",
      "session-1",
      "recovery",
    ]);
  });
});
