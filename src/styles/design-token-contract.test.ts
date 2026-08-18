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
});
