import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ActiveProjectModule from "@/features/active-project/ActiveProjectProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import { aiKeys } from "@/features/ai/queryKeys";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { createTestQueryClient } from "@/test/queryTestUtils";
import {
  DocumentsFollowActiveProject,
  ProjectDocsRepositoryPicker,
  currentDocsRepositoryKey,
} from "./ProjectDocsRepository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockActiveProject(activeProjectId: string, selectProject = vi.fn(async () => {})) {
  vi.spyOn(ActiveProjectModule, "useOptionalActiveProject").mockReturnValue({
    activeProjectId,
    selectProject,
  } as unknown as ActiveProjectModule.ActiveProjectContextValue);
  return selectProject;
}

function documentsGateway() {
  const gateway = new FakeDocumentsGateway();
  gateway.sessionSnapshot.lastOpenedPath = null;
  return gateway;
}

describe("ProjectDocsRepositoryPicker", () => {
  it("does not switch back to the project that started the clone", async () => {
    const user = userEvent.setup();
    const selectProject = mockActiveProject("project-b");
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: true };
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DocumentsProvider gateway={documentsGateway()} searchDebounceMs={0}>
          <ProjectDocsRepositoryPicker
            projectId="project-a"
            gateway={docs}
            repositoryGateway={FakeWorkspaceConnectionGateway.connected()}
          />
        </DocumentsProvider>
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );

    await waitFor(() => expect(docs.connects).toHaveLength(1));
    expect(docs.connects[0].projectId).toBe("project-a");
    expect(selectProject).not.toHaveBeenCalled();
  });

  it("reselects the project when it is still active", async () => {
    const user = userEvent.setup();
    const selectProject = mockActiveProject("project-a");
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: true };
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DocumentsProvider gateway={documentsGateway()} searchDebounceMs={0}>
          <ProjectDocsRepositoryPicker
            projectId="project-a"
            gateway={docs}
            repositoryGateway={FakeWorkspaceConnectionGateway.connected()}
          />
        </DocumentsProvider>
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );

    await waitFor(() => expect(selectProject).toHaveBeenCalledWith("project-a"));
  });
});

describe("DocumentsFollowActiveProject", () => {
  it("refreshes the current repository and AI context when the project changes", async () => {
    const client = createTestQueryClient();
    client.setQueryData(currentDocsRepositoryKey, { status: "connected" });
    client.setQueryData(aiKeys.agentsMd, { workspace_path: "a" });
    mockActiveProject("project-a");
    const documents = documentsGateway();
    const view = render(
      <QueryClientProvider client={client}>
        <DocumentsProvider gateway={documents} searchDebounceMs={0}>
          <DocumentsFollowActiveProject />
        </DocumentsProvider>
      </QueryClientProvider>,
    );
    expect(client.getQueryState(currentDocsRepositoryKey)?.isInvalidated).toBe(false);

    mockActiveProject("project-b");
    view.rerender(
      <QueryClientProvider client={client}>
        <DocumentsProvider gateway={documents} searchDebounceMs={0}>
          <DocumentsFollowActiveProject />
        </DocumentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(client.getQueryState(currentDocsRepositoryKey)?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(aiKeys.agentsMd)?.isInvalidated).toBe(true);
  });
});
