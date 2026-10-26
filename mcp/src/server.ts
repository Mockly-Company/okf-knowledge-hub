import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GhRunner } from "./gh.js";
import type { WorkspaceConfig } from "./workspace.js";
import { registerWorkspaceTool } from "./tools/workspace.js";
import { registerBoardTools } from "./tools/board.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerDocumentTools } from "./tools/docs.js";

export function createServer(
  getConfig: () => Promise<WorkspaceConfig>,
  runGh: GhRunner,
): McpServer {
  const server = new McpServer({
    name: "okhub",
    version: "0.1.0",
    description:
      "OkHub 워크스페이스 MCP: 공유 지식 문서 조회/작성, GitHub 보드 조회, 형식에 맞는 이슈 생성을 AI 에이전트에 제공한다.",
  });

  registerWorkspaceTool(server, getConfig);
  registerBoardTools(server, getConfig, runGh);
  registerIssueTools(server, getConfig, runGh);
  registerDocumentTools(server, getConfig);
  return server;
}
