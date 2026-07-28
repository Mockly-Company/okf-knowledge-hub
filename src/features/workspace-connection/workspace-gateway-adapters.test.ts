import type { Event } from "@tauri-apps/api/event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { TauriWorkspaceConnectionGateway } from "@/infrastructure/workspace/TauriWorkspaceConnectionGateway";
import {
  desktopOnlyError,
  UnavailableWorkspaceConnectionGateway,
} from "@/infrastructure/workspace/UnavailableWorkspaceConnectionGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import type { AuthStatusEvent } from "./model/protocol";
import { repository, localRepository, preview, connected } from "./machine/__tests__/connection-test-helpers";

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
        inspect_existing_clone: localRepository(),
        clone_repository: { requestId: "clone-operation-1", targetPath: "/work/repo" },
        cancel_repository_clone: true,
        inspect_workspace: { status: "initialization_required" },
        connect_workspace: connected(),
        preview_workspace_initialization: preview(),
        initialize_workspace: {
          root: "/work/repo",
          branch: "main",
          commitOid: "abc123",
          commitMessage: "chore: initialize OkHub workspace",
          pushed: true,
          draftPullRequestUrl: null,
        },
      };
      return responses[command] as T;
    };
    const gateway = new TauriWorkspaceConnectionGateway(
      invoke,
      async () => () => undefined,
      async () => "/work",
      async () => undefined,
    );

    await gateway.getCurrentWorkspace();
    await gateway.getAuthState();
    expect(await gateway.beginGithubAuth("auth-operation-1")).toMatchObject({
      requestId: "auth-operation-1",
    });
    await gateway.cancelGithubAuth("auth-1");
    await gateway.logoutGithub();
    await gateway.listRepositories("cursor-1");
    await gateway.inspectExistingClone("/work/repo", "repo-1");
    expect(
      await gateway.cloneRepository(
        "clone-operation-1",
        repository("repo-1"),
        "/work",
      ),
    ).toMatchObject({ requestId: "clone-operation-1" });
    await gateway.cancelRepositoryClone("clone-1");
    await gateway.inspectWorkspace("/work/repo");
    await gateway.connectWorkspace("/work/repo", repository("repo-1"));
    await gateway.previewInitialization({
      repositoryPath: "/work/repo",
      workspaceName: "Mockly",
      repositoryId: "repo-1",
      repositoryFullName: "Mockly-Company/repo-1-knowledge",
    });
    await gateway.initializeWorkspace("preview-1");

    expect(calls.map(({ command }) => command)).toEqual([
      "get_current_workspace",
      "get_auth_state",
      "begin_github_auth",
      "cancel_github_auth",
      "logout_github",
      "list_github_repositories",
      "inspect_existing_clone",
      "clone_repository",
      "cancel_repository_clone",
      "inspect_workspace",
      "connect_workspace",
      "preview_workspace_initialization",
      "initialize_workspace",
    ]);
    expect(calls[2]?.args).toEqual({ requestId: "auth-operation-1" });
    expect(calls[7]?.args).toEqual({
      requestId: "clone-operation-1",
      request: {
        repositoryId: "repo-1",
        fullName: "Mockly-Company/repo-1-knowledge",
        httpsUrl: "https://github.com/Mockly-Company/repo-1-knowledge.git",
        parentDirectory: "/work",
      },
    });
    expect(calls[8]?.args).toEqual({ requestId: "clone-1" });
  });

  it("fake gateway echoes caller-owned operation ids", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const auth = await gateway.beginGithubAuth("auth-operation-1");
    const clone = await gateway.cloneRepository(
      "clone-operation-1",
      repository("repo-1"),
      "/work",
    );

    expect(auth.requestId).toBe("auth-operation-1");
    expect(clone.requestId).toBe("clone-operation-1");
    expect(gateway.calls).toContainEqual({
      method: "beginGithubAuth",
      args: ["auth-operation-1"],
    });
    expect(gateway.calls).toContainEqual({
      method: "cloneRepository",
      args: ["clone-operation-1", repository("repo-1"), "/work"],
    });
  });

  it("uses exact dialog options and caller-owned event teardown", async () => {
    const choose = vi.fn(async () => "/selected");
    const subscriptions: string[] = [];
    const teardowns: string[] = [];
    const openedPaths: string[] = [];
    let authHandler: ((event: Event<AuthStatusEvent>) => void) | undefined;
    const listen = async <T,>(event: string, listener: (event: Event<T>) => void) => {
      subscriptions.push(event);
      authHandler = listener as (event: Event<AuthStatusEvent>) => void;
      return () => teardowns.push(event);
    };
    const gateway = new TauriWorkspaceConnectionGateway(
      async <T,>() => undefined as T,
      listen,
      choose,
      async () => undefined,
      async (path) => {
        openedPaths.push(path);
      },
    );
    const listener = vi.fn();
    const unlisten = await gateway.onAuthStatus(listener);
    const event: AuthStatusEvent = { status: "waiting_for_user", requestId: "auth-1" };
    authHandler?.({ event: "github-auth-status", id: 1, payload: event });
    unlisten();

    await expect(gateway.pickDirectory()).resolves.toBe("/selected");
    await gateway.openPath("/work/mockly-knowledge/.okf/workspace.yml");
    expect(choose).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(subscriptions).toEqual(["github-auth-status"]);
    expect(listener).toHaveBeenCalledWith(event);
    expect(teardowns).toEqual(["github-auth-status"]);
    expect(openedPaths).toEqual(["/work/mockly-knowledge/.okf/workspace.yml"]);
  });

  it("fails closed in a browser", async () => {
    const gateway = new UnavailableWorkspaceConnectionGateway();
    const expected = desktopOnlyError();
    await expect(gateway.getCurrentWorkspace()).rejects.toEqual(expected);
    await expect(gateway.getAuthState()).rejects.toEqual(expected);
    await expect(gateway.listRepositories()).rejects.toEqual(expected);
    await expect(
      gateway.connectWorkspace("/work/repo", repository("repo-1")),
    ).rejects.toEqual(expected);
    await expect(gateway.openPath("/work/repo/.okf/workspace.yml")).rejects.toEqual(expected);
  });
});
