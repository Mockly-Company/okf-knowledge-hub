import { cleanup, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { WorkspaceConnectionProvider } from "./WorkspaceConnectionProvider";
import { WorkspaceGate } from "./WorkspaceGate";

afterEach(cleanup);

function renderGate(gateway: FakeWorkspaceConnectionGateway) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <MemoryRouter>
        <Routes>
          <Route element={<WorkspaceGate />}>
            <Route index element={<h1>프로젝트 진행 상황</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </WorkspaceConnectionProvider>,
  );
}

describe("WorkspaceGate", () => {
  it("restores Home on startup while preserving subsequent connected navigation", async () => {
    render(<WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}><MemoryRouter initialEntries={["/settings"]}><Routes><Route element={<WorkspaceGate />}><Route index element={<><h1>Home restored</h1><Link to="/settings">Go settings</Link></>} /><Route path="settings" element={<h1>Settings</h1>} /></Route></Routes></MemoryRouter></WorkspaceConnectionProvider>);
    await screen.findByRole("heading", { name: "Home restored" });
    await userEvent.click(screen.getByRole("link", { name: "Go settings" }));
    await screen.findByRole("heading", { name: "Settings" });
  });

  it("ends loading after a partial subscription failure and retries both listeners", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.authSubscriptionError = new Error("listener unavailable");
    renderGate(gateway);
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    expect(screen.queryByRole("status", { name: "워크스페이스 확인 중" })).toBeNull();
    expect(gateway.listenerCount()).toEqual({ auth: 0, clone: 0 });
    expect(screen.queryByRole("button", { name: "GitHub 로그인" })).toBeNull();
    gateway.authSubscriptionError = null;
    await userEvent.click(retry);
    await screen.findByRole("button", { name: "GitHub 로그인" });
    expect(gateway.listenerCount()).toEqual({ auth: 1, clone: 1 });
  });

  it("shows an accessible busy state while the saved workspace is loading", () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.deferCurrentWorkspace();

    renderGate(gateway);

    expect(screen.getByRole("status", { name: "워크스페이스 확인 중" })).toBeInTheDocument();
  });

  it("shows the connection flow instead of application content when no workspace is saved", async () => {
    renderGate(FakeWorkspaceConnectionGateway.disconnected());

    expect(await screen.findByRole("heading", { name: "GitHub에 연결" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "프로젝트 진행 상황" })).not.toBeInTheDocument();
  });

  it("opens routed content only for a connected workspace", async () => {
    renderGate(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeInTheDocument();
  });
});
