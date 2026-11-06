import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "@/test/FakeAiGateway";

describe("FakeAiGateway", () => {
  it("keeps the command template in memory", async () => {
    const gateway = new FakeAiGateway();
    await gateway.setConfig("custom {prompt_file}", "codex");
    expect(await gateway.getConfig()).toEqual({
      command_template: "custom {prompt_file}",
      cli_command: "codex",
    });
  });

  it("keeps the terminal cli command in memory", async () => {
    const gateway = new FakeAiGateway();
    await gateway.setConfig(gateway.template, "opencode");
    expect((await gateway.getConfig()).cli_command).toBe("opencode");
    expect(gateway.sets).toHaveLength(1);
    expect(gateway.sets[0]).toEqual({
      command_template: gateway.template,
      cli_command: "opencode",
    });
  });

  it("records which tool started a terminal", async () => {
    const gateway = new FakeAiGateway();
    await expect(
      gateway.startTerminal("claude", { cols: 80, rows: 24 }, () => {}),
    ).resolves.toBe("session-0");
    expect(gateway.terminalStarts).toEqual(["claude"]);
  });

  it("records runs and returns a fake result", async () => {
    const gateway = new FakeAiGateway();
    const result = await gateway.runTask("이슈 생성해줘", "codex");
    expect(gateway.runs).toEqual(["이슈 생성해줘"]);
    expect(gateway.runTools).toEqual(["codex"]);
    expect(result).toEqual({
      status: "completed",
      exit_code: 0,
      output: "(fake) 이슈 생성해줘",
    });
  });
});
