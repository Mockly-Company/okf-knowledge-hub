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

  it("propagates remembered-workspace failures instead of hiding them", async () => {
    const failure = { message: "기억된 프로젝트 저장소 정보를 읽을 수 없습니다." };
    const gateway = new TauriWorkspaceConnectionGateway(async () => {
      throw failure;
    });

    await expect(gateway.getWorkspaceForProject("id")).rejects.toBe(failure);
    await expect(gateway.setWorkspaceForProject("id", "/repo")).rejects.toBe(failure);
    await expect(gateway.listRememberedWorkspaces()).rejects.toBe(failure);
  });

  it("sends camelCase projectId to the remembered-workspace commands (Tauri macro default)", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriWorkspaceConnectionGateway(async (command, args) => {
      calls.push({ command, args });
      if (command === "get_workspace_for_project") {
        return { path: "/work/mockly-knowledge" } as never;
      }
      return undefined as never;
    });

    const remembered = await gateway.getWorkspaceForProject("PVT_kwDOExample");
    await gateway.setWorkspaceForProject(
      "PVT_kwDOExample",
      "/work/mockly-knowledge",
    );

    expect(remembered).toBe("/work/mockly-knowledge");
    expect(calls).toEqual([
      {
        command: "get_workspace_for_project",
        args: { projectId: "PVT_kwDOExample" },
      },
      {
        command: "set_workspace_for_project",
        args: {
          projectId: "PVT_kwDOExample",
          path: "/work/mockly-knowledge",
        },
      },
    ]);
  });
});
