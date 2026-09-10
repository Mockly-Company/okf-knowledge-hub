import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentSummary, SearchResult } from "../model";
import { DocumentSearch } from "./DocumentSearch";

const document: DocumentSummary = {
  path: "docs/api/map.md",
  fileName: "map.md",
  title: "지도 API",
  documentId: null,
  frontmatterStatus: { status: "valid" },
  modifiedAtUnixMs: 1,
  size: 100,
};

const result: SearchResult = {
  path: document.path,
  title: document.title,
  matchField: "body",
  matchText: "응답 DTO",
  snippet: "성공 응답 DTO와 오류 응답을 정의합니다.",
};

function KeyboardSearchHarness({ onQueryChange }: { onQueryChange(query: string): void }) {
  const [query, setQuery] = useState("");

  return (
    <DocumentSearch
      query={query}
      documents={[document]}
      results={[]}
      searchStatus="idle"
      searchError={null}
      indexStatus={{ status: "preparing", indexed: 3, total: 100 }}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        onQueryChange(nextQuery);
      }}
      onSelectDocument={() => {}}
      onSelectResult={() => {}}
      onRetry={() => {}}
    />
  );
}

afterEach(cleanup);

describe("DocumentSearch", () => {
  it("shows title and path results while body indexing is preparing", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(<KeyboardSearchHarness onQueryChange={onQueryChange} />);

    expect(screen.getByText("본문 검색을 준비하는 중… 3/100")).toBeVisible();
    expect(screen.getByText("지도 API")).toBeVisible();
    expect(screen.getByText("docs/api/map.md")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "문서 검색" }), "api");
    expect(screen.getByRole("searchbox", { name: "문서 검색" })).toHaveValue("api");
    expect(onQueryChange).toHaveBeenCalledWith("api");
  });

  it("shows result context and forwards the selected match", async () => {
    const user = userEvent.setup();
    const onSelectResult = vi.fn();
    render(
      <DocumentSearch
        query="api"
        documents={[document]}
        results={[result]}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={onSelectResult}
        onRetry={() => {}}
      />,
    );

    const resultRow = screen.getByRole("button", { name: /지도 API/ });
    expect(resultRow).toHaveTextContent(result.snippet);
    await user.click(resultRow);
    expect(onSelectResult).toHaveBeenCalledWith(result);
  });

  it("emphasizes every matched phrase while preserving snippet ellipses", () => {
    render(
      <DocumentSearch
        query="응답 dto"
        documents={[document]}
        results={[
          {
            ...result,
            snippet: "…응답 DTO를 확인하고 응답 DTO를 기록합니다…",
          },
        ]}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    const matches = screen.getAllByText("응답 DTO");

    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.tagName === "MARK")).toBe(true);
    expect(screen.getByRole("button", { name: /지도 API/ })).toHaveTextContent(
      "…응답 DTO를 확인하고 응답 DTO를 기록합니다…",
    );
  });

  it("does not return to the Documents list while the first search is pending", () => {
    render(
      <DocumentSearch
        query="응답 DTO"
        documents={[document]}
        results={[]}
        searchStatus="idle"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /지도 API/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "검색 중…" })).not.toBeInTheDocument();
    expect(screen.queryByText("검색 결과가 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("문서 찾기")).toHaveAttribute("aria-busy", "true");
  });

  it("does not add a duplicate heading when a search query is active", () => {
    render(
      <DocumentSearch
        query="api"
        documents={[document]}
        results={[result]}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.queryByRole("heading", { name: "검색 결과" })).not.toBeInTheDocument();
  });

  it("renders document results as Documents-specific selectable rows, not fixed Buttons", () => {
    render(
      <DocumentSearch
        query=""
        documents={[document]}
        results={[]}
        searchStatus="idle"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    const row = screen.getByRole("button", { name: /지도 API/ });

    expect(row).toHaveClass("document-search__result-row");
    expect(row).not.toHaveAttribute("data-variant");
  });

  it("keeps retryable search failures inside the affected content region", () => {
    render(
      <DocumentSearch
        query="api"
        documents={[document]}
        results={[]}
        searchStatus="error"
        searchError={{
          code: "document_index_unavailable",
          message: "검색할 수 없습니다.",
          recovery: "retry",
          details: {},
        }}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    const feedback = screen.getByRole("alert");
    expect(feedback).toHaveAttribute("data-feedback-variant", "content");
    expect(feedback).toHaveAttribute("data-feedback-tone", "error");
    expect(feedback).toHaveTextContent("검색할 수 없습니다.");
    expect(
      screen.getByRole("button", { name: "검색 다시 시도" }),
    ).toBeVisible();
  });
});
