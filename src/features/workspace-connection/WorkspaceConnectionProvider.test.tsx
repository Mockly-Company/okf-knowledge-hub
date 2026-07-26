import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { WorkspaceConnectionProvider, useWorkspaceConnection } from "./WorkspaceConnectionProvider";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";

afterEach(cleanup);

function Probe() {
  const connection = useWorkspaceConnection();
  return (
    <>
      <output>{`${connection.state.step}:${connection.state.status}`}</output>
      <button onClick={() => void connection.startLogin()}>login</button>
      <button onClick={() => {
        void connection.startLogin();
        void connection.startLogin();
      }}>login twice</button>
      <button onClick={() => void connection.retryLastAction()}>retry</button>
    </>
  );
}

describe("WorkspaceConnectionProvider", () => {
  it("subscribes before commands and tears down both event listeners", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const view = render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <Probe />
      </WorkspaceConnectionProvider>,
    );
    await waitFor(() => expect(gateway.listenerCount()).toEqual({ auth: 1, clone: 1 }));

    await userEvent.click(screen.getByRole("button", { name: "login" }));
    expect(gateway.calls.find((call) => call.method === "beginGithubAuth")).toBeDefined();

    view.unmount();
    expect(gateway.listenerCount()).toEqual({ auth: 0, clone: 0 });
  });

  it.each([
    ["auth", "clone"],
    ["clone", "auth"],
  ] as const)("cleans up the installed listener when %s setup rejects after %s", async (rejecting, _installed) => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    if (rejecting === "auth") gateway.authSubscriptionError = new Error("auth listener failed");
    else gateway.cloneSubscriptionError = new Error("clone listener failed");
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <Probe />
      </WorkspaceConnectionProvider>,
    );

    await waitFor(() => {
      expect(gateway.authSubscriptionAttempts).toBe(1);
      expect(gateway.cloneSubscriptionAttempts).toBe(1);
    });
    await waitFor(() => expect(gateway.listenerCount()).toEqual({ auth: 0, clone: 0 }));
    expect(gateway.calls.filter((call) => call.method === "getCurrentWorkspace")).toHaveLength(0);
    expect(gateway.calls.filter((call) => call.method === "getAuthState")).toHaveLength(0);
  });

  it("owns the auth id before invocation and keeps an early terminal event terminal", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.deferGithubAuth = true;
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <Probe />
      </WorkspaceConnectionProvider>,
    );
    await waitFor(() => expect(gateway.listenerCount()).toEqual({ auth: 1, clone: 1 }));

    await user.click(screen.getByRole("button", { name: "login" }));
    const authCall = gateway.calls.find((call) => call.method === "beginGithubAuth");
    expect(authCall?.args[0]).toEqual(expect.any(String));

    gateway.approveAuthentication();
    expect(await screen.findByText("repository:idle")).toBeInTheDocument();
    await gateway.resolveGithubAuth();
    expect(screen.getByText("repository:idle")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "listRepositories")).toHaveLength(1);
  });

  it("keeps reducer acceptance monotonic across batched reentrant starts", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.deferGithubAuth = true;
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <Probe />
      </WorkspaceConnectionProvider>,
    );
    await waitFor(() => expect(gateway.listenerCount()).toEqual({ auth: 1, clone: 1 }));

    await user.click(screen.getByRole("button", { name: "login twice" }));
    expect(gateway.calls.filter((call) => call.method === "beginGithubAuth")).toHaveLength(1);
  });

  it("routes only an owned early clone completion into downstream inspection", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.deferClone = true;
    gateway.workspaceInspection = { status: "initialization_required" };
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
        <Probe />
      </WorkspaceConnectionProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));
    const cloneCall = gateway.calls.find((call) => call.method === "cloneRepository");
    const requestId = cloneCall?.args[0];
    expect(requestId).toEqual(expect.any(String));
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);

    gateway.emitClone({
      status: "completed",
      requestId: "stale-clone-id",
      ownershipTargetPath: "/work/mockly-knowledge",
      repository: gateway.repositorySnapshot,
    });
    expect(gateway.calls.filter((call) => call.method === "inspectWorkspace")).toHaveLength(0);

    gateway.emitClone({
      status: "completed",
      requestId: requestId as string,
      ownershipTargetPath: "/work/mockly-knowledge",
      repository: gateway.repositorySnapshot,
    });
    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "inspectWorkspace")).toHaveLength(1),
    );
    await gateway.resolveClone();
    expect(screen.getByText("local:idle")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "inspectWorkspace")).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);
  });

  it("loads an empty first repository page only once after accepted authentication", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.repositories = [];
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <Probe />
      </WorkspaceConnectionProvider>,
    );
    await waitFor(() => expect(gateway.listenerCount()).toEqual({ auth: 1, clone: 1 }));

    await user.click(screen.getByRole("button", { name: "login" }));
    gateway.approveAuthentication();
    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "listRepositories")).toHaveLength(1),
    );
  });

  it("does not connect after an initialization result names a different root", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.workspaceInspection = { status: "initialization_required" };
    gateway.initializationResult = { ...gateway.initializationResult, root: "/other/root" };
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
      </WorkspaceConnectionProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));

    await waitFor(() =>
      expect(gateway.calls.filter((call) => call.method === "initializeWorkspace")).toHaveLength(1),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(gateway.calls.filter((call) => call.method === "connectWorkspace")).toHaveLength(0);
  });

  it("retries a failed clone with a fresh operation id and reducer-held semantic input", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.cloneError = {
      code: "clone_failed",
      message: "clone 실패",
      recovery: "retry",
      details: {},
    };
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
      </WorkspaceConnectionProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));
    await user.click(await screen.findByRole("button", { name: "다시 시도" }));

    const cloneCalls = gateway.calls.filter((call) => call.method === "cloneRepository");
    expect(cloneCalls).toHaveLength(2);
    expect(cloneCalls[1]?.args[0]).not.toBe(cloneCalls[0]?.args[0]);
    expect(cloneCalls[1]?.args.slice(1)).toEqual(cloneCalls[0]?.args.slice(1));
  });
});
