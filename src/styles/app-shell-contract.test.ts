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

function mediaQueryBlock(query: string): string {
  const start = globalsCss.indexOf(`@media ${query} {`);
  if (start < 0) return "";
  const next = globalsCss.indexOf("\n@media ", start + 1);
  return globalsCss.slice(start, next < 0 ? undefined : next);
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

  it("gives the connection flow its own viewport-height vertical scroll boundary", () => {
    const connection = declarationBlock(".workspace-connection");

    expect(connection).toMatch(/(?:^|\n)\s*height: 100dvh;/);
    expect(connection).toContain("overflow-y: auto");
    expect(connection).toContain(
      "overscroll-behavior: contain",
    );
    expect(connection).toContain("align-items: start");
    expect(declarationBlock(".workspace-connection__card")).toContain(
      "margin-block: auto",
    );
  });

  it("uses a 260px sidebar only on wide desktop screens", () => {
    const wideDesktop = mediaQueryBlock("(min-width: 1440px)");

    expect(wideDesktop).toContain("width: 260px");
    expect(wideDesktop).toContain("flex-basis: 260px");
  });

  it("turns the sidebar into an overlay and gives main the full tablet width", () => {
    const tablet = mediaQueryBlock(
      "(min-width: 768px) and (max-width: 1023px)",
    );

    expect(tablet).toContain(".app-sidebar");
    expect(tablet).toContain("position: fixed");
    expect(tablet).toContain("box-shadow: var(--shadow-overlay)");
    expect(tablet).toContain(".app-shell__main");
    expect(tablet).toContain("width: 100%");
    expect(tablet).toContain("flex-basis: 100%");
  });

  it("uses one shell column below 768px including the 720px minimum", () => {
    const narrow = mediaQueryBlock("(max-width: 767px)");

    expect(narrow).toContain(".app-shell");
    expect(narrow).toContain("display: block");
    expect(narrow).toContain(".app-sidebar");
    expect(narrow).toContain("position: fixed");
    expect(narrow).toContain(".app-shell__main");
    expect(narrow).toContain("width: 100%");
  });
});
