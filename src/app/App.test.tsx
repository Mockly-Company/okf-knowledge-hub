import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the OkHub application landmark", async () => {
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.connected()}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );
    expect(await screen.findByRole("main", { name: "OkHub" })).toBeInTheDocument();
  });

  it("shows connection instead of the shell when no workspace is saved", async () => {
    render(
      <App
        workspaceGateway={FakeWorkspaceConnectionGateway.disconnected()}
        preferencesRepository={new FakePreferencesRepository()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "GitHub에 연결" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "OkHub" })).not.toBeInTheDocument();
  });

  it("connects an existing initialized clone and opens Home", async () => {
    const gateway = FakeWorkspaceConnectionGateway.existingReadyClone();
    const user = userEvent.setup();
    render(<App workspaceGateway={gateway} preferencesRepository={new FakePreferencesRepository()} />);

    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));

    expect(await screen.findByRole("heading", { name: "프로젝트 진행 상황" })).toBeInTheDocument();
  });
});
