import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDocumentTools } from "../src/tools/docs.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "okhub-docs-"));
  mkdirSync(join(dir, "docs", "guide"), { recursive: true });
  writeFileSync(join(dir, "docs", "guide", "a.md"), "# A\n", "utf-8");
  writeFileSync(join(dir, "docs", "root.md"), "# R\n", "utf-8");
  return dir;
}

function fakeConfig(root: string) {
  return {
    root,
    name: "T",
    docRoots: ["docs"],
    repositories: [],
    project: null,
  };
}

async function withClient(
  gateway: McpServer,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientTransport), gateway.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await gateway.close();
  }
}

describe("documents tools", () => {
  let root = "";
  let server: McpServer;

  beforeEach(() => {
    root = makeRoot();
    server = new McpServer({ name: "t", version: "0" });
    registerDocumentTools(server, async () => fakeConfig(root));
  });

  afterEach(async () => {
    await server.close().catch(() => undefined);
  });

  it("lists, reads and creates documents within the roots", async () => {
    await withClient(server, async (client) => {      const listed = await client.callTool({ name: "list_documents", arguments: {} });
      const text = (listed.content as Array<{ text?: string }>)[0]?.text ?? "";
      expect(text).toContain("guide/a.md");
      expect(text).toContain("root.md");

      await expect(
        client.callTool({ name: "read_document", arguments: { path: "../outside.md" } }),
      ).rejects.toThrow();

      const created = await client.callTool({
        name: "create_document",
        arguments: { path: "decisions/2026-10-26-test.md", content: "# T\n" },
      });
      expect(JSON.stringify(created)).toContain("decisions/2026-10-26-test.md");

      await expect(
        client.callTool({
          name: "create_document",
          arguments: { path: "decisions/2026-10-26-test.md", content: "# T\n" },
        }),
      ).rejects.toThrow(/이미 있는 파일/);
    });
  });
});
