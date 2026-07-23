import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import {
  PreferencesProvider,
  usePreferences,
} from "./PreferencesProvider";

function Probe() {
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();
  return (
    <div>
      <output>{isLoading ? "loading" : displayDensity}</output>
      <button onClick={() => void setDisplayDensity("compact")}>compact</button>
    </div>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

class DeferredPreferencesRepository implements PreferencesRepository {
  readonly read = deferred<DisplayDensity>();
  readonly write = deferred<void>();
  readonly writes: DisplayDensity[] = [];

  getDisplayDensity(): Promise<DisplayDensity> {
    return this.read.promise;
  }

  setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.writes.push(value);
    return this.write.promise;
  }
}

describe("PreferencesProvider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads density and applies it to the document root", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository("compact")}>
        <Probe />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("compact")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
  });

  it("persists an explicit density change", async () => {
    const repository = new FakePreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <Probe />
      </PreferencesProvider>,
    );
    await screen.findByText("default");
    await userEvent.click(screen.getByRole("button", { name: "compact" }));
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
  });

  it("keeps an explicit choice when a stale initial read resolves later", async () => {
    const repository = new DeferredPreferencesRepository();
    const user = userEvent.setup();
    render(
      <PreferencesProvider repository={repository}>
        <Probe />
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "compact" }));
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
    repository.write.resolve();
    expect(await screen.findByText("compact")).toBeInTheDocument();

    repository.read.resolve("default");

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-density", "compact"),
    );
  });

  it("settles to the default density when the initial read fails", async () => {
    const repository = new DeferredPreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <Probe />
      </PreferencesProvider>,
    );

    repository.read.reject(new Error("read failed"));

    expect(await screen.findByText("default")).toBeInTheDocument();
  });

  it("does not apply a deferred write after unmount", async () => {
    const repository = new DeferredPreferencesRepository();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    const { unmount } = render(
      <PreferencesProvider repository={repository}>
        <Probe />
      </PreferencesProvider>,
    );

    repository.read.resolve("default");
    await screen.findByText("default");
    await user.click(screen.getByRole("button", { name: "compact" }));
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));

    unmount();
    repository.write.resolve();
    await Promise.resolve();

    expect(document.documentElement).toHaveAttribute("data-density", "default");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
