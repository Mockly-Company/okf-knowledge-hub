import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiGateway, AiTaskResult } from "@/features/ai/AiGateway";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { TestQueryProvider, createTestQueryClient } from "@/test/queryTestUtils";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import {
  LEGACY_BOARD_ID,
  projectBoardKeys,
} from "@/features/project-board/queryKeys";
import { AiPage } from "./AiPage";

afterEach(cleanup);

function renderPage(
  aiGateway: AiGateway,
  options?: { refreshDocuments?: () => Promise<void> },
) {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <AiPage
          aiGateway={aiGateway}
          projectBoardGateway={FakeProjectBoardGateway.empty()}
          refreshDocuments={options?.refreshDocuments}
        />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe("AiPage", () => {
  it("does not store a synced board under the project selected when the run started", async () => {
    const user = userEvent.setup();
    const client = createTestQueryClient();
    const key = projectBoardKeys.board(LEGACY_BOARD_ID);
    const before = { issues: [], fetchedAt: "before", skipped: 0, truncated: false };
    client.setQueryData(key, before);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AiPage
            aiGateway={new FakeAiGateway()}
            projectBoardGateway={FakeProjectBoardGateway.empty()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.type(await screen.findByLabelText("요청"), "요청");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() =>
      expect(client.getQueryState(key)?.isInvalidated).toBe(true),
    );
    expect(client.getQueryData(key)).toBe(before);
  });

  it("shows the last run result again after leaving and returning to the page", async () => {
    const user = userEvent.setup();
    const client = createTestQueryClient();
    const gateway = new FakeAiGateway();
    const page = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AiPage
            aiGateway={gateway}
            projectBoardGateway={FakeProjectBoardGateway.empty()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const first = render(page());
    await user.type(await screen.findByLabelText("요청"), "요청");
    await user.click(screen.getByRole("button", { name: "실행" }));
    await screen.findByLabelText("실행 결과");

    first.unmount();
    render(page());

    expect(await screen.findByLabelText("실행 결과")).toBeInTheDocument();
  });

  it("renders the request form with context summary", async () => {
    renderPage(new FakeAiGateway());

    expect(await screen.findByRole("heading", { name: "AI" })).toBeInTheDocument();
    expect(screen.getByLabelText("요청")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
    expect(await screen.findByText(/활성 프로젝트:/)).toBeInTheDocument();
    // 워크스페이스 경로와 AGENTS.md 경로 둘 다 표시된다.
    const pathMatches = await screen.findAllByText(/\/work\/mockly-knowledge/);
    expect(pathMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("runs the task through the gateway and shows the log", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    await user.type(await screen.findByLabelText("요청"), "이슈 생성해줘");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(gateway.runs).toEqual(["이슈 생성해줘"]));
    const result = await screen.findByLabelText("실행 결과");
    expect(result).toHaveTextContent("(fake) 이슈 생성해줘");
    expect(await screen.findByText("보드·문서를 새로고침했습니다.")).toBeInTheDocument();
  });

  it("refreshes the board and documents after a run", async () => {
    const gateway = new FakeAiGateway();
    const projectBoard = FakeProjectBoardGateway.empty();
    const refreshDocuments = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <MemoryRouter>
          <AiPage
            aiGateway={gateway}
            projectBoardGateway={projectBoard}
            refreshDocuments={refreshDocuments}
          />
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await user.type(await screen.findByLabelText("요청"), "기획서 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(gateway.runs).toEqual(["기획서 작업"]));
    expect(
      projectBoard.calls.filter((call) => call.method === "syncProjectBoard"),
    ).toHaveLength(1);
    expect(refreshDocuments).toHaveBeenCalledTimes(1);
  });

  it("refetches the board after a run even when its cache is fresh", async () => {
    const gateway = new FakeAiGateway();
    const projectBoard = FakeProjectBoardGateway.empty();
    const client = createTestQueryClient();
    client.setQueryData(projectBoardKeys.board(LEGACY_BOARD_ID), {
      issues: [],
      fetchedAt: null,
      skipped: 0,
      truncated: false,
    });
    const user = userEvent.setup();
    render(
      <TestQueryProvider client={client}>
        <MemoryRouter>
          <AiPage
            aiGateway={gateway}
            projectBoardGateway={projectBoard}
            refreshDocuments={vi.fn(async () => {})}
          />
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await user.type(await screen.findByLabelText("요청"), "기획서 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(gateway.runs).toEqual(["기획서 작업"]));
    await waitFor(() =>
      expect(
        projectBoard.calls.filter((call) => call.method === "syncProjectBoard"),
      ).toHaveLength(1),
    );
  });

  it("does not claim a refresh when the board refresh fails", async () => {
    const gateway = new FakeAiGateway();
    const projectBoard = FakeProjectBoardGateway.empty();
    projectBoard.loadError = new Error("동기화에 실패했습니다.");
    const user = userEvent.setup();
    render(
      <TestQueryProvider>
        <MemoryRouter>
          <AiPage aiGateway={gateway} projectBoardGateway={projectBoard} />
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await user.type(await screen.findByLabelText("요청"), "기획서 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await screen.findByLabelText("실행 결과");
    expect(
      screen.queryByText("보드·문서를 새로고침했습니다."),
    ).not.toBeInTheDocument();
  });

  it("hides a tool that is not installed and says so", async () => {
    const gateway = new FakeAiGateway();
    gateway.tools = { claude: true, codex: false };
    renderPage(gateway);

    expect(
      await screen.findByText("Codex가 설치되어 있지 않습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Codex로 실행")).toBeNull();
    expect(screen.getByLabelText("Claude Code로 실행")).toBeInTheDocument();
  });

  it("offers the custom command only when one is saved", async () => {
    const gateway = new FakeAiGateway();
    gateway.cliCommand = "";
    gateway.template = "";
    renderPage(gateway);

    await screen.findByLabelText("Claude Code로 실행");
    expect(screen.queryByLabelText("사용자 지정으로 실행")).toBeNull();
  });

  it("runs with the first installed tool by default", async () => {
    const gateway = new FakeAiGateway();
    gateway.tools = { claude: false, codex: true };
    const user = userEvent.setup();
    renderPage(gateway);

    await screen.findByText("Claude Code가 설치되어 있지 않습니다.");
    await user.type(screen.getByLabelText("요청"), "요약해줘");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(gateway.runTools).toEqual(["codex"]));
  });

  it("runs with the tool the user picked", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByLabelText("Codex로 실행"));
    await user.type(screen.getByLabelText("요청"), "요약해줘");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(gateway.runTools).toEqual(["codex"]));
  });

  it("blocks running when no tool is available", async () => {
    const gateway = new FakeAiGateway();
    gateway.tools = { claude: false, codex: false };
    gateway.template = "";
    gateway.cliCommand = "";
    const user = userEvent.setup();
    renderPage(gateway);

    expect(
      await screen.findByText("Claude Code가 설치되어 있지 않습니다."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("요청"), "요약해줘");

    expect(screen.getByRole("button", { name: "실행" })).toBeDisabled();
  });

  it("cancels a running task and reports it", async () => {
    const gateway = new FakeAiGateway();
    let finish: (result: AiTaskResult) => void = () => {};
    gateway.runResult = new Promise((resolve) => {
      finish = resolve;
    });
    gateway.cancelTask = async () => {
      gateway.cancels += 1;
      finish({ status: "cancelled", exit_code: -1, output: "중간 출력" });
    };
    const user = userEvent.setup();
    renderPage(gateway);

    await user.type(await screen.findByLabelText("요청"), "오래 걸리는 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));
    await user.click(await screen.findByRole("button", { name: "취소" }));

    expect(await screen.findByText("실행을 취소했습니다.")).toBeInTheDocument();
    expect(gateway.cancels).toBe(1);
    expect(screen.getByLabelText("실행 결과")).toHaveTextContent("중간 출력");
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });

  it("reports a task stopped by the time limit", async () => {
    const gateway = new FakeAiGateway();
    gateway.runResult = Promise.resolve({
      status: "timed_out",
      exit_code: -1,
      output: "",
    });
    const user = userEvent.setup();
    renderPage(gateway);

    await user.type(await screen.findByLabelText("요청"), "오래 걸리는 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));

    expect(
      await screen.findByText("시간 제한을 넘어 중단했습니다"),
    ).toBeInTheDocument();
  });

  it("still offers cancel after leaving and returning to the page", async () => {
    const gateway = new FakeAiGateway();
    gateway.runResult = new Promise(() => {});
    const client = createTestQueryClient();
    const user = userEvent.setup();
    const page = () => (
      <TestQueryProvider client={client}>
        <MemoryRouter>
          <AiPage
            aiGateway={gateway}
            projectBoardGateway={FakeProjectBoardGateway.empty()}
          />
        </MemoryRouter>
      </TestQueryProvider>
    );
    const first = render(page());

    await user.type(await screen.findByLabelText("요청"), "오래 걸리는 작업");
    await user.click(screen.getByRole("button", { name: "실행" }));
    await screen.findByRole("button", { name: "취소" });
    first.unmount();

    render(page());

    expect(await screen.findByRole("button", { name: "취소" })).toBeInTheDocument();
  });

  it("shows the unsupported guidance when the backend is missing", async () => {
    const failing: AiGateway = {
      getConfig: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      setConfig: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      detectTools: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      cancelTask: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      resolveAgentsMd: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      resolveAppAgentsMd: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      createAgentsMd: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      runTask: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
    };
    const user = userEvent.setup();
    renderPage(failing);

    expect(await screen.findByText("아직 지원되지 않습니다")).toBeInTheDocument();

    await user.type(screen.getByLabelText("요청"), "이슈 생성해줘");
    await user.click(screen.getByRole("button", { name: "실행" }));

    expect(await screen.findByText("실행에 실패했습니다")).toBeInTheDocument();
  });

  it("works inside the documents provider refresh wiring", async () => {
    const documentsGateway = new FakeDocumentsGateway();
    documentsGateway.sessionSnapshot.lastOpenedPath = null;
    const aiGateway = new FakeAiGateway();
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    render(
      <TestQueryProvider>
        <MemoryRouter>
          <DocumentsProvider gateway={documentsGateway} searchDebounceMs={0}>
            <AiPage
              aiGateway={aiGateway}
              projectBoardGateway={FakeProjectBoardGateway.empty()}
              refreshDocuments={refresh}
            />
          </DocumentsProvider>
        </MemoryRouter>
      </TestQueryProvider>,
    );

    await user.type(await screen.findByLabelText("요청"), "문서 새로고침 확인");
    await user.click(screen.getByRole("button", { name: "실행" }));

    await waitFor(() => expect(aiGateway.runs).toEqual(["문서 새로고침 확인"]));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
