import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { GhRunner } from "../src/gh.js";
import type { WorkspaceConfig } from "../src/workspace.js";

const CONFIG: WorkspaceConfig = {
  root: "/ws",
  name: "Mockly",
  docRoots: ["docs"],
  repositories: [
    { key: "mockly-server", label: "Mockly 서버", id: "R_1", fullName: "o/mockly-server" },
  ],
  project: { id: "PVT_x", owner: "o", number: 1, title: "B" },
};

const noGh: GhRunner = async () => {
  throw new Error("gh를 호출하면 안 되는 테스트입니다");
};

async function withClient(
  gateway: ReturnType<typeof createServer>,
  fn: (client: InstanceType<typeof Client>) => Promise<void>,
): Promise<void> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([client.connect(ct), gateway.connect(st)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await gateway.close();
  }
}

describe("okhub MCP server", () => {
  it("도구를 나열하고 워크스페이스 요약을 반환한다", async () => {
    const server = createServer(async () => CONFIG, noGh);
    await withClient(server, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(
        [
          "create_document",
          "create_issue",
          "get_issue",
          "get_workspace",
          "list_board",
          "list_documents",
          "read_document",
        ].sort(),
      );
      const result = await client.callTool({ name: "get_workspace", arguments: {} });
      const text = JSON.stringify(result);
      expect(text).toContain("Mockly");
      expect(text).toContain("o/1");
    });
  });
});
