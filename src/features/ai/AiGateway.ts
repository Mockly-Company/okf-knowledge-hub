/**
 * AI CLI 연동 게이트웨이 계약. invoke명/인자는 백엔드 lane과 공유한다.
 * - `get_ai_config` {} → `{ cli_command: string }`
 * - `set_ai_config` `{ cliCommand: string }`
 * - `detect_ai_tools` {} → `{ claude: boolean, codex: boolean }`
 * - `start_ai_terminal` `{ tool, cols, rows, onEvent: Channel }` → `{ session_id }`
 * - `write_ai_terminal` `{ sessionId, data }`, `resize_ai_terminal` `{ sessionId, cols, rows }`,
 *   `stop_ai_terminal` `{ sessionId }` → `boolean`
 * - `resolve_agents_md` {} → `{ workspace_path, path, content, repository_full_name }`
 * - `resolve_app_agents_md` {} → `{ path: string, content: string }`
 * - `create_agents_md` {} → `{ path: string }`
 * 모두 snake_case. 백엔드가 없으면 게이트웨이가
 * "아직 지원되지 않습니다" 에러로 폴백한다.
 */
export type AiToolId = "claude" | "codex" | "custom";

export interface AiToolAvailability {
  claude: boolean;
  codex: boolean;
}

export type AiTerminalEvent =
  | { kind: "output"; data: string }
  | { kind: "exit"; exit_code: number };

export interface AiConfig {
  cli_command: string;
}

export interface AgentsMdResolution {
  workspace_path: string;
  path: string | null;
  content: string | null;
  /** 문서 저장소 이름(`owner/name`). 예전 백엔드나 이름 없는 폴더면 없다. */
  repository_full_name?: string | null;
}

export interface AppAgentsMdResolution {
  path: string;
  content: string;
}

export interface AiGateway {
  getConfig(): Promise<AiConfig>;
  setConfig(cliCommand: string): Promise<void>;
  detectTools(): Promise<AiToolAvailability>;
  startTerminal(
    tool: AiToolId,
    size: { cols: number; rows: number },
    onEvent: (event: AiTerminalEvent) => void,
  ): Promise<string>;
  writeTerminal(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  stopTerminal(sessionId: string): Promise<void>;
  resolveAgentsMd(): Promise<AgentsMdResolution>;
  resolveAppAgentsMd(): Promise<AppAgentsMdResolution>;
  createAgentsMd(): Promise<{ path: string }>;
}
