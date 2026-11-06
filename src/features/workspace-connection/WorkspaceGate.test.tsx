import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import {
  useWorkspaceConnection,
  WorkspaceConnectionProvider,
} from "./WorkspaceConnectionProvider";
import { WorkspaceGate } from "./WorkspaceGate";

afterEach(cleanup);

function renderGate(
  gateway: FakeWorkspaceConnectionGateway,
  probe?: ReactNode,
) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <MemoryRouter>
        <Routes>
          <Route element={<WorkspaceGate />}>
            <Route
              index
              element={
                <>
                  {probe}
                  <h1>프로젝트 진행 상황</h1>
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </WorkspaceConnectionProvider>,
  );
}

function ReplacementProbe() {
  const connection = useWorkspaceConnection();
  return (
    <button type="button" onClick={() => void connection.startReplacement()}>
      다른 저장소 연결
    </button>
  );
}

describe("WorkspaceGate", () => {
  it("shows an accessible busy state while the saved workspace is loading", () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.deferCurrentWorkspace();

    renderGate(gateway);

    expect(screen.getByRole("status", { name: "워크스페이스 확인 중" })).toBeInTheDocument();
  });

  it("shows application content instead of the connection flow when no workspace is saved", async () => {
    renderGate(FakeWorkspaceConnectionGateway.disconnected());

    expect(
      await screen.findByRole("heading", { name: "프로젝트 진행 상황" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "GitHub에 연결" }),
    ).not.toBeInTheDocument();
  });

  it("shows the connection flow while a replacement is in progress", async () => {
    const user = userEvent.setup();
    renderGate(
      FakeWorkspaceConnectionGateway.connected(),
      <ReplacementProbe />,
    );

    await user.click(
      await screen.findByRole("button", { name: "다른 저장소 연결" }),
    );

    expect(
      await screen.findByRole("heading", { name: "OKF 저장소 선택" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "프로젝트 진행 상황" }),
    ).not.toBeInTheDocument();
  });

  it("opens routed content only for a connected workspace", async () => {
    renderGate(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeInTheDocument();
  });
});
