import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardIssue } from "./model";
import { ProjectTree, epicProgress } from "./ProjectTree";

afterEach(() => {
  cleanup();
});

function issue(number: number, children: BoardIssue[] = []): BoardIssue {
  return {
    number,
    title: `항목 ${number}`,
    url: `https://github.com/acme/app/issues/${number}`,
    layer: "backend",
    status: "backlog",
    children,
    kind: "작업",
  };
}

describe("ProjectTree", () => {
  it("stops at URL cycles from polluted caches", () => {
    // A → B → A'(A와 같은 URL의 별개 객체)
    const root = issue(1, [issue(2, [issue(1, [issue(2)])])]);

    render(<ProjectTree issues={[root]} />);

    expect(
      screen.getByRole("article", { name: "에픽 #1 항목 1" }),
    ).toBeInTheDocument();
    expect(epicProgress(root).total).toBe(2);
  });

  it("drops non-issue entries and links only safe GitHub URLs", () => {
    const unsafe = { ...issue(3), url: "javascript:alert(1)" };
    const polluted = issue(1, [
      issue(2),
      unsafe,
      null as unknown as BoardIssue,
    ]);

    render(<ProjectTree issues={[polluted]} />);

    expect(screen.getByRole("link", { name: "태스크 #2 항목 2" })).toHaveAttribute(
      "href",
      "https://github.com/acme/app/issues/2",
    );
    expect(
      screen.queryByRole("link", { name: "태스크 #3 항목 3" }),
    ).not.toBeInTheDocument();
  });

  it("marks children cut by the backend", () => {
    render(
      <ProjectTree issues={[{ ...issue(1, [issue(2)]), childrenTruncated: true }]} />,
    );

    expect(screen.getByText("하위 항목 생략됨")).toBeInTheDocument();
  });
});
