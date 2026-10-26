#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { makeGhRunner } from "./gh.js";
import { currentWorkspaceConfig } from "./tools/workspace.js";
import { createServer } from "./server.js";

function workspaceOverride(): string | undefined {
  const flagIndex = process.argv.findIndex((arg) => arg === "--workspace");
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const override = workspaceOverride();
  const getConfig = () => currentWorkspaceConfig(override);
  const runGh = makeGhRunner();
  const server = createServer(getConfig, runGh);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "okhub-mcp failed to start",
  );
  process.exit(1);
});
