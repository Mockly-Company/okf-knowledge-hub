import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeInsights, analyzeHomeProject, type ProjectAnalysisSource } from "./HomeInsights";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const item = { id: "one", title: "검색 접근성 개선", repository: "mockly/product", number: 42, url: "https://github.com/mockly/product/pull/42" };
const source: ProjectAnalysisSource = { projectName: "Mockly 제품 개발", asOf: "2026-10-23T00:00:00Z", complete: true,
  pendingReviews: [{ ...item, requestedAt: "2026-10-20T00:00:00Z" }, { ...item, id: "new", requestedAt: "2026-10-21T00:00:00Z" }],
  inProgressIssues: [{ ...item, updatedAt: "2026-10-16T00:00:00Z" }],
  completed: [{ ...item, kind: "pr", completedAt: "2026-10-17T00:00:00Z" }, { ...item, id: "old", kind: "issue", completedAt: "2026-10-15T23:59:59Z" }],
};
describe("HomeInsights", () => {
  it("derives waiting, inactive and recently completed evidence using explicit time windows", () => {
    const result = analyzeHomeProject(source);
    expect(result.groups.map(group => group.items.map(item => item.id))).toEqual([["one"], ["one"], ["one"]]);
    expect(source.pendingReviews).toHaveLength(2);
  });
  it("does not present an incomplete query as zero matching work", () => {
    render(<HomeInsights data={analyzeHomeProject({ ...source, complete: false })} />);
    expect(screen.getByText("분석에 필요한 전체 항목을 확인하지 못했습니다.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /3일 이상/ })).not.toBeInTheDocument();
  });
  it("rejects missing timestamps and excludes future completion events", () => {
    expect(analyzeHomeProject({ ...source, asOf: "invalid" }).incomplete).toBe(true);
    const result = analyzeHomeProject({ ...source, completed: [{ ...item, kind: "pr", completedAt: "2026-10-24T00:00:00Z" }, { ...item, id: "boundary", kind: "issue", completedAt: "2026-10-16T00:00:00Z" }] });
    expect(result.groups[2].items.map(item => item.id)).toEqual(["boundary"]);
  });
  it("shows a concise project summary and item panel while keeping calculation metadata out of the view", async () => {
    render(<HomeInsights data={analyzeHomeProject(source)} />);
    const open = screen.getByRole("button", { name: /3일 이상 기다리는 리뷰/ });
    await userEvent.click(open);
    expect(open).not.toHaveTextContent("항목 보기");
    expect(screen.getByRole("region", { name: "프로젝트 요약" })).toBeVisible();
    const dialog = screen.getByRole("complementary", { name: "3일 이상 기다리는 리뷰" });
    expect(within(dialog).getByRole("link", { name: /검색 접근성 개선/ })).toHaveAttribute("href", item.url);
    expect(within(dialog).queryByText("계산 기준")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/마지막 리뷰 요청 시각/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("time")).toHaveAttribute("dateTime", "2026-10-20T00:00:00Z");
    expect(within(dialog).getByRole("time")).not.toHaveTextContent("2026");
    expect(analyzeHomeProject(source).groups[0].basis).toContain("72시간");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
  it("resizes the desktop panel by keyboard and preserves the chosen width on reopen", async () => {
    render(<HomeInsights data={analyzeHomeProject(source)} />);
    await userEvent.click(screen.getByRole("button", { name: /3일 이상 기다리는 리뷰/ }));
    const handle = screen.getByRole("separator", { name: "분석 패널 너비 조절" });
    const before = Number(handle.getAttribute("aria-valuenow"));
    handle.focus(); await userEvent.keyboard("{ArrowLeft}");
    expect(handle).toHaveAttribute("aria-valuenow", String(before + 16));
    await userEvent.click(screen.getByRole("button", { name: "분석 패널 닫기" }));
    await userEvent.click(screen.getByRole("button", { name: /3일 이상 기다리는 리뷰/ }));
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", String(before + 16));
  });
  it("uses an overlay drawer without a resize handle on narrow screens", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    render(<HomeInsights data={analyzeHomeProject(source)} />);
    const open = screen.getByRole("button", { name: /3일 이상 기다리는 리뷰/ });
    await userEvent.click(open);
    expect(screen.getByRole("dialog", { name: "3일 이상 기다리는 리뷰" })).toBeVisible();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(open).toHaveFocus();
  });
  it("distinguishes disconnected, loading, failed and cached analysis", () => {
    const { rerender } = render(<HomeInsights />);
    expect(screen.getByText("GitHub 분석이 아직 연결되지 않았습니다.")).toBeVisible();
    rerender(<HomeInsights data={{ status: "loading", groups: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("분석 중입니다");
    rerender(<HomeInsights data={{ ...analyzeHomeProject(source), status: "error" }} />);
    expect(screen.queryByRole("button", { name: /3일 이상/ })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeVisible();
    rerender(<HomeInsights data={{ ...analyzeHomeProject(source), status: "stale" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("저장된 분석");
  });
});
