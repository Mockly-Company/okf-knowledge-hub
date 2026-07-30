import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { WorkspaceConnectionProvider } from "../WorkspaceConnectionProvider";
import { GitHubAccountPanel } from "./GitHubAccountPanel";

afterEach(cleanup);

function renderPanel(gateway = FakeWorkspaceConnectionGateway.connected()) {
  const view = render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <GitHubAccountPanel />
    </WorkspaceConnectionProvider>,
  );
  return { ...view, gateway, user: userEvent.setup() };
}

describe("GitHubAccountPanel", () => {
  it("shows the authenticated account and logout action", async () => {
    renderPanel();

    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });

  it("falls back to the login initial when the avatar cannot load", async () => {
    const { container } = renderPanel();
    await screen.findByText("@hyeeun");

    const avatar = container.querySelector(".github-account-card__identity img");
    expect(avatar).not.toBeNull();
    fireEvent.error(avatar as HTMLImageElement);

    expect(container.querySelector(".github-account-card__identity img")).toBeNull();
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("explains retained local access before logout and focuses cancel", async () => {
    const { user } = renderPanel();
    await screen.findByText("@hyeeun");

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(
      await screen.findByRole("alertdialog", { name: "GitHub에서 로그아웃할까요?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/로컬 워크스페이스와 문서는 유지/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
  });

  it("signs out only after confirmation", async () => {
    const { gateway, user } = renderPanel();
    await screen.findByText("@hyeeun");
    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    await user.click(
      screen.getByRole("button", { name: "GitHub에서 로그아웃" }),
    );

    expect(
      await screen.findByRole("button", { name: "GitHub 다시 로그인" }),
    ).toBeInTheDocument();
    expect(
      gateway.calls.filter((call) => call.method === "logoutGithub"),
    ).toHaveLength(1);
  });

  it("retains the account and shows a public error when logout fails", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.logoutError = {
      code: "credential_store_unavailable",
      message: "GitHub 로그아웃을 완료할 수 없습니다.",
      recovery: "retry",
      details: {},
    };
    const { user } = renderPanel(gateway);
    await screen.findByText("@hyeeun");
    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    await user.click(
      screen.getByRole("button", { name: "GitHub에서 로그아웃" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub 로그아웃을 완료할 수 없습니다.",
    );
    expect(screen.getByText("@hyeeun")).toBeInTheDocument();
  });

  it("starts Device Flow and opens the verification page", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    const { user } = renderPanel(gateway);
    await user.click(
      await screen.findByRole("button", { name: "GitHub 다시 로그인" }),
    );

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "GitHub 인증 페이지 열기" }),
    );

    expect(gateway.openedUrls).toEqual(["https://github.com/login/device"]);
  });

  it("cancels Device Flow and returns to the signed-out action", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    const { user } = renderPanel(gateway);
    await user.click(
      await screen.findByRole("button", { name: "GitHub 다시 로그인" }),
    );
    await screen.findByText("ABCD-EFGH");

    await user.click(screen.getByRole("button", { name: "인증 취소" }));

    expect(
      await screen.findByRole("button", { name: "GitHub 다시 로그인" }),
    ).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderPanel();
    await screen.findByText("@hyeeun");

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });
});
