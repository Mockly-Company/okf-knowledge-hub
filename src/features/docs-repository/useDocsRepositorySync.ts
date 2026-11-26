import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useOptionalWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type {
  DocsRepositoryGateway,
  PullOutcome,
} from "@/features/docs-repository/DocsRepositoryGateway";
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  WINDOW_FOCUS_SYNC_COOLDOWN_MS,
  useWindowFocusAndIntervalSync,
} from "@/infrastructure/sync/autoSyncPolicy";

/** 앱이 켜져 있는 동안 문서 저장소를 최신으로 받는 간격. */
export const DOCS_PULL_INTERVAL_MS = BACKGROUND_SYNC_INTERVAL_MS;

/** 마지막 받기 결과. Documents 화면의 안내가 읽는다. */
export const docsPullKey = ["docsRepository", "pull"] as const;

/** 시작할 때, 로그인·프로젝트 전환할 때, 포커스 복귀(60초 쿨다운), 5분마다 문서 저장소를 최신으로 받는다. */
export function useDocsRepositorySync(gateway: DocsRepositoryGateway): void {
  const activeProjectId = useOptionalActiveProject()?.activeProjectId ?? null;
  const authSessionVersion =
    useOptionalWorkspaceConnection()?.authSessionVersion ?? 0;
  const { refresh } = useDocuments();
  const queryClient = useQueryClient();
  const lastPullAtMsRef = useRef<number | null>(null);
  const pullRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let stopped = false;
    // 이전 프로젝트의 결과가 새 프로젝트 화면에 남지 않도록 비운다.
    queryClient.setQueryData(docsPullKey, null);
    lastPullAtMsRef.current = null;
    // 받기가 오래 걸려도 다음 주기와 겹쳐 같은 저장소를 동시에 갱신하지 않는다.
    let pulling = false;
    const pull = async () => {
      if (pulling) return;
      pulling = true;
      lastPullAtMsRef.current = Date.now();
      let outcome: PullOutcome;
      try {
        outcome = await gateway.pull();
      } catch (error) {
        // 네트워크가 끊겼을 수 있다. 다음 주기에 다시 받는다.
        console.warn("[docs-repository] pull failed", error);
        return;
      } finally {
        pulling = false;
      }
      if (stopped) return;
      lastPullAtMsRef.current = Date.now();
      queryClient.setQueryData(docsPullKey, outcome);
      if (outcome === "updated") {
        await refresh();
      }
    };
    pullRef.current = pull;
    void pull();
    return () => {
      stopped = true;
      if (pullRef.current === pull) {
        pullRef.current = null;
      }
    };
  }, [activeProjectId, authSessionVersion, gateway, queryClient, refresh]);

  useWindowFocusAndIntervalSync({
    enabled: true,
    intervalMs: DOCS_PULL_INTERVAL_MS,
    focusCooldownMs: WINDOW_FOCUS_SYNC_COOLDOWN_MS,
    getLastSyncAtMs: () => lastPullAtMsRef.current,
    onSync: () => {
      void pullRef.current?.();
    },
  });
}
