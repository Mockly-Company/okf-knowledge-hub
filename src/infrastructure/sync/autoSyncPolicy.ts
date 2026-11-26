import { useEffect, useRef } from "react";

/** 캐시된 Project 보드가 자동 백그라운드 재조회 대상이 되는 경과 시간(1분). */
export const BOARD_AUTO_SYNC_STALE_MS = 60_000;

/** 창 포커스·가시성 복귀 시 중복 동기화를 막는 최소 쿨다운(60초). */
export const WINDOW_FOCUS_SYNC_COOLDOWN_MS = 60_000;

/** 앱이 열려 있는 동안 보드·대시보드·문서를 백그라운드 최신화하는 주기(5분). */
export const BACKGROUND_SYNC_INTERVAL_MS = 300_000;

export type AutoSyncTrigger = "focus" | "interval";

export function parseIsoTimestampMs(
  iso: string | null | undefined,
): number | null {
  if (!iso) {
    return null;
  }
  const trimmed = iso.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * ISO 타임스탬프가 `staleAfterMs` 이상 오래되었거나 비어·손상되었으면 참.
 * 시계 오차로 미래 시각이면 신선한 것으로 본다.
 */
export function isTimestampStale(
  iso: string | null | undefined,
  staleAfterMs: number,
  nowMs: number = Date.now(),
): boolean {
  const parsed = parseIsoTimestampMs(iso);
  if (parsed === null) {
    return true;
  }
  return nowMs - parsed >= staleAfterMs;
}

/** 마지막 동기화 시각으로부터 `cooldownMs` 이상 지났거나 이력이 없으면 참. */
export function hasCooldownElapsed(
  lastSyncedAtMs: number | null,
  cooldownMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (lastSyncedAtMs === null) {
    return true;
  }
  return nowMs - lastSyncedAtMs >= cooldownMs;
}

export interface UseWindowFocusAndIntervalSyncOptions {
  enabled: boolean;
  intervalMs?: number;
  focusCooldownMs?: number;
  getLastSyncAtMs: () => number | null;
  onSync: (trigger: AutoSyncTrigger) => void;
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * 창 포커스·가시성 복귀(쿨다운 60초)와 주기적 백그라운드(5분) 자동 동기화 훅.
 * `visibilitychange`와 `focus`가 연달아 발생해도 한 번만 트리거한다.
 */
export function useWindowFocusAndIntervalSync({
  enabled,
  intervalMs = BACKGROUND_SYNC_INTERVAL_MS,
  focusCooldownMs = WINDOW_FOCUS_SYNC_COOLDOWN_MS,
  getLastSyncAtMs,
  onSync,
}: UseWindowFocusAndIntervalSyncOptions): void {
  const getLastSyncRef = useRef(getLastSyncAtMs);
  getLastSyncRef.current = getLastSyncAtMs;
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const lastDispatchedAtMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      lastDispatchedAtMsRef.current = null;
      return;
    }

    const trySync = (trigger: AutoSyncTrigger) => {
      if (isDocumentHidden()) {
        return;
      }
      const now = Date.now();
      const recorded = getLastSyncRef.current();
      const dispatched = lastDispatchedAtMsRef.current;
      const effectiveLast =
        recorded !== null && dispatched !== null
          ? Math.max(recorded, dispatched)
          : (recorded ?? dispatched);

      if (!hasCooldownElapsed(effectiveLast, focusCooldownMs, now)) {
        return;
      }
      lastDispatchedAtMsRef.current = now;
      onSyncRef.current(trigger);
    };

    const handleFocus = () => {
      trySync("focus");
    };

    const handleVisibilityChange = () => {
      if (!isDocumentHidden()) {
        trySync("focus");
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const timer = window.setInterval(() => {
      trySync("interval");
    }, intervalMs);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(timer);
    };
  }, [enabled, focusCooldownMs, intervalMs]);
}
