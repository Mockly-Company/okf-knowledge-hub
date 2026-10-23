import { describe, expect, it } from "vitest";
import { resolveFolderPath, removePendingBranch } from "./folder-selection";

describe("folder selection", () => {
  it("reuses existing intermediate folders and identifies only missing paths", () => {
    expect(resolveFolderPath("docs/api", "contracts/v2", ["docs", "docs/api", "docs/api/contracts"]))
      .toEqual({ path: "docs/api/contracts/v2", missing: ["docs/api/contracts/v2"] });
    expect(resolveFolderPath("docs/api", "v2/contracts", ["docs", "docs/api"]))
      .toEqual({ path: "docs/api/v2/contracts", missing: ["docs/api/v2", "docs/api/v2/contracts"] });
  });
  it.each(["../outside", "a//b", "/a", "a/", "a\\b", ".", "", "a/../b"])("rejects unsafe or empty segments: %s", path => {
    expect(() => resolveFolderPath("docs/api", path, ["docs", "docs/api"])).toThrow();
  });
  it("undoes unused intermediate pending folders without removing existing folders", () => {
    expect(removePendingBranch(["docs", "docs/api"], ["docs/api/v2", "docs/api/v2/contracts"], "docs/api/v2/contracts"))
      .toEqual({ pending: [], fallback: "docs/api" });
    expect(removePendingBranch(["docs", "docs/api"], ["docs/api/v2", "docs/api/v2/contracts", "docs/api/v2/examples"], "docs/api/v2/contracts"))
      .toEqual({ pending: ["docs/api/v2", "docs/api/v2/examples"], fallback: "docs/api/v2" });
  });
});
