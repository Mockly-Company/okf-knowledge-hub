import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");

describe("component contract", () => {
  it("routes product buttons through shared UI primitives", () => {
    const violations = globSync("**/*.tsx", { cwd: sourceRoot })
      .filter((path) => !path.startsWith("components/ui/") && !path.endsWith(".test.tsx"))
      .filter((path) => readFileSync(resolve(sourceRoot, path), "utf8").includes("<button"));

    expect(violations).toEqual([]);
  });
});
