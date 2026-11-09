import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import type {
  DocsRepositoryGateway,
  PullOutcome,
} from "@/features/docs-repository/DocsRepositoryGateway";

/** 앱이 켜져 있는 동안 문서 저장소를 최신으로 받는 간격. */
export const DOCS_PULL_INTERVAL_MS = 300_000;

/** 마지막 받기 결과. Documents 화면의 안내가 읽는다. */
export const docsPullKey = ["docsRepository", "pull"] as const;

/** 시작할 때, 프로젝트를 바꿀 때, 그리고 5분마다 문서 저장소를 최신으로 받는다. */
export function useDocsRepositorySync(gateway: DocsRepositoryGateway): void {
  const activeProjectId = useOptionalActiveProject()?.activeProjectId ?? null;
  const { refresh } = useDocuments();
  const queryClient = useQueryClient();

  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      let outcome: PullOutcome;
      try {
        outcome = await gateway.pull();
      } catch (error) {
        // 네트워크가 끊겼을 수 있다. 다음 주기에 다시 받는다.
        console.warn("[docs-repository] pull failed", error);
        return;
      }
      if (stopped) return;
      queryClient.setQueryData(docsPullKey, outcome);
      if (outcome === "updated") {
        await refresh();
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), DOCS_PULL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeProjectId, gateway, queryClient, refresh]);
}
