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

function matchesTitleOrPath(document: DocumentSummary, query: string) {
  const normalizedQuery = query.toLocaleLowerCase();
  return (
    document.title.toLocaleLowerCase().includes(normalizedQuery) ||
    document.path.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function DocumentSearch({
  query,
  documents,
  results,
  searchStatus,
  searchError,
  onQueryChange,
  onSelectDocument,
  onSelectResult,
  onRetry,
  toolbarAction,
}: DocumentSearchProps) {
  const isSearching = query.trim().length > 0;
  const isAwaitingSearch =
    isSearching && searchStatus !== "ready" && searchStatus !== "error";
  const bodySearchUnavailable =
    isSearching &&
    searchStatus === "error" &&
    searchError?.code === "document_index_unavailable";
  const searchFailed =
    isSearching && searchStatus === "error" && searchError !== null && !bodySearchUnavailable;
  const titleAndPathMatches = isSearching
    ? documents.filter((document) => matchesTitleOrPath(document, query))
    : documents;
  const items =
    !isSearching || searchStatus === "ready"
      ? isSearching ? results : documents
      : searchFailed
        ? []
        : titleAndPathMatches;

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

      <div className="document-search__results">
        {searchFailed ? (
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
            <p>검색 결과를 불러오지 못했습니다.</p>
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
