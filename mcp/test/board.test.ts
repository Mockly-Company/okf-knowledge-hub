import { describe, expect, it } from "vitest";
import {
  listProjectItems,
  mapLayer,
  mapStatus,
  toBoardIssues,
  type RawItem,
} from "../src/board.js";
import type { GhRunner } from "../src/gh.js";

const BOARD_PAGE = {
  data: {
    organization: {
      projectV2: {
        items: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              content: {
                __typename: "Issue",
                number: 12,
                title: "기획서 초안",
                url: "https://example.test/issues/12",
                labels: { nodes: [] },
                subIssues: {
                  nodes: [
                    {
                      number: 13,
                      title: "하위 작업",
                      url: "https://example.test/issues/13",
                    },
                  ],
                },
              },
              fieldValues: {
                nodes: [
                  {
                    __typename: "ProjectV2ItemFieldSingleSelectValue",
                    name: "Backlog",
                    field: { name: "Status" },
                  },
                  {
                    __typename: "ProjectV2ItemFieldSingleSelectValue",
                    name: "기획",
                    field: { name: "영역" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
};

function fakeRun(response: unknown): { run: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: GhRunner = async (args: string[]) => {
    calls.push(args);
    return { stdout: JSON.stringify(response) };
  };
  return { run, calls };
}

describe("mapLayer / mapStatus", () => {
  it("영역 필드를 우선하고 없으면 라벨을 본다", () => {
    expect(mapLayer("백엔드", [])).toBe("backend");
    expect(mapLayer("프론트엔드", [])).toBe("frontend");
    expect(mapLayer("프론트", [])).toBe("frontend");
    expect(mapLayer("기획", [])).toBe("planning");
    expect(mapLayer("디자인", [])).toBe("design");
    expect(mapLayer(null, ["layer:design"])).toBe("design");
    expect(mapLayer(null, [])).toBe("unassigned");
    expect(mapStatus("Done")).toBe("done");
    expect(mapStatus("모름")).toBe("backlog");
    expect(mapStatus(null)).toBe("backlog");
  });
});

describe("listProjectItems + toBoardIssues", () => {
  it("에픽 밑에 하위 이슈를 붙이고 루트만 반환한다", async () => {
    const { run } = fakeRun(BOARD_PAGE);
    const raw = await listProjectItems(run, "Mockly-Company", 1, true);
    expect(raw).toHaveLength(1);
    expect(raw[0]?.subIssues).toHaveLength(1);

    const board = toBoardIssues([
      ...raw,
      {
        kind: "Issue",
        number: 13,
        title: "하위 작업",
        url: "https://example.test/issues/13",
        repository: "Mockly-Company/mockly-mobile",
        labels: [],
        status: "Backlog",
        area: "기획",
        kindValue: "작업",
        milestone: null,
        iteration: null,
        subIssues: [],
      } satisfies RawItem,
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]?.children).toHaveLength(1);
    expect(board[0]?.children[0]?.title).toBe("하위 작업");
    expect(board[0]?.layer).toBe("planning");
  });

  it("에러 응답이면 의미를 살려서 던진다", async () => {
    const { run } = fakeRun({
      data: null,
      errors: [{ type: "FORBIDDEN", message: "Resource not accessible" }],
    });
    await expect(
      listProjectItems(run, "Mockly-Company", 1, true),
    ).rejects.toThrow(/읽을 권한/);
  });
});
