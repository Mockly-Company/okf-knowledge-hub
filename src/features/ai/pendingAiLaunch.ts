import { useSyncExternalStore } from "react";
import type { AiTaskLaunchRequest } from "./AiGateway";
import type { BoardLayer } from "@/features/project-board/model";

export interface PendingAiLaunchContext {
  request: AiTaskLaunchRequest;
  label: string;
  layer?: BoardLayer;
  targetDescription?: string;
}

let currentPendingLaunch: PendingAiLaunchContext | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function setPendingAiLaunch(context: PendingAiLaunchContext | null): void {
  currentPendingLaunch = context;
  notify();
}

export function getPendingAiLaunch(): PendingAiLaunchContext | null {
  return currentPendingLaunch;
}

export function clearPendingAiLaunch(): void {
  if (currentPendingLaunch !== null) {
    currentPendingLaunch = null;
    notify();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingAiLaunch(): PendingAiLaunchContext | null {
  return useSyncExternalStore(
    subscribe,
    getPendingAiLaunch,
    getPendingAiLaunch,
  );
}
