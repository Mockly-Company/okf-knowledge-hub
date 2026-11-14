import { describe, expect, it } from "vitest";
import type { BoardIssue } from "./model";
import {
  ASSIGNEE_FILTER_ALL,
  ASSIGNEE_FILTER_UNASSIGNED,
  collectBoardAssignees,
  filterTreeByAssignee,
  formatAssigneeBadgeLabel,
  matchesAssigneeFilter,
} from "./assigneeFilter";

function issue(
  number: number,
  assigns: string[] = [],
  children: BoardIssue[] = [],
  status: BoardIssue["status"] = "ready",
): BoardIssue {
  return {
    number,
    title: `항목 #${number}`,
    url: `https://github.com/Acme/app/issues/${number}`,
    layer: "frontend",
    kind: null,
    status,
    children,
    assignees: assigns.map((login) => ({ login })),
  };
}

describe("assigneeFilter", () => {
  it("collects unique assignees case-insensitively and preserves logged-in user first", () => {
    const issues = [
      issue(1, [], [issue(2, ["bob", "YoonDongGeun"]), issue(3, ["Alice", "bob"])]),
    ];

    const list = collectBoardAssignees(issues, "YoonDongGeun");
    expect(list.map((a) => a.login)).toEqual(["YoonDongGeun", "Alice", "bob"]);
  });

  it("matches all, unassigned, and login filters case-insensitively", () => {
    const assigned = issue(10, ["YoonDongGeun"]);
    const unassigned = issue(11, []);

    expect(matchesAssigneeFilter(assigned, ASSIGNEE_FILTER_ALL)).toBe(true);
    expect(matchesAssigneeFilter(unassigned, ASSIGNEE_FILTER_ALL)).toBe(true);
    expect(matchesAssigneeFilter(unassigned, ASSIGNEE_FILTER_UNASSIGNED)).toBe(true);
    expect(matchesAssigneeFilter(assigned, ASSIGNEE_FILTER_UNASSIGNED)).toBe(false);
    expect(matchesAssigneeFilter(assigned, "yoondonggeun")).toBe(true);
    expect(matchesAssigneeFilter(assigned, "someoneelse")).toBe(false);
  });

  it("keeps parent container nodes in tree view only when descendants match the assignee filter", () => {
    const epic1 = issue(1, [], [issue(2, ["alice"]), issue(3, ["bob"])]);
    const epic2 = issue(4, [], [issue(5, ["bob"])]);

    const filtered = filterTreeByAssignee([epic1, epic2], "alice");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].number).toBe(1);
    expect(filtered[0].children.map((c) => c.number)).toEqual([2]);
  });

  it("formats compact assignee badge summary without duplicating UI strings", () => {
    expect(formatAssigneeBadgeLabel([])).toBe("미배정");
    expect(formatAssigneeBadgeLabel([{ login: "alice" }])).toBe("@alice");
    expect(
      formatAssigneeBadgeLabel([{ login: "alice" }, { login: "bob" }, { login: "carol" }]),
    ).toBe("@alice 외 2");
  });
});
