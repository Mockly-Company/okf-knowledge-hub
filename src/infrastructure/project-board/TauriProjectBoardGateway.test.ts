import { describe, expect, it } from "vitest";
import { TauriProjectBoardGateway } from "./TauriProjectBoardGateway";

describe("TauriProjectBoardGateway", () => {
  it("maps the board command to its exact snake_case name", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ command, args });
      return { issues: [], fetchedAt: null, skipped: 0, truncated: false } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(calls).toEqual([{ command: "get_project_board", args: undefined }]);
    expect(board).toEqual({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
  });

  it("maps the sync command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ command, args });
      return {
        issues: [],
        fetchedAt: "2026-10-25T12:00:00+09:00",
        skipped: 0,
        truncated: false,
      } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.syncProjectBoard();

    expect(calls).toEqual([{ command: "sync_project_board", args: undefined }]);
    expect(board.fetchedAt).toBe("2026-10-25T12:00:00+09:00");
  });

  it("drops an unparseable fetchedAt from polluted caches", async () => {
    const invoke = async <T>(): Promise<T> =>
      ({ issues: [], fetchedAt: "not a date", skipped: 0, truncated: false }) as T;
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(board.fetchedAt).toBeNull();
  });

  it("normalizes issues missing kind or children from old caches", async () => {
    const invoke = async <T>(): Promise<T> => {
      return {
        issues: [
          {
            number: 1,
            title: "구 캐시 이슈",
            url: "https://example.test/issues/1",
            layer: "planning",
            status: "backlog",
          },
        ],
        fetchedAt: null,
        skipped: 0,
        truncated: false,
      } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(board.issues[0].children).toEqual([]);
    expect(board.issues[0].kind).toBeNull();
  });

  it("drops non-object entries from polluted caches", async () => {
    const invoke = async <T>(): Promise<T> => {
      return {
        issues: [
          null,
          42,
          {
            number: 2,
            title: "정상 이슈",
            url: "https://example.test/issues/2",
            layer: "planning",
            status: "backlog",
            children: [null, "oops"],
            kind: null,
          },
        ],
        fetchedAt: null,
        skipped: 0,
        truncated: false,
      } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(board.issues).toHaveLength(1);
    expect(board.issues[0].children).toEqual([]);
    // 비객체 원소 4개(최상위 null·42, 자식 null·"oops")가 skipped에 합산된다.
    expect(board.skipped).toBe(4);
  });

  it("counts a shared cut subtree only once across branches", async () => {
    // 두 에픽이 50 깊이 이후에 같은 하위 체인을 공유하는 다이아몬드 오염 캐시.
    // 절단 집계용 전역 집합이 없으면 공유 구간이 분기마다 중복 가산된다.
    const sharedTail = (start: number): unknown[] => {
      const leaf = {
        number: start + 9,
        title: `공유 ${start + 9}`,
        url: `https://example.test/issues/shared-${start + 9}`,
        layer: "planning",
        status: "backlog",
        children: [],
        kind: null,
      };
      let current: unknown = leaf;
      for (let n = start + 8; n >= start; n--) {
        current = {
          number: n,
          title: `공유 ${n}`,
          url: `https://example.test/issues/shared-${n}`,
          layer: "planning",
          status: "backlog",
          children: [current],
          kind: null,
        };
      }
      return [current];
    };
    const chainTo = (prefix: string, length: number, tail: unknown[]): unknown => {
      let head: unknown = tail;
      for (let n = length - 1; n >= 0; n--) {
        head = {
          number: 1000 + n,
          title: `${prefix} ${n}`,
          url: `https://example.test/issues/${prefix}-${n}`,
          layer: "planning",
          status: "backlog",
          children: Array.isArray(head) ? head : [head],
          kind: null,
        };
      }
      return head;
    };
    const tail = sharedTail(9000);
    const invoke = async <T>(): Promise<T> => {
      return {
        issues: [chainTo("a", 51, tail), chainTo("b", 51, tail)],
        fetchedAt: null,
        skipped: 0,
        truncated: false,
      } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(board.truncated).toBe(true);
    // 잘린 노드 자체는 flagged 리프로 렌더되므로, 숨김 집계는 자손만 센다.
    // 공유 꼬리 S1..S9 9개가 두 분기에 걸쳐 있어도 한 번만 합산된다(중복이면 18).
    expect(board.skipped).toBe(9);
  });

  it("maps the project list command", async () => {
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      expect(command).toBe("list_github_projects");
      expect(args).toBeUndefined();
      return {
        projects: [
          {
            id: "PVT_kwDOExample",
            owner: "Mockly-Company",
            number: 1,
            title: "Mockly",
            scope: "organization",
          },
        ],
        truncated: true,
      } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const list = await gateway.listGithubProjects();

    expect(list.projects).toHaveLength(1);
    expect(list.projects[0].title).toBe("Mockly");
    expect(list.truncated).toBe(true);
  });

  it("maps project resolve and link commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> =
      [];
    const invoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ command, args });
      if (command === "resolve_github_project") {
        return {
          id: "PVT_kwDOExample",
          owner: "Mockly-Company",
          number: 1,
          title: "Mockly Board",
          scope: "organization",
        } as T;
      }
      return undefined as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const resolved = await gateway.resolveGithubProject(
      "https://github.com/orgs/Mockly-Company/projects/1",
    );
    await gateway.linkGithubProject(resolved);

    expect(calls).toEqual([
      {
        command: "resolve_github_project",
        args: { url: "https://github.com/orgs/Mockly-Company/projects/1" },
      },
      {
        command: "link_github_project",
        args: {
          project: {
            id: "PVT_kwDOExample",
            owner: "Mockly-Company",
            number: 1,
            title: "Mockly Board",
            scope: "organization",
          },
        },
      },
    ]);
  });
});
