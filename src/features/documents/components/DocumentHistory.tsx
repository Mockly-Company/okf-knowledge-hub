import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDocuments } from "../DocumentsProvider";

export function DocumentHistory() {
  const { state, loadHistory, loadMoreHistory, selectDocumentVersion } = useDocuments();

  useEffect(() => {
    if (state.historyStatus === "idle") loadHistory();
  }, [loadHistory, state.historyStatus]);

  return (
    <section className="document-history" aria-label="문서 History">
      <h2>History</h2>
      {state.historyStatus === "loading" || state.historyStatus === "queued" ? <p>이력을 불러오는 중…</p> : null}
      {state.historyStatus === "error" ? <p>이력을 불러오지 못했습니다.</p> : null}
      {state.historyItems.length === 0 && state.historyStatus === "ready" ? <p>표시할 변경 이력이 없습니다.</p> : null}
      <ol>
        {state.historyItems.map((item) => (
          <li key={item.commitOid}>
            <button type="button" onClick={() => selectDocumentVersion(item)}>
              <strong>{item.message}</strong>
              <span>{item.shortOid} · {item.authorName}</span>
            </button>
          </li>
        ))}
      </ol>
      {state.historyNextCursor ? (
        <Button variant="secondary" onClick={loadMoreHistory} disabled={state.historyStatus === "loading" || state.historyStatus === "queued"}>
          더 불러오기
        </Button>
      ) : null}
    </section>
  );
}
