import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  createCodeRepositoriesGateway,
  type CodeRepositoriesGateway,
  type CodeRepositoryFilePreview,
} from "@/features/code-repositories/CodeRepositoriesGateway";
import type { DocumentContent } from "../model";

interface ParsedCodeReference {
  raw: string;
  repository: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
}

const defaultCodeGateway = createCodeRepositoriesGateway();

function parseCodeReference(raw: string): ParsedCodeReference | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const [pathWithRepo, fragment] = trimmed.split("#", 2);
  let repository = "";
  let filePath = pathWithRepo.trim();
  const colonIdx = filePath.indexOf(":");
  if (colonIdx > 0 && !filePath.slice(0, colonIdx).includes("\\")) {
    repository = filePath.slice(0, colonIdx).trim();
    filePath = filePath.slice(colonIdx + 1).trim();
  }
  if (!filePath) return null;

  let startLine: number | undefined;
  let endLine: number | undefined;
  if (fragment) {
    const lineMatch = /^L?(\d+)(?:-L?(\d+))?$/i.exec(fragment.trim());
    if (lineMatch) {
      startLine = Number(lineMatch[1]);
      endLine = lineMatch[2] ? Number(lineMatch[2]) : startLine;
    }
  }
  return {
    raw: trimmed,
    repository,
    filePath,
    startLine,
    endLine,
  };
}

function extractCodeReferences(properties: unknown): ParsedCodeReference[] {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  const record = properties as Record<string, unknown>;
  const rawList: string[] = [];
  for (const key of ["code_refs", "codeRefs", "code_paths", "codePaths", "code"]) {
    const val = record[key];
    if (typeof val === "string") {
      rawList.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string") {
          rawList.push(item);
        }
      }
    }
  }
  return rawList
    .map(parseCodeReference)
    .filter((item): item is ParsedCodeReference => item !== null);
}

const PROPERTY_LABELS: Record<string, string> = {
  type: "유형",
  owner: "담당",
  status: "상태",
  domain: "도메인",
  tags: "태그",
  related_docs: "관련 문서",
  wireframes: "와이어프레임",
  designs: "디자인 시안",
  impl_status: "코드 반영 상태",
  impl_note: "코드 반영 메모",
  updated: "업데이트",
  updated_at: "업데이트",
  code_refs: "코드 참조",
};

const IMPL_STATUS_LABELS: Record<string, string> = {
  synced: "코드 반영 완료",
  partial: "일부 수정 필요",
  unimplemented: "미반영",
};

function displayProperty(value: unknown, key?: string): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (key === "impl_status" && value in IMPL_STATUS_LABELS) {
      return IMPL_STATUS_LABELS[value];
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "없음";
    if (key === "wireframes" || key === "designs") {
      return `${value.length}건 (시안 탭에서 보기)`;
    }
    if (
      value.every(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      )
    ) {
      return value.map(String).join(", ");
    }
    const namedTitles = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        if (typeof record.title === "string") return record.title;
        if (typeof record.name === "string") return record.name;
        return null;
      })
      .filter((item): item is string => item !== null);
    if (namedTitles.length === value.length) {
      return namedTitles.join(", ");
    }
    return `${value.length}건`;
  }
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

