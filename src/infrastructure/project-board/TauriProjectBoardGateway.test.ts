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
      return { issues: [], fetchedAt: null } as T;
    };
    const gateway = new TauriProjectBoardGateway(invoke);

    const board = await gateway.getProjectBoard();

    expect(calls).toEqual([{ command: "get_project_board", args: undefined }]);
    expect(board).toEqual({ issues: [], fetchedAt: null });
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
          },
        },
      },
    ]);
  });
});
