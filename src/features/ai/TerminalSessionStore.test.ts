import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAiGateway } from "@/test/FakeAiGateway";
import { FakeTerminalRenderer } from "@/test/FakeTerminalRenderer";
import {
  DEFAULT_WORKSPACE_SCOPE,
  TerminalSessionStore,
  closeWorkspaceTerminals,
  getRunningTerminalCounts,
  migrateWorkspaceTerminals,
  subscribeRunningTerminalCounts,
  terminalStoreFor,
} from "./TerminalSessionStore";

function setup() {
  const gateway = new FakeAiGateway();
  const store = new TerminalSessionStore(gateway, FakeTerminalRenderer.create);
  return { gateway, store };
}

describe("TerminalSessionStore", () => {
  beforeEach(() => {
    FakeTerminalRenderer.created = [];
  });

  it("asks for focus only when a terminal is opened or newly selected", async () => {
    const { store } = setup();

    await store.open("claude");
    const first = store.getSnapshot()[0].key;
    expect(store.consumeFocus(first)).toBe(true);
    expect(store.consumeFocus(first)).toBe(false);

    await store.open("codex");
    const second = store.getSnapshot()[1].key;
    store.consumeFocus(second);
    store.select(second);
    expect(store.consumeFocus(second)).toBe(false);

    store.select(first);
    expect(store.consumeFocus(first)).toBe(true);
  });

  it("starts the tool and shows its output in the session renderer", async () => {
    const { gateway, store } = setup();

    await store.open("claude");
    gateway.emitTerminal(0, { kind: "output", data: "안녕" });

    expect(gateway.terminalStarts).toEqual(["claude"]);
    expect(store.getSnapshot()[0].status).toBe("running");
    expect(FakeTerminalRenderer.created[0].written).toBe("안녕");
  });

  it("delivers input sent before the backend finished starting, in order", async () => {
    const { gateway, store } = setup();
    let finishStart: (id: string) => void = () => {};
    gateway.startTerminal = vi.fn(
      () => new Promise<string>((resolve) => (finishStart = resolve)),
    );

    const opening = store.open("claude");
    // ConPTY는 시작하자마자 커서 위치를 묻는다. 이 응답이 사라지면 터미널이 멈춘다.
    FakeTerminalRenderer.created[0].type("\u001b[1;1R");
    FakeTerminalRenderer.created[0].type("a");
    expect(gateway.terminalWrites).toEqual([]);

    finishStart("backend-id");
    await opening;

    await vi.waitFor(() =>
      expect(gateway.terminalWrites).toEqual([
        { sessionId: "backend-id", data: "\u001b[1;1R" },
        { sessionId: "backend-id", data: "a" },
      ]),
    );
  });

  it("keeps writes in order even when an earlier write is slow", async () => {
    const { gateway, store } = setup();
    await store.open("claude");
    const order: string[] = [];
    let release: () => void = () => {};
    gateway.writeTerminal = vi.fn(async (_id: string, data: string) => {
      if (data === "first") {
        await new Promise<void>((resolve) => (release = resolve));
      }
      order.push(data);
    });

    FakeTerminalRenderer.created[0].type("first");
    FakeTerminalRenderer.created[0].type("second");
    await vi.waitFor(() => expect(gateway.writeTerminal).toHaveBeenCalledTimes(1));
    release();

    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
  });

  it("resizes the backend to the measured size", async () => {
    const { gateway, store } = setup();
    await store.open("claude");
    const key = store.getSnapshot()[0].key;

    store.fit(key);

    await vi.waitFor(() =>
      expect(gateway.terminalResizes).toEqual([
        { sessionId: "session-0", cols: 100, rows: 25 },
      ]),
    );
  });

  it("does not resize when the terminal cannot be measured or the size is unchanged", async () => {
    const { gateway, store } = setup();
    await store.open("claude");
    const key = store.getSnapshot()[0].key;

    FakeTerminalRenderer.created[0].size = null;
    store.fit(key);
    FakeTerminalRenderer.created[0].size = { cols: 100, rows: 25 };
    store.fit(key);
    store.fit(key);

    await vi.waitFor(() => expect(gateway.terminalResizes).toHaveLength(1));
  });

  it("marks a session exited with its code", async () => {
    const { gateway, store } = setup();
    await store.open("codex");

    gateway.emitTerminal(0, { kind: "exit", exit_code: 3 });

    expect(store.getSnapshot()[0]).toMatchObject({
      status: "exited",
      exitCode: 3,
    });
  });

  it("stays exited when the exit arrives before the start resolves", async () => {
    const { gateway, store } = setup();
    let finishStart: (id: string) => void = () => {};
    const original = gateway.startTerminal.bind(gateway);
    gateway.startTerminal = async (tool, size, onEvent) => {
      await original(tool, size, onEvent);
      return new Promise<string>((resolve) => (finishStart = resolve));
    };

    const opening = store.open("claude");
    await vi.waitFor(() => expect(gateway.terminalStarts).toHaveLength(1));
    gateway.emitTerminal(0, { kind: "exit", exit_code: 1 });
    await vi.waitFor(() => expect(finishStart).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve));
    finishStart("backend-id");
    await opening;

    expect(store.getSnapshot()[0].status).toBe("exited");
  });

  it("removes the session and rethrows when starting fails", async () => {
    const { gateway, store } = setup();
    gateway.startTerminal = async () => {
      throw new Error("연결된 워크스페이스가 없습니다.");
    };

    await expect(store.open("claude")).rejects.toThrow(
      "연결된 워크스페이스가 없습니다.",
    );

    expect(store.getSnapshot()).toEqual([]);
    expect(FakeTerminalRenderer.created[0].disposed).toBe(true);
  });

  it("stops the backend when closed before the start finishes", async () => {
    const { gateway, store } = setup();
    let finishStart: (id: string) => void = () => {};
    gateway.startTerminal = vi.fn(
      () => new Promise<string>((resolve) => (finishStart = resolve)),
    );
    const stop = vi.spyOn(gateway, "stopTerminal");

    const opening = store.open("claude");
    store.close(store.getSnapshot()[0].key);
    finishStart("late-session");
    await opening;

    expect(stop).toHaveBeenCalledWith("late-session");
  });

  it("stops the backend and disposes the renderer on close", async () => {
    const { gateway, store } = setup();
    await store.open("claude");
    const key = store.getSnapshot()[0].key;

    store.close(key);

    expect(store.getSnapshot()).toEqual([]);
    expect(FakeTerminalRenderer.created[0].disposed).toBe(true);
    await vi.waitFor(() => expect(gateway.terminalStops).toEqual(["session-0"]));
  });

  it("notifies subscribers with a new snapshot", async () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    await store.open("claude");

    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).not.toBe(before);
  });

  it("isolates terminal sessions per workspace scopeKey while keeping background sessions alive", async () => {
    const gateway = new FakeAiGateway();
    const storeA = terminalStoreFor(gateway, FakeTerminalRenderer.create, "ws-a");
    const storeB = terminalStoreFor(gateway, FakeTerminalRenderer.create, "ws-b");
    const defaultStore = terminalStoreFor(gateway, FakeTerminalRenderer.create);

    expect(storeA).not.toBe(storeB);
    expect(defaultStore).toBe(
      terminalStoreFor(gateway, FakeTerminalRenderer.create, DEFAULT_WORKSPACE_SCOPE),
    );

    await storeA.open("claude");
    expect(storeA.getSnapshot()).toHaveLength(1);
    expect(storeB.getSnapshot()).toEqual([]);

    await storeB.open("antigravity");
    expect(storeA.getSnapshot()[0].tool).toBe("claude");
    expect(storeB.getSnapshot()[0].tool).toBe("antigravity");
    expect(gateway.terminalStops).toEqual([]);
  });

  it("tracks running terminal counts per scope and decrements immediately on exit or closeAll", async () => {
    const gateway = new FakeAiGateway();
    const listener = vi.fn();
    const unsubscribe = subscribeRunningTerminalCounts(gateway, listener);
    const initialCounts = getRunningTerminalCounts(gateway);
    expect(initialCounts).toEqual({});
    expect(getRunningTerminalCounts(gateway)).toBe(initialCounts);

    const storeA = terminalStoreFor(gateway, FakeTerminalRenderer.create, "ws-a");
    const storeB = terminalStoreFor(gateway, FakeTerminalRenderer.create, "ws-b");

    await storeA.open("claude");
    await storeB.open("codex");
    const activeSnapshot = getRunningTerminalCounts(gateway);
    expect(activeSnapshot).toEqual({ "ws-a": 1, "ws-b": 1 });
    expect(getRunningTerminalCounts(gateway)).toBe(activeSnapshot);
    expect(listener).toHaveBeenCalled();

    gateway.emitTerminal(0, { kind: "exit", exit_code: 0 });
    expect(getRunningTerminalCounts(gateway)).toEqual({ "ws-b": 1 });

    storeB.closeAll();
    expect(getRunningTerminalCounts(gateway)).toEqual({});
    await vi.waitFor(() => expect(gateway.terminalStops).toEqual(["session-1"]));
    unsubscribe();
  });

  it("stops late-resolving starting sessions when closeWorkspaceTerminals is called", async () => {
    const gateway = new FakeAiGateway();
    let finishStart: (id: string) => void = () => {};
    gateway.startTerminal = vi.fn(
      () => new Promise<string>((resolve) => (finishStart = resolve)),
    );
    const stop = vi.spyOn(gateway, "stopTerminal");

    const storeA = terminalStoreFor(gateway, FakeTerminalRenderer.create, "ws-a");
    const opening = storeA.open("claude");
    expect(getRunningTerminalCounts(gateway)).toEqual({ "ws-a": 1 });

    closeWorkspaceTerminals(gateway, "ws-a");
    expect(getRunningTerminalCounts(gateway)).toEqual({});
    expect(storeA.getSnapshot()).toEqual([]);

    finishStart("late-ws-session");
    await opening;
    expect(stop).toHaveBeenCalledWith("late-ws-session");
  });

  it("migrates running sessions to a new workspace key without stopping them and merges safely", async () => {
    const gateway = new FakeAiGateway();
    const fromStore = terminalStoreFor(
      gateway,
      FakeTerminalRenderer.create,
      "repo:R_1",
    );
    await fromStore.open("claude");

    // 동일 키 이관은 무해한 no-op이다.
    migrateWorkspaceTerminals(gateway, "repo:R_1", "repo:R_1");
    expect(fromStore.getSnapshot()).toHaveLength(1);

    // 대상 스코프에 이미 세션이 있어도 손실 없이 병합된다.
    const existingTarget = terminalStoreFor(
      gateway,
      FakeTerminalRenderer.create,
      "PVT_1",
    );
    await existingTarget.open("codex");

    migrateWorkspaceTerminals(gateway, "repo:R_1", "PVT_1");

    expect(fromStore.getSnapshot()).toEqual([]);
    const targetStore = terminalStoreFor(
      gateway,
      FakeTerminalRenderer.create,
      "PVT_1",
    );
    expect(targetStore.getSnapshot().map((s) => s.tool)).toEqual([
      "codex",
      "claude",
    ]);
    expect(getRunningTerminalCounts(gateway)).toEqual({ PVT_1: 2 });
    expect(gateway.terminalStops).toEqual([]);

    // 이관된 렌더러 입출력도 끊기지 않고 동작한다.
    FakeTerminalRenderer.created[0].type("ls\n");
    await vi.waitFor(() =>
      expect(gateway.terminalWrites).toContainEqual({
        sessionId: "session-0",
        data: "ls\n",
      }),
    );
    gateway.emitTerminal(0, { kind: "output", data: "migrated-ok" });
    expect(FakeTerminalRenderer.created[0].written).toContain("migrated-ok");
  });
});
