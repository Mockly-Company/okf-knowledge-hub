import { invoke } from "@tauri-apps/api/core";
import type {
  AgentsMdResolution,
  AiConfig,
  AiGateway,
  AiTaskResult,
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

export class TauriAiGateway implements AiGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
  ) {}

  async getConfig(): Promise<AiConfig> {
    try {
      const raw = await this.invokeCommand<{
        command_template?: string;
        cli_command?: string;
      }>("get_ai_config");
      return {
        command_template: raw.command_template ?? "",
        cli_command: raw.cli_command ?? "",
      };
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async setConfig(
    command_template: string,
    cli_command: string,
  ): Promise<void> {
    try {
      await this.invokeCommand<void>("set_ai_config", {
        commandTemplate: command_template,
        cliCommand: cli_command,
      });
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

  async runTask(prompt: string, tool: AiToolId): Promise<AiTaskResult> {
    try {
      return await this.invokeCommand<AiTaskResult>("run_ai_task", {
        prompt,
        tool,
      });
    } catch (error) {
      throw withBackendMessage(error);
    }
  }

  async cancelTask(): Promise<void> {
    try {
      await this.invokeCommand<boolean>("cancel_ai_task");
    } catch (error) {
      throw withBackendMessage(error);
    }
  }
}
