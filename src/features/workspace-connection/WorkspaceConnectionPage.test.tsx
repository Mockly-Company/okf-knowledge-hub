import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import type { AppError, WorkspaceInspection } from "./types";
import { WorkspaceConnectionProvider } from "./WorkspaceConnectionProvider";
import { WorkspaceConnectionPage } from "./WorkspaceConnectionPage";

const invalidYaml: WorkspaceInspection = {
  status: "invalid",
  diagnostics: [
    {
      code: "workspace_yaml_invalid",
      path: ".okf/workspace.yml",
      message: "YAML 형식이 올바르지 않습니다.",
    },
  ],
};

const folderCollision: AppError = {
  code: "repository_path_conflict",
  message: "선택한 위치에 같은 이름의 폴더가 이미 있습니다.",
  recovery: "choose_another_directory",
  details: { path: "/work/mockly-knowledge" },
};

afterEach(cleanup);

function renderPage(gateway = FakeWorkspaceConnectionGateway.disconnected()) {
  return {
    gateway,
    user: userEvent.setup(),
    ...render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
      </WorkspaceConnectionProvider>,
    ),
  };
}

async function signInAndChooseRepository(
  gateway: FakeWorkspaceConnectionGateway,
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
  gateway.approveAuthentication();
  await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
  await user.click(screen.getByRole("button", { name: "다음" }));
}

describe("WorkspaceConnectionPage", () => {
  it("presents one h1 and moves keyboard focus to the next decision", async () => {
    const { gateway, user } = renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    await signInAndChooseRepository(gateway, user);

    expect(screen.getByRole("heading", { name: "로컬 연결" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기존 clone 연결" })).toHaveFocus();
  });

  it("shows the Device Flow code, expiry, cancellation, and restart", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub에서 인증 계속" })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
    expect(screen.getByRole("button", { name: "로그인 취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 다시 시작" })).toBeInTheDocument();
  });

  it("recovers an expired Device Flow with an explicit restart action", async () => {
    const { gateway, user } = renderPage();
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    gateway.expireAuthentication();

    expect(await screen.findByText("GitHub 인증 시간이 만료되었습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "로그인 다시 시작" }));
    expect(gateway.calls.filter((call) => call.method === "beginGithubAuth")).toHaveLength(2);
  });

  it("refreshes repositories and can load the next page", async () => {
    const { gateway, user } = renderPage();
    gateway.nextRepositoryCursor = "page-2";
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await screen.findByRole("heading", { name: "OKF 저장소 선택" });

    await user.click(screen.getByRole("button", { name: "새로고침" }));
    expect(gateway.calls.filter((call) => call.method === "listRepositories")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "저장소 더 보기" }));
    expect(gateway.calls.filter((call) => call.method === "listRepositories").at(-1)?.args).toEqual(["page-2"]);
  });

  it("shows folder collision recovery with its preserved local path", async () => {
    const { gateway, user } = renderPage();
    gateway.cloneError = folderCollision;
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));

    expect(await screen.findByText("/work/mockly-knowledge")).toBeInTheDocument();
    gateway.selectedDirectory = "/new-work";
    await user.click(screen.getByRole("button", { name: "다른 위치 선택" }));
    const cloneCalls = gateway.calls.filter((call) => call.method === "cloneRepository");
    expect(cloneCalls).toHaveLength(2);
    expect(cloneCalls[1]?.args[1]).toBe("/new-work");
  });

  it("announces clone progress without replacing the current focus", async () => {
    const { gateway, user } = renderPage();
    gateway.deferClone = true;
    await signInAndChooseRepository(gateway, user);
    const cloneButton = screen.getByRole("button", { name: "새 위치에 clone" });
    await user.click(cloneButton);
    gateway.emitCloneProgress();

    expect(await screen.findByRole("status")).toHaveTextContent("clone 중");
    expect(document.activeElement).toBe(cloneButton);
  });

  it("shows invalid workspace YAML diagnostics in the local step", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = invalidYaml;
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));

    expect(await screen.findByText("YAML 형식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.getByText(".okf/workspace.yml")).toBeInTheDocument();
  });

  it("previews initialization and cancels without writing", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = { status: "initialization_required" };
    gateway.initializationPreview = {
      ...gateway.initializationPreview,
      files: [{ path: ".okf/workspace.yml", content: "name: Mockly", overwritesExisting: false }],
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));

    expect(await screen.findByText("name: Mockly")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(gateway.calls.some((call) => call.method === "initializeWorkspace")).toBe(false);
  });

  it("initializes then connects the exact initialized root", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = { status: "initialization_required" };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));

    expect(await screen.findByText("워크스페이스가 연결되었습니다.")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "initializeWorkspace")).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.method === "connectWorkspace")).toHaveLength(1);
  });

  it("uses compact control tokens when compact density is active", () => {
    document.documentElement.dataset.density = "compact";
    renderPage();
    expect(screen.getByRole("button", { name: "GitHub 로그인" })).toHaveClass(
      "h-[var(--control-height)]",
    );
    document.documentElement.dataset.density = "";
  });
});
