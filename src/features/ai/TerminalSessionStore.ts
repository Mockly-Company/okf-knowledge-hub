import type {
  AiGateway,
  AiTaskLaunchRequest,
  AiTerminalEvent,
  AiToolId,
} from "@/features/ai/AiGateway";

/** 활성 워크스페이스가 없을 때(단독 단위 테스트·스토리 등) 사용하는 기본 스코프 키. */
export const DEFAULT_WORKSPACE_SCOPE = "__default__";

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

interface SessionRoute {
  store: TerminalSessionStore;
  key: string;
}

interface SessionLink {
  backendId: string | null;
  /** 시작 완료를 기다린 뒤 입력·크기 변경을 순서대로 보내는 작업 사슬. */
  queue: Promise<void>;
  lastSize: { cols: number; rows: number } | null;
  route: SessionRoute;
}

interface AdoptedSession {
  session: TerminalSession;
  link: SessionLink;
}

const INITIAL_SIZE = { cols: 120, rows: 30 };

/**
 * 워크스페이스 하나에 속한 앱 안 터미널 세션 저장소.
 * React 밖에 두어 AI 화면이나 다른 프로젝트로 잠시 이동해도 프로세스와 출력이 유지된다.
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
    private readonly onRegistryChange?: () => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly TerminalSession[] => this.sessions;

  getActiveKey = (): string | null => this.activeKey;

  getRunningCount(): number {
    let count = 0;
    for (const session of this.sessions) {
      if (session.status === "starting" || session.status === "running") {
        count += 1;
      }
    }
    return count;
  }

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

  async open(tool: AiToolId, taskContext?: AiTaskLaunchRequest): Promise<void> {
    const initialKey = String(this.nextKey++);
    const renderer = this.createRenderer();
    const route: SessionRoute = { store: this, key: initialKey };
    const link: SessionLink = {
      backendId: null,
      queue: Promise.resolve(),
      lastSize: null,
      route,
    };
    this.links.set(initialKey, link);
    // 백엔드 시작이 끝나기 전에 오는 입력도 잃지 않도록 먼저 연결한다.
    // ConPTY의 커서 위치 질의에 대한 응답이 이 시점에 나올 수 있다.
    renderer.onInput((data) => {
      route.store.enqueue(route.key, (id) =>
        route.store.gateway.writeTerminal(id, data),
      );
    });
    this.sessions = [
      ...this.sessions,
      { key: initialKey, tool, status: "starting", exitCode: null, renderer },
    ];
    this.activeKey = initialKey;
    this.focusKey = initialKey;
    this.notify();

    const started = taskContext
      ? this.gateway.startTerminal(
          tool,
          INITIAL_SIZE,
          (event) => route.store.handleEvent(route.key, event),
          taskContext,
        )
      : this.gateway.startTerminal(tool, INITIAL_SIZE, (event) =>
          route.store.handleEvent(route.key, event),
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
      route.store.remove(route.key);
      throw error;
    }
    await link.queue;
    route.store.update(route.key, (session) =>
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

  closeAll(): void {
    for (const session of [...this.sessions]) {
      this.close(session.key);
    }
  }

  /** @internal 다른 워크스페이스 스코프로 세션을 끊지 않고 이관할 때 꺼낸다. */
  takeAllForMigration(): AdoptedSession[] {
    if (this.sessions.length === 0) {
      return [];
    }
    const items: AdoptedSession[] = [];
    for (const session of this.sessions) {
      const link = this.links.get(session.key);
      if (link) {
        items.push({ session, link });
      }
    }
    this.links.clear();
    this.sessions = [];
    this.activeKey = null;
    this.focusKey = null;
    this.notify();
    return items;
  }

  /** @internal 이관된 세션을 충돌 없는 새 키로 편입한다. */
  adoptMigrated(items: readonly AdoptedSession[]): void {
    if (items.length === 0) {
      return;
    }
    const appended: TerminalSession[] = [];
    for (const { session, link } of items) {
      const key = String(this.nextKey++);
      link.route.store = this;
      link.route.key = key;
      this.links.set(key, link);
      appended.push({ ...session, key });
    }
    this.sessions = [...this.sessions, ...appended];
    if (this.activeKey === null) {
      this.activeKey = this.sessions.at(-1)?.key ?? null;
    }
    this.notify();
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
    this.onRegistryChange?.();
  }
}

const EMPTY_RUNNING_COUNTS: Readonly<Record<string, number>> = Object.freeze({});

