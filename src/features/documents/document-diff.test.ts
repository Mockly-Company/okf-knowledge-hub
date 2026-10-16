import { describe, expect, it } from "vitest";
import { compareDocumentLines } from "./document-diff";

describe("compareDocumentLines", () => {
  it("aligns replacements and preserves line numbers", () => {
    expect(compareDocumentLines("# 제목\n\n이전\n유지", "# 제목\n\n수정\n유지")).toEqual([
      { before: { number: 1, text: "# 제목", kind: "same" }, after: { number: 1, text: "# 제목", kind: "same" } },
      { before: { number: 2, text: "", kind: "same" }, after: { number: 2, text: "", kind: "same" } },
      { before: { number: 3, text: "이전", kind: "removed" }, after: { number: 3, text: "수정", kind: "added" } },
      { before: { number: 4, text: "유지", kind: "same" }, after: { number: 4, text: "유지", kind: "same" } },
    ]);
  });
  it("does not invent previous lines for a new document", () => {
    expect(compareDocumentLines("", "# 새 문서")).toEqual([
      { before: null, after: { number: 1, text: "# 새 문서", kind: "added" } },
    ]);
  });
  it.each([
    ["a\nb", "a\nx\nb"], ["a\nb", "b"], ["", ""],
    ["a\n", "a\n\n"], ["동일\n동일\n끝", "동일\n수정\n끝"], ["a\nb\nc", "x\ny"],
  ])("preserves source text through changes (%s)", (before, after) => {
    const rows = compareDocumentLines(before, after);
    expect(rows.flatMap(row => row.before ? [row.before.text] : []).join("\n")).toBe(before);
    expect(rows.flatMap(row => row.after ? [row.after.text] : []).join("\n")).toBe(after);
  });
  it("bounds work for large replacements", () => {
    const rows = compareDocumentLines(Array.from({ length: 2000 }, (_, i) => `old${i}`).join("\n"), Array.from({ length: 2000 }, (_, i) => `new${i}`).join("\n"));
    expect(rows).toHaveLength(2000);
    expect(rows[1999]).toEqual({ before: { number: 2000, text: "old1999", kind: "removed" }, after: { number: 2000, text: "new1999", kind: "added" } });
  });
});
