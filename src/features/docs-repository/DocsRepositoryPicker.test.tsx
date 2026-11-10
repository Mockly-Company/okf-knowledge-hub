import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { TestQueryProvider } from "@/test/queryTestUtils";
import { DocsRepositoryPicker } from "./DocsRepositoryPicker";

afterEach(cleanup);

function renderPicker(
  docs: FakeDocsRepositoryGateway,
  repositories: FakeWorkspaceConnectionGateway,
  onConnected = vi.fn(),
) {
  render(
    <TestQueryProvider>
      <DocsRepositoryPicker
        projectId="project-1"
        gateway={docs}
        repositoryGateway={repositories}
        onConnected={onConnected}
      />
    </TestQueryProvider>,
  );
  return { onConnected };
}

/** 진행 중인 clone을 끝낸다. 실제 백엔드는 진행률 이벤트로 완료를 알린다. */
function finishClone(repositories: FakeWorkspaceConnectionGateway) {
  const call = repositories.calls.find((entry) => entry.method === "cloneRepository");
  const requestId = call?.args[0] as string;
  repositories.emitClone({
    status: "completed",
    requestId,
    ownershipTargetPath: "/ignored",
    repository: {
      root: "/ignored",
      headOid: null,
      defaultBranch: "main",
      isDirty: false,
      hasContent: true,
    } as never,
  });
}

describe("DocsRepositoryPicker", () => {
  it("clones then connects the chosen repository for the given project", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: false };
    const repositories = FakeWorkspaceConnectionGateway.connected();
    const { onConnected } = renderPicker(docs, repositories);

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );
    await waitFor(() =>
      expect(repositories.calls.map((entry) => entry.method)).toContain("cloneRepository"),
    );
    const clone = repositories.calls.find((entry) => entry.method === "cloneRepository");
    expect(clone?.args[2]).toBe("/app/repos/Mockly-Company");
    finishClone(repositories);

    await waitFor(() =>
      expect(docs.connects).toEqual([
        {
          projectId: "project-1",
          repositoryId: "R_kgDOExample",
          fullName: "Mockly-Company/mockly-knowledge",
        },
      ]),
    );
    await waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith({
        fullName: "Mockly-Company/mockly-knowledge",
        okf: true,
      }),
    );
  });

  it("skips cloning when the repository is already in the app folder", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: true };
    const repositories = FakeWorkspaceConnectionGateway.connected();
    renderPicker(docs, repositories);

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );

    await waitFor(() => expect(docs.connects).toHaveLength(1));
    expect(repositories.calls.map((entry) => entry.method)).not.toContain(
      "cloneRepository",
    );
  });

  it("shows the OKF warning after connecting a non-OKF repository", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: true };
    docs.okf = false;
    renderPicker(docs, FakeWorkspaceConnectionGateway.connected());

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );

    expect(
      await screen.findByText("OKF 형식에 맞지 않는 저장소입니다."),
    ).toBeInTheDocument();
  });

  it("never shows a local path", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: false };
    const repositories = FakeWorkspaceConnectionGateway.connected();
    renderPicker(docs, repositories);

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );
    await screen.findByText("문서 저장소를 받는 중…");

    expect(document.body.textContent).not.toContain("/app/repos");
  });

  it("ignores a second choice while the first is being prepared", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareGate = new Promise(() => {});
    renderPicker(docs, FakeWorkspaceConnectionGateway.connected());
    const button = await screen.findByRole("button", {
      name: "Mockly-Company/mockly-knowledge",
    });

    await user.click(button);
    await user.click(button);

    expect(docs.prepares).toHaveLength(1);
  });

  it("shows the reason when the clone fails", async () => {
    const user = userEvent.setup();
    const docs = new FakeDocsRepositoryGateway();
    docs.prepareResult = { parentDirectory: "/app/repos/Mockly-Company", alreadyCloned: false };
    const repositories = FakeWorkspaceConnectionGateway.connected();
    renderPicker(docs, repositories);

    await user.click(
      await screen.findByRole("button", { name: "Mockly-Company/mockly-knowledge" }),
    );
    await waitFor(() =>
      expect(repositories.calls.map((entry) => entry.method)).toContain("cloneRepository"),
    );
    const clone = repositories.calls.find((entry) => entry.method === "cloneRepository");
    repositories.emitClone({
      status: "failed",
      requestId: clone?.args[0] as string,
      error: { code: "clone_failed", message: "네트워크 오류", recovery: "retry", details: {} },
    } as never);

    expect(await screen.findByText(/네트워크 오류/)).toBeInTheDocument();
    expect(docs.connects).toEqual([]);
  });
});