function shallowEqualCounts(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

class WorkspaceTerminalRegistry {
  private readonly stores = new Map<string, TerminalSessionStore>();
  private readonly listeners = new Set<() => void>();
  private countsSnapshot: Readonly<Record<string, number>> =
    EMPTY_RUNNING_COUNTS;

  constructor(private readonly gateway: AiGateway) {}

  storeFor(
    createRenderer: TerminalRendererFactory,
    scopeKey: string,
  ): TerminalSessionStore {
    const normalized = scopeKey || DEFAULT_WORKSPACE_SCOPE;
    let store = this.stores.get(normalized);
    if (!store) {
      store = new TerminalSessionStore(this.gateway, createRenderer, () =>
        this.recomputeCounts(),
      );
      this.stores.set(normalized, store);
    }
    return store;
  }

  closeScope(scopeKey: string): void {
    const normalized = scopeKey || DEFAULT_WORKSPACE_SCOPE;
    const store = this.stores.get(normalized);
    if (!store) {
      return;
    }
    store.closeAll();
  }

  migrateScope(fromScopeKey: string, toScopeKey: string): void {
    const fromKey = fromScopeKey || DEFAULT_WORKSPACE_SCOPE;
    const toKey = toScopeKey || DEFAULT_WORKSPACE_SCOPE;
    if (fromKey === toKey) {
      return;
    }
    const fromStore = this.stores.get(fromKey);
    if (!fromStore || fromStore.getSnapshot().length === 0) {
      return;
    }
    const existingTarget = this.stores.get(toKey);
    if (!existingTarget) {
      this.stores.delete(fromKey);
      this.stores.set(toKey, fromStore);
      this.recomputeCounts();
      return;
    }
    const migrated = fromStore.takeAllForMigration();
    existingTarget.adoptMigrated(migrated);
    this.recomputeCounts();
  }

  subscribeCounts = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCounts = (): Readonly<Record<string, number>> => this.countsSnapshot;

  private recomputeCounts(): void {
    const next: Record<string, number> = {};
    for (const [scopeKey, store] of this.stores) {
      const count = store.getRunningCount();
      if (count > 0) {
        next[scopeKey] = count;
      }
    }
    const normalizedNext =
      Object.keys(next).length === 0
        ? EMPTY_RUNNING_COUNTS
        : Object.freeze(next);
    if (shallowEqualCounts(this.countsSnapshot, normalizedNext)) {
      return;
    }
    this.countsSnapshot = normalizedNext;
    this.listeners.forEach((listener) => listener());
  }
}

const registries = new WeakMap<AiGateway, WorkspaceTerminalRegistry>();

function registryFor(gateway: AiGateway): WorkspaceTerminalRegistry {
  let registry = registries.get(gateway);
  if (!registry) {
    registry = new WorkspaceTerminalRegistry(gateway);
    registries.set(gateway, registry);
  }
  return registry;
}

/** 게이트웨이·워크스페이스 스코프당 저장소 하나. 화면을 오가도 같은 세션을 본다. */
export function terminalStoreFor(
  gateway: AiGateway,
  createRenderer: TerminalRendererFactory,
  scopeKey: string = DEFAULT_WORKSPACE_SCOPE,
): TerminalSessionStore {
  return registryFor(gateway).storeFor(createRenderer, scopeKey);
}

/** 워크스페이스 연결 해제나 문서 저장소 교체 시 해당 스코프의 터미널을 모두 닫는다. */
export function closeWorkspaceTerminals(
  gateway: AiGateway,
  scopeKey: string,
): void {
  registryFor(gateway).closeScope(scopeKey);
}

/** 같은 문서 저장소를 유지한 채 워크스페이스 ID만 바뀔 때 실행 중인 세션을 이관한다. */
export function migrateWorkspaceTerminals(
  gateway: AiGateway,
  fromScopeKey: string,
  toScopeKey: string,
): void {
  registryFor(gateway).migrateScope(fromScopeKey, toScopeKey);
}

/** 워크스페이스별 실행 중(starting | running) 터미널 개수 변화를 구독한다. */
export function subscribeRunningTerminalCounts(
  gateway: AiGateway,
  listener: () => void,
): () => void {
  return registryFor(gateway).subscribeCounts(listener);
}

/** 워크스페이스별 실행 중(starting | running) 터미널 개수 스냅샷을 돌려준다. */
export function getRunningTerminalCounts(
  gateway: AiGateway,
): Readonly<Record<string, number>> {
  return registryFor(gateway).getCounts();
}
