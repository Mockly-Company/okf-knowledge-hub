import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { AppShell } from "./AppShell";

function renderShell(
  initialEntry = "/",
  gateway = FakeWorkspaceConnectionGateway.connected(),
) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <DocumentsProvider gateway={new FakeDocumentsGateway()}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<h1>프로젝트 진행 상황</h1>} />
              <Route path="documents" element={<h1>Documents</h1>} />
              <Route path="project" element={<h1>Project</h1>} />
              <Route path="settings" element={<h1>Settings</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </DocumentsProvider>
    </WorkspaceConnectionProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("navigates without leaving the application", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("link", { name: "Documents" }));
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  });

  it("collapses and restores the sidebar", async () => {
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    const openButton = screen.getByRole("button", { name: "사이드바 열기" });
    expect(openButton).toHaveFocus();
    await userEvent.click(openButton);
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveFocus();
  });

  it("reserves space for the open button only while collapsed", async () => {
    renderShell();
    const main = screen.getByRole("main", { name: "OkHub" });
    expect(main).not.toHaveClass("app-shell__main--sidebar-collapsed");

    await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
    expect(main).toHaveClass("app-shell__main--sidebar-collapsed");

    await userEvent.click(screen.getByRole("button", { name: "사이드바 열기" }));
    expect(main).not.toHaveClass("app-shell__main--sidebar-collapsed");
  });

  it("toggles the sidebar with the platform shortcut", () => {
    renderShell();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 열기" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveFocus();
  });

  it("keeps the sidebar menu discoverable before the main content for keyboard users", async () => {
    const user = userEvent.setup();
    renderShell("/documents");

    await user.tab();

    expect(screen.getByRole("button", { name: "사이드바 접기" })).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toContainElement(
      screen.getByRole("link", { name: "Documents" }),
    );
    expect(screen.getByRole("link", { name: "Documents" })).toBeVisible();
  });

  it.each(["/", "/documents", "/project", "/settings"])(
    "shows the GitHub reauthentication banner on %s",
    async (initialEntry) => {
      const gateway = FakeWorkspaceConnectionGateway.connected();
      gateway.authState = { status: "reauthentication_required" };
      renderShell(initialEntry, gateway);

      const banner = await screen.findByRole("status");
      expect(banner).toHaveTextContent("GitHub 재로그인 필요");
      expect(banner).toHaveTextContent("GitHub 인증이 만료되었습니다.");
      expect(
        screen.getByRole("link", { name: "Settings에서 다시 연결" }),
      ).toHaveAttribute("href", "/settings");
    },
  );
});
