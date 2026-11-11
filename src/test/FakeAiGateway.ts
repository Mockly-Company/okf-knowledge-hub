import type {
  AgentsMdResolution,
  AiConfig,
  AiGateway,
  AiTerminalEvent,
  AiToolAvailability,
  AiToolId,
  AppAgentsMdResolution,
} from "@/features/ai/AiGateway";

/** AI 연동 Fake. 메모리 cliCommand + 고정 agents_md + 터미널 기록. */
export class FakeAiGateway implements AiGateway {
  cliCommand = "codex";
  agentsMd: AgentsMdResolution = {
    workspace_path: "/work/mockly-knowledge",
    path: "/work/mockly-knowledge/.okf/AGENTS.md",
    content: "# AGENTS\n\n- 테스트 규칙\n- 문서 규칙\n",
  };
  appAgentsMd: AppAgentsMdResolution = {
    path: "/app/AGENTS.md",
    content:
      "# APP AGENTS\n\n- 허브 공통 규칙 1\n- 허브 공통 규칙 2\n- 허브 공통 규칙 3\n- 허브 공통 규칙 4\n- 허브 공통 규칙 5\n- 허브 공통 규칙 6\n- 허브 공통 규칙 7\n- 허브 공통 규칙 8\n- 허브 공통 규칙 9\n- 허브 공통 규칙 10\n- 허브 공통 규칙 11\n- 허브 공통 규칙 12\n",
  };
  /** false면 resolveAgentsMd가 "없음"(path/content null)으로 응답한다. */
  agentsMdExists = true;
  readonly creates: string[] = [];
  readonly sets: string[] = [];
  /** startTerminal 호출 기록. 각 항목은 연 도구다. */
  readonly terminalStarts: AiToolId[] = [];
  readonly terminalWrites: Array<{ sessionId: string; data: string }> = [];
  readonly terminalResizes: Array<{
    sessionId: string;
    cols: number;
    rows: number;
  }> = [];
  readonly terminalStops: string[] = [];
  private readonly terminalListeners: Array<(event: AiTerminalEvent) => void> =
    [];
  tools: AiToolAvailability = { claude: true, codex: true, antigravity: true };

  async getConfig(): Promise<AiConfig> {
    return { cli_command: this.cliCommand };
  }

  async setConfig(cliCommand: string): Promise<void> {
    this.sets.push(cliCommand);
    this.cliCommand = cliCommand;
  }

  async detectTools(): Promise<AiToolAvailability> {
    return this.tools;
  }

  async startTerminal(
    tool: AiToolId,
    _size: { cols: number; rows: number },
    onEvent: (event: AiTerminalEvent) => void,
  ): Promise<string> {
    const index = this.terminalStarts.length;
    this.terminalStarts.push(tool);
    this.terminalListeners.push(onEvent);
    return `session-${index}`;
  }

  /** index번째로 시작한 터미널에 백엔드 이벤트를 보낸다. */
  emitTerminal(index: number, event: AiTerminalEvent): void {
    this.terminalListeners[index](event);
  }

  async writeTerminal(sessionId: string, data: string): Promise<void> {
    this.terminalWrites.push({ sessionId, data });
  }

  async resizeTerminal(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    this.terminalResizes.push({ sessionId, cols, rows });
  }

  async stopTerminal(sessionId: string): Promise<void> {
    this.terminalStops.push(sessionId);
  }

  async resolveAgentsMd(): Promise<AgentsMdResolution> {
    if (!this.agentsMdExists) {
      return {
        workspace_path: this.agentsMd.workspace_path,
        path: null,
        content: null,
      };
    }
    return this.agentsMd;
  }

  async resolveAppAgentsMd(): Promise<AppAgentsMdResolution> {
    return this.appAgentsMd;
  }

  async createAgentsMd(): Promise<{ path: string }> {
    const path = this.agentsMd.path ?? "/work/mockly-knowledge/.okf/AGENTS.md";
    this.creates.push(path);
    this.agentsMdExists = true;
    this.agentsMd = {
      workspace_path: this.agentsMd.workspace_path,
      path,
      content:
        this.agentsMd.content ?? "# AGENTS\n\n- 테스트 규칙\n- 문서 규칙\n",
    };
    return { path };
  }
}
