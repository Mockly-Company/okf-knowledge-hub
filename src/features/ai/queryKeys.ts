/**
 * AI 도메인 React Query 키.
 * - config: 터미널 명령·템플릿 설정 (설정 화면 저장 시 invalidate)
 * - agentsMd: 워크스페이스 AGENTS.md 해석본
 * - appAgentsMd: 허브 공통 규칙
 * - tools: 이 기기에 설치된 AI CLI
 */
export const aiKeys = {
  all: ["ai"] as const,
  config: ["ai", "config"] as const,
  agentsMd: ["ai", "agentsMd"] as const,
  appAgentsMd: ["ai", "appAgentsMd"] as const,
  tools: ["ai", "tools"] as const,
};
