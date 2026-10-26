import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loadWorkspaceConfig,
  resolveWorkspaceRoot,
  type WorkspaceConfig,
} from "../workspace.js";

export function workspaceSummary(config: WorkspaceConfig): string {
  const lines = [
    `워크스페이스: ${config.name}`,
    `루트: ${config.root}`,
    `문서 루트: ${config.docRoots.length > 0 ? config.docRoots.join(", ") : "(없음)"}`,
  ];
  if (config.repositories.length > 0) {
    lines.push("연결된 코드 저장소:");
    for (const repo of config.repositories) {
      lines.push(`- ${repo.label} (${repo.fullName})`);
    }
  }
  if (config.project) {
    lines.push(
      `GitHub Project: ${config.project.owner} #${config.project.number} (${config.project.id})`,
    );
  } else {
    lines.push("GitHub Project: 미연결");
  }
  return lines.join("\n");
}

export function registerWorkspaceTool(
  server: McpServer,
  getConfig: () => Promise<WorkspaceConfig>,
): void {
  server.registerTool(
    "get_workspace",
    {
      description:
        "OkHub 워크스페이스 요약을 반환한다. 문서 루트, 연결된 코드 저장소, 연결된 GitHub Project를 포함한다.",
    },
    async () => {
      const config = await getConfig();
      return { content: [{ type: "text", text: workspaceSummary(config) }] };
    },
  );
}

export async function currentWorkspaceConfig(
  workspaceOverride?: string,
): Promise<WorkspaceConfig> {
  const root = await resolveWorkspaceRoot(workspaceOverride);
  return loadWorkspaceConfig(root);
}
