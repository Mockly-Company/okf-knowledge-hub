import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { SettingsPage } from "./SettingsPage";
import type { BuildInfoGateway } from "@/features/build-info/BuildInfoGateway";

const buildInfoGateway: BuildInfoGateway = {
  getBuildInfo: async () => ({
    mode: "development",
    branch: "feat/document-creation",
    commit: "abc12345",
    dirty: true,
    credentialBackend: "file-keychain",
  }),
};

describe("SettingsPage", () => {
  afterEach(cleanup);

  it("uses the approved page and section hierarchy", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toHaveClass(
      "font-[number:var(--font-weight-page-title)]",
    );
    expect(screen.getByRole("heading", { level: 2, name: "화면" })).toHaveClass(
      "font-[number:var(--font-weight-section-title)]",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Settings" }).closest("section"))
      .toHaveClass(
        "px-[var(--page-padding-inline)]",
        "pt-[var(--page-block-start)]",
        "pb-[var(--space-10)]",
      );
  });

  it("changes the device-only display density", async () => {
    const repository = new FakePreferencesRepository();
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(await screen.findByRole("radio", { name: "Default" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Compact" }));

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    expect(repository.writes).toEqual(["compact"]);
  });

  it("uses its fieldset legend as the only named density group", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(await screen.findByRole("group", { name: "표시 밀도" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("keeps a visible focus treatment while changing density with the keyboard", async () => {
    const repository = new FakePreferencesRepository();
    const user = userEvent.setup();
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    const defaultRadio = await screen.findByRole("radio", { name: "Default" });
    const defaultLabel = screen.getByText("Default").closest("label");

    defaultRadio.focus();

    expect(defaultRadio).toHaveFocus();
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-2");
    expect(defaultLabel).toHaveClass(
      "peer-focus-visible:outline-[var(--color-primary)]",
    );
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-offset-2");

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
    await waitFor(() => expect(repository.writes).toEqual(["compact"]));
  });

  it("keeps the selected density description legible on the primary-soft surface", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    const selectedDescription = await screen.findByText(
      "문서 읽기와 작업 화면의 균형 잡힌 기본 크기",
    );
    expect(selectedDescription).toHaveClass("text-[var(--color-text-default)]");
  });

  it("disables density choices while the initial preference read is pending", () => {
    const repository: PreferencesRepository = {
      getDisplayDensity: () => new Promise<DisplayDensity>(() => {}),
      setDisplayDensity: async () => {},
    };
    render(
      <PreferencesProvider repository={repository}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(screen.getByRole("radio", { name: "Default" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Compact" })).toBeDisabled();
  });

  it("shows the durable knowledge repository connection in workspace settings", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected(
      "/work/mockly-knowledge",
    );
    Object.assign(gateway.currentWorkspace!, {
      repository: {
        id: "R_kgDOExample",
        fullName: "Mockly-Company/mockly-knowledge",
      },
    });
    if (gateway.currentWorkspace?.status === "connected") {
      Object.assign(gateway.currentWorkspace.summary, { schemaVersion: 1 });
    }

    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );

    expect(
      screen.getByText("Mockly-Company/mockly-knowledge"),
    ).toBeInTheDocument();
    expect(screen.getByText("/work/mockly-knowledge")).toBeInTheDocument();
    expect(screen.getByText("schema v1")).toBeInTheDocument();
    expect(screen.getByText("schema v1")).toHaveClass(
      "bg-[var(--color-surface-pressed)]",
      "text-[var(--color-text-default)]",
      "font-[number:var(--font-weight-control)]",
    );
    expect(
      screen.getByRole("button", { name: "다시 확인" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다른 지식 저장소 연결" }),
    ).toBeInTheDocument();
  });

  it("shows the connected GitHub account under external connections", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={FakeWorkspaceConnectionGateway.connected()}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "외부 연결" }),
    );

    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  });

  it("revalidates the current workspace and shows the session result", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    expect(
      await screen.findByText("유효한 워크스페이스입니다."),
    ).toBeInTheDocument();
  });

  it("shows workspace diagnostics when revalidation fails", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.workspaceInspection = {
      status: "invalid",
      diagnostics: [
        {
          code: "workspace_name_empty",
          path: "workspace.name",
          message: "워크스페이스 이름이 비어 있습니다.",
        },
      ],
    };
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    expect(
      await screen.findByText("워크스페이스 이름이 비어 있습니다."),
    ).toBeInTheDocument();
  });

  it("shows a missing local folder error without dropping the connection", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.workspaceInspectionError = {
      code: "workspace_missing",
      message: "연결된 로컬 폴더를 찾을 수 없습니다.",
      recovery: "choose_another_directory",
      details: {},
    };
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    expect(
      await screen.findByText("연결된 로컬 폴더를 찾을 수 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("/work/mockly-knowledge")).toBeInTheDocument();
  });

  it("keeps the session validation result while switching settings categories", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <WorkspaceConnectionProvider gateway={gateway}>
          <SettingsPage />
        </WorkspaceConnectionProvider>
      </PreferencesProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "워크스페이스" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(
      await screen.findByText("유효한 워크스페이스입니다."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "화면" }));
    await userEvent.click(screen.getByRole("button", { name: "워크스페이스" }));

    expect(screen.getByText("유효한 워크스페이스입니다.")).toBeInTheDocument();
  });
});
  it("shows the current development build provenance without local paths", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage buildInfoGateway={buildInfoGateway} />
      </PreferencesProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "앱 정보" }));

    expect(await screen.findByText("feat/document-creation@abc12345")).toBeInTheDocument();
    expect(screen.getByText("변경사항 있음")).toBeInTheDocument();
    expect(screen.getByText("file-keychain")).toBeInTheDocument();
    expect(screen.queryByText(/Users\/hyeeun/)).not.toBeInTheDocument();
  });
