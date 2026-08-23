import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("macOS development signing", () => {
  it("keeps pnpm tauri dev behind the signing-aware wrapper", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["dev:setup:macos"]).toContain("setup-macos-dev-signing");
    expect(packageJson.scripts.tauri).toContain("tauri-with-macos-signing");
  });

  it("fails before launching when the stable identity is unavailable", () => {
    const wrapper = read("scripts/tauri-with-macos-signing.sh");
    const runner = read("scripts/macos-dev-runner.sh");

    expect(wrapper).toContain("OkHub Local Development");
    expect(wrapper).toContain("dev:setup:macos");
    expect(wrapper).toContain("CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER");
    expect(runner).toContain("codesign --force");
    expect(runner).toContain("--identifier com.okhub.desktop.dev");
    expect(runner).toContain("codesign --verify --strict");
  });

  it("uses one stable OkHub target across moved and newly-created worktrees", () => {
    const wrapper = read("scripts/tauri-with-macos-signing.sh");

    expect(wrapper).toContain("OKHUB_CARGO_TARGET_DIR");
    expect(wrapper).toContain("$HOME/.cargo/targets/okhub");
    expect(wrapper).toContain("export CARGO_TARGET_DIR");
  });
});
