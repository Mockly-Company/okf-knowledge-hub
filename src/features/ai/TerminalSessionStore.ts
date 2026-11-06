import type {
  AiGateway,
  AiTerminalEvent,
  AiToolId,
} from "@/features/ai/AiGateway";

/** 터미널 화면 하나. 세션과 수명을 같이하고, 화면 이동 때는 붙였다 뗐다 한다. */
export interface TerminalRenderer {
  attach(parent: HTMLElement): void;
  detach(): void;
  write(data: string): void;
  /** 붙어 있는 영역에 맞춰 크기를 조정한다. 잴 수 없으면 null이다. */
  fit(): { cols: number; rows: number } | null;
  focus(): void;
  onInput(listener: (data: string) => void): void;
  dispose(): void;
}

export type TerminalRendererFactory = () => TerminalRenderer;

export interface TerminalSession {
  key: string;
  tool: AiToolId;
  status: "starting" | "running" | "exited";
  exitCode: number | null;
  renderer: TerminalRenderer;
}

interface SessionLink {
  backendId: string | null;
  /** 시작 완료를 기다린 뒤 입력·크기 변경을 순서대로 보내는 작업 사슬. */
  queue: Promise<void>;
  lastSize: { cols: number; rows: number } | null;
}

const INITIAL_SIZE = { cols: 120, rows: 30 };

/**
 * 앱 안 터미널 세션 저장소. React 밖에 두어 AI 화면을 떠나도 프로세스와
 * 출력이 유지된다.
 */
export class TerminalSessionStore {
  private sessions: readonly TerminalSession[] = [];
  private activeKey: string | null = null;
  /** 사용자가 방금 열거나 고른 터미널. 화면 복귀 때는 포커스를 가져가지 않는다. */
  private focusKey: string | null = null;
  private nextKey = 0;
  private readonly links = new Map<string, SessionLink>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly gateway: AiGateway,
    private readonly createRenderer: TerminalRendererFactory,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly TerminalSession[] => this.sessions;

  getActiveKey = (): string | null => this.activeKey;

  select(key: string): void {
    if (key !== this.activeKey) {
      this.focusKey = key;
    }
    this.activeKey = key;
    this.notify();
  }

  /** 이 터미널이 포커스를 받아야 하면 참을 돌려주고 요청을 지운다. */
  consumeFocus(key: string): boolean {
    if (this.focusKey !== key) {
      return false;
    }
    this.focusKey = null;
    return true;
  }

  async open(tool: AiToolId): Promise<void> {
    const key = String(this.nextKey++);
    const renderer = this.createRenderer();
    const link: SessionLink = {
      backendId: null,
      queue: Promise.resolve(),
      lastSize: null,
    };
    this.links.set(key, link);
    // 백엔드 시작이 끝나기 전에 오는 입력도 잃지 않도록 먼저 연결한다.
    // ConPTY의 커서 위치 질의에 대한 응답이 이 시점에 나올 수 있다.
    renderer.onInput((data) => {
      this.enqueue(key, (id) => this.gateway.writeTerminal(id, data));
    });
    this.sessions = [
      ...this.sessions,
      { key, tool, status: "starting", exitCode: null, renderer },
    ];
    this.activeKey = key;
    this.focusKey = key;
    this.notify();

    const started = this.gateway.startTerminal(tool, INITIAL_SIZE, (event) =>
      this.handleEvent(key, event),
    );
    link.queue = started.then(
      (id) => {
        link.backendId = id;
      },
      () => {},
    );
    try {
      await started;
    } catch (error) {
      this.remove(key);
      throw error;
    }
    await link.queue;
    this.update(key, (session) =>
      session.status === "starting"
        ? { ...session, status: "running" }
        : session,
    );
  }

  fit(key: string): void {
    const session = this.find(key);
    const link = this.links.get(key);
    const size = session?.renderer.fit();
    if (!link || !size) {
      return;
    }
    if (
      link.lastSize?.cols === size.cols &&
      link.lastSize?.rows === size.rows
    ) {
      return;
    }
    link.lastSize = size;
    this.enqueue(key, (id) =>
      this.gateway.resizeTerminal(id, size.cols, size.rows),
    );
  }

  close(key: string): void {
    this.enqueue(key, (id) => this.gateway.stopTerminal(id));
    this.remove(key);
  }

  private enqueue(key: string, task: (backendId: string) => Promise<void>) {
    const link = this.links.get(key);
    if (!link) {
      return;
    }
    link.queue = link.queue
      .then(() => (link.backendId === null ? undefined : task(link.backendId)))
      .catch((error: unknown) => {
        // 이미 끝난 세션으로 보낸 입력은 버려도 된다. 진단용으로만 남긴다.
        console.debug("[ai-terminal] request failed", error);
      });
  }

  private handleEvent(key: string, event: AiTerminalEvent) {
    if (event.kind === "output") {
      this.find(key)?.renderer.write(event.data);
      return;
    }
    this.update(key, (session) => ({
      ...session,
      status: "exited",
      exitCode: event.exit_code,
    }));
  }

  private find(key: string): TerminalSession | undefined {
    return this.sessions.find((session) => session.key === key);
  }

  private update(
    key: string,
    change: (session: TerminalSession) => TerminalSession,
  ) {
    this.sessions = this.sessions.map((session) =>
      session.key === key ? change(session) : session,
    );
    this.notify();
  }

  private remove(key: string) {
    this.find(key)?.renderer.dispose();
    this.links.delete(key);
    this.sessions = this.sessions.filter((session) => session.key !== key);
    if (this.activeKey === key) {
      this.activeKey = this.sessions.at(-1)?.key ?? null;
    }
    this.notify();
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }
}

const stores = new WeakMap<AiGateway, TerminalSessionStore>();

/** 게이트웨이당 저장소 하나. 화면이 다시 마운트되어도 같은 세션을 본다. */
export function terminalStoreFor(
  gateway: AiGateway,
  createRenderer: TerminalRendererFactory,
): TerminalSessionStore {
  let store = stores.get(gateway);
  if (!store) {
    store = new TerminalSessionStore(gateway, createRenderer);
    stores.set(gateway, store);
  }
  return store;
}
