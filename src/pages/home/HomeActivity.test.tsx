import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeActivity, type ActivityItem } from "./HomeActivity";

afterEach(cleanup);
const items: ActivityItem[] = Array.from({ length: 7 }, (_, index) => ({ id: `a-${index}`, actor: "Kim", action: "issue_opened", title: `활동 ${index}`, repository: "mockly/product", number: index + 1, occurredAt: `2026-10-${index + 10}T01:00:00Z`, url: `https://github.com/mockly/product/issues/${index + 1}` }));

describe("HomeActivity", () => {
  it("shows only the latest five GitHub events and links to their original target", () => {
    render(<HomeActivity data={{ status: "ready", items }} />);
    const rows = within(screen.getByRole("region", { name: "최근 활동" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("활동 6");
    const title = within(rows[0]).getByText("활동 6");
    const event = rows[0].querySelector(".home-activity-row__event")!;
    expect(title.compareDocumentPosition(event) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[0]).toHaveTextContent("Issue #7");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "https://github.com/mockly/product/issues/7");
    expect(screen.queryByText("활동 0")).not.toBeInTheDocument();
  });

  it("opens an in-app document review when the event is connected to it", async () => {
    function Journey() {
      const [selected, setSelected] = useState("");
      return selected ? <h1>{selected}</h1> : <HomeActivity data={{ status: "ready", items: [{ ...items[0], action: "review_requested", reviewId: "review-42" }] }} onOpenReview={setSelected} />;
    }
    render(<Journey />);
    await userEvent.click(screen.getByRole("button", { name: /활동 0/ }));
    expect(screen.getByRole("heading", { name: "review-42" })).toBeInTheDocument();
  });

  it("does not present failed or cached results as a current empty timeline", () => {
    const { rerender } = render(<HomeActivity data={{ status: "error", items }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    rerender(<HomeActivity data={{ status: "stale", updatedAt: "2026-10-21T00:00:00Z", items }} />);
    expect(screen.getByText(/최신 상태를 확인하지 못했습니다/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    rerender(<HomeActivity data={{ status: "ready", items: [] }} />);
    expect(screen.getByText("최근 활동이 없습니다.")).toBeInTheDocument();
  });
});
