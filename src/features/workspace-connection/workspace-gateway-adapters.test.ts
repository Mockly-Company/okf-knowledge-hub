import type { Event } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { TauriWorkspaceConnectionGateway } from "@/infrastructure/workspace/TauriWorkspaceConnectionGateway";
import {
  desktopOnlyError,
  UnavailableWorkspaceConnectionGateway,
} from "@/infrastructure/workspace/UnavailableWorkspaceConnectionGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import type { AuthStatusEvent, GithubRepositorySummary } from "./model/protocol";

function repository(id: string): GithubRepositorySummary {
  return {
    id,
    owner: "Mockly-Company",
    name: `${id}-knowledge`,
    fullName: `Mockly-Company/${id}-knowledge`,
    defaultBranch: "main",
    isEmpty: false,
  };
}

describe("workspace connection gateway adapters", () => {
  it("selects the desktop adapter only when runtime detection succeeds", () => {
    expect(createWorkspaceConnectionGateway(() => true)).toBeInstanceOf(
      TauriWorkspaceConnectionGateway,
    );
    expect(createWorkspaceConnectionGateway(() => false)).toBeInstanceOf(
      UnavailableWorkspaceConnectionGateway,
    );
  });

  it("forwards caller-owned auth and clone ids in exact camelCase command envelopes", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T,>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const responses: Record<string, unknown> = {
        get_current_workspace: null,
        get_auth_state: { status: "signed_out" },
        begin_github_auth: {
          requestId: "auth-operation-1",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
          expiresAtUnix: 2_000,
          intervalSeconds: 5,
        },
        cancel_github_auth: true,
        logout_github: undefined,
        list_github_repositories: { items: [], nextCursor: null },
        clone_repository: { requestId: "clone-operation-1", targetPath: "/work/repo" },
        cancel_repository_clone: true,
      };
      return responses[command] as T;
    };
    const gateway = new TauriWorkspaceConnectionGateway(invoke, async () => () => undefined);

    await gateway.getCurrentWorkspace();
    await gateway.getAuthState();
    expect(await gateway.beginGithubAuth("auth-operation-1")).toMatchObject({
      requestId: "auth-operation-1",
    });
    await gateway.cancelGithubAuth("auth-1");
    await gateway.logoutGithub();
    await gateway.listRepositories("cursor-1");
    expect(
      await gateway.cloneRepository("clone-operation-1", repository("repo-1"), "/work"),
    ).toMatchObject({ requestId: "clone-operation-1" });
    await gateway.cancelRepositoryClone("clone-1");

    expect(calls.map(({ command }) => command)).toEqual([
      "get_current_workspace",
      "get_auth_state",
      "begin_github_auth",
      "cancel_github_auth",
      "logout_github",
      "list_github_repositories",
      "clone_repository",
      "cancel_repository_clone",
    ]);
    expect(calls[2]?.args).toEqual({ requestId: "auth-operation-1" });
    expect(calls[6]?.args).toEqual({
      requestId: "clone-operation-1",
      request: {
        repositoryId: "repo-1",
        fullName: "Mockly-Company/repo-1-knowledge",
        httpsUrl: "https://github.com/Mockly-Company/repo-1-knowledge.git",
        parentDirectory: "/work",
      },
    });
    expect(calls[7]?.args).toEqual({ requestId: "clone-1" });
  });

  it("fake gateway echoes caller-owned operation ids", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const auth = await gateway.beginGithubAuth("auth-operation-1");
    const clone = await gateway.cloneRepository("clone-operation-1", repository("repo-1"), "/work");

    expect(auth.requestId).toBe("auth-operation-1");
    expect(clone.requestId).toBe("clone-operation-1");
  });

  it("uses caller-owned event teardown", async () => {
    const subscriptions: string[] = [];
    const teardowns: string[] = [];
    let authHandler: ((event: Event<AuthStatusEvent>) => void) | undefined;
    const listen = async <T,>(event: string, listener: (event: Event<T>) => void) => {
      subscriptions.push(event);
      authHandler = listener as (event: Event<AuthStatusEvent>) => void;
      return () => teardowns.push(event);
    };
    const gateway = new TauriWorkspaceConnectionGateway(async <T,>() => undefined as T, listen);
    const listener = vi.fn();
    const unlisten = await gateway.onAuthStatus(listener);
    const event: AuthStatusEvent = { status: "waiting_for_user", requestId: "auth-1" };
    authHandler?.({ event: "github-auth-status", id: 1, payload: event });
    unlisten();

    expect(subscriptions).toEqual(["github-auth-status"]);
    expect(listener).toHaveBeenCalledWith(event);
    expect(teardowns).toEqual(["github-auth-status"]);
  });

  it("fails closed in a browser", async () => {
    const gateway = new UnavailableWorkspaceConnectionGateway();
    const expected = desktopOnlyError();
    await expect(gateway.getCurrentWorkspace()).rejects.toEqual(expected);
    await expect(gateway.getAuthState()).rejects.toEqual(expected);
    await expect(gateway.listRepositories()).rejects.toEqual(expected);
  });
});
