import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
