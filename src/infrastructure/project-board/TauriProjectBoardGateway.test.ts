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
