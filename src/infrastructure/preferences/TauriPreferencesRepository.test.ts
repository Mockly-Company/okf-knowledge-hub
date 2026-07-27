import { describe, expect, it, vi } from "vitest";
import { TauriPreferencesRepository } from "./TauriPreferencesRepository";

describe("TauriPreferencesRepository", () => {
  it("round-trips density through the narrow Rust command names", async () => {
    let density: unknown = "default";
    const invokeCommand = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "get_display_density") {
          return density;
        }
        if (command === "set_display_density") {
          density = args?.density;
          return undefined;
        }
        throw new Error(`unexpected command: ${command}`);
      },
    );
    const repository = new TauriPreferencesRepository(invokeCommand);

    await repository.setDisplayDensity("compact");

    expect(await repository.getDisplayDensity()).toBe("compact");
    expect(invokeCommand).toHaveBeenNthCalledWith(1, "set_display_density", {
      density: "compact",
    });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "get_display_density");
  });

  it("retains the existing safe fallback for an invalid Rust response", async () => {
    const invokeCommand = vi.fn(async () => "comfortable");
    const repository = new TauriPreferencesRepository(invokeCommand);

    expect(await repository.getDisplayDensity()).toBe("default");
  });
});
