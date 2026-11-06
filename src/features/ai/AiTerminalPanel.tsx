import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AiToolId } from "@/features/ai/AiGateway";
import type {
  TerminalSession,
  TerminalSessionStore,
} from "@/features/ai/TerminalSessionStore";

function TerminalSurface({
  session,
  store,
}: {
  session: TerminalSession;
  store: TerminalSessionStore;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { key, renderer } = session;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    renderer.attach(host);
    store.fit(key);
    // StrictMode의 시험 마운트가 요청을 소비하지 않도록 한 틱 미룬다.
    const focusTimer = window.setTimeout(() => {
      if (store.consumeFocus(key)) {
        renderer.focus();
      }
    });
    const observer = new ResizeObserver(() => store.fit(key));
    observer.observe(host);
    return () => {
      window.clearTimeout(focusTimer);
      observer.disconnect();
      renderer.detach();
    };
  }, [key, renderer, store]);

  return <div ref={hostRef} className="h-full w-full" />;
}

/** 같은 도구를 여러 개 열면 번호를 붙여 탭을 구분한다. */
function sessionLabel(
  session: TerminalSession,
  sessions: readonly TerminalSession[],
  labels: Record<AiToolId, string>,
): string {
  const sameTool = sessions.filter((other) => other.tool === session.tool);
  const position = sameTool.indexOf(session) + 1;
  return position > 1
    ? `${labels[session.tool]} ${position}`
    : labels[session.tool];
}

/** 열린 터미널 탭과 활성 터미널 화면. 세션이 없으면 아무것도 그리지 않는다. */
export function AiTerminalPanel({
  store,
  labels,
}: {
  store: TerminalSessionStore;
  labels: Record<AiToolId, string>;
}) {
  const sessions = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const activeKey = useSyncExternalStore(store.subscribe, store.getActiveKey);
  const active = sessions.find((session) => session.key === activeKey) ?? null;

  if (active === null) {
    return null;
  }

  return (
    <div className="grid gap-[var(--space-2)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <TabsList aria-label="열린 터미널" className="flex-1">
          {sessions.map((session) => (
            <TabsTrigger
              key={session.key}
              id={`ai-terminal-tab-${session.key}`}
              selected={session.key === active.key}
              aria-controls="ai-terminal-panel"
              onClick={() => store.select(session.key)}
            >
              {sessionLabel(session, sessions, labels)}
            </TabsTrigger>
          ))}
        </TabsList>
        <IconButton
          label={`${sessionLabel(active, sessions, labels)} 터미널 닫기`}
          onClick={() => store.close(active.key)}
        >
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
      <div
        id="ai-terminal-panel"
        role="tabpanel"
        aria-labelledby={`ai-terminal-tab-${active.key}`}
        className="h-[480px] overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-code-background)] p-[var(--space-2)]"
      >
        <TerminalSurface key={active.key} session={active} store={store} />
      </div>
      {active.status === "exited" ? (
        <p role="status" className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
          터미널이 종료되었습니다 (코드 {active.exitCode}).
        </p>
      ) : null}
    </div>
  );
}
