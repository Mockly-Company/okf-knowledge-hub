import { createRef } from "react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { AppSidebar } from "./AppSidebar";

afterEach(cleanup);

function renderSidebar(gateway: FakeWorkspaceConnectionGateway) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <MemoryRouter>
        <AppSidebar collapseButtonRef={createRef()} onCollapse={() => {}} />
      </MemoryRouter>
    </WorkspaceConnectionProvider>,
  );
}

describe("AppSidebar", () => {
  it("shows the connected workspace and authenticated GitHub identity", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByText("Mockly")).toBeInTheDocument();
    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(view.container.querySelector('img[src="https://example.test/avatar.png"]'))
      .toBeInTheDocument();
  });

  it("shows reauthentication without hiding the connected workspace", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    renderSidebar(gateway);

    expect(await screen.findByText("Mockly")).toBeInTheDocument();
    expect(await screen.findByText("GitHub 재로그인 필요")).toBeInTheDocument();
    expect(screen.getByText("Settings에서 연결")).toBeInTheDocument();
  });

  it("falls back to the login initial when the avatar cannot load", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");
    const avatar = view.container.querySelector("img");
    expect(avatar).not.toBeNull();

    fireEvent.error(avatar as HTMLImageElement);

    expect(screen.getByText("H")).toBeInTheDocument();
    expect(view.container.querySelector("img")).not.toBeInTheDocument();
  });

  it("keeps the full workspace name available when visual text is truncated", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    if (gateway.currentWorkspace?.status === "connected") {
      gateway.currentWorkspace.summary = {
        ...gateway.currentWorkspace.summary,
        name: "Mockly Product Knowledge Workspace",
      };
    }
    renderSidebar(gateway);

    expect(
      await screen.findByTitle("Mockly Product Knowledge Workspace"),
    ).toHaveTextContent("Mockly Product Knowledge Workspace");
  });

  it("reserves stable identity space while workspace and account state load", () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.deferCurrentWorkspace();
    renderSidebar(gateway);

    expect(screen.getByLabelText("워크스페이스 불러오는 중")).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub 계정 불러오는 중")).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });
});
