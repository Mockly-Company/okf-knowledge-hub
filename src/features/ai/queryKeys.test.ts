import { describe, expect, it } from "vitest";
import { aiKeys } from "./queryKeys";

describe("aiKeys", () => {
  it("pins stable key shapes for cross-module invalidation", () => {
    expect(aiKeys.all).toEqual(["ai"]);
    expect(aiKeys.config).toEqual(["ai", "config"]);
    expect(aiKeys.agentsMd).toEqual(["ai", "agentsMd"]);
    expect(aiKeys.appAgentsMd).toEqual(["ai", "appAgentsMd"]);
  });
});
