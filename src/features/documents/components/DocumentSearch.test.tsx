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
  it("keeps title and path results available while body indexing is preparing", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(<KeyboardSearchHarness onQueryChange={onQueryChange} />);

    expect(screen.queryByText("본문 검색을 준비하는 중… 3/100")).not.toBeInTheDocument();
    expect(screen.getByText("지도 API")).toBeVisible();
    expect(screen.getByText("docs/api/map.md")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "문서 검색" }), "api");
    expect(screen.getByRole("searchbox", { name: "문서 검색" })).toHaveValue("api");
    expect(onQueryChange).toHaveBeenCalledWith("api");
    expect(screen.getByRole("button", { name: /지도 API/ })).toBeVisible();
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

  it("falls back to title and path results when body search is unavailable", () => {
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

    expect(screen.getByRole("button", { name: /지도 API/ })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a generic retryable message only when the entire search fails", () => {
    render(
      <DocumentSearch
        query="api"
        documents={[document]}
        results={[]}
        searchStatus="error"
        searchError={{
          code: "github_unavailable",
          message: "internal gateway details",
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

    expect(screen.getByRole("alert")).toHaveTextContent("검색 결과를 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: "검색 다시 시도" })).toBeVisible();
  });

  it("groups documents by domain by default and supports switching view mode and category filters", async () => {
    const user = userEvent.setup();
    const docs: DocumentSummary[] = [
      {
        path: "docs/domains/documents/prd.md",
        fileName: "prd.md",
        title: "Documents PRD",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Product Spec",
        domain: "documents",
        hasCompanionHtml: true,
        modifiedAtUnixMs: 1,
        size: 100,
      },
      {
        path: "docs/domains/dashboard/screen-spec.md",
        fileName: "screen-spec.md",
        title: "Dashboard 화면명세서",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Screen Spec",
        domain: "dashboard",
        hasCompanionHtml: false,
        modifiedAtUnixMs: 1,
        size: 100,
      },
    ];
    const onNewDocumentInFolder = vi.fn();

    render(
      <DocumentSearch
        query=""
        documents={docs}
        results={[]}
        searchStatus="idle"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
        onNewDocumentInFolder={onNewDocumentInFolder}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Documents (문서)" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Dashboard (대시보드)" })).toBeVisible();
    expect(screen.getByText("HTML")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "docs/domains/documents 폴더에 새 문서" }));
    expect(onNewDocumentInFolder).toHaveBeenCalledWith("docs/domains/documents");

    await user.click(screen.getByRole("button", { name: "문서 유형별" }));
    expect(screen.getByRole("heading", { level: 2, name: "기획 · PRD" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "화면명세" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "전체 목록" }));
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "가이드" }));
    expect(screen.getByText("선택한 분류에 해당하는 문서가 없습니다.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByText("Documents PRD")).toBeVisible();
    expect(screen.getByText("Dashboard 화면명세서")).toBeVisible();
  });

  it("applies the active category filter to search results and title/path matches during search", async () => {
    const user = userEvent.setup();
    const docs: DocumentSummary[] = [
      {
        path: "docs/domains/documents/prd.md",
        fileName: "prd.md",
        title: "Documents PRD",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Product Spec",
        domain: "documents",
        modifiedAtUnixMs: 1,
        size: 100,
      },
      {
        path: "docs/domains/dashboard/screen-spec.md",
        fileName: "screen-spec.md",
        title: "Dashboard 화면명세서",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Screen Spec",
        domain: "dashboard",
        modifiedAtUnixMs: 1,
        size: 100,
      },
    ];
    const searchHits: SearchResult[] = [
      {
        path: "docs/domains/documents/prd.md",
        title: "Documents PRD",
        matchField: "body",
        matchText: "명세",
        snippet: "Documents PRD 본문 명세",
      },
      {
        path: "docs/domains/dashboard/screen-spec.md",
        title: "Dashboard 화면명세서",
        matchField: "body",
        matchText: "명세",
        snippet: "Dashboard 화면명세서 본문",
      },
    ];

    const view = render(
      <DocumentSearch
        query="docs"
        documents={docs}
        results={searchHits}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "기획 · PRD" }));
    expect(screen.getByRole("button", { name: /Documents PRD/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Dashboard 화면명세서/ })).toBeNull();

    // indexing fallback 상태에서도 선택한 카테고리 필터가 동일하게 유지되는지 검증
    view.rerender(
      <DocumentSearch
        query="docs"
        documents={docs}
        results={[]}
        searchStatus="loading"
        searchError={null}
        indexStatus={{ status: "preparing", indexed: 1, total: 2 }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Documents PRD/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Dashboard 화면명세서/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "전체" }));
    expect(screen.getByRole("button", { name: /Dashboard 화면명세서/ })).toBeVisible();
  });

  it("shows 검색 결과가 없습니다 instead of category empty state when a search query matches nothing in any category", async () => {
    const user = userEvent.setup();
    const docs: DocumentSummary[] = [
      {
        path: "docs/domains/documents/prd.md",
        fileName: "prd.md",
        title: "Documents PRD",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Product Spec",
        domain: "documents",
        modifiedAtUnixMs: 1,
        size: 100,
      },
      {
        path: "docs/domains/dashboard/screen-spec.md",
        fileName: "screen-spec.md",
        title: "Dashboard 화면명세서",
        documentId: null,
        frontmatterStatus: { status: "valid" },
        docType: "Screen Spec",
        domain: "dashboard",
        modifiedAtUnixMs: 1,
        size: 100,
      },
    ];
    const screenSpecHit: SearchResult = {
      path: "docs/domains/dashboard/screen-spec.md",
      title: "Dashboard 화면명세서",
      matchField: "body",
      matchText: "화면명세",
      snippet: "Dashboard 화면명세 본문",
    };

    const view = render(
      <DocumentSearch
        query="없는검색어"
        documents={docs}
        results={[]}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "기획 · PRD" }));
    expect(screen.getByText("검색 결과가 없습니다.")).toBeVisible();
    expect(screen.queryByText("선택한 분류에 해당하는 문서가 없습니다.")).toBeNull();

    // fallback(본문 인덱스 미준비) 상태에서도 전체 일치 결과가 0건이면 검색 결과 없음을 우선 표시
    view.rerender(
      <DocumentSearch
        query="없는검색어"
        documents={docs}
        results={[]}
        searchStatus="error"
        searchError={{
          code: "document_index_unavailable",
          message: "검색 불가",
          recovery: "retry",
          details: {},
        }}
        indexStatus={{ status: "preparing", indexed: 0, total: 2 }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("검색 결과가 없습니다.")).toBeVisible();
    expect(screen.queryByText("선택한 분류에 해당하는 문서가 없습니다.")).toBeNull();

    // 다른 분류에 일치 결과가 있는 경우에는 필터 안내 및 초기화 버튼을 표시
    view.rerender(
      <DocumentSearch
        query="화면명세"
        documents={docs}
        results={[screenSpecHit]}
        searchStatus="ready"
        searchError={null}
        indexStatus={{ status: "ready" }}
        onQueryChange={() => {}}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("선택한 분류에 해당하는 문서가 없습니다.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByRole("button", { name: /Dashboard 화면명세서/ })).toBeVisible();
  });
});
