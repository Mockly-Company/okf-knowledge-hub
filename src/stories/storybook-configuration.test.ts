import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Storybook configuration", () => {
  it("provides local, test, and static-build scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.storybook).toBe("storybook dev -p 6006");
    expect(packageJson.scripts["test:storybook"]).toBe(
      "vitest --project storybook",
    );
    expect(packageJson.scripts["build-storybook"]).toBe("storybook build");
  });
});
