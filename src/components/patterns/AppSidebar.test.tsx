import { createRef } from "react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { AppSidebar } from "./AppSidebar";

afterEach(cleanup);

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
  it("shows the connected workspace and authenticated GitHub identity", async () => {
    const view = renderSidebar(FakeWorkspaceConnectionGateway.connected());

    expect(await screen.findByText("Mockly")).toBeInTheDocument();
    expect(await screen.findByText("@hyeeun")).toBeInTheDocument();
    expect(view.container.querySelector('img[src="https://example.test/avatar.png"]'))
      .toBeInTheDocument();
  });

  it("does not expose the saved workspace while reauthentication is required", async () => {
    const gateway = FakeWorkspaceConnectionGateway.connected();
    gateway.authState = { status: "signed_out" };
    renderSidebar(gateway);

    expect(await screen.findByText("GitHub 재로그인 필요")).toBeInTheDocument();
    expect(screen.queryByText("Mockly")).toBeNull();
    expect(screen.getByText("워크스페이스 연결 필요")).toBeInTheDocument();
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

  it("has no automatically detectable accessibility violations", async () => {
    const { container } = renderSidebar(FakeWorkspaceConnectionGateway.connected());
    await screen.findByText("@hyeeun");

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });

    expect(result.violations).toEqual([]);
  });
});
