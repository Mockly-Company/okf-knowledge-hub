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
    await user.click(await screen.findByRole("button", { name: "다시 시도" }));

    const cloneCalls = gateway.calls.filter((call) => call.method === "cloneRepository");
    expect(cloneCalls).toHaveLength(2);
    expect(cloneCalls[1]?.args).toEqual(cloneCalls[0]?.args);
  });
});
