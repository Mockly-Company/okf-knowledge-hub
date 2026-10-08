import { submitLocalConnection } from "@/test/localConnection";
import axe from "axe-core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

async function completeLatestClone(gateway: FakeWorkspaceConnectionGateway) {
  const call = gateway.calls.filter((entry) => entry.method === "cloneRepository").at(-1);
  const requestId = call?.args[0];
  const parent = call?.args[2];
  if (typeof requestId !== "string" || typeof parent !== "string") throw new Error("No clone request to complete");
  const target = `${parent}/mockly-knowledge`;
  await act(async () => gateway.emitClone({ status: "completed", requestId, ownershipTargetPath: target, repository: { ...gateway.repositorySnapshot, root: target } }));
}

describe("WorkspaceConnectionPage", () => {
  it.each([
    ["existing", "existing"], ["download", "download"],
    ["existing", "download"], ["download", "existing"],
  ] as const)("invalidates old YAML repair actions when changing %s selection to %s", async (initial, next) => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = invalidYaml;
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user, initial);
    if (initial === "download") { await user.click(screen.getByRole("button", { name: "다운로드해서 연결" })); await completeLatestClone(gateway); }
    await screen.findByRole("button", { name: "다시 확인" });
    const inspected = gateway.calls.filter((call) => call.method === "inspectWorkspace").length;
    gateway.workspaceInspection = { status: "ready", summary: gateway.connectedWorkspace.summary };
    await user.click(screen.getByRole("radio", { name: next === "existing" ? "이 기기의 저장소 연결" : "새로 다운로드해서 연결" }));
    gateway.selectedDirectory = "/selected-b";
    await user.click(screen.getByRole("button", { name: /^(폴더 선택|변경)$/ }));
    expect(screen.queryByRole("button", { name: "다시 확인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "워크스페이스 파일 열기" })).toBeNull();
    expect(gateway.calls.filter((call) => call.method === "inspectWorkspace")).toHaveLength(inspected);
    expect(gateway.calls.filter((call) => call.method === "connectWorkspace")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: next === "existing" ? "연결" : "다운로드해서 연결" }));
    if (next === "download") await completeLatestClone(gateway);
    await screen.findByText("워크스페이스가 연결되었습니다.");
    const calls = gateway.calls.filter((call) => call.method === (next === "existing" ? "inspectExistingClone" : "cloneRepository"));
    expect(calls.at(-1)?.args[next === "existing" ? 0 : 2]).toBe("/selected-b");
  });

  it.each(["same-parent", "different-parent", "existing-clone"] as const)("executes an explicit %s submission after a retryable clone failure", async (selection) => {
    const { gateway, user } = renderPage();
    gateway.cloneError = { code: "clone_failed", message: "다운로드 실패", recovery: "retry", details: {} };
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user, "download");
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
    await screen.findByText("다운로드 실패");
    const originalId = gateway.calls.find((call) => call.method === "cloneRepository")?.args[0];
    gateway.cloneError = null;
    if (selection === "existing-clone") await user.click(screen.getByRole("radio", { name: "이 기기의 저장소 연결" }));
    gateway.selectedDirectory = selection === "same-parent" ? "/work" : "/recovery-b";
    await user.click(screen.getByRole("button", { name: /^(폴더 선택|변경)$/ }));
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: selection === "existing-clone" ? "연결" : "다운로드해서 연결" }));
    if (selection !== "existing-clone") await completeLatestClone(gateway);
    await screen.findByText("워크스페이스가 연결되었습니다.");
    if (selection !== "existing-clone") {
      const clones = gateway.calls.filter((call) => call.method === "cloneRepository");
      expect(clones).toHaveLength(2);
      expect(clones[1].args[0]).not.toBe(originalId);
      expect(clones[1].args[2]).toBe(selection === "same-parent" ? "/work" : "/recovery-b");
    } else expect(gateway.calls.find((call) => call.method === "inspectExistingClone")?.args[0]).toBe("/recovery-b");
  });

  it("allows explicit download after a failed existing clone inspection", async () => {
    const { gateway, user } = renderPage();
    gateway.existingCloneError = { code: "repository_path_conflict", message: "Git 저장소 아님", recovery: "choose_another_directory", details: {} };
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user);
    await screen.findByText("Git 저장소 아님");
    await user.click(screen.getByRole("radio", { name: "새로 다운로드해서 연결" }));
    gateway.selectedDirectory = "/download-b";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
    await completeLatestClone(gateway);
    await screen.findByText("워크스페이스가 연결되었습니다.");
  });

  it("opens repository creation with the native gateway", async () => {
    const { gateway, user } = renderPage();
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("link", { name: /GitHub에서 새 저장소 만들기/ }));
    expect(gateway.openedUrls).toEqual(["https://github.com/new"]);
  });

  it("recovers a rejected browser launch while preserving pending authentication", async () => {
    const { gateway, user } = renderPage();
    vi.spyOn(gateway, "openExternal").mockRejectedValueOnce(new Error("os refused"));
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    await user.click(screen.getByRole("link", { name: /GitHub에서 인증 계속/ }));
    await screen.findByRole("button", { name: "다시 시도" });
    expect(screen.getByRole("button", { name: "사용자 코드 복사" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(gateway.openedUrls).toEqual(["https://github.com/login/device"]);
    expect(gateway.calls.filter((call) => call.method === "beginGithubAuth")).toHaveLength(1);
  });

  it("recovers a failed folder picker without losing the download parent", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("radio", { name: "새로 다운로드해서 연결" }));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    vi.spyOn(gateway, "pickDirectory").mockRejectedValueOnce(new Error("picker refused"));
    await user.click(screen.getByRole("button", { name: "변경" }));
    await screen.findByRole("button", { name: "폴더 선택 다시 시도" });
    expect(screen.getByRole("textbox", { name: "다운로드 위치" })).toHaveValue("/work");
    gateway.selectedDirectory = "/another";
    await user.click(screen.getByRole("button", { name: "폴더 선택 다시 시도" }));
    expect(screen.getByRole("textbox", { name: "다운로드 위치" })).toHaveValue("/another");
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);
  });

  it("explains an empty repository list without permitting the next step", async () => {
    const gateway = FakeWorkspaceConnectionGateway.disconnected();
    gateway.repositories = [];
    const { user } = renderPage(gateway);
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    expect(await screen.findByText("선택할 저장소가 없습니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /GitHub에서 새 저장소 만들기.*새 창/ })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("조회된 저장소").parentElement).toHaveTextContent(/^조회된 저장소$/);
    expect(screen.queryByText("새 저장소가 안 보이면 새로고침")).not.toBeInTheDocument();
    expect(screen.queryByText("저장소를 만든 뒤 이 화면으로 돌아와 새로고침하세요.")).not.toBeInTheDocument();
  });

  it("announces repository refresh and prevents advancing with stale selection", async () => {
    const { gateway, user } = renderPage();
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));
    gateway.approveAuthentication();
    await user.click(await screen.findByRole("radio", { name: /mockly-knowledge/ }));
    vi.spyOn(gateway, "listRepositories").mockImplementation(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    expect(screen.getByRole("status")).toHaveTextContent("저장소를 불러오는 중입니다.");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(screen.queryByRole("radio", { name: /mockly-knowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByText("선택할 저장소가 없습니다.")).not.toBeInTheDocument();
  });

  it("shows the final download path in the form before one explicit download action", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("radio", { name: "새로 다운로드해서 연결" }));
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(screen.getByText("/work/mockly-knowledge")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "다운로드 위치 확인" })).not.toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);
  });
  it("selects a local folder without connecting until the form is submitted", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    expect(screen.getByRole("radio", { name: /이 기기의 저장소 연결/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "연결" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveValue("/work");
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "연결" }));
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(1);
  });

  it("keeps independent folder choices when switching connection methods", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    await user.click(screen.getByRole("radio", { name: "새로 다운로드해서 연결" }));
    expect(screen.getByRole("textbox", { name: "다운로드 위치" })).toHaveValue("");
    gateway.selectedDirectory = "/new-work";
    await user.click(screen.getByRole("button", { name: "폴더 선택" }));
    expect(screen.getByRole("textbox", { name: "다운로드 위치" })).toHaveValue("/new-work");
    await user.click(screen.getByRole("radio", { name: "이 기기의 저장소 연결" }));
    expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveValue("/work");
    expect(gateway.calls.filter((call) => call.method === "cloneRepository" || call.method === "inspectExistingClone")).toHaveLength(0);
  });
  it("uses the semantic canvas and panel spacing for the connection boundary", () => {
    const { container } = renderPage();

    expect(screen.getByRole("main")).toHaveClass("bg-[var(--color-canvas)]");
    expect(container.querySelector(".workspace-connection__card")).toHaveClass(
      "p-[var(--panel-padding)]",
      "grid",
      "gap-[var(--space-6)]",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "GitHub에 연결" }),
    ).toHaveClass("font-[number:var(--font-weight-page-title)]");
  });

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
    await submitLocalConnection(user);
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

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-feedback-variant",
      "banner",
    );

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
    await submitLocalConnection(user);
    await screen.findByRole("button", { name: "다시 시도" });

    expectTokenFree(exposedStates);
  });

  it("presents one h1 and moves keyboard focus to the next decision", async () => {
    const { gateway, user } = renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    await signInAndChooseRepository(gateway, user);

    expect(screen.getByRole("heading", { name: "로컬 연결" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /이 기기의 저장소 연결/ })).toHaveFocus();
  });

  it("groups the Device Flow code with expiry and offers only the primary authentication action", async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole("button", { name: "GitHub 로그인" }));

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub에서 인증 계속" })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
    expect(screen.queryByRole("button", { name: "로그인 취소" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그인 다시 시작" })).not.toBeInTheDocument();
    expect(screen.getByText("아래 코드를 GitHub에 입력해 인증을 완료하세요.")).toBeVisible();
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
    await submitLocalConnection(user, "download");
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));

    expect(await screen.findByRole("textbox", { name: "다운로드 위치" })).toHaveValue("/work");
    gateway.selectedDirectory = "/new-work";
    await user.click(screen.getByRole("button", { name: "변경" }));
    expect(screen.getByText("/new-work/mockly-knowledge")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
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
    await submitLocalConnection(user);
    expect(await screen.findByText("선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.")).toBeInTheDocument();
    const path = screen.getByRole("textbox", { name: "저장소 폴더" });
    expect(path).toHaveValue("/work");
    expect(path).toHaveAttribute("readonly");
    expect(path).toHaveAttribute("aria-invalid", "true");
    expect(path).toHaveAccessibleDescription("선택한 폴더가 연결 가능한 Git 저장소가 아닙니다.");
    expect(screen.getByRole("form", { name: "로컬 연결" })).toContainElement(path);

    gateway.existingCloneError = null;
    gateway.selectedDirectory = "/work/mockly-knowledge";
    await user.click(screen.getByRole("button", { name: "변경" }));
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "연결" }));

    expect(gateway.calls.filter((call) => call.method === "pickDirectory")).toHaveLength(2);
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(2);
  });

  it("previews the exact clone target and requires confirmation before writing", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);

    await submitLocalConnection(user, "download");

    expect(screen.getByText("/work/mockly-knowledge")).toBeInTheDocument();
    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));

    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(1);
  });

  it("switches away from the download method without writing", async () => {
    const { gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user, "download");

    await user.click(screen.getByRole("radio", { name: "이 기기의 저장소 연결" }));

    expect(gateway.calls.filter((call) => call.method === "cloneRepository")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "연결" })).toBeDisabled();
  });

  it("has no automatically detectable accessibility violations in clone confirmation", async () => {
    const { container, gateway, user } = renderPage();
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user, "download");

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
    await submitLocalConnection(user, "download");
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));

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
    await submitLocalConnection(user, "download");
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));

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
    await submitLocalConnection(user);

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
    await submitLocalConnection(user);

    await user.click(await screen.findByRole("button", { name: "OkHub 업데이트 확인" }));

    expect(gateway.openedUrls).toEqual([
      "https://github.com/Mockly-Company/okf-knowledge-hub/releases",
    ]);
  });

  it("announces download progress without moving focus or duplicating the path", async () => {
    const { gateway, user } = renderPage();
    gateway.deferClone = true;
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user, "download");
    await user.click(screen.getByRole("button", { name: "다운로드해서 연결" }));
    gateway.emitCloneProgress();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("다운로드 중");
    expect(status).toHaveClass("sr-only");
    expect(status).not.toHaveFocus();
    expect(status).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "다운로드 중…" })).toBeDisabled();
    expect(screen.getAllByText("/work/mockly-knowledge")).toHaveLength(1);
  });

  it("revalidates repaired YAML in the same form without losing the selected folder", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = invalidYaml;
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user);
    await screen.findByText("YAML 형식이 올바르지 않습니다.");
    expect(screen.getByRole("form", { name: "로컬 연결" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveValue("/work");
    await user.click(screen.getByRole("button", { name: "워크스페이스 파일 열기" }));
    expect(gateway.openedPaths).toEqual(["/work/mockly-knowledge/.okf/workspace.yml"]);
    gateway.workspaceInspection = { status: "ready", summary: gateway.connectedWorkspace.summary };
    await user.click(screen.getByRole("button", { name: "다시 확인" }));
    await screen.findByText("워크스페이스가 연결되었습니다.");
  });

  it("recovery folder selection waits for the explicit connection button", async () => {
    const { gateway, user } = renderPage();
    gateway.existingCloneError = { code: "repository_remote_mismatch", message: "저장소가 다릅니다.", recovery: "choose_another_directory", details: {} };
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user);
    gateway.existingCloneError = null;
    gateway.selectedDirectory = "/another";
    await user.click(await screen.findByRole("button", { name: "다른 위치 선택" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveValue("/another"));
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "연결" }));
    await screen.findByText("워크스페이스가 연결되었습니다.");
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")[1].args[0]).toBe("/another");
  });

  it("shows invalid workspace YAML diagnostics in the local step", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = invalidYaml;
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user);

    expect(await screen.findByText("YAML 형식이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.getByText(".okf/workspace.yml")).toBeInTheDocument();
    expect(
      screen.getByText("YAML 형식이 올바르지 않습니다.").closest("[data-feedback-variant]"),
    ).toHaveAttribute("data-feedback-variant", "content");
  });

  it("previews initialization and cancels without writing", async () => {
    const { gateway, user } = renderPage();
    gateway.workspaceInspection = { status: "initialization_required" };
    gateway.initializationPreview = {
      ...gateway.initializationPreview,
      files: [{ path: ".okf/workspace.yml", content: "name: Mockly", overwritesExisting: false }],
    };
    await signInAndChooseRepository(gateway, user);
    await submitLocalConnection(user);
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
    await submitLocalConnection(user);
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
    await submitLocalConnection(user);
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
    await submitLocalConnection(user);
    await user.click(await screen.findByRole("button", { name: "초기화 내용 확인" }));
    await user.click(screen.getByRole("button", { name: "워크스페이스 초기화" }));
    await screen.findByRole("heading", { name: "Draft PR을 검수해 주세요" });
    gateway.workspaceInspection = {
      status: "ready",
      summary: gateway.connectedWorkspace!.summary,
    };

    await user.click(screen.getByRole("button", { name: "병합 후 clone 선택" }));

    expect(gateway.calls.filter((call) => call.method === "pickDirectory")).toHaveLength(2);
    expect(gateway.calls.filter((call) => call.method === "inspectExistingClone")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "저장소 폴더" })).toHaveValue("/work");
    await user.click(screen.getByRole("button", { name: "연결" }));
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
