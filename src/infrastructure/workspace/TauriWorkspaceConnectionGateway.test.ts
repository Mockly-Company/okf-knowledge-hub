import { describe, expect, it } from "vitest";
import { TauriWorkspaceConnectionGateway } from "./TauriWorkspaceConnectionGateway";

describe("TauriWorkspaceConnectionGateway", () => {
  it("opens a selected-repository PR through the constrained Rust command", async () => {
    const calls: unknown[] = [];
    const gateway = new TauriWorkspaceConnectionGateway(async (command, args) => { calls.push({ command, args }); return undefined as never; });
    await gateway.openExternal("https://github.com/Mockly-Company/mockly-knowledge/pull/12", "Mockly-Company/mockly-knowledge");
    expect(calls).toEqual([{ command: "open_github_pull_request", args: { url: "https://github.com/Mockly-Company/mockly-knowledge/pull/12", repositoryFullName: "Mockly-Company/mockly-knowledge" } }]);
  });

  it.each([
    "https://evil.test/Mockly-Company/mockly-knowledge/pull/1",
    "http://github.com/Mockly-Company/mockly-knowledge/pull/1",
    "https://github.com/other/repo/pull/1",
    "https://github.com/Mockly-Company/mockly-knowledge/pull/0",
    "https://github.com/Mockly-Company/mockly-knowledge/pull/1?redirect=evil",
    "https://user@github.com/Mockly-Company/mockly-knowledge/pull/1",
  ])("rejects unapproved external URL %s before invoking native actions", async (url) => {
    const calls: string[] = [];
    const gateway = new TauriWorkspaceConnectionGateway(async (command) => { calls.push(command); return undefined as never; }, undefined, undefined, async () => { calls.push("openUrl"); });
    await expect(gateway.openExternal(url, "Mockly-Company/mockly-knowledge")).rejects.toMatchObject({ code: "github_unavailable" });
    expect(calls).toEqual([]);
  });

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
