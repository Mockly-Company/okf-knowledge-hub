import { describe, expect, it } from "vitest";
import { TauriWorkspaceConnectionGateway } from "./TauriWorkspaceConnectionGateway";

describe("TauriWorkspaceConnectionGateway", () => {
  it("sends repository identity when making a workspace current", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriWorkspaceConnectionGateway(async (command, args) => {
      calls.push({ command, args });
      return {
        path: "/work/mockly-knowledge",
        status: "connected",
        summary: {
          id: "89bf04ef-df57-4a76-b10a-b33107d8a6c2",
          name: "Mockly",
          schemaVersion: 1,
          documentRoots: ["docs"],
          repositoryCount: 0,
        },
        repository: {
          id: "R_kgDOExample",
          fullName: "Mockly-Company/mockly-knowledge",
        },
      } as never;
    });

    await gateway.connectWorkspace("/work/mockly-knowledge", {
      id: "R_kgDOExample",
      fullName: "Mockly-Company/mockly-knowledge",
    });

    expect(calls).toEqual([
      {
        command: "connect_workspace",
        args: {
          repositoryPath: "/work/mockly-knowledge",
          repositoryId: "R_kgDOExample",
          repositoryFullName: "Mockly-Company/mockly-knowledge",
        },
      },
    ]);
  });
});
