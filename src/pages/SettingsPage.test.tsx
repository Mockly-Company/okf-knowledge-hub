import {
  cleanup,
  render as rtlRender,
  screen,
  waitFor,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { SettingsPage } from "./SettingsPage";
import type { BuildInfoGateway } from "@/features/build-info/BuildInfoGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";

// 이 파일의 모든 렌더는 QueryClient를 제공한다.
function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }) => (
      <TestQueryProvider>{children}</TestQueryProvider>
    ),
  });
}

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
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-[length:var(--focus-ring-width)]");
    expect(defaultLabel).toHaveClass(
      "peer-focus-visible:outline-[var(--color-primary)]",
    );
    expect(defaultLabel).toHaveClass("peer-focus-visible:outline-offset-[var(--focus-ring-offset)]");

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

  it("does not expose a workspace category", async () => {
    render(
      <PreferencesProvider repository={new FakePreferencesRepository()}>
        <SettingsPage />
      </PreferencesProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "외부 연결" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "워크스페이스" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to display settings for legacy workspace deep links", async () => {
    window.location.hash = "#/settings?category=workspace";
    try {
      render(
        <PreferencesProvider repository={new FakePreferencesRepository()}>
          <SettingsPage />
        </PreferencesProvider>,
      );

      expect(
        await screen.findByRole("group", { name: "표시 밀도" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "워크스페이스" }),
      ).not.toBeInTheDocument();
    } finally {
      window.location.hash = "";
      cleanup();
    }
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
