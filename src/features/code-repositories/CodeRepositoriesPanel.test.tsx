import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/queryTestUtils";
import type {
  CodeRepositoriesGateway,
  WorkspaceCodeRepositoryStatus,
} from "./CodeRepositoriesGateway";
import { CodeRepositoriesPanel } from "./CodeRepositoriesPanel";

afterEach(cleanup);

describe("CodeRepositoriesPanel", () => {
  it("lists workspace code repositories and saves or resets manual local clone paths", async () => {
    let repos: WorkspaceCodeRepositoryStatus[] = [
      {
        key: "web",
        label: "Acme Web",
        fullName: "Acme-Org/acme-web",
        localPath: "/work/sibling/acme-web",
        mappingSource: "auto_detected",
        exists: true,
      },
      {
        key: "api",
        label: "Acme API",
        fullName: "Acme-Org/acme-api",
        localPath: null,
        mappingSource: "unmapped",
        exists: false,
      },
    ];

    const gateway: CodeRepositoriesGateway = {
      listWorkspaceCodeRepositories: vi.fn(async () => repos),
      setCodeRepositoryLocalPath: vi.fn(async (fullName, localPath) => {
        const updated: WorkspaceCodeRepositoryStatus = {
          key: "api",
          label: "Acme API",
          fullName,
          localPath,
          mappingSource: "manual",
          exists: true,
        };
        repos = repos.map((item) =>
          item.fullName === fullName ? updated : item,
        );
        return updated;
      }),
      clearCodeRepositoryLocalPath: vi.fn(async (fullName) => {
        repos = repos.map((item) =>
          item.fullName === fullName
            ? {
                ...item,
                localPath: null,
                mappingSource: "unmapped",
                exists: false,
              }
            : item,
        );
      }),
      readCodeRepositoryFile: vi.fn(),
    };

    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <CodeRepositoriesPanel gateway={gateway} />
      </TestQueryProvider>,
    );

    expect(await screen.findByText("Acme-Org/acme-web")).toBeInTheDocument();
    expect(screen.getByText("자동 감지됨")).toBeInTheDocument();
    expect(screen.getByText("미연결")).toBeInTheDocument();

    const apiInput = screen.getByLabelText("Acme-Org/acme-api 로컬 폴더 경로");
    await user.clear(apiInput);
    await user.type(apiInput, "/custom/clones/acme-api");
    await user.click(
      screen.getByRole("button", { name: "Acme-Org/acme-api 경로 저장" }),
    );

    await waitFor(() => {
      expect(gateway.setCodeRepositoryLocalPath).toHaveBeenCalledWith(
        "Acme-Org/acme-api",
        "/custom/clones/acme-api",
      );
    });
    expect(await screen.findByText("수동 연결됨")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Acme-Org/acme-api 수동 연결 해제" }),
    );
    await waitFor(() => {
      expect(gateway.clearCodeRepositoryLocalPath).toHaveBeenCalledWith(
        "Acme-Org/acme-api",
      );
    });
  });
});
