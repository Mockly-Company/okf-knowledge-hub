import { useEffect, useRef, useState, type RefObject } from "react";
import type { DocumentContent } from "../model";

function displayProperty(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function propertyEntries(properties: unknown): Array<[string, unknown]> {
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.entries(properties as Record<string, unknown>)
    : [];
}

function scrollContainer(element: Element | null): HTMLElement | null {
  const canvas = element?.querySelector<HTMLElement>(".document-reader__canvas");
  if (canvas && /(auto|scroll)/.test(getComputedStyle(canvas).overflowY)) return canvas;
  let parent = element?.parentElement ?? null;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  return parent;
}

export function DocumentOverview({ document, readerRef, onNavigate }: { document: DocumentContent; readerRef?: RefObject<HTMLElement | null>; onNavigate?: (id: string) => void }) {
  const entries = propertyEntries(document.properties);
  const navRef = useRef<HTMLElement>(null);
  const requestedLocation = useRef<{id: string; scrollTop: number} | null>(null);
  const [activeId, setActiveId] = useState(document.tableOfContents[0]?.id);
  useEffect(() => {
    const reader = readerRef?.current ?? navRef.current?.closest(".document-reader");
    if (!reader) return;
    const scrollRoot = scrollContainer(reader);
    requestedLocation.current = null;
    let frame = 0;
    const update = () => {
      const top = scrollRoot?.getBoundingClientRect().top ?? 0;
      const requested = requestedLocation.current;
      if (requested && scrollRoot && Math.abs(scrollRoot.scrollTop - requested.scrollTop) < 2) {
        setActiveId(requested.id);
        return;
      }
      requestedLocation.current = null;
      const maxScroll = scrollRoot ? Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight) : 0;
      const headings = document.tableOfContents.flatMap(entry => {
        const element = reader.ownerDocument.getElementById(entry.id);
        if (!element || !reader.contains(element)) return [];
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0) return [];
        return [{id: entry.id, top: rect.top, margin: parseFloat(getComputedStyle(element).scrollMarginTop) || 0}];
      });
      const lastReachable = headings.filter(heading => (scrollRoot?.scrollTop ?? 0) + heading.top - top - heading.margin <= maxScroll + 1).at(-1);
      const endStart = lastReachable ? Math.max(0, (scrollRoot?.scrollTop ?? 0) + lastReachable.top - top - lastReachable.margin) : 0;
      const endRange = maxScroll - endStart;
      const endProgress = scrollRoot && endRange > 1 ? Math.max(0, Math.min(1, (scrollRoot.scrollTop - endStart) / endRange)) : 0;
      // Keep normal top-edge tracking until the last reachable heading, then
      // advance through the remaining visible headings as the document ends.
      const readingOffset = scrollRoot ? Math.max(0, scrollRoot.clientHeight - (lastReachable?.margin ?? 0)) * endProgress : 0;
      let current = document.tableOfContents[0]?.id;
      for (const heading of headings) {
        if (heading.top <= top + heading.margin + readingOffset + 1) current = heading.id;
      }
      setActiveId(current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const manualScroll = (event: Event) => {
      if (event instanceof KeyboardEvent && (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) || event.defaultPrevented)) return;
      if (event instanceof WheelEvent && event.deltaY === 0) return;
      requestedLocation.current = null;
      schedule();
    };
    update();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    scrollRoot?.addEventListener("wheel", manualScroll, {passive: true});
    scrollRoot?.addEventListener("touchmove", manualScroll, {passive: true});
    scrollRoot?.addEventListener("keydown", manualScroll);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(reader);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); scrollRoot?.removeEventListener("wheel", manualScroll); scrollRoot?.removeEventListener("touchmove", manualScroll); scrollRoot?.removeEventListener("keydown", manualScroll); observer?.disconnect(); };
  }, [document.tableOfContents, readerRef]);

  const selectLocation = (id: string) => {
    const reader = readerRef?.current ?? navRef.current?.closest(".document-reader") ?? null;
    const root = scrollContainer(reader);
    const heading = reader?.ownerDocument.getElementById(id);
    if (root && heading) {
      const offset = parseFloat(getComputedStyle(heading).scrollMarginTop) || 0;
      const desired = root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
      requestedLocation.current = {id, scrollTop: Math.max(0, Math.min(desired, root.scrollHeight - root.clientHeight))};
    }
    setActiveId(id);
    onNavigate?.(id);
  };

  return (
    <>
      <section className="document-overview__properties" aria-label="문서 속성">
        <h2>문서 속성</h2>
        {entries.length === 0 ? (
          <p>표시할 문서 속성이 없습니다.</p>
        ) : (
          <dl>
            {entries.map(([name, value]) => (
              <div key={name}>
                <dt>{name === "type" ? "유형" : name === "owner" ? "담당" : name}</dt>
                <dd>{displayProperty(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <nav ref={navRef} className="document-overview__toc" aria-label="목차">
        <h2>목차</h2>
        {document.tableOfContents.length === 0 ? (
          <p>목차가 없습니다.</p>
        ) : (
          <ol>
            {document.tableOfContents.map((item) => (
              <li
                key={item.id}
                style={{
                  paddingInlineStart: `calc(${item.level - 1} * var(--space-3))`,
                }}
              >
                <a href={`#${item.id}`} target="_self" aria-current={activeId === item.id ? "location" : undefined} onClick={() => selectLocation(item.id)}>{item.title}</a>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </>
  );
}
