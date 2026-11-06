import { describe, expect, it } from "vitest";
import { LEGACY_BOARD_ID, projectBoardKeys } from "./queryKeys";

describe("projectBoardKeys", () => {
  it("pins stable key shapes for cross-module invalidation", () => {
    expect(projectBoardKeys.all).toEqual(["projectBoard"]);
    expect(projectBoardKeys.linkedProjects).toEqual([
      "projectBoard",
      "linkedProjects",
    ]);
    expect(projectBoardKeys.board("PVT_x")).toEqual([
      "projectBoard",
      "board",
      "PVT_x",
    ]);
    expect(projectBoardKeys.board(null)).toEqual([
      "projectBoard",
      "board",
      null,
    ]);
    expect(LEGACY_BOARD_ID).toBe("legacy");
  });
});
