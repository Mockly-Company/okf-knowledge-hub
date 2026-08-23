import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const tokenFile = resolve(sourceRoot, "styles/tokens.css");
const globalStyleFile = resolve(sourceRoot, "styles/globals.css");

function productStyleFiles(): string[] {
  return globSync("**/*.{css,tsx}", { cwd: sourceRoot })
    .map((path) => resolve(sourceRoot, path))
    .filter((path) => path !== tokenFile && !path.endsWith(".test.tsx"));
}

describe("design token contract", () => {
  it("keeps literal product colors inside the token source of truth", () => {
    const violations = productStyleFiles().flatMap((path) => {
      const contents = readFileSync(path, "utf8");
      return [...contents.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map(
        (match) => `${path.slice(sourceRoot.length + 1)}:${match[0]}`,
      );
    });

    expect(violations).toEqual([]);
  });

  it("does not use the obsolete danger token", () => {
    const violations = productStyleFiles().filter((path) =>
      readFileSync(path, "utf8").includes("--color-danger"),
    );

    expect(violations).toEqual([]);
  });

  it("encodes the approved default typography hierarchy", () => {
    const tokens = readFileSync(tokenFile, "utf8");

    expect(tokens).toContain("--font-weight-page-title: 600");
    expect(tokens).toContain("--font-weight-section-title: 600");
    expect(tokens).toContain("--font-weight-control: 600");
    expect(tokens).toContain("--font-weight-description: 500");
    expect(tokens).toContain("--font-weight-body: 400");
    expect(tokens).toContain("--font-ui-size: 13px");
    expect(tokens).toContain("--font-ui-line: 20px");
    expect(tokens).toContain("--control-height: 36px");
  });

  it("defines the approved full radius for status pills", () => {
    const tokens = readFileSync(tokenFile, "utf8");

    expect(tokens).toContain("--radius-full: 999px");
  });

  it("keeps spacing on the approved four-pixel scale", () => {
    const tokens = readFileSync(tokenFile, "utf8");

    for (const [name, value] of [
      ["--space-1", "4px"],
      ["--space-2", "8px"],
      ["--space-3", "12px"],
      ["--space-4", "16px"],
      ["--space-5", "20px"],
      ["--space-6", "24px"],
      ["--space-8", "32px"],
      ["--space-10", "40px"],
      ["--space-12", "48px"],
    ]) {
      expect(tokens).toContain(`${name}: ${value}`);
    }
  });

  it("defines one density-aware page block-start inset", () => {
    const tokens = readFileSync(tokenFile, "utf8");

    expect(tokens).toMatch(
      /:root\s*\{[\s\S]*?--page-block-start: var\(--space-8\)/,
    );
    expect(tokens).toMatch(
      /:root\[data-density="compact"\]\s*\{[\s\S]*?--page-block-start: var\(--space-6\)/,
    );
  });

  it("uses the approved density-aware page inline inset", () => {
    const tokens = readFileSync(tokenFile, "utf8");

    expect(tokens).toMatch(
      /:root\s*\{[\s\S]*?--page-padding-inline: var\(--space-8\)/,
    );
    expect(tokens).toMatch(
      /:root\[data-density="compact"\]\s*\{[\s\S]*?--page-padding-inline: var\(--space-6\)/,
    );
  });

  it("defines the approved control focus and motion contract", () => {
    const tokens = readFileSync(tokenFile, "utf8");
    const globals = readFileSync(globalStyleFile, "utf8");

    expect(tokens).toContain("--focus-ring-width: 1px");
    expect(tokens).toContain("--focus-ring-offset: 0px");
    expect(tokens).toContain("--motion-control-duration: 180ms");
    expect(tokens).toContain("--motion-control-easing: cubic-bezier(0.2, 0, 0, 1)");
    expect(globals).toContain(
      "outline: var(--focus-ring-width) solid var(--color-primary)",
    );
    expect(globals).toContain("outline-offset: var(--focus-ring-offset)");
    expect(globals).toMatch(
      /\[aria-invalid="true"\]:focus-visible\s*\{[\s\S]*?outline-color: var\(--color-error\)/,
    );
  });
});
