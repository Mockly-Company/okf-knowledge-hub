import { FileText, Search } from "lucide-react";
import type {
  DocumentSummary,
  IndexStatus,
  SearchResult,
} from "../model";
import type { AsyncStatus } from "../documents-reducer";

interface DocumentSearchProps {
  query: string;
  documents: DocumentSummary[];
  results: SearchResult[];
  searchStatus: AsyncStatus;
  indexStatus: IndexStatus;
  onQueryChange(query: string): void;
  onSelectDocument(path: string): void;
  onSelectResult(result: SearchResult): void;
}

function IndexNotice({ status }: { status: IndexStatus }) {
  if (status.status !== "preparing") return null;
  const progress = status.total > 0 ? ` ${status.indexed}/${status.total}` : "";
  return (
    <p className="document-search__index-status" role="status">
      본문 검색을 준비하는 중…{progress}
    </p>
  );
}

export function DocumentSearch({
  query,
  documents,
  results,
  searchStatus,
  indexStatus,
  onQueryChange,
  onSelectDocument,
  onSelectResult,
}: DocumentSearchProps) {
  const isSearching = query.trim().length > 0;
  const items = isSearching ? results : documents;

  return (
    <section className="document-search" aria-label="문서 찾기">
      <div className="document-search__field">
        <Search aria-hidden="true" />
        <input
          type="search"
          aria-label="문서 검색"
          placeholder="문서 제목, 본문 또는 경로 검색"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </div>

      <IndexNotice status={indexStatus} />

      <div
        className="document-search__results"
        aria-busy={isSearching && searchStatus === "loading"}
      >
        <h2>{isSearching ? "검색 결과" : "모든 문서"}</h2>
        {items.length === 0 ? (
          <p className="document-search__empty">
            {isSearching && searchStatus !== "loading"
              ? "검색 결과가 없습니다."
              : "표시할 문서가 없습니다."}
          </p>
        ) : (
          <ul>
            {items.map((item) => {
              const result = "matchField" in item ? item : null;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() =>
                      result
                        ? onSelectResult(result)
                        : onSelectDocument(item.path)
                    }
                  >
                    <FileText aria-hidden="true" />
                    <span className="document-search__result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.path}</small>
                      {result?.snippet ? <span>{result.snippet}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
