import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  BOARD_AUTO_SYNC_STALE_MS,
  WINDOW_FOCUS_SYNC_COOLDOWN_MS,
  hasCooldownElapsed,
  isTimestampStale,
  parseIsoTimestampMs,
  useWindowFocusAndIntervalSync,
  type AutoSyncTrigger,
} from "./autoSyncPolicy";

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

describe("autoSyncPolicy helpers", () => {
  it("parses valid ISO timestamps and rejects missing or malformed ones", () => {
    expect(parseIsoTimestampMs("2026-11-26T00:00:00Z")).toBe(
      Date.parse("2026-11-26T00:00:00Z"),
    );
    expect(parseIsoTimestampMs(null)).toBeNull();
    expect(parseIsoTimestampMs(undefined)).toBeNull();
    expect(parseIsoTimestampMs("   ")).toBeNull();
    expect(parseIsoTimestampMs("not-a-date")).toBeNull();
  });

  it("evaluates staleness against the configured threshold", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const fresh = new Date(now - (BOARD_AUTO_SYNC_STALE_MS - 1_000)).toISOString();
    const stale = new Date(now - BOARD_AUTO_SYNC_STALE_MS).toISOString();
    const future = new Date(now + 10_000).toISOString();

    expect(isTimestampStale(fresh, BOARD_AUTO_SYNC_STALE_MS, now)).toBe(false);
    expect(isTimestampStale(future, BOARD_AUTO_SYNC_STALE_MS, now)).toBe(false);
    expect(isTimestampStale(stale, BOARD_AUTO_SYNC_STALE_MS, now)).toBe(true);
    expect(isTimestampStale(null, BOARD_AUTO_SYNC_STALE_MS, now)).toBe(true);
    expect(isTimestampStale("broken", BOARD_AUTO_SYNC_STALE_MS, now)).toBe(true);
  });

  it("checks cooldown elapsed properly", () => {
    const now = 1_000_000;
    expect(hasCooldownElapsed(null, WINDOW_FOCUS_SYNC_COOLDOWN_MS, now)).toBe(true);
    expect(
      hasCooldownElapsed(
        now - (WINDOW_FOCUS_SYNC_COOLDOWN_MS - 1),
        WINDOW_FOCUS_SYNC_COOLDOWN_MS,
        now,
      ),
    ).toBe(false);
    expect(
      hasCooldownElapsed(
        now - WINDOW_FOCUS_SYNC_COOLDOWN_MS,
        WINDOW_FOCUS_SYNC_COOLDOWN_MS,
        now,
      ),
    ).toBe(true);
  });
});

describe("useWindowFocusAndIntervalSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    setVisibilityState("visible");
    vi.useRealTimers();
  });

  function Harness({
    enabled,
    getLastSyncAtMs,
    onSync,
  }: {
    enabled: boolean;
    getLastSyncAtMs: () => number | null;
    onSync: (trigger: AutoSyncTrigger) => void;
  }) {
    useWindowFocusAndIntervalSync({
      enabled,
      getLastSyncAtMs,
      onSync,
    });
    return null;
  }

  it("triggers on focus only after cooldown elapsed and deduplicates visibilitychange + focus pair", () => {
    let lastSync: number | null = Date.now();
    const triggers: AutoSyncTrigger[] = [];

    render(
      <Harness
        enabled
        getLastSyncAtMs={() => lastSync}
        onSync={(trigger) => {
          triggers.push(trigger);
          lastSync = Date.now();
        }}
      />,
    );

    // Within 60s cooldown -> ignored
    act(() => {
      vi.advanceTimersByTime(WINDOW_FOCUS_SYNC_COOLDOWN_MS - 5_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(triggers).toEqual([]);

    // Past 60s cooldown -> visibilitychange + focus back-to-back only fires once
    act(() => {
      vi.advanceTimersByTime(5_000);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(triggers).toEqual(["focus"]);
  });

  it("runs periodic sync every 5 minutes while visible and skips while hidden", () => {
    let lastSync: number | null = Date.now();
    const triggers: AutoSyncTrigger[] = [];

    render(
      <Harness
        enabled
        getLastSyncAtMs={() => lastSync}
        onSync={(trigger) => {
          triggers.push(trigger);
          lastSync = Date.now();
        }}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_SYNC_INTERVAL_MS);
    });
    expect(triggers).toEqual(["interval"]);

    // While hidden, interval ticks are skipped
    setVisibilityState("hidden");
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_SYNC_INTERVAL_MS);
    });
    expect(triggers).toEqual(["interval"]);

    // Returning to visible triggers a focus sync immediately since cooldown elapsed
    setVisibilityState("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(triggers).toEqual(["interval", "focus"]);
  });

  it("does not fire when disabled", () => {
    const triggers: AutoSyncTrigger[] = [];
    render(
      <Harness
        enabled={false}
        getLastSyncAtMs={() => null}
        onSync={(trigger) => triggers.push(trigger)}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_SYNC_INTERVAL_MS);
      window.dispatchEvent(new Event("focus"));
    });
    expect(triggers).toEqual([]);
  });
});
