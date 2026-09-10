import { FileText, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import type {
  AppError,
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
  searchError: AppError | null;
  indexStatus: IndexStatus;
  onQueryChange(query: string): void;
  onSelectDocument(path: string): void;
  onSelectResult(result: SearchResult): void;
  onRetry(): void;
  toolbarAction?: ReactNode;
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedSnippet({ snippet, matchText }: Pick<SearchResult, "snippet" | "matchText">) {
  if (!matchText) return snippet;

  const expression = new RegExp(`(${escapeRegularExpression(matchText)})`, "gi");
  const segments = snippet.split(expression);

  return segments.map((segment, index) =>
    index % 2 === 1 ? (
      <mark key={`${segment}-${index}`} className="document-search__match">
        {segment}
      </mark>
    ) : (
      segment
    ),
  );
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
  searchError,
  indexStatus,
  onQueryChange,
  onSelectDocument,
  onSelectResult,
  onRetry,
  toolbarAction,
}: DocumentSearchProps) {
  const isSearching = query.trim().length > 0;
  const isAwaitingSearch =
    isSearching && searchStatus !== "ready" && searchStatus !== "error";
  const items = isSearching ? results : documents;

  return (
    <section
      className="document-search"
      aria-label="문서 찾기"
      aria-busy={isAwaitingSearch}
    >
      <div className="document-search__toolbar">
        <div className="document-search__field">
          <Search aria-hidden="true" />
          <Input
            type="search"
            aria-label="문서 검색"
            placeholder="문서 제목, 본문 또는 경로 검색"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
        </div>
        {toolbarAction}
      </div>

      <IndexNotice status={indexStatus} />

      <div className="document-search__results">
        {isSearching && searchStatus === "error" && searchError ? (
          <StatusFeedback
            variant="content"
            tone="error"
            className="document-search__error"
            action={searchError.recovery === "retry" ? (
              <Button variant="secondary" onClick={onRetry}>
                검색 다시 시도
            </Button>
          ) : undefined}
          >
            <p>{searchError.message}</p>
          </StatusFeedback>
        ) : isAwaitingSearch && items.length === 0 ? null : items.length === 0 ? (
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
                  <UnstyledButton
                    className="document-search__result-row"
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
                      {result?.snippet ? (
                        <span>
                          <HighlightedSnippet
                            snippet={result.snippet}
                            matchText={result.matchText}
                          />
                        </span>
                      ) : null}
                    </span>
                  </UnstyledButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
