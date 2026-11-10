import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiGateway } from "@/features/ai/AiGateway";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
import { FakeProjectBoardGateway } from "@/test/FakeProjectBoardGateway";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { TestQueryProvider, createTestQueryClient } from "@/test/queryTestUtils";
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
    gateway.tools = { claude: true, codex: false };
    renderPage(gateway);

    expect(
      await screen.findByText("Codex가 설치되어 있지 않습니다."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeDisabled();
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

});