export function DocumentOverview({
  document,
  readerRef,
  onNavigate,
  onRequestHeading,
  codeRepositoriesGateway = defaultCodeGateway,
}: {
  document: DocumentContent;
  readerRef?: RefObject<HTMLElement | null>;
  onNavigate?: (id: string) => void;
  onRequestHeading?: (id: string) => void;
  codeRepositoriesGateway?: CodeRepositoriesGateway;
}) {
  const entries = propertyEntries(document.properties);
  const codeReferences = extractCodeReferences(document.properties);
  const [selectedCodeRef, setSelectedCodeRef] = useState<string | null>(null);
  const [loadingCodeRef, setLoadingCodeRef] = useState<string | null>(null);
  const [codePreview, setCodePreview] =
    useState<CodeRepositoryFilePreview | null>(null);
  const [codePreviewError, setCodePreviewError] = useState<string | null>(null);
  const codeRequestSeqRef = useRef(0);
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
    if (!heading) {
      onRequestHeading?.(id);
    } else if (root && root.scrollHeight > root.clientHeight) {
      const offset = parseFloat(getComputedStyle(heading).scrollMarginTop) || 0;
      const desired = root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
      const nextScrollTop = Math.max(0, Math.min(desired, root.scrollHeight - root.clientHeight));
      requestedLocation.current = { id, scrollTop: nextScrollTop };
      if (typeof root.scrollTo === "function") {
        root.scrollTo({ top: nextScrollTop, behavior: "auto" });
      } else {
        root.scrollTop = nextScrollTop;
      }
    } else if (typeof heading.scrollIntoView === "function") {
      requestedLocation.current = null;
      heading.scrollIntoView({ block: "start" });
    }
    setActiveId(id);
    onNavigate?.(id);
  };

  const toggleCodeReference = async (ref: ParsedCodeReference) => {
    const nextSeq = ++codeRequestSeqRef.current;
    if (selectedCodeRef === ref.raw) {
      setSelectedCodeRef(null);
      setLoadingCodeRef(null);
      setCodePreview(null);
      setCodePreviewError(null);
      return;
    }
    setSelectedCodeRef(ref.raw);
    setLoadingCodeRef(ref.raw);
    setCodePreview(null);
    setCodePreviewError(null);
    try {
      const loaded = await codeRepositoriesGateway.readCodeRepositoryFile(
        ref.repository,
        ref.filePath,
        ref.startLine,
        ref.endLine,
      );
      if (codeRequestSeqRef.current !== nextSeq) return;
      setCodePreview(loaded);
    } catch (err) {
      if (codeRequestSeqRef.current !== nextSeq) return;
      setCodePreviewError(
        err instanceof Error
          ? err.message
          : "연결된 코드 저장소에서 파일을 읽지 못했습니다.",
      );
    } finally {
      if (codeRequestSeqRef.current === nextSeq) {
        setLoadingCodeRef(null);
      }
    }
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
                <dt>{PROPERTY_LABELS[name] ?? name}</dt>
                <dd>{displayProperty(value, name)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      {codeReferences.length > 0 && (
        <section
          className="mt-[var(--space-4)] grid gap-[var(--space-2)]"
          aria-label="연결된 코드 참조"
        >
          <h2 className="m-0 text-[length:var(--font-ui-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            연결된 코드 참조
          </h2>
          <div className="grid gap-[var(--space-1)]">
            {codeReferences.map((ref) => (
              <Button
                key={ref.raw}
                type="button"
                variant="secondary"
                loading={loadingCodeRef === ref.raw}
                onClick={() => void toggleCodeReference(ref)}
                className="justify-start font-mono text-[length:var(--font-meta-size)]"
              >
                {ref.raw}
              </Button>
            ))}
          </div>
          {loadingCodeRef && (
            <p
              role="status"
              aria-live="polite"
              className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]"
            >
              코드 스니펫을 불러오는 중…
            </p>
          )}
          {codePreviewError && (
            <p
              role="alert"
              className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-error)]"
            >
              {codePreviewError}
            </p>
          )}
          {codePreview && (
            <div className="grid gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-2)]">
              <div className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                {codePreview.repositoryFullName} · {codePreview.filePath} (L
                {codePreview.startLine}–L{codePreview.endLine})
              </div>
              <pre className="m-0 overflow-x-auto font-mono text-[length:var(--font-meta-size)] text-[var(--color-text-strong)]">
                <code>{codePreview.content}</code>
              </pre>
            </div>
          )}
        </section>
      )}
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
                <a
                  href={`#${item.id}`}
                  target="_self"
                  aria-current={activeId === item.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    selectLocation(item.id);
                  }}
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </>
  );
}
