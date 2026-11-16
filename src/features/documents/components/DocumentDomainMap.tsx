import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExternalLink, FilePlus2, LayoutGrid } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import {
  classifyDocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  groupDocumentsByDomain,
  isAuxiliaryDocument,
  type DocumentCategory,
  type DocumentGroup,
} from "../document-taxonomy";
import { normalizeDocumentPath, type DocumentSummary } from "../model";

interface StageBucket {
  key: "prd" | "screen_spec" | "adr" | "guide_ref";
  label: string;
  categories: readonly DocumentCategory[];
}

const STAGE_BUCKETS: readonly StageBucket[] = [
  { key: "prd", label: "기획 · PRD", categories: ["prd"] },
  { key: "screen_spec", label: "화면명세", categories: ["screen_spec"] },
  { key: "adr", label: "설계 · ADR", categories: ["adr"] },
  { key: "guide_ref", label: "가이드 · 참고", categories: ["guide", "reference"] },
];

interface DomainEdge {
  id: string;
  fromKey: string;
  toKey: string;
  kind: "explicit" | "flow";
}

interface MeasuredEdge {
  id: string;
  path: string;
  kind: "explicit" | "flow";
}

function canonicalKey(path: string): string {
  return normalizeDocumentPath(path).replace(/\.html$/i, ".md").toLowerCase();
}

