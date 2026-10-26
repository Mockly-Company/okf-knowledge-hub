import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listProjectItems,
  toBoardIssues,
  type BoardIssue,
} from "../board.js";
import type { GhRunner } from "../gh.js";
import type { WorkspaceConfig } from "../workspace.js";

function formatIssue(issue: BoardIssue, depth = 0): string {
  const indent = "  ".repeat(depth);
  const kind = issue.kind ? ` [${issue.kind}]` : "";
  const lines = [
    `${indent}- #${issue.number} ${issue.title} [${issue.layer}/${issue.status}]${kind} (${issue.url})`,
  ];
  for (const child of issue.children) {
    lines.push(formatIssue(child, depth + 1));
  }
  return lines.join("\n");
}

export function formatBoard(issues: BoardIssue[]): string {
  return issues.map((issue) => formatIssue(issue)).join("\n");
}

export function registerBoardTools(
  server: McpServer,
  getConfig: () => Promise<WorkspaceConfig>,
  runGh: GhRunner,
): void {
  server.registerTool(
    "list_board",
    {
      description:
        "연결된 GitHub Project의 이슈/PR을 레이어(기획/디자인/프론트/백엔드/미지정)와 상태별로 묶은 보드로 반환한다. 에픽-스토리-하위 항목 계층을 포함한다.",
      inputSchema: {
        include_done: z
          .boolean()
          .optional()
          .describe("완료된 항목 포함 여부. 기본값은 제외한다."),
      },
    },
    async ({ include_done }) => {
      const config = await getConfig();
      if (!config.project) {
        throw new Error(
          "GitHub Project가 연결되지 않았습니다. .okf/workspace.yml의 github.project를 확인하세요.",
        );
      }
      const raw = await listProjectItems(
        runGh,
        config.project.owner,
        config.project.number,
        true,
      ).catch(async (error: unknown) => {
        if (
          error instanceof Error &&
          error.message.includes("찾을 수 없습니다")
        ) {
          return listProjectItems(
            runGh,
            config.project!.owner,
            config.project!.number,
            false,
          );
        }
        throw error;
      });
      let issues = toBoardIssues(raw);
      if (!include_done) {
        issues = stripDone(issues);
      }
      const text = issues.length > 0
        ? formatBoard(issues)
        : "표시할 항목이 없습니다.";
      return { content: [{ type: "text", text }] };
    },
  );
}

function stripDone(issues: BoardIssue[]): BoardIssue[] {
  const kept: BoardIssue[] = [];
  for (const issue of issues) {
    const children = stripDone(issue.children);
    if (issue.status === "done") {
      kept.push(...children);
    } else {
      kept.push({ ...issue, children });
    }
  }
  return kept;
}
