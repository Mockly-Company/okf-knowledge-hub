import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { HomeTasks } from "./HomeTasks";

afterEach(cleanup);
const data = {
  status: "ready" as const,
  updatedAt: "2026-10-21T01:30:00Z",
  reviews: [{ id: "review-42", title: "문서 검색 API 검토", repository: "mockly/product", number: 42, requester: "Kim", updatedAt: "2026-10-21T01:00:00Z" }],
  issues: [{ id: "issue-18", title: "검색 결과 키보드 탐색 지원", repository: "mockly/product", number: 18, url: "https://github.com/mockly/product/issues/18", projectStatus: "In progress", updatedAt: "2026-10-21T01:00:00Z" }],
};

describe("HomeTasks", () => {
  it("sorts reviews by oldest request and Issues by earliest deadline while paging independently", async () => {
    const user = userEvent.setup();
    const reviews = Array.from({ length: 7 }, (_, index) => ({ ...data.reviews[0], id: `r-${index}`, title: `리뷰 ${index}`, number: index, requestedAt: `2026-10-${String(index + 10).padStart(2, "0")}T01:00:00Z`, updatedAt: `2026-10-${String(index + 10).padStart(2, "0")}T01:00:00Z` }));
    const issues = Array.from({ length: 6 }, (_, index) => ({ ...data.issues[0], id: `i-${index}`, title: `작업 ${index}`, number: index, dueDate: `2026-10-${24 + index}`, updatedAt: reviews[index].updatedAt }));
    const snapshot = { ...data, reviews, issues };
    const { rerender } = render(<HomeTasks data={snapshot} onOpenReview={() => {}} />);
    const reviewPanel = within(screen.getByRole("region", { name: "나에게 요청된 리뷰" }));
    const issuePanel = within(screen.getByRole("region", { name: "내 담당 Issue" }));
    expect(reviewPanel.getAllByRole("listitem")).toHaveLength(5);
    expect(reviewPanel.getAllByRole("listitem")[0]).toHaveTextContent("리뷰 0");
    expect(issuePanel.getAllByRole("listitem")[0]).toHaveTextContent("작업 0");
    expect(within(reviewPanel.getAllByRole("listitem")[0]).getByRole("time")).toHaveAttribute("dateTime", reviews[0].requestedAt);
    expect(reviewPanel.getAllByRole("listitem")[0].querySelector(".home-task-row__date")).not.toHaveTextContent("요청");
    expect(within(issuePanel.getAllByRole("listitem")[0]).getByRole("time")).toHaveAttribute("dateTime", "2026-10-24");
    expect(reviewPanel.getByRole("button", { name: "이전 페이지" })).toBeDisabled();
    await user.click(reviewPanel.getByRole("button", { name: "다음 페이지" }));
    expect(reviewPanel.getByText("6–7 / 7개")).toBeInTheDocument();
    expect(reviewPanel.getAllByRole("listitem")).toHaveLength(2);
    expect(reviewPanel.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
    expect(issuePanel.getByText("1–5 / 6개")).toBeInTheDocument();
    expect(reviews[0].id).toBe("r-0");
    rerender(<HomeTasks data={{ ...snapshot, updatedAt: "2026-10-22T00:00:00Z", reviews: reviews.slice(3) }} onOpenReview={() => {}} />);
    expect(reviewPanel.queryByText("6–7 / 7개")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "나에게 요청된 리뷰" })).getAllByRole("listitem")).toHaveLength(4);
  });
  it("puts missing or invalid deadlines and request times last without using update time as a substitute", () => {
    render(<HomeTasks data={{ ...data,
      reviews: [{ ...data.reviews[0], id: "unknown", title: "요청 시각 모름", updatedAt: "2000-01-01T00:00:00Z" }, { ...data.reviews[0], id: "known", title: "요청 시각 있음", requestedAt: "2026-10-20T00:00:00Z" }],
      issues: [{ ...data.issues[0], id: "invalid", title: "날짜 오류", dueDate: "invalid" }, { ...data.issues[0], id: "none", title: "마감일 미지정" }, { ...data.issues[0], id: "due", title: "마감 임박", dueDate: "2026-10-24" }],
    }} onOpenReview={() => {}} />);
    expect(within(screen.getByRole("region", { name: "나에게 요청된 리뷰" })).getAllByRole("listitem")[0]).toHaveTextContent("요청 시각 있음");
    expect(within(screen.getByRole("region", { name: "내 담당 Issue" })).getAllByRole("listitem")[0]).toHaveTextContent("마감 임박");
    expect(screen.getByText("요청 시각 없음")).toBeVisible();
    expect(screen.getAllByText("마감일 없음")).toHaveLength(2);
  });

  it("uses repository and number as deterministic tie breakers", () => {
    render(<HomeTasks data={{ ...data, reviews: [
      { ...data.reviews[0], id: "b", repository: "z/repo", number: 1 },
      { ...data.reviews[0], id: "a2", repository: "a/repo", number: 2 },
      { ...data.reviews[0], id: "a1", repository: "a/repo", number: 1 },
    ] }} onOpenReview={() => {}} />);
    const rows = within(screen.getByRole("region", { name: "나에게 요청된 리뷰" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("a/repoPR #1");
    expect(rows[1]).toHaveTextContent("a/repoPR #2");
    expect(rows[2]).toHaveTextContent("z/repoPR #1");
  });
  it("opens the selected review and links assigned Issues to their GitHub source", async () => {
    function Journey() {
      const [selected, setSelected] = useState("");
      return selected ? <h1>{selected}</h1> : <HomeTasks data={data} onOpenReview={setSelected} />;
    }
    render(<Journey />);
    const issue = screen.getByRole("link", { name: /검색 결과 키보드 탐색 지원/ });
    expect(issue).toHaveAttribute("href", "https://github.com/mockly/product/issues/18");
    expect(issue).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByText("In progress")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /문서 검색 API 검토/ }));
    expect(screen.getByRole("heading", { name: "review-42" })).toBeInTheDocument();
  });

  it("distinguishes unavailable, loading, failed, and genuinely empty results", () => {
    const { rerender } = render(<HomeTasks data={{ ...data, status: "unavailable" }} />);
    expect(screen.queryByText("요청된 리뷰가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /문서 검색 API 검토/ })).not.toBeInTheDocument();
    rerender(<HomeTasks data={{ ...data, status: "loading" }} />);
    expect(screen.getAllByRole("status")).toHaveLength(2);
    rerender(<HomeTasks data={{ ...data, status: "error" }} />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("요청된 리뷰가 없습니다.")).not.toBeInTheDocument();
    rerender(<HomeTasks data={{ ...data, reviews: [], issues: [] }} />);
    expect(within(screen.getByRole("region", { name: "나에게 요청된 리뷰" })).getByText("요청된 리뷰가 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("담당한 열린 Issue가 없습니다.")).toBeInTheDocument();
  });

  it("labels cached rows as stale without presenting their count as current", () => {
    render(<HomeTasks data={{ ...data, status: "stale" }} onOpenReview={() => {}} />);
    expect(screen.getAllByText(/최신 상태를 확인하지 못했습니다/)).toHaveLength(2);
    expect(screen.getAllByText("저장된 항목 1개")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /문서 검색 API 검토/ })).toBeInTheDocument();
    expect(screen.getAllByRole("time").length).toBeGreaterThan(0);
  });

  it("offers a document entry only after both lists are confirmed empty", async () => {
    function Journey() {
      const [opened, setOpened] = useState(false);
      return opened ? <h1>문서 목록</h1> : <HomeTasks data={{ ...data, reviews: [], issues: [] }} onOpenDocuments={() => setOpened(true)} />;
    }
    render(<Journey />);
    await userEvent.click(screen.getByRole("button", { name: "문서 둘러보기" }));
    expect(screen.getByRole("heading", { name: "문서 목록" })).toBeInTheDocument();
  });
});
