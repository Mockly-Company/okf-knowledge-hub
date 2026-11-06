/**
 * AI CLI 연동 게이트웨이 계약. invoke명/인자는 백엔드 lane과 공유한다.
 * - `get_ai_config` {} → `{ command_template: string, cli_command: string }`
 * - `set_ai_config` `{ command_template: string, cli_command: string }`
 * - `detect_ai_tools` {} → `{ claude: boolean, codex: boolean }`
 * - `resolve_agents_md` {} → `{ workspace_path, path, content }`
 * - `resolve_app_agents_md` {} → `{ path: string, content: string }`
 * - `create_agents_md` {} → `{ path: string }`
 * - `run_ai_task` `{ prompt: string, tool }` → `{ status, exit_code, output }`
 * - `cancel_ai_task` {} → `boolean`
 * 모두 snake_case. 백엔드가 없으면 게이트웨이가
 * "아직 지원되지 않습니다" 에러로 폴백한다.
 */
export type AiToolId = "claude" | "codex" | "custom";

export interface AiToolAvailability {
  claude: boolean;
  codex: boolean;
}

export type AiTaskStatus = "completed" | "cancelled" | "timed_out";

export interface AiConfig {
  command_template: string;
  cli_command: string;
}

export interface AgentsMdResolution {
  workspace_path: string;
  path: string | null;
  content: string | null;
}

export interface AppAgentsMdResolution {
  path: string;
  content: string;
}

export interface AiTaskResult {
  status: AiTaskStatus;
  exit_code: number;
  output: string;
}

export interface AiGateway {
  getConfig(): Promise<AiConfig>;
  setConfig(command_template: string, cli_command: string): Promise<void>;
  detectTools(): Promise<AiToolAvailability>;
  resolveAgentsMd(): Promise<AgentsMdResolution>;
  resolveAppAgentsMd(): Promise<AppAgentsMdResolution>;
  createAgentsMd(): Promise<{ path: string }>;
  runTask(prompt: string, tool: AiToolId): Promise<AiTaskResult>;
  cancelTask(): Promise<void>;
}
