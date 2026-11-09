import { describe, expect, it, vi } from "vitest";
import type { AiTerminalEvent } from "@/features/ai/AiGateway";
import { TauriAiGateway } from "./TauriAiGateway";

/** 호출한 쪽이 기대하는 응답 타입으로 고정 값을 돌려주는 invoke. */
function invokeReturning(value: unknown) {
  return async <T,>() => value as T;
}

/** Tauri 런타임 없이 터미널 이벤트를 흘려보내는 채널. */
function fakeChannel() {
  const channel: { onmessage: (event: AiTerminalEvent) => void } = {
    onmessage: () => {},
  };
  return channel;
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
  it("preserves the backend message when starting a terminal fails", async () => {
    const gateway = new TauriAiGateway(
      async () => {
        throw { message: "AI CLI가 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요." };
      },
      fakeChannel,
    );

    await expect(
      gateway.startTerminal("custom", { cols: 80, rows: 24 }, () => {}),
    ).rejects.toThrow("AI CLI가 설정되지 않았습니다. 설정 → AI 연동에서 등록해 주세요.");
  });

  it("falls back to unsupported only when there is no backend message", async () => {
    const gateway = new TauriAiGateway(
      async () => {
        throw "Command start_ai_terminal not found";
      },
      fakeChannel,
    );

    await expect(
      gateway.startTerminal("claude", { cols: 80, rows: 24 }, () => {}),
    ).rejects.toThrow("아직 지원되지 않습니다");
  });

  it("starts a terminal and forwards channel events", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const channel = fakeChannel();
    const gateway = new TauriAiGateway(
      async <T,>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return { session_id: "abc" } as T;
      },
      () => channel,
    );
    const events: AiTerminalEvent[] = [];

    const id = await gateway.startTerminal(
      "codex",
      { cols: 90, rows: 20 },
      (event) => events.push(event),
    );
    channel.onmessage({ kind: "output", data: "hi" });

    expect(id).toBe("abc");
    expect(calls).toEqual([
      {
        command: "start_ai_terminal",
        args: { tool: "codex", cols: 90, rows: 20, onEvent: channel },
      },
    ]);
    expect(events).toEqual([{ kind: "output", data: "hi" }]);
  });

  it("writes, resizes and stops a terminal by session id", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriAiGateway(
      async <T,>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        return true as T;
      },
    );

    await gateway.writeTerminal("abc", "ls");
    await gateway.resizeTerminal("abc", 100, 30);
    await gateway.stopTerminal("abc");

    expect(calls).toEqual([
      { command: "write_ai_terminal", args: { sessionId: "abc", data: "ls" } },
      {
        command: "resize_ai_terminal",
        args: { sessionId: "abc", cols: 100, rows: 30 },
      },
      { command: "stop_ai_terminal", args: { sessionId: "abc" } },
    ]);
  });

  it("records setConfig with the cli command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const gateway = new TauriAiGateway(async <T,>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ command, args });
      return undefined as T;
    });

    await gateway.setConfig("codex");

    expect(calls).toEqual([
      { command: "set_ai_config", args: { cliCommand: "codex" } },
    ]);
  });

  it("treats a missing cli_command as no custom command", async () => {
    const gateway = new TauriAiGateway(invokeReturning({}));

    await expect(gateway.getConfig()).resolves.toEqual({ cli_command: "" });
  });

  it("detects tools through the backend", async () => {
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

    expect(calls).toEqual(["detect_ai_tools"]);
  });
});
