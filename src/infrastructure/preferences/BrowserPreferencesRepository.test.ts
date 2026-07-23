import { beforeEach, describe, expect, it } from "vitest";
import { BrowserPreferencesRepository } from "./BrowserPreferencesRepository";

describe("BrowserPreferencesRepository", () => {
  beforeEach(() => localStorage.clear());

  it("returns default when nothing was stored", async () => {
    const repository = new BrowserPreferencesRepository(localStorage);
    await expect(repository.getDisplayDensity()).resolves.toBe("default");
  });

  it("persists compact density", async () => {
    const repository = new BrowserPreferencesRepository(localStorage);
    await repository.setDisplayDensity("compact");
    await expect(repository.getDisplayDensity()).resolves.toBe("compact");
  });
});
