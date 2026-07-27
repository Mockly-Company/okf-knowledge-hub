import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import defaultCapability from "../../../src-tauri/capabilities/default.json";

describe("desktop settings boundary", () => {
  it("does not grant the WebView direct store access", () => {
    expect(defaultCapability.permissions).not.toContain("store:default");
  });

  it("does not ship the JavaScript store client", () => {
    expect(packageJson.dependencies).not.toHaveProperty(
      "@tauri-apps/plugin-store",
    );
  });
});
