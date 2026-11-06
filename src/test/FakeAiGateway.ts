import type {
  AgentsMdResolution,
  AiConfig,
  AiGateway,
  AiTaskResult,
  AiToolAvailability,
  AiToolId,
  AppAgentsMdResolution,
} from "@/features/ai/AiGateway";

/** AI 연동 Fake. 메모리 template/cliCommand + 고정 agents_md + runTask 기록. */
export class FakeAiGateway implements AiGateway {
  template = `type "{prompt_file}" | my-ai-cli`;
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
  readonly runs: string[] = [];
  readonly sets: Array<{ command_template: string; cli_command: string }> = [];
  /** runTask에 전달된 도구 기록. runs와 같은 순서다. */
  readonly runTools: AiToolId[] = [];
  tools: AiToolAvailability = { claude: true, codex: true };
  cancels = 0;
  /** 지정하면 runTask가 이 값을 그대로 돌려준다. 실행 중 상태를 만들 때 쓴다. */
  runResult: Promise<AiTaskResult> | null = null;

  async getConfig(): Promise<AiConfig> {
    return {
      command_template: this.template,
      cli_command: this.cliCommand,
    };
  }

  async setConfig(
    command_template: string,
    cli_command: string,
  ): Promise<void> {
    this.sets.push({ command_template, cli_command });
    this.template = command_template;
    this.cliCommand = cli_command;
  }

  async detectTools(): Promise<AiToolAvailability> {
    return this.tools;
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

  async runTask(prompt: string, tool: AiToolId): Promise<AiTaskResult> {
    this.runs.push(prompt);
    this.runTools.push(tool);
    if (this.runResult) {
      return this.runResult;
    }
    return { status: "completed", exit_code: 0, output: `(fake) ${prompt}` };
  }

  async cancelTask(): Promise<void> {
    this.cancels += 1;
  }
}
