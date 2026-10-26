import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { GhRunner } from "../src/gh.js";
import { registerIssueTools } from "../src/tools/issues.js";

const FIELDS_RESPONSE = {
  data: {
    organization: {
      projectV2: {
        fields: {
          nodes: [
            {
              __typename: "ProjectV2SingleSelectField",
              id: "F_STATUS",
              name: "Status",
              options: [{ id: "O_BACKLOG", name: "Backlog" }],
            },
            {
              __typename: "ProjectV2SingleSelectField",
              id: "F_AREA",
              name: "영역",
              options: [
                { id: "O_BE", name: "백엔드" },
                { id: "O_FE", name: "프론트" },
              ],
            },
            {
              __typename: "ProjectV2SingleSelectField",
              id: "F_KIND",
              name: "타입",
              options: [
                { id: "O_F", name: "기능" },
                { id: "O_W", name: "작업" },
              ],
            },
          ],
        },
      },
    },
  },
};

function makeRunner(log: string[]): GhRunner {
  return async (args: string[]) => {
    const joined = args.join(" ");
    log.push(joined);
    if (joined.includes("organization(login:") && joined.includes("projectV2(number:")) {
      return {
        stdout: JSON.stringify({
          data: { organization: { projectV2: { id: "PVT_x", title: "Mockly" } } },
        }),
      };
    }
    if (joined.includes("projectV2") && joined.includes("fields")) {
      return { stdout: JSON.stringify(FIELDS_RESPONSE) };
    }
    if (joined.includes("addProjectV2ItemById")) {
      return {
        stdout: JSON.stringify({
          data: { addProjectV2ItemById: { item: { id: "I_1" } } },
        }),
      };
    }
    if (joined.includes("updateProjectV2ItemField")) {
      return { stdout: JSON.stringify({ data: { updateProjectV2ItemField: { projectV2Item: { id: "I_1" } } } }) };
    }
    if (joined.includes("issue(number")) {
      return { stdout: JSON.stringify({ data: { repository: { issue: { id: "ISS_1" } } } }) };
    }
    if (joined.includes("addSubIssue")) {
      return { stdout: JSON.stringify({ data: { addSubIssue: { issue: { id: "P" }, subIssue: { id: "C" } } } }) };
    }
    if (joined.includes("issue create")) {
      return { stdout: JSON.stringify({ number: 101, url: "https://github.com/o/r/issues/101" }) };
    }
    throw new Error(`unexpected gh call: ${joined}`);
  };
}

describe("create_issue", () => {
  it("만들고 프로젝트에 올린 뒤 영역/종류/상위를 세팅한다", async () => {
    const calls: string[] = [];
    const server = new McpServer({ name: "t", version: "0" });
    registerIssueTools(
      server,
      async () => ({
        root: "/ws",
        name: "T",
        docRoots: ["docs"],
        repositories: [],
        project: { id: "PVT_x", owner: "o", number: 1, title: "B" },
      }),
      makeRunner(calls),
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const result = await client.callTool({
        name: "create_issue",
        arguments: {
          repo: "o/r",
          title: "테스트 이슈",
          body: "본문",
          area: "백엔드",
          kind: "작업",
        },
      });
      const text = JSON.stringify(result);
      expect(text).toContain("#101");
      expect(calls.some((c) => c.includes("updateProjectV2ItemField"))).toBe(true);
      expect(calls.some((c) => c.includes("addProjectV2ItemById"))).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("영역 값을 검증한다", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    registerIssueTools(
      server,
      async () => ({
        root: "/ws",
        name: "T",
        docRoots: ["docs"],
        repositories: [],
        project: { id: "PVT_x", owner: "o", number: 1, title: "B" },
      }),
      makeRunner([]),
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      await expect(
        client.callTool({
          name: "create_issue",
          arguments: {
            repo: "o/r",
            title: "t",
            body: "b",
            area: "엉뚱한영역",
            kind: "작업",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
