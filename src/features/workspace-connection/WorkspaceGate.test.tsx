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
  it("shows an accessible busy state while the account is loading", () => {
    renderGate(FakeWorkspaceConnectionGateway.disconnected());

    expect(screen.getByRole("status", { name: "앱을 준비하는 중" })).toBeInTheDocument();
  });

  it("opens the app without a connection step when signed out", async () => {
    renderGate(FakeWorkspaceConnectionGateway.disconnected());

    expect(
      await screen.findByRole("heading", { name: "프로젝트 진행 상황" }),
    ).toBeInTheDocument();
  });

  it("opens the app for a signed-in account", async () => {
    renderGate(FakeWorkspaceConnectionGateway.connected());

    expect(
      await screen.findByRole("heading", { name: "프로젝트 진행 상황" }),
    ).toBeInTheDocument();
  });
});
