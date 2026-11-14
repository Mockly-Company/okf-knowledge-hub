import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiGateway } from "@/features/ai/AiGateway";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeDocsRepositoryGateway } from "@/test/FakeDocsRepositoryGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { TestQueryProvider, createTestQueryClient } from "@/test/queryTestUtils";
import {
  ActiveProjectProvider,
  useActiveProject,
} from "@/features/active-project/ActiveProjectProvider";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import {
  LEGACY_BOARD_ID,
  projectBoardKeys,
} from "@/features/project-board/queryKeys";
import { AiPage } from "./AiPage";

afterEach(() => {
  cleanup();
  FakeTerminalRenderer.created = [];
});

function renderPage(aiGateway: AiGateway) {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <AiPage
          aiGateway={aiGateway}
          terminalRendererFactory={FakeTerminalRenderer.create}
        />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe("AiPage", () => {
  it("shows only terminal launchers", async () => {
    renderPage(new FakeAiGateway());

    expect(
      await screen.findByRole("button", { name: "Claude Code" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "실행 도구" })).toBeNull();
    expect(screen.queryByLabelText("요청")).toBeNull();
  });

  it("renders the context summary", async () => {
    renderPage(new FakeAiGateway());

    expect(await screen.findByRole("heading", { name: "AI" })).toBeInTheDocument();
    expect(await screen.findByText(/프로젝트:/)).toBeInTheDocument();
  });

  it("shows the docs repository name instead of paths", async () => {
    const gateway = new FakeAiGateway();
    gateway.agentsMd = {
      workspace_path: "C:\\x",
      path: "C:\\x\\.okf\\AGENTS.md",
      content: "# 규칙",
      repository_full_name: "a/docs",
    };
    renderPage(gateway);

    expect(await screen.findByText("문서 저장소: a/docs")).toBeInTheDocument();
    expect(
      screen.getByText(/AI 규칙: 앱 기본 규칙 \+ 작업 규칙\(worktree·PR\) \+ 저장소 규칙/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("C:\\x");
  });

  it("names an unnamed docs repository instead of leaving it blank", async () => {
    const gateway = new FakeAiGateway();
    gateway.agentsMd = { ...gateway.agentsMd, repository_full_name: "" };
    renderPage(gateway);

    expect(await screen.findByText("문서 저장소: 이름 없는 저장소")).toBeInTheDocument();
  });

  it("asks to choose a docs repository when none is connected", async () => {
    const gateway = new FakeAiGateway();
    gateway.resolveAgentsMd = async () => {
      throw new Error("연결된 워크스페이스가 없습니다.");
    };
    renderPage(gateway);

    expect(
      await screen.findByRole("link", { name: "문서 저장소를 선택하세요" }),
    ).toHaveAttribute("href", "/documents");
  });

  it("numbers tabs when the same tool is opened twice", async () => {
    const user = userEvent.setup();
    renderPage(new FakeAiGateway());

    await user.click(await screen.findByRole("button", { name: "Claude Code" }));
    await screen.findByRole("tab", { name: "Claude Code" });
    await user.click(screen.getByRole("button", { name: "Claude Code" }));

    expect(await screen.findByRole("tab", { name: "Claude Code 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Claude Code" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Claude Code 2 터미널 닫기" }),
    ).toBeInTheDocument();
  });

  it("opens Claude Code inside the app with one click and no setup", async () => {
    const gateway = new FakeAiGateway();
    gateway.cliCommand = "";
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: "Claude Code" }));

    await waitFor(() => expect(gateway.terminalStarts).toEqual(["claude"]));
    expect(await screen.findByRole("tab", { name: "Claude Code" })).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel", { name: "Claude Code" });
    expect(FakeTerminalRenderer.created[0].parent).toBe(panel.firstElementChild);
  });

  it("opens Codex inside the app", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    const button = await screen.findByRole("button", { name: "Codex" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(gateway.terminalStarts).toEqual(["codex"]));
  });

  it("opens Antigravity inside the app", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    const button = await screen.findByRole("button", { name: "Antigravity" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(gateway.terminalStarts).toEqual(["antigravity"]));
    expect(await screen.findByRole("tab", { name: "Antigravity" })).toBeInTheDocument();
  });

  it("switches between open terminals without restarting them", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: "Claude Code" }));
    await screen.findByRole("tab", { name: "Claude Code" });
    await user.click(screen.getByRole("button", { name: "Codex" }));
    await screen.findByRole("tab", { name: "Codex" });
    expect(FakeTerminalRenderer.created[1].parent).not.toBeNull();
    expect(FakeTerminalRenderer.created[0].parent).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Claude Code" }));

    expect(FakeTerminalRenderer.created[0].parent).not.toBeNull();
    expect(FakeTerminalRenderer.created[1].parent).toBeNull();
    expect(gateway.terminalStarts).toEqual(["claude", "codex"]);
    expect(gateway.terminalStops).toEqual([]);
  });

  it("closes a terminal and stops its process", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);
    await user.click(await screen.findByRole("button", { name: "Claude Code" }));

    await user.click(
      await screen.findByRole("button", { name: "Claude Code 터미널 닫기" }),
    );

    await waitFor(() => expect(gateway.terminalStops).toEqual(["session-0"]));
    expect(screen.queryByRole("tab", { name: "Claude Code" })).toBeNull();
  });

  it("shows when the process in a terminal has ended", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    renderPage(gateway);
    await user.click(await screen.findByRole("button", { name: "Claude Code" }));
    await screen.findByRole("tab", { name: "Claude Code" });

    act(() => gateway.emitTerminal(0, { kind: "exit", exit_code: 2 }));

    expect(
      await screen.findByText("터미널이 종료되었습니다 (코드 2)."),
    ).toBeInTheDocument();
  });

  it("keeps a terminal running after leaving and returning to the page", async () => {
    const gateway = new FakeAiGateway();
    const user = userEvent.setup();
    const first = renderPage(gateway);
    await user.click(await screen.findByRole("button", { name: "Claude Code" }));
    await screen.findByRole("tab", { name: "Claude Code" });

    first.unmount();
    expect(FakeTerminalRenderer.created[0].parent).toBeNull();
    gateway.emitTerminal(0, { kind: "output", data: "다른 화면에 있는 동안" });
    expect(gateway.terminalStops).toEqual([]);
    renderPage(gateway);

    expect(await screen.findByRole("tab", { name: "Claude Code" })).toBeInTheDocument();
    expect(FakeTerminalRenderer.created).toHaveLength(1);
    expect(FakeTerminalRenderer.created[0].parent).not.toBeNull();
    expect(FakeTerminalRenderer.created[0].written).toContain("다른 화면에 있는 동안");
  });

  it("disables a tool that is not installed and says so", async () => {
    const gateway = new FakeAiGateway();
    gateway.tools = { claude: true, codex: false, antigravity: false };
    renderPage(gateway);

    expect(
      await screen.findByText("Codex가 설치되어 있지 않습니다."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Antigravity가 설치되어 있지 않습니다."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Antigravity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeEnabled();
  });

  it("offers the custom command only when one is saved", async () => {
    const gateway = new FakeAiGateway();
    gateway.cliCommand = "";
    renderPage(gateway);

    await screen.findByRole("button", { name: "Claude Code" });
    expect(screen.queryByRole("button", { name: "사용자 지정" })).toBeNull();
  });

  it("links to settings from the terminal error", async () => {
    const gateway = new FakeAiGateway();
    gateway.startTerminal = async () => {
      throw new Error("AI 터미널을 시작할 수 없습니다.");
    };
    const user = userEvent.setup();
    renderPage(gateway);

    await user.click(await screen.findByRole("button", { name: "Claude Code" }));

    expect(
      await screen.findByText("터미널을 열지 못했습니다"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "설정에서 확인" }),
    ).toHaveAttribute("href", "/settings");
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
      startTerminal: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      writeTerminal: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      resizeTerminal: async () => {
        throw new Error("아직 지원되지 않습니다");
      },
      stopTerminal: async () => {
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
    };
    renderPage(failing);

    expect(await screen.findByText("아직 지원되지 않습니다")).toBeInTheDocument();
  });

  it("displays standalone docs mode clearly in the context summary when no Project board is attached", async () => {
    const aiGateway = new FakeAiGateway();
    aiGateway.agentsMd = {
      workspace_path: "C:\\workspaces\\handbook",
      path: null,
      content: null,
      repository_full_name: "Mockly-Company/handbook",
    };
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    docsRepoGateway.workspaces = [
      {
        id: "docs:Mockly-Company/handbook",
        title: "Mockly-Company/handbook",
        project: null,
        docsRepository: {
          repositoryId: "R_2",
          fullName: "Mockly-Company/handbook",
        },
      },
    ];
    docsRepoGateway.activeWorkspaceId = "docs:Mockly-Company/handbook";

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={new FakeProjectBoardGateway()}
          docsRepositoryGateway={docsRepoGateway}
        >
          <MemoryRouter>
            <AiPage
              aiGateway={aiGateway}
              terminalRendererFactory={FakeTerminalRenderer.create}
            />
          </MemoryRouter>
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    expect(within(contextBar).getByText("문서 전용")).toBeVisible();
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/handbook"),
    ).toBeVisible();
    expect(within(contextBar).queryByText("상위 Project 없음")).toBeNull();
  });

  it("isolates open CLI terminals per workspace, shows background running terminal hint, and restores the previous workspace's running terminal on switch back", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const aiGateway = new FakeAiGateway();
    const docsRepoGateway = new FakeDocsRepositoryGateway();
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_beta",
        owner: "Mockly-Company",
        number: 2,
        title: "Beta",
        scope: "organization",
      },
      { repositoryId: "R_beta", fullName: "Mockly-Company/beta-docs" },
    );
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");

    function SwitcherControls() {
      const { selectWorkspace } = useActiveProject();
      return (
        <div>
          <button
            type="button"
            onClick={() => void selectWorkspace("PVT_alpha")}
          >
            Alpha 전환
          </button>
          <button
            type="button"
            onClick={() => void selectWorkspace("PVT_beta")}
          >
            Beta 전환
          </button>
        </div>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={new FakeProjectBoardGateway()}
          docsRepositoryGateway={docsRepoGateway}
          aiGateway={aiGateway}
        >
          <MemoryRouter>
            <SwitcherControls />
            <AiPage
              aiGateway={aiGateway}
              terminalRendererFactory={FakeTerminalRenderer.create}
            />
          </MemoryRouter>
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    const contextBar = await screen.findByRole("region", {
      name: "현재 작업 공간",
    });
    await waitFor(() =>
      expect(within(contextBar).getByText("선택된 Project · Alpha")).toBeInTheDocument(),
    );
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/alpha-docs"),
    ).toBeInTheDocument();

    // Alpha에서 Claude Code 터미널 실행
    await user.click(await screen.findByRole("button", { name: "Claude Code" }));
    expect(
      await screen.findByRole("tab", { name: /Claude Code/ }),
    ).toBeInTheDocument();

    // Beta로 전환하면 Beta는 깨끗한 AI 화면이고 Alpha 터미널은 종료되지 않은 채 백그라운드 안내가 뜬다
    await user.click(screen.getByRole("button", { name: "Beta 전환" }));
    await waitFor(() =>
      expect(within(contextBar).getByText("선택된 Project · Beta")).toBeInTheDocument(),
    );
    expect(
      within(contextBar).getByText("문서 저장소 · Mockly-Company/beta-docs"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Claude Code/ })).toBeNull();
    expect(aiGateway.terminalStops).toEqual([]);
    expect(
      screen.getByText("다른 워크스페이스에서 실행 중인 AI 터미널 1개"),
    ).toBeInTheDocument();

    // Beta에서는 Antigravity 실행
    await user.click(screen.getByRole("button", { name: "Antigravity" }));
    expect(
      await screen.findByRole("tab", { name: /Antigravity/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Claude Code/ })).toBeNull();

    // 다시 Alpha로 돌아오면 Claude Code 탭이 그대로 복원된다
    await user.click(screen.getByRole("button", { name: "Alpha 전환" }));
    await waitFor(() =>
      expect(within(contextBar).getByText("선택된 Project · Alpha")).toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("tab", { name: /Claude Code/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Antigravity/ })).toBeNull();
    expect(
      screen.getByText("다른 워크스페이스에서 실행 중인 AI 터미널 1개"),
    ).toBeInTheDocument();
  });

  it("does not leak openError or clobber openingTool when an in-flight startTerminal settles after switching workspaces", async () => {
    const user = userEvent.setup();
    const aiGateway = new FakeAiGateway();
    let rejectAlphaStart: ((err: Error) => void) | null = null;
    let resolveBetaStart: ((id: string) => void) | null = null;
    aiGateway.startTerminal = (tool) => {
      if (tool === "claude") {
        return new Promise<string>((_, reject) => {
          rejectAlphaStart = reject;
        });
      }
      return new Promise<string>((resolve) => {
        resolveBetaStart = resolve;
      });
    };

    const docsRepoGateway = new FakeDocsRepositoryGateway();
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_alpha",
        owner: "Mockly-Company",
        number: 1,
        title: "Alpha",
        scope: "organization",
      },
      { repositoryId: "R_alpha", fullName: "Mockly-Company/alpha-docs" },
    );
    await docsRepoGateway.createProjectWorkspace(
      {
        id: "PVT_beta",
        owner: "Mockly-Company",
        number: 2,
        title: "Beta",
        scope: "organization",
      },
      { repositoryId: "R_beta", fullName: "Mockly-Company/beta-docs" },
    );
    await docsRepoGateway.setActiveWorkspace("PVT_alpha");

    function SwitcherControls() {
      const { selectWorkspace } = useActiveProject();
      return (
        <button
          type="button"
          onClick={() => void selectWorkspace("PVT_beta")}
        >
          Beta 전환
        </button>
      );
    }

    render(
      <TestQueryProvider>
        <ActiveProjectProvider
          projectGateway={new FakeProjectBoardGateway()}
          docsRepositoryGateway={docsRepoGateway}
          aiGateway={aiGateway}
        >
          <MemoryRouter>
            <SwitcherControls />
            <AiPage
              aiGateway={aiGateway}
              terminalRendererFactory={FakeTerminalRenderer.create}
            />
          </MemoryRouter>
        </ActiveProjectProvider>
      </TestQueryProvider>,
    );

    const claudeBtn = await screen.findByRole("button", { name: "Claude Code" });
    await user.click(claudeBtn);
    expect(rejectAlphaStart).not.toBeNull();

    // Alpha의 startTerminal이 아직 끝나기 전에 Beta로 전환 후 Antigravity 실행 시작
    await user.click(screen.getByRole("button", { name: "Beta 전환" }));
    const agyBtn = await screen.findByRole("button", { name: "Antigravity" });
    await waitFor(() => expect(agyBtn).toBeEnabled());
    await user.click(agyBtn);
    expect(resolveBetaStart).not.toBeNull();
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeDisabled();

    // 뒤늦게 Alpha의 startTerminal이 실패해도 Beta 화면에 에러가 뜨거나 Beta의 로딩 중 상태가 풀리지 않아야 한다
    await act(async () => {
      rejectAlphaStart!(new Error("Alpha PTY 실행 실패"));
    });
    expect(screen.queryByText(/Alpha PTY 실행 실패/)).toBeNull();
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeDisabled();

    await act(async () => {
      resolveBetaStart!("beta-pty-1");
    });
    expect(
      await screen.findByRole("tab", { name: /Antigravity/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeEnabled();
  });

});
