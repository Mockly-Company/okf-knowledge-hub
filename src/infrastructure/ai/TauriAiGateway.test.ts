import { describe, expect, it, vi } from "vitest";
import { TauriAiGateway } from "./TauriAiGateway";

/** 호출한 쪽이 기대하는 응답 타입으로 고정 값을 돌려주는 invoke. */
function invokeReturning(value: unknown) {
  return async <T,>() => value as T;
}

describe("TauriAiGateway string failures", () => {
  it("keeps the reason from a string failure but hides a missing command", async () => {
    const failing = new TauriAiGateway(async () => {
      throw "연결이 끊어졌습니다";
    });
    await expect(failing.getConfig()).rejects.toThrow("연결이 끊어졌습니다");

    const domainError = new TauriAiGateway(async () => {
      throw "workspace not found";
    });
    await expect(domainError.getConfig()).rejects.toThrow("workspace not found");

    const oldBackend = new TauriAiGateway(async () => {
      throw "get_ai_config not allowed. Command not found";
    });
    await expect(oldBackend.getConfig()).rejects.toThrow("아직 지원되지 않습니다");
  });
});

describe("TauriAiGateway", () => {
  it("preserves the backend message for one-shot runs", async () => {
    const gateway = new TauriAiGateway(async () => {
      throw { code: "LocalSettingsUnavailable", message: "AI CLI 명령이 설정되지 않았습니다." };
    });

    await expect(gateway.runTask("hello", "claude")).rejects.toThrow(
      "AI CLI 명령이 설정되지 않았습니다.",
    );
  });

  it("records setConfig with both fields", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriAiGateway(async <T,>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ command, args });
      return undefined as T;
    });

    await gateway.setConfig("tmpl {prompt_file}", "codex");

    expect(calls).toEqual([
      {
        command: "set_ai_config",
        args: { commandTemplate: "tmpl {prompt_file}", cliCommand: "codex" },
      },
    ]);
  });

  it("treats a missing cli_command as no custom command", async () => {
    const gateway = new TauriAiGateway(invokeReturning({ command_template: "tmpl" }));

    await expect(gateway.getConfig()).resolves.toEqual({
      command_template: "tmpl",
      cli_command: "",
    });
  });

  it("passes the chosen tool when running a task", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriAiGateway(async <T,>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ command, args });
      return { status: "completed", exit_code: 0, output: "" } as T;
    });

    await gateway.runTask("요청", "claude");

    expect(calls).toEqual([
      { command: "run_ai_task", args: { prompt: "요청", tool: "claude" } },
    ]);
  });

  it("detects tools and cancels through the backend", async () => {
    const calls: string[] = [];
    const gateway = new TauriAiGateway(async <T,>(command: string) => {
      calls.push(command);
      return (command === "detect_ai_tools"
        ? { claude: true, codex: false }
        : true) as T;
    });

    await expect(gateway.detectTools()).resolves.toEqual({
      claude: true,
      codex: false,
    });
    await gateway.cancelTask();

    expect(calls).toEqual(["detect_ai_tools", "cancel_ai_task"]);
  });
});
