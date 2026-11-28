import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { WorkspaceConnectionProvider, useWorkspaceConnection } from "./WorkspaceConnectionProvider";

afterEach(cleanup);

function Probe() {
  const connection = useWorkspaceConnection();
  const account = connection.account;
  return (
    <>
      <output aria-label="account">
        {account.status === "authenticated" || account.status === "logging_out"
          ? `${account.status}:${account.user.login}`
          : account.status}
      </output>
      <output aria-label="exposes repository flow">{String("state" in connection)}</output>
      <button onClick={() => void connection.startLogin()}>login</button>
      <button onClick={() => void connection.cancelLogin()}>cancel login</button>
      <button onClick={() => void connection.logoutGithub()}>logout</button>
    </>
  );
}

function renderProvider(gateway: FakeWorkspaceConnectionGateway) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <Probe />
    </WorkspaceConnectionProvider>,
  );
}

describe("WorkspaceConnectionProvider", () => {
  it("loads the GitHub account once and offers only the account", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    renderProvider(gateway);

    expect(await screen.findByText("authenticated:hyeeun")).toBeInTheDocument();
    expect(screen.getByLabelText("exposes repository flow")).toHaveTextContent("false");
    expect(gateway.calls.filter((call) => call.method === "getAuthState")).toHaveLength(1);
  });

  it("signs in with the device flow", async () => {
    const user = userEvent.setup();
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    renderProvider(gateway);
    await screen.findByText("signed_out");

    await user.click(screen.getByRole("button", { name: "login" }));
    expect(await screen.findByText("waiting_for_user")).toBeInTheDocument();
    gateway.approveAuthentication();

    expect(await screen.findByText("authenticated:hyeeun")).toBeInTheDocument();
  });

  it("cancels a pending login", async () => {
    const user = userEvent.setup();
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    renderProvider(gateway);
    await screen.findByText("signed_out");

    await user.click(screen.getByRole("button", { name: "login" }));
    await screen.findByText("waiting_for_user");
    await user.click(screen.getByRole("button", { name: "cancel login" }));

    expect(await screen.findByText("signed_out")).toBeInTheDocument();
    expect(gateway.cancelledAuthRequests).toHaveLength(1);
  });

  it("logs out, and keeps the account when logout fails", async () => {
    const user = userEvent.setup();
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.logoutError = {
      code: "github_unavailable",
      message: "로그아웃하지 못했습니다.",
      recovery: "retry",
      details: {},
    } as never;
    renderProvider(gateway);
    await screen.findByText("authenticated:hyeeun");

    await user.click(screen.getByRole("button", { name: "logout" }));
    expect(await screen.findByText("authenticated:hyeeun")).toBeInTheDocument();

    gateway.logoutError = null;
    await user.click(screen.getByRole("button", { name: "logout" }));
    expect(await screen.findByText("signed_out")).toBeInTheDocument();
  });

  it("stops listening for auth events when unmounted", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    const view = renderProvider(gateway);
    await screen.findByText("authenticated:hyeeun");
    expect(gateway.listenerCount().auth).toBe(1);

    view.unmount();

    await waitFor(() => expect(gateway.listenerCount().auth).toBe(0));
  });

  it("distinguishes initial session restore from interactive login and clears React Query cache on logout", async () => {
    const { createTestQueryClient, TestQueryProvider } = await import(
      "@/test/queryTestUtils"
    );
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["projectBoard", "board", "PVT_alpha"], {
      issues: [],
      fetchedAt: "2026-11-26T00:00:00Z",
    });
    const gateway = FakeWorkspaceConnectionGateway.connected();

    function SessionProbe() {
      const connection = useWorkspaceConnection();
      return (
        <div>
          <output aria-label="session-meta">
            {`${connection.authSessionVersion}:${connection.authSessionOrigin ?? "none"}`}
          </output>
          <button onClick={() => void connection.logoutGithub()}>logout</button>
          <button onClick={() => void connection.startLogin()}>login</button>
        </div>
      );
    }

    render(
      <TestQueryProvider client={queryClient}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SessionProbe />
        </WorkspaceConnectionProvider>
      </TestQueryProvider>,
    );

    expect(await screen.findByLabelText("session-meta")).toHaveTextContent(
      "1:initial",
    );
    expect(
      queryClient.getQueryData(["projectBoard", "board", "PVT_alpha"]),
    ).toBeDefined();

    // Logout clears cached queries from previous session
    await user.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() =>
      expect(screen.getByLabelText("session-meta")).toHaveTextContent("1:none"),
    );
    expect(
      queryClient.getQueryData(["projectBoard", "board", "PVT_alpha"]),
    ).toBeUndefined();

    // Interactive login increments authSessionVersion with origin "login"
    await user.click(screen.getByRole("button", { name: "login" }));
    gateway.approveAuthentication();
    await waitFor(() =>
      expect(screen.getByLabelText("session-meta")).toHaveTextContent("2:login"),
    );
  });
});

