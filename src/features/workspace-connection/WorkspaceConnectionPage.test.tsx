import axe from "axe-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import type { AppError, WorkspaceInspection } from "./types";
import {
  useWorkspaceConnection,
  WorkspaceConnectionProvider,
} from "./WorkspaceConnectionProvider";
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

function StateRecorder({ states }: { states: unknown[] }) {
  const connection = useWorkspaceConnection();
  states.push({
    state: connection.state,
    workspaceValidation: connection.workspaceValidation,
  });
  return null;
}

function expectTokenFree(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const marker of ["access_token", "refresh_token", "device_code", "ghu_", "ghr_"]) {
    expect(serialized).not.toContain(marker);
  }
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
  it("keeps every gateway state exposed to React outside the token boundary", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const exposedStates: unknown[] = [];
    gateway.workspaceInspectionError = {
      code: "workspace_invalid",
      message: "워크스페이스 설정이 유효하지 않습니다.",
      recovery: "open_workspace_file",
      details: {
        diagnostic: "access_token refresh_token device_code ghu_private ghr_private",
      },
      accessToken: "ghu_private",
    } as AppError;
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
        <StateRecorder states={exposedStates} />
      </WorkspaceConnectionProvider>,
    );

    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await screen.findByRole("button", { name: "워크스페이스 파일 열기" });

    expect(exposedStates).not.toHaveLength(0);
    expectTokenFree(exposedStates);
  });

  it("keeps failed gateway events outside the token boundary", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const exposedStates: unknown[] = [];
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
        <StateRecorder states={exposedStates} />
      </WorkspaceConnectionProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "GitHub 로그인" }));
    const requestId = gateway.calls.find((call) => call.method === "beginGithubAuth")?.args[0];
    if (typeof requestId !== "string") throw new Error("GitHub login request ID was not recorded");
    gateway.emitAuth({
      status: "failed",
      requestId,
      error: {
        code: "github_unavailable",
        message: "GitHub에 연결할 수 없습니다.",
        recovery: "retry",
        details: {
          diagnostic: "access_token refresh_token device_code ghu_private ghr_private",
        },
      },
    });
    await screen.findByRole("button", { name: "다시 시도" });

    expectTokenFree(exposedStates);
  });

  it("uses a fixed public fallback for an untyped gateway error", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    const exposedStates: unknown[] = [];
    gateway.workspaceInspectionError = new Error(
      "access_token refresh_token device_code ghu_private ghr_private",
    ) as unknown as AppError;
    const user = userEvent.setup();
    render(
      <WorkspaceConnectionProvider gateway={gateway}>
        <WorkspaceConnectionPage />
        <StateRecorder states={exposedStates} />
      </WorkspaceConnectionProvider>,
    );

    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await screen.findByRole("button", { name: "다시 시도" });

    expectTokenFree(exposedStates);
  });

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
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));

    expect(await screen.findByText("/work/mockly-knowledge")).toBeInTheDocument();
    gateway.selectedDirectory = "/new-work";
    await user.click(screen.getByRole("button", { name: "다른 위치 선택" }));
    expect(screen.getByText("/new-work/mockly-knowledge")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));
    const cloneCalls = gateway.calls.filter((call) => call.method === "cloneRepository");
    expect(cloneCalls).toHaveLength(2);
    expect(cloneCalls[1]?.args[2]).toBe("/new-work");
  });

  it("reopens the folder picker after selecting a non-repository as an existing clone", async () => {
    const { gateway, user } = renderPage();
    gateway.existingCloneError = {
      code: "repository_path_conflict",
      message: "선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.",
      recovery: "choose_another_directory",
      details: { path: "/work" },
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    expect(await screen.findByText("선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.")).toBeInTheDocument();

    gateway.existingCloneError = null;
    gateway.selectedDirectory = "/work/mockly-knowledge";
    await user.click(screen.getByRole("button", { name: "다른 위치 선택" }));

    expect(gateway.calls.filter((call) => call.method === "pickDirectory")).toHaveLength(2);
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(2);
  });

  it("previews the exact clone target and requires confirmation before writing", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);

    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));

    expect(screen.getByText("/work/mockly-knowledge")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));

    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);
  });

  it("cancels a clone target preview without writing", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));

    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "새 위치에 clone" })).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations in clone confirmation", async () => {
    const { container, gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));

    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });

    expect(result.violations).toEqual([]);
  });

  it("opens GitHub App installation management for permission recovery", async () => {
    const { gateway, user } = renderPage();
    gateway.cloneError = {
      code: "github_permission_denied",
      message: "선택한 저장소에 접근할 수 없습니다.",
      recovery: "reinstall_github_app",
      details: {},
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));

    await user.click(await screen.findByRole("button", { name: "GitHub 앱 설치 관리" }));

    expect(gateway.openedUrls).toEqual(["https://github.com/settings/installations"]);
  });

  it("shows non-destructive cleanup guidance before rechecking the working tree", async () => {
    const { gateway, user } = renderPage();
    gateway.cloneError = {
      code: "repository_dirty",
      message: "working tree에 커밋하지 않은 변경이 있습니다.",
      recovery: "clean_working_tree",
      details: {},
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "새 위치에 clone" }));
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));

    await user.click(await screen.findByRole("button", { name: "정리 방법 보기" }));

    expect(screen.getByRole("heading", { name: "working tree를 직접 정리해 주세요" })).toBeInTheDocument();
    expect(screen.getByText(/OkHub는 변경 파일을 자동으로 삭제하거나 stash하지 않습니다/)).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);

    gateway.cloneError = null;
    await user.click(screen.getByRole("button", { name: "정리 상태 다시 확인" }));
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(2);
  });

  it("opens the workspace YAML with the operating system file handler", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspectionError = {
      code: "workspace_invalid",
      message: "워크스페이스 설정이 유효하지 않습니다.",
      recovery: "open_workspace_file",
      details: { path: ".okf/workspace.yml" },
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));

    await user.click(await screen.findByRole("button", { name: "워크스페이스 파일 열기" }));

    expect(gateway.openedPaths).toEqual(["/work/mockly-knowledge/.okf/workspace.yml"]);
  });

  it("opens the OkHub releases page for an unsupported workspace version", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspectionError = {
      code: "workspace_version_unsupported",
      message: "현재 버전의 OkHub에서 이 워크스페이스를 열 수 없습니다.",
      recovery: "update_okhub",
      details: { foundVersion: "2" },
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));

    await user.click(await screen.findByRole("button", { name: "OkHub 업데이트 확인" }));

    expect(gateway.openedUrls).toEqual([
      "https://github.com/Mockly-Company/okf-knowledge-hub/releases",
    ]);
  });

  it("moves focus to clone status and progress updates do not steal it", async () => {
    const { gateway, user } = renderPage();
    gateway.deferClone = true;
    await signInAndChooseRepository(gateway, user);
    const cloneButton = screen.getByRole("button", { name: "새 위치에 clone" });
    await user.click(cloneButton);
    await user.click(screen.getByRole("button", { name: "이 위치에 clone" }));
    gateway.emitCloneProgress();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("clone 중");
    expect(status).toHaveFocus();
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
    gateway.initializationPreview = {
      ...gateway.initializationPreview,
      branch: "main",
      strategy: { kind: "direct_push" },
    };
    gateway.initializationResult = {
      ...gateway.initializationResult,
      branch: "main",
      draftPullRequestUrl: null,
    };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));

    expect(await screen.findByText("워크스페이스가 연결되었습니다.")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "initializeWorkspace")).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.method === "connectWorkspace")).toHaveLength(1);
  });

  it("shows the Draft PR without connecting an unmerged initialization branch", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = { status: "initialization_required" };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));

    expect(await screen.findByRole("heading", { name: "Draft PR을 검수해 주세요" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Draft PR 열기" }));
    expect(gateway.openedUrls).toContain(gateway.initializationResult.draftPullRequestUrl);
    expect(gateway.calls.filter((call) => call.method === "connectWorkspace")).toHaveLength(0);
  });

  it("lets the user select a refreshed clone after the Draft PR is merged", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = { status: "initialization_required" };
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "기존 clone 연결" }));
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));
    await screen.findByRole("heading", { name: "Draft PR을 검수해 주세요" });
    gateway.workspaceInspection = {
      status: "ready",
      summary: gateway.connectedWorkspace!.summary,
    };

    await user.click(screen.getByRole("button", { name: "병합 후 clone 선택" }));

    expect(gateway.calls.filter((call) => call.method === "pickDirectory")).toHaveLength(2);
    expect(await screen.findByText("워크스페이스가 연결되었습니다.")).toBeInTheDocument();
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
