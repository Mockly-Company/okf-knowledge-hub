import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { StorybookAppProviders } from "./AppProviders";

function DocumentsProbe() {
  const { state } = useDocuments();

  return (
    <div>
      <output aria-label="selected-path">{state.selectedPath ?? "none"}</output>
      <output aria-label="selected-title">
        {state.selectedDocument?.summary.title ?? "none"}
      </output>
    </div>
  );
}

function DraftProbe() {
  const { authoringState } = useDocuments();

  return (
    <div>
      <output aria-label="draft-count">{authoringState.drafts.length}</output>
      <output aria-label="active-draft">
        {authoringState.activeChangeId ?? "none"}
      </output>
    </div>
  );
}

function WorkspaceProbe() {
  const connection = useWorkspaceConnection();

  return (
    <div>
      <output aria-label="workspace-state">
        {`${connection.state.step}:${connection.state.status}`}
      </output>
      <output aria-label="account-state">
        {connection.account.status === "authenticated"
          ? `${connection.account.status}:${connection.account.user.login}`
          : connection.account.status}
      </output>
      <output aria-label="connected-workspace-path">
        {connection.state.connectedWorkspace?.path ?? "none"}
      </output>
      <output aria-label="recovery-workspace-path">
        {connection.state.recoveryWorkspace?.path ?? "none"}
      </output>
    </div>
  );
}

describe("StorybookAppProviders", () => {
  afterEach(cleanup);

  it("renders a Documents consumer with an isolated fake session", async () => {
    render(
      <StorybookAppProviders
        documents={{ selectedPath: "docs/api/map-search.md" }}
      >
        <DocumentsProbe />
      </StorybookAppProviders>,
    );

    expect(await screen.findByText("지도 검색 API 계약")).toBeVisible();
    expect(screen.getByLabelText("selected-path")).toHaveTextContent(
      "docs/api/map-search.md",
    );
  });

  it("replaces fake providers when the same wrapper rerenders with default options", async () => {
    const view = render(
      <StorybookAppProviders
        documents={{ selectedPath: "docs/api/map-search.md" }}
      >
        <DocumentsProbe />
      </StorybookAppProviders>,
    );

    await screen.findByText("지도 검색 API 계약");

    view.rerender(
      <StorybookAppProviders>
        <DocumentsProbe />
      </StorybookAppProviders>,
    );

    expect(screen.queryByText("지도 검색 API 계약")).not.toBeInTheDocument();
    expect(screen.getByLabelText("selected-path")).toHaveTextContent("none");
    expect(screen.getByLabelText("selected-title")).toHaveTextContent("none");
  });

  it("uses configured local drafts for Documents stories", async () => {
    const draft = {
      workspaceId: "storybook-workspace",
      changeId: "storybook-draft-map-search",
      authorLogin: "storybook-bot",
      baseCommit: "a1b2c3d4",
      branch: "draft/storybook-bot/map-search",
      createdAtUnixMs: 1_726_000_000_000,
      lastOpenedAtUnixMs: 1_726_000_000_000,
    };

    render(
      <StorybookAppProviders
        documents={{
          branch: draft.branch,
          drafts: [draft],
        }}
      >
        <DraftProbe />
      </StorybookAppProviders>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("draft-count")).toHaveTextContent("1"),
    );
    expect(screen.getByLabelText("active-draft")).toHaveTextContent(
      draft.changeId,
    );
  });

  it("respects an explicit null currentWorkspace override without surfacing a connected workspace", async () => {
    render(
      <StorybookAppProviders workspace={{ currentWorkspace: null }}>
        <WorkspaceProbe />
        <DocumentsProbe />
      </StorybookAppProviders>,
    );

    expect(await screen.findByLabelText("workspace-state")).toHaveTextContent(
      "repository:idle",
    );
    expect(screen.getByLabelText("account-state")).toHaveTextContent(
      "authenticated:storybook-bot",
    );
    expect(screen.getByLabelText("connected-workspace-path")).toHaveTextContent(
      "none",
    );
    expect(screen.getByLabelText("recovery-workspace-path")).toHaveTextContent(
      "none",
    );
    expect(screen.getByLabelText("selected-path")).toHaveTextContent("none");
  });

  it("respects a recovery_required currentWorkspace override without replacing it with a connected fixture", async () => {
    render(
      <StorybookAppProviders
        workspace={{
          currentWorkspace: {
            path: "/workspace/recovery-only",
            status: "recovery_required",
          },
        }}
      >
        <WorkspaceProbe />
        <DocumentsProbe />
      </StorybookAppProviders>,
    );

    expect(await screen.findByLabelText("workspace-state")).toHaveTextContent(
      "repository:idle",
    );
    expect(screen.getByLabelText("connected-workspace-path")).toHaveTextContent(
      "none",
    );
    expect(screen.getByLabelText("recovery-workspace-path")).toHaveTextContent(
      "/workspace/recovery-only",
    );
    expect(screen.getByLabelText("selected-path")).toHaveTextContent("none");
  });
});
