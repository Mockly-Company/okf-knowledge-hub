import { createRef } from "react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { AppSidebar } from "./AppSidebar";

function renderSidebar(
  gateway: FakeWorkspaceConnectionGateway,
  initialPath = "/",
  documentsGateway = new FakeDocumentsGateway(),
) {
  return render(
    <WorkspaceConnectionProvider gateway={gateway}>
      <DocumentsProvider gateway={documentsGateway}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppSidebar collapseButtonRef={createRef()} onCollapse={() => {}} />
        </MemoryRouter>
      </DocumentsProvider>
    </WorkspaceConnectionProvider>,
  );
}

describe("AppSidebar", () => {
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

  it("shows the authenticated GitHub identity without duplicating workspace context", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(screen.queryByText("Mockly")).not.toBeInTheDocument();
    expect(view.container.querySelector(".app-sidebar__workspace")).toBeNull();
    expect(view.container.querySelector('img[src="https://example.test/avatar.png"]'))
      .toBeInTheDocument();
  });

  it("does not duplicate workspace context while reauthentication is required", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    renderSidebar(gateway);

    expect(await screen.findByText("GitHub 재로그인 필요")).toBeInTheDocument();
    expect(screen.queryByText("Mockly")).toBeNull();
    expect(screen.getByText("Settings에서 연결")).toBeInTheDocument();
  });

  it("keeps the sidebar account area neutral while reauthentication is required", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "reauthentication_required" };
    const view = renderSidebar(gateway);

    expect(await screen.findByText("GitHub 재로그인 필요")).toBeVisible();
    expect(screen.getByText("Settings에서 연결")).toBeVisible();
    expect(view.container.querySelector(".app-sidebar__user")).not.toHaveClass(
      "app-sidebar__user--reauthentication-required",
    );
    expect(view.container.querySelector(".lucide-circle-alert")).toBeNull();
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

  it("reserves stable identity space while account state loads", () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.deferCurrentWorkspace();
    renderSidebar(gateway);

    expect(screen.getByLabelText("GitHub 계정 불러오는 중")).toBeInTheDocument();
  });

  it("shows the document tree only on Documents routes without sidebar search", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const view = renderSidebar(
      FakeWorkspaceConnectionGateway.connected(),
      "/documents",
      documentsGateway,
    );

    expect(await screen.findByRole("tree", { name: "문서" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "Guide" })).toBeVisible();
    expect(screen.queryByRole("searchbox")).toBeNull();

    view.unmount();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/project");
    expect(screen.queryByRole("tree", { name: "문서" })).toBeNull();
  });

  it("keeps the Lucide new-document action available on Documents routes", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = "docs/guide.md";
    const view = renderSidebar(
      FakeWorkspaceConnectionGateway.connected(),
      "/documents",
      documentsGateway,
    );

    const action = await screen.findByRole("button", { name: "새 문서" });
    expect(action.querySelector("svg.lucide-plus")).not.toBeNull();
    expect(view.container.querySelector(".document-tree__header")).toContainElement(
      action,
    );
  });

  it.each(["/", "/documents", "/project"])(
    "keeps the primary navigation divider directly below Project on %s",
    async (initialPath) => {
      renderSidebar(FakeWorkspaceConnectionGateway.connected(), initialPath);

      await screen.findByText("@hyeeun");
      const primaryNavigation = screen.getByRole("navigation", { name: "주 메뉴" });
      const divider = screen.getByRole("separator");

      expect(primaryNavigation.nextElementSibling).toBe(divider);
    },
  );

  it.each(["/", "/documents", "/project"])(
    "keeps Settings directly below Project on %s",
    async (initialPath) => {
      renderSidebar(FakeWorkspaceConnectionGateway.connected(), initialPath);

      await screen.findByText("@hyeeun");
      const primaryNavigation = screen.getByRole("navigation", { name: "주 메뉴" });
      const project = screen.getByRole("link", { name: "Project" });
      const settings = screen.getByRole("link", { name: "Settings" });

      expect(project.nextElementSibling).toBe(settings);
      expect(settings.parentElement).toBe(primaryNavigation);
    },
  );

  it("returns to the Documents home when the main Documents link is selected", async () => {
    const user = userEvent.setup();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/documents");

    const document = await screen.findByRole("treeitem", { name: "Guide" });
    expect(document).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("link", { name: "Documents" }));

    expect(document).toHaveAttribute("aria-selected", "false");
  });

  it("allows a keyboard user to focus the current route in the primary navigation", async () => {
    const user = userEvent.setup();
    renderSidebar(FakeWorkspaceConnectionGateway.connected(), "/documents");

    await user.tab();
    await user.tab();
    await user.tab();

    const documents = screen.getByRole("link", { name: "Documents" });
    expect(documents).toHaveFocus();
    expect(documents).toHaveAttribute("aria-current", "page");
  });

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");

    const result = await axe.run(container);

    expect(result.violations).toEqual([]);
  });
});
