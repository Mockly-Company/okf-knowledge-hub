import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

describe("Storybook native pointer commands", () => {
  it("uses the public Playwright BrowserCommandContext surface", () => {
    expect(viteConfig).toContain("await context.frame()");
    expect(viteConfig).toContain("context.page.mouse.down()");
    expect(viteConfig).toContain("context.page.mouse.up()");
    expect(viteConfig).not.toContain("getCommandsContext");
    expect(viteConfig).not.toContain("PlaywrightBrowserCommandContext");
  });
});
