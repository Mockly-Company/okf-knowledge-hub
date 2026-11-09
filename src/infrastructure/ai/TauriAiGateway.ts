import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AgentsMdResolution,
  AiConfig,
  AiGateway,
  AiTerminalEvent,
  AiToolAvailability,
  AiToolId,
  AppAgentsMdResolution,
} from "@/features/ai/AiGateway";

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const invokeDesktop: InvokeDesktop = (command, args) =>
  invoke(command, args);

/** 백엔드 lane이 붙기 전에는 invoke가 실패하므로 안내 에러로 폴백한다. */
function unsupported(): Error {
  return new Error("아직 지원되지 않습니다");
}

/**
 * 백엔드가 준 에러 메시지는 살리고, 명령 자체가 없을 때만 폴백한다.
 * (메시지를 통째로 삼키면 "미설정" 같은 실제 사유가 안 보인다.)
 */
function withBackendMessage(error: unknown): Error {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return new Error(message);
    }
  }
  if (
    typeof error === "string" &&
    error.trim().length > 0 &&
    !/command.*not found|not registered|unknown command|not allowed/i.test(error)
  ) {
    return new Error(error);
  }
  return unsupported();
}

interface TerminalChannel {
  onmessage: (event: AiTerminalEvent) => void;
}

export class TauriAiGateway implements AiGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
    private readonly createChannel: () => TerminalChannel = () =>
      new Channel<AiTerminalEvent>(),
  ) {}

  async getConfig(): Promise<AiConfig> {
    try {
      const raw = await this.invokeCommand<{
        cli_command?: string;
      }>("get_ai_config");
      return {
        cli_command: raw.cli_command ?? "",
      };
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async setConfig(cliCommand: string): Promise<void> {
    try {
      await this.invokeCommand<void>("set_ai_config", { cliCommand });
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async detectTools(): Promise<AiToolAvailability> {
    try {
      return await this.invokeCommand<AiToolAvailability>("detect_ai_tools");
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async startTerminal(
    tool: AiToolId,
    size: { cols: number; rows: number },
    onEvent: (event: AiTerminalEvent) => void,
  ): Promise<string> {
    const channel = this.createChannel();
    channel.onmessage = onEvent;
    try {
      const result = await this.invokeCommand<{ session_id: string }>(
        "start_ai_terminal",
        { tool, cols: size.cols, rows: size.rows, onEvent: channel },
      );
      return result.session_id;
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async writeTerminal(sessionId: string, data: string): Promise<void> {
    await this.invokeCommand<boolean>("write_ai_terminal", { sessionId, data });
  }

  async resizeTerminal(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    await this.invokeCommand<boolean>("resize_ai_terminal", {
      sessionId,
      cols,
      rows,
    });
  }

  async stopTerminal(sessionId: string): Promise<void> {
    await this.invokeCommand<boolean>("stop_ai_terminal", { sessionId });
  }

  async resolveAgentsMd(): Promise<AgentsMdResolution> {
    try {
      return await this.invokeCommand<AgentsMdResolution>(
        "resolve_agents_md",
      );
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async resolveAppAgentsMd(): Promise<AppAgentsMdResolution> {
    try {
      return await this.invokeCommand<AppAgentsMdResolution>(
        "resolve_app_agents_md",
      );
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async createAgentsMd(): Promise<{ path: string }> {
    try {
      return await this.invokeCommand<{ path: string }>("create_agents_md");
    } catch (error) {
      throw withBackendMessage(error);
    }
  }
}
