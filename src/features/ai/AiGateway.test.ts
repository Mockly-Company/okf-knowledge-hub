import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "@/test/FakeAiGateway";

describe("FakeAiGateway", () => {
  it("keeps the terminal cli command in memory", async () => {
    const gateway = new FakeAiGateway();
    await gateway.setConfig("opencode");
    expect(await gateway.getConfig()).toEqual({ cli_command: "opencode" });
    expect(gateway.sets).toEqual(["opencode"]);
  });

  it("records which tool started a terminal", async () => {
    const gateway = new FakeAiGateway();
    await expect(
      gateway.startTerminal("claude", { cols: 80, rows: 24 }, () => {}),
    ).resolves.toBe("session-0");
    await expect(
      gateway.startTerminal("antigravity", { cols: 80, rows: 24 }, () => {}),
    ).resolves.toBe("session-1");
    expect(gateway.terminalStarts).toEqual(["claude", "antigravity"]);
    await expect(gateway.detectTools()).resolves.toEqual({
      claude: true,
      codex: true,
      antigravity: true,
    });
  });
});
