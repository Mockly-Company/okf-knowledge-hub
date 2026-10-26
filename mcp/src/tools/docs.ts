import { z } from "zod";
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve, relative, sep, dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkspaceConfig } from "../workspace.js";

const MAX_LIST_FILES = 300;
const MAX_READ_BYTES = 200_000;

function insideDocsRoot(root: string, docRoots: string[], target: string): string | null {
  const normalized = target.replace(/\\/g, "/");
  for (const docRoot of docRoots) {
    const base = resolve(root, docRoot);
    const resolved = resolve(root, docRoot, normalized);
    if (resolved === base || resolved.startsWith(base + sep)) {
      return resolved;
    }
  }
  return null;
}

async function walkFiles(dir: string, base: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_LIST_FILES) {
      return;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      await walkFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join("/"));
    }
  }
}

export function registerDocumentTools(
  server: McpServer,
  getConfig: () => Promise<WorkspaceConfig>,
): void {
  server.registerTool(
    "list_documents",
    {
      description:
        "워크스페이스 문서 루트 아래 OKF 문서 파일 목록을 반환한다. dir로 하위 경로를 좁힐 수 있다.",
      inputSchema: {
        dir: z
          .string()
          .optional()
          .describe("문서 루트 기준 하위 경로 (예: domains). 생략하면 전체를 나열한다."),
      },
    },
    async ({ dir }) => {
      const config = await getConfig();
      if (config.docRoots.length === 0) {
        throw new Error("워크스페이스에 문서 루트가 없다. .okf/workspace.yml의 documents.roots를 확인하라.");
      }
      const out: string[] = [];
      for (const root of config.docRoots) {
        const base = resolve(config.root, root);
        const start = dir ? insideDocsRoot(config.root, [root], dir) : base;
        if (!start) {
          throw new Error(`문서 범위 밖의 경로이다: ${dir}`);
        }
        const st = await stat(start).catch(() => null);
        if (!st) {
          continue;
        }
        if (st.isFile()) {
          out.push(relative(resolve(config.root), start).split(sep).join("/"));
        } else {
          await walkFiles(start, resolve(config.root), out);
        }
      }
      return {
        content: [
          {
            type: "text",
            text: out.length > 0 ? out.join("\n") : "문서가 없다.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "read_document",
    {
      description: "OKF 문서를 읽는다. 경로는 문서 루트 기준 상대 경로이다.",
      inputSchema: {
        path: z.string().describe("문서 경로 (예: domains/auth.md)"),
      },
    },
    async ({ path }) => {
      const config = await getConfig();
      const full = insideDocsRoot(config.root, config.docRoots, path);
      if (!full) {
        throw new Error(`문서 범위 밖의 경로이다: ${path}`);
      }
      const content = await readFile(full, "utf-8").catch(() => {
        throw new Error(`문서를 읽을 수 없다: ${path}`);
      });
      if (content.length > MAX_READ_BYTES) {
        return {
          content: [
            {
              type: "text",
              text: content.slice(0, MAX_READ_BYTES) + "\n... (잘림)",
            },
          ],
        };
      }
      return { content: [{ type: "text", text: content }] };
    },
  );

  server.registerTool(
    "create_document",
    {
      description:
        "OKF 문서를 새로 만든다. frontmatter에 id, title, type, status를 포함하라. 이미 있는 파일은 덮어쓰지 않는다(overwrite 명시 필요).",
      inputSchema: {
        path: z.string().describe("문서 경로 (예: decisions/2026-10-27-xxx.md)"),
        content: z.string().describe("Markdown 전체 내용"),
        overwrite: z.boolean().optional().describe("이미 있으면 덮어쓴다"),
      },
    },
    async ({ path, content, overwrite }) => {
      const config = await getConfig();
      const full = insideDocsRoot(config.root, config.docRoots, path);
      if (!full) {
        throw new Error(`문서 범위 밖의 경로이다: ${path}`);
      }
      const exists = await stat(full)
        .then(() => true)
        .catch(() => false);
      if (exists && !overwrite) {
        throw new Error(
          `이미 있는 파일이다: ${path}. overwrite=true로 다시 시도하라.`,
        );
      }
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `문서를 만들었다: ${relative(resolve(config.root), full).split(sep).join("/")}`,
          },
        ],
      };
    },
  );
}
