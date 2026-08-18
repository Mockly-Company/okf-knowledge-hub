import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  resolve(process.cwd(), "src/styles/globals.css"),
  "utf8",
);

function declarationBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = globalsCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("app shell design contract", () => {
  it("uses the canvas for the sidebar and the surface for main content", () => {
    expect(declarationBlock(".app-sidebar")).toContain(
      "background: var(--color-canvas)",
    );
    expect(declarationBlock(".app-shell__main")).toContain(
      "background: var(--color-surface)",
    );
  });

  it("keeps the document root fixed while main content scrolls independently", () => {
    expect(declarationBlock("html,\nbody,\n#root")).toContain("height: 100%");
    expect(declarationBlock("html,\nbody,\n#root")).toContain("overflow: hidden");
    expect(declarationBlock(".app-shell")).toContain("height: 100dvh");
    expect(declarationBlock(".app-shell")).toContain("overflow: hidden");
    expect(declarationBlock(".app-shell__main")).toContain("overflow-y: auto");
    expect(declarationBlock(".app-shell__main")).toContain(
      "overscroll-behavior: contain",
    );
  });
});
