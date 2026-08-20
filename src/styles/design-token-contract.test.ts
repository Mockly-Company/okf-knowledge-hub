import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const tokenFile = resolve(sourceRoot, "styles/tokens.css");

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

    expect(tokens).toContain("--font-weight-page-title: 700");
    expect(tokens).toContain("--font-weight-section-title: 700");
    expect(tokens).toContain("--font-weight-control: 600");
    expect(tokens).toContain("--font-weight-description: 500");
    expect(tokens).toContain("--font-weight-body: 400");
    expect(tokens).toContain("--font-ui-size: 13px");
    expect(tokens).toContain("--font-ui-line: 20px");
    expect(tokens).toContain("--control-height: 36px");
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
});
