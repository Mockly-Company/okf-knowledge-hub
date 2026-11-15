import { FilePlus2, FileText, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import {
  classifyDocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_ORDER,
  groupDocumentsByCategory,
  groupDocumentsByDomain,
  isAuxiliaryDocument,
  type DocumentCategoryFilter,
  type DocumentGroup,
  type DocumentGroupMode,
} from "../document-taxonomy";
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
  onNewDocumentInFolder?: (folderPath: string) => void;
  toolbarAction?: ReactNode;
}

const GROUP_MODE_OPTIONS: ReadonlyArray<{ mode: DocumentGroupMode; label: string }> = [
  { mode: "domain", label: "도메인별" },
  { mode: "type", label: "문서 유형별" },
  { mode: "flat", label: "전체 목록" },
];

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
  onNewDocumentInFolder,
  toolbarAction,
}: DocumentSearchProps) {
  const [groupMode, setGroupMode] = useState<DocumentGroupMode>("domain");
  const [categoryFilter, setCategoryFilter] =
    useState<DocumentCategoryFilter>("all");

  const documentByPath = useMemo(
    () => new Map(documents.map((doc) => [doc.path, doc])),
    [documents],
  );

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
  const filteredDocuments = useMemo(
    () =>
      categoryFilter === "all"
        ? documents
        : documents.filter(
            (doc) => classifyDocumentCategory(doc) === categoryFilter,
          ),
    [documents, categoryFilter],
  );
  const groupedDocuments: DocumentGroup[] = useMemo(() => {
    if (groupMode === "domain") {
      return groupDocumentsByDomain(filteredDocuments);
    }
    if (groupMode === "type") {
      return groupDocumentsByCategory(filteredDocuments);
    }
    return [];
  }, [filteredDocuments, groupMode]);

  const items: Array<DocumentSummary | SearchResult> = !isSearching
    ? filteredDocuments
    : searchStatus === "ready"
      ? results
      : searchFailed
        ? []
        : titleAndPathMatches;

  const renderResultRow = (item: DocumentSummary | SearchResult) => {
    const result = "matchField" in item ? item : null;
    const summary = "matchField" in item ? documentByPath.get(item.path) : item;
    const docRef = summary ?? {
      path: item.path,
      fileName: item.path.split("/").pop() ?? item.path,
    };
    const category = classifyDocumentCategory(docRef);
    const hasCompanionHtml =
      Boolean(summary?.hasCompanionHtml) && !isAuxiliaryDocument(docRef);

    return (
      <li key={item.path}>
        <UnstyledButton
          className="document-search__result-row"
          onClick={() =>
            result ? onSelectResult(result) : onSelectDocument(item.path)
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
          <span className="document-search__result-badges">
            <span className="document-search__category-badge">
              {DOCUMENT_CATEGORY_LABELS[category]}
            </span>
            {hasCompanionHtml ? (
              <span className="document-search__html-badge">HTML</span>
            ) : null}
          </span>
        </UnstyledButton>
      </li>
    );
  };

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

      {!isSearching && documents.length > 0 ? (
        <div className="document-search__taxonomy">
          <div
            className="document-search__view-switch"
            role="group"
            aria-label="문서 묶음 기준"
          >
            {GROUP_MODE_OPTIONS.map((option) => (
              <UnstyledButton
                key={option.mode}
                type="button"
                className="document-search__mode-chip"
                data-active={groupMode === option.mode}
                aria-pressed={groupMode === option.mode}
                onClick={() => setGroupMode(option.mode)}
              >
                {option.label}
              </UnstyledButton>
            ))}
          </div>
          <div
            className="document-search__category-filters"
            role="group"
            aria-label="문서 종류 필터"
          >
            <UnstyledButton
              type="button"
              className="document-search__filter-chip"
              data-active={categoryFilter === "all"}
              aria-pressed={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            >
              전체
            </UnstyledButton>
            {DOCUMENT_CATEGORY_ORDER.map((category) => (
              <UnstyledButton
                key={category}
                type="button"
                className="document-search__filter-chip"
                data-active={categoryFilter === category}
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
              >
                {DOCUMENT_CATEGORY_LABELS[category]}
              </UnstyledButton>
            ))}
          </div>
        </div>
      ) : null}

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
          !isSearching && documents.length > 0 ? (
            <div className="document-search__filtered-empty">
              <p className="document-search__empty">
                선택한 분류에 해당하는 문서가 없습니다.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCategoryFilter("all")}
              >
                필터 초기화
              </Button>
            </div>
          ) : (
            <p className="document-search__empty">
              {isSearching && searchStatus !== "loading"
                ? "검색 결과가 없습니다."
                : "표시할 문서가 없습니다."}
            </p>
          )
        ) : !isSearching && groupMode !== "flat" ? (
          <div className="document-search__groups">
            {groupedDocuments.map((group) => {
              const folderPath = group.folderPath;
              return (
                <section
                  key={group.key}
                  className="document-search__group"
                  aria-label={group.label}
                >
                  <div className="document-search__group-header">
                    <div className="document-search__group-heading">
                      <h2>{group.label}</h2>
                      <span className="document-search__group-count">
                        {`${group.documents.length}건`}
                      </span>
                    </div>
                    {groupMode === "domain" &&
                    folderPath &&
                    onNewDocumentInFolder ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="document-search__group-action"
                        aria-label={`${folderPath} 폴더에 새 문서`}
                        onClick={() => onNewDocumentInFolder(folderPath)}
                      >
                        <FilePlus2 aria-hidden="true" />
                        폴더에 새 문서
                      </Button>
                    ) : null}
                  </div>
                  <ul>{group.documents.map((doc) => renderResultRow(doc))}</ul>
                </section>
              );
            })}
          </div>
        ) : (
          <ul>{items.map((item) => renderResultRow(item))}</ul>
        )}
      </div>
    </section>
  );
}