function buildDomainEdges(documents: readonly DocumentSummary[]): DomainEdge[] {
  const domainKeys = new Set(documents.map((doc) => canonicalKey(doc.path)));
  const edges: DomainEdge[] = [];
  const seen = new Set<string>();
  const explicitPairs = new Set<string>();

  for (const doc of documents) {
    const fromKey = canonicalKey(doc.path);
    for (const linked of doc.linkedPaths ?? []) {
      const toKey = canonicalKey(linked);
      if (toKey === fromKey || !domainKeys.has(toKey)) continue;
      const edgeId = `${fromKey}->${toKey}`;
      if (!seen.has(edgeId)) {
        seen.add(edgeId);
        explicitPairs.add(edgeId);
        explicitPairs.add(`${toKey}->${fromKey}`);
        edges.push({ id: edgeId, fromKey, toKey, kind: "explicit" });
      }
    }
  }

  const prds = documents.filter(
    (doc) => !isAuxiliaryDocument(doc) && classifyDocumentCategory(doc) === "prd",
  );
  const specs = documents.filter(
    (doc) =>
      !isAuxiliaryDocument(doc) && classifyDocumentCategory(doc) === "screen_spec",
  );
  const adrs = documents.filter(
    (doc) => !isAuxiliaryDocument(doc) && classifyDocumentCategory(doc) === "adr",
  );

  if (prds.length > 0 && specs.length > 0) {
    const anchorPrd = canonicalKey(prds[0]!.path);
    for (const spec of specs) {
      const specKey = canonicalKey(spec.path);
      const hasPrdLink = prds.some((prd) =>
        explicitPairs.has(`${canonicalKey(prd.path)}->${specKey}`),
      );
      if (!hasPrdLink) {
        const edgeId = `${anchorPrd}->${specKey}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({ id: edgeId, fromKey: anchorPrd, toKey: specKey, kind: "flow" });
        }
      }
    }
  }

  if (specs.length > 0 && adrs.length > 0) {
    const anchorSpec = canonicalKey(specs[0]!.path);
    for (const adr of adrs) {
      const adrKey = canonicalKey(adr.path);
      const hasSpecLink = specs.some((spec) =>
        explicitPairs.has(`${canonicalKey(spec.path)}->${adrKey}`),
      );
      if (!hasSpecLink) {
        const edgeId = `${anchorSpec}->${adrKey}`;
        if (!seen.has(edgeId)) {
          seen.add(edgeId);
          edges.push({ id: edgeId, fromKey: anchorSpec, toKey: adrKey, kind: "flow" });
        }
      }
    }
  }

  return edges;
}

function computeEdgePath(
  boardRect: DOMRect,
  fromRect: DOMRect,
  toRect: DOMRect,
): string {
  const fromY = fromRect.top - boardRect.top + fromRect.height / 2;
  const toY = toRect.top - boardRect.top + toRect.height / 2;

  if (fromRect.right <= toRect.left + 8) {
    const x1 = fromRect.right - boardRect.left;
    const x2 = toRect.left - boardRect.left;
    const dx = Math.max(24, (x2 - x1) * 0.48);
    return `M ${x1} ${fromY} C ${x1 + dx} ${fromY}, ${x2 - dx} ${toY}, ${x2} ${toY}`;
  }

  if (toRect.right <= fromRect.left + 8) {
    const x1 = fromRect.left - boardRect.left;
    const x2 = toRect.right - boardRect.left;
    const dx = Math.max(24, (x1 - x2) * 0.48);
    return `M ${x1} ${fromY} C ${x1 - dx} ${fromY}, ${x2 + dx} ${toY}, ${x2} ${toY}`;
  }

  const x1 = fromRect.right - boardRect.left;
  const x2 = toRect.right - boardRect.left;
  const archX = Math.max(x1, x2) + 28;
  return `M ${x1} ${fromY} C ${archX} ${fromY}, ${archX} ${toY}, ${x2} ${toY}`;
}

function DomainSectionBoard({
  group,
  lookupByPath,
  onSelectDocument,
  onSelectScreenSpecs,
  onOpenInNewWindow,
  onNewDocumentInFolder,
}: {
  group: DocumentGroup;
  lookupByPath: ReadonlyMap<string, DocumentSummary>;
  onSelectDocument: (
    path: string,
    preferredViewMode?: "html" | "markdown",
  ) => void;
  onSelectScreenSpecs?: (domainKey: string) => void;
  onOpenInNewWindow?: (
    path: string,
    viewMode?: "html" | "markdown",
    title?: string,
  ) => void;
  onNewDocumentInFolder?: (folderPath: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [svgSize, setSvgSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [measuredEdges, setMeasuredEdges] = useState<MeasuredEdge[]>([]);

  const columns = useMemo(() => {
    return STAGE_BUCKETS.map((bucket) => ({
      ...bucket,
      documents: group.documents.filter((doc) =>
        bucket.categories.includes(classifyDocumentCategory(doc)),
      ),
    })).filter((column) => column.documents.length > 0);
  }, [group.documents]);

  const edges = useMemo(() => buildDomainEdges(group.documents), [group.documents]);
  const hasScreenSpec = useMemo(
    () =>
      group.documents.some(
        (doc) =>
          !isAuxiliaryDocument(doc) &&
          classifyDocumentCategory(doc) === "screen_spec",
      ),
    [group.documents],
  );

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const measure = () => {
      const boardRect = board.getBoundingClientRect();
      if (boardRect.width <= 0 && boardRect.height <= 0) {
        setSvgSize({ width: 0, height: 0 });
        setMeasuredEdges([]);
        return;
      }

      const nextEdges: MeasuredEdge[] = [];
      for (const edge of edges) {
        const fromEl = cardRefs.current.get(edge.fromKey);
        const toEl = cardRefs.current.get(edge.toKey);
        if (!fromEl || !toEl) continue;
        nextEdges.push({
          id: edge.id,
          kind: edge.kind,
          path: computeEdgePath(
            boardRect,
            fromEl.getBoundingClientRect(),
            toEl.getBoundingClientRect(),
          ),
        });
      }
      setSvgSize({
        width: Math.max(board.scrollWidth, boardRect.width),
        height: Math.max(board.scrollHeight, boardRect.height),
      });
      setMeasuredEdges(nextEdges);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    for (const el of cardRefs.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [edges, columns]);

  const folderPath = group.folderPath;

  return (
    <section
      className="document-domain-map__section"
      aria-label={group.label}
    >
      <div className="document-domain-map__section-header">
        <div className="document-domain-map__section-heading">
          <h2>{group.label}</h2>
          <span className="document-search__group-count">
            {`${group.documents.length}건`}
          </span>
        </div>
        <div className="document-domain-map__section-actions">
          {hasScreenSpec && onSelectScreenSpecs ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onSelectScreenSpecs(group.key)}
            >
              <LayoutGrid aria-hidden="true" size={14} />
              화면명세 모아보기
            </Button>
          ) : null}
          {folderPath && onNewDocumentInFolder ? (
            <Button
              type="button"
              variant="ghost"
              className="document-search__group-action"
              aria-label={`${folderPath} 폴더에 새 문서`}
              onClick={() => onNewDocumentInFolder(folderPath)}
            >
              <FilePlus2 aria-hidden="true" />
              폴더에 새 문서
            </Button>
          ) : null}
        </div>
      </div>

      <div className="document-domain-map__board" ref={boardRef}>
        {svgSize.width > 0 && svgSize.height > 0 && measuredEdges.length > 0 ? (
          <svg
            className="document-domain-map__edges"
            aria-hidden="true"
            width={svgSize.width}
            height={svgSize.height}
            viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
          >
            <defs>
              <marker
                id={`edge-arrow-explicit-${group.key}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--color-primary)" />
              </marker>
              <marker
                id={`edge-arrow-flow-${group.key}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 1.5 L 8.5 5 L 0 8.5 z"
                  fill="var(--color-border-strong)"
                />
              </marker>
            </defs>
            {measuredEdges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                fill="none"
                stroke={
                  edge.kind === "explicit"
                    ? "var(--color-primary)"
                    : "var(--color-border-strong)"
                }
                strokeWidth={edge.kind === "explicit" ? 1.75 : 1.25}
                strokeDasharray={edge.kind === "flow" ? "4 4" : undefined}
                markerEnd={
                  edge.kind === "explicit"
                    ? `url(#edge-arrow-explicit-${group.key})`
                    : `url(#edge-arrow-flow-${group.key})`
                }
              />
            ))}
          </svg>
        ) : null}

        <div className="document-domain-map__columns">
          {columns.map((column) => (
            <div key={column.key} className="document-domain-map__column">
              <div className="document-domain-map__column-title">
                <span>{column.label}</span>
                <small>{`${column.documents.length}`}</small>
              </div>
              <div className="document-domain-map__cards">
                {column.documents.map((doc) => {
                  const category = classifyDocumentCategory(doc);
                  const key = canonicalKey(doc.path);
                  const relatedDocs: DocumentSummary[] = [];
                  const seenRelated = new Set<string>([key]);
                  for (const linkedPath of doc.linkedPaths ?? []) {
                    const targetKey = canonicalKey(linkedPath);
                    if (seenRelated.has(targetKey)) continue;
                    const resolved = lookupByPath.get(targetKey);
                    if (resolved) {
                      seenRelated.add(targetKey);
                      relatedDocs.push(resolved);
                    }
                    if (relatedDocs.length >= 4) break;
                  }

                  const preferredView: "html" | "markdown" = doc.hasCompanionHtml
                    ? "html"
                    : "markdown";
                  const headings = (doc.previewHeadings ?? []).slice(0, 3);
                  const designCount = doc.designs?.length ?? 0;

                  return (
                    <article
                      key={doc.path}
                      ref={(node) => {
                        if (node) {
                          cardRefs.current.set(key, node);
                        } else {
                          cardRefs.current.delete(key);
                        }
                      }}
                      className="document-map-card"
                      aria-label={doc.title}
                      data-category={category}
                    >
                      <div className="document-map-card__top">
                        <div className="document-map-card__badges">
                          <span className="document-map-card__badge">
                            {DOCUMENT_CATEGORY_LABELS[category]}
                          </span>
                          {doc.hasCompanionHtml ? (
                            <span className="document-map-card__badge document-map-card__badge--html">
                              HTML
                            </span>
                          ) : null}
                          {designCount > 0 ? (
                            <span className="document-map-card__badge document-map-card__badge--design">
                              {`디자인 ${designCount}`}
                            </span>
                          ) : null}
                        </div>
                        {onOpenInNewWindow ? (
                          <IconButton
                            type="button"
                            label="새 창으로 열기"
                            tooltip={false}
                            className="document-map-card__popout"
                            onClick={() =>
                              onOpenInNewWindow(doc.path, preferredView, doc.title)
                            }
                          >
                            <ExternalLink aria-hidden="true" />
                          </IconButton>
                        ) : null}
                      </div>

                      <UnstyledButton
                        type="button"
                        className="document-map-card__main"
                        onClick={() => onSelectDocument(doc.path, preferredView)}
                      >
                        <strong className="document-map-card__title">
                          {doc.title}
                        </strong>
                        <div className="document-map-card__thumb">
                          <div
                            className="document-map-card__thumb-chrome"
                            aria-hidden="true"
                          >
                            <span />
                            <span />
                            <span />
                          </div>
                          {doc.description ? (
                            <p className="document-map-card__desc">
                              {doc.description}
                            </p>
                          ) : null}
                          {headings.length > 0 ? (
                            <ul className="document-map-card__headings">
                              {headings.map((heading, idx) => (
                                <li key={`${idx}-${heading}`}>{heading}</li>
                              ))}
                            </ul>
                          ) : !doc.description ? (
                            <div
                              className="document-map-card__wireframe"
                              aria-hidden="true"
                            >
                              <span />
                              <span />
                            </div>
                          ) : null}
                        </div>
                      </UnstyledButton>

                      {relatedDocs.length > 0 ? (
                        <div
                          className="document-map-card__links"
                          aria-label={`${doc.title} 연결 문서`}
                        >
                          {relatedDocs.map((target) => (
                            <UnstyledButton
                              key={target.path}
                              type="button"
                              className="document-map-card__link-chip"
                              onClick={() =>
                                onSelectDocument(
                                  target.path,
                                  target.hasCompanionHtml ? "html" : "markdown",
                                )
                              }
                            >
                              {`→ ${target.title}`}
                            </UnstyledButton>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DocumentDomainMap({
  documents,
  allDocuments,
  onSelectDocument,
  onSelectScreenSpecs,
  onOpenInNewWindow,
  onNewDocumentInFolder,
}: {
  documents: readonly DocumentSummary[];
  allDocuments?: readonly DocumentSummary[];
  onSelectDocument: (
    path: string,
    preferredViewMode?: "html" | "markdown",
  ) => void;
  onSelectScreenSpecs?: (domainKey: string) => void;
  onOpenInNewWindow?: (
    path: string,
    viewMode?: "html" | "markdown",
    title?: string,
  ) => void;
  onNewDocumentInFolder?: (folderPath: string) => void;
}) {
  const groups = useMemo(() => groupDocumentsByDomain(documents), [documents]);
  const lookupByPath = useMemo(() => {
    const map = new Map<string, DocumentSummary>();
    for (const doc of allDocuments ?? documents) {
      map.set(canonicalKey(doc.path), doc);
    }
    return map;
  }, [allDocuments, documents]);

  if (groups.length === 0) {
    return (
      <p className="document-search__empty">
        도메인 맵에 표시할 문서가 없습니다.
      </p>
    );
  }

  return (
    <div className="document-domain-map">
      {groups.map((group) => (
        <DomainSectionBoard
          key={group.key}
          group={group}
          lookupByPath={lookupByPath}
          onSelectDocument={onSelectDocument}
          onSelectScreenSpecs={onSelectScreenSpecs}
          onOpenInNewWindow={onOpenInNewWindow}
          onNewDocumentInFolder={onNewDocumentInFolder}
        />
      ))}
    </div>
  );
}
