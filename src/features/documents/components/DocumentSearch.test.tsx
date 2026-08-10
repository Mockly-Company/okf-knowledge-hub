import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

afterEach(cleanup);

describe("DocumentSearch", () => {
  it("shows title and path results while body indexing is preparing", async () => {
    const onQueryChange = vi.fn();
    render(
      <DocumentSearch
        query=""
        documents={[document]}
        results={[]}
        searchStatus="idle"
        searchError={null}
        indexStatus={{ status: "preparing", indexed: 3, total: 100 }}
        onQueryChange={onQueryChange}
        onSelectDocument={() => {}}
        onSelectResult={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText("본문 검색을 준비하는 중… 3/100")).toBeVisible();
    expect(screen.getByText("지도 API")).toBeVisible();
    expect(screen.getByText("docs/api/map.md")).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "문서 검색" }), {
      target: { value: "api" },
    });
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

    expect(screen.getByText(result.snippet)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /지도 API/ }));
    expect(onSelectResult).toHaveBeenCalledWith(result);
  });
});
