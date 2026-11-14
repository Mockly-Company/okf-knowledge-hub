import { describe, expect, it } from "vitest";
import type { BoardIssue } from "./model";
import {
  buildIssueReadinessIndex,
  filterTreeToReadyOnly,
} from "./readyFilter";

const makeIssue = (
  number: number,
  status: BoardIssue["status"],
  dependsOn: number | null = null,
  children: BoardIssue[] = [],
  url = `https://github.com/Acme-Org/acme-web/issues/${number}`,
): BoardIssue => ({
  number,
  title: `이슈 ${number}`,
  url,
  layer: "backend",
  status,
  children,
  kind: "작업",
  dependsOn,
});

describe("readyFilter", () => {
  it("marks backlog/ready issues with no predecessor or a done predecessor as ready, and surfaces waiting #N otherwise", () => {
    const epic = makeIssue(1, "in_progress", null, [
      makeIssue(10, "done", null),
      makeIssue(11, "backlog", 10),
      makeIssue(12, "backlog", 11),
      makeIssue(13, "ready", null),
      makeIssue(14, "in_progress", null),
    ]);

    const index = buildIssueReadinessIndex([epic]);
    expect(index.getStatus(epic).state).toBe("other");
    expect(index.getStatus(epic.children[0]).state).toBe("other");
    expect(index.getStatus(epic.children[1])).toEqual({
      state: "ready",
      waitingOn: null,
    });
    expect(index.getStatus(epic.children[2])).toEqual({
      state: "blocked",
      waitingOn: 11,
    });
    expect(index.getStatus(epic.children[3])).toEqual({
      state: "ready",
      waitingOn: null,
    });
    expect(index.getStatus(epic.children[4]).state).toBe("other");
  });

  it("resolves cross-repository predecessor Done status when number is unique on the board", () => {
    const planningDone = makeIssue(
      50,
      "done",
      null,
      [],
      "https://github.com/Acme-Org/acme-docs/issues/50",
    );
    const backendWaiting = makeIssue(
      51,
      "backlog",
      50,
      [],
      "https://github.com/Acme-Org/acme-api/issues/51",
    );

    const index = buildIssueReadinessIndex([planningDone, backendWaiting]);
    expect(index.getStatus(backendWaiting)).toEqual({
      state: "ready",
      waitingOn: null,
    });
  });

  it("filters tree to keep ready leaves and epics containing ready descendants", () => {
    const epicWithReady = makeIssue(1, "in_progress", null, [
      makeIssue(10, "done", null),
      makeIssue(11, "backlog", 10),
      makeIssue(12, "backlog", 11),
    ]);
    const epicWithoutReady = makeIssue(2, "in_progress", null, [
      makeIssue(20, "in_progress", null),
      makeIssue(21, "backlog", 20),
    ]);
    const loneReady = makeIssue(30, "backlog", null);

    const index = buildIssueReadinessIndex([
      epicWithReady,
      epicWithoutReady,
      loneReady,
    ]);
    const filtered = filterTreeToReadyOnly(
      [epicWithReady, epicWithoutReady, loneReady],
      index,
    );

    expect(filtered.map((item) => item.number)).toEqual([1, 30]);
    expect(filtered[0].children.map((child) => child.number)).toEqual([11]);
  });
});
