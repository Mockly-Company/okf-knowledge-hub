import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExternalLink, FilePlus2, LayoutGrid } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { useOptionalDocuments } from "../DocumentsProvider";
import {
  classifyDocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  groupDocumentsByDomain,
  isAuxiliaryDocument,
  isOverviewDocument,
  type DocumentGroup,
} from "../document-taxonomy";
import {
  normalizeDocumentPath,
  type DocumentAsset,
  type DocumentDesignLink,
  type DocumentSummary,
  type DocumentWireframe,
} from "../model";
import {
  DesignPreviewDialog,
  documentAssetSrc,
  safeHttpUrl,
  useDocumentAsset,
  type DocumentAssetReader,
  type ExpandedDesignPreview,
} from "./DesignLinksBar";

type StageKey = "overview" | "prd" | "screen_spec" | "design" | "adr" | "guide_ref";

/** Left-to-right reading order: overview → planning → screen spec → design, then side records. */
const STAGE_LABELS: Record<StageKey, string> = {
  overview: "개요",
  prd: "기획 · PRD",
  screen_spec: "화면명세",
  design: "디자인",
  adr: "설계 · ADR",
  guide_ref: "가이드 · 참고",
};

const STAGE_ORDER: readonly StageKey[] = [
  "overview",
  "prd",
  "screen_spec",
  "design",
  "adr",
  "guide_ref",
];

function documentStage(doc: DocumentSummary): Exclude<StageKey, "design"> {
  if (isOverviewDocument(doc)) return "overview";
  switch (classifyDocumentCategory(doc)) {
    case "prd":
      return "prd";
    case "screen_spec":
      return "screen_spec";
    case "adr":
      return "adr";
    default:
      return "guide_ref";
  }
}

type MapCard =
  | { kind: "document"; key: string; doc: DocumentSummary }
  | {
      kind: "design";
      key: string;
      spec: DocumentSummary;
      design: DocumentDesignLink;
    };

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

const unavailableAssetReader: DocumentAssetReader = async (): Promise<DocumentAsset> => {
  throw new Error("문서 에셋 리더를 사용할 수 없습니다.");
};

function canonicalKey(path: string): string {
  return normalizeDocumentPath(path).replace(/\.html$/i, ".md").toLowerCase();
}

function designCardKey(specKey: string, index: number): string {
  return `design:${specKey}#${index}`;
}

function preferredViewOf(doc: DocumentSummary): "html" | "markdown" {
  return doc.hasCompanionHtml ? "html" : "markdown";
}

function buildDomainEdges(documents: readonly DocumentSummary[]): DomainEdge[] {
  const domainKeys = new Set(documents.map((doc) => canonicalKey(doc.path)));
  const edges: DomainEdge[] = [];
  const seen = new Set<string>();
  const explicitPairs = new Set<string>();
  const pushEdge = (fromKey: string, toKey: string, kind: DomainEdge["kind"]) => {
    const edgeId = `${fromKey}->${toKey}`;
    if (seen.has(edgeId)) return;
    seen.add(edgeId);
    edges.push({ id: edgeId, fromKey, toKey, kind });
  };

  for (const doc of documents) {
    const fromKey = canonicalKey(doc.path);
    for (const linked of doc.linkedPaths ?? []) {
      const toKey = canonicalKey(linked);
      if (toKey === fromKey || !domainKeys.has(toKey)) continue;
      explicitPairs.add(`${fromKey}->${toKey}`);
      explicitPairs.add(`${toKey}->${fromKey}`);
      pushEdge(fromKey, toKey, "explicit");
    }
  }

  const byStage = (stage: StageKey) =>
    documents.filter(
      (doc) => documentStage(doc) === stage && (stage === "overview" || !isAuxiliaryDocument(doc)),
    );
  const overviews = byStage("overview");
  const prds = byStage("prd");
  const specs = byStage("screen_spec");
  const adrs = byStage("adr");

  // Implied reading-flow edges from the first document of one stage to each document of the
  // next stage, unless an explicit related_docs link already connects them.
  const linkFlow = (
    anchors: readonly DocumentSummary[],
    targets: readonly DocumentSummary[],
  ) => {
    const [anchor] = anchors;
    if (!anchor) return;
    const anchorKey = canonicalKey(anchor.path);
    for (const target of targets) {
      const targetKey = canonicalKey(target.path);
      const linked = anchors.some((candidate) =>
        explicitPairs.has(`${canonicalKey(candidate.path)}->${targetKey}`),
      );
      if (!linked) pushEdge(anchorKey, targetKey, "flow");
    }
  };

  linkFlow(overviews, prds.length > 0 ? prds.slice(0, 1) : specs.slice(0, 1));
  linkFlow(prds, specs);
  linkFlow(specs, adrs);

  for (const spec of specs) {
    const specKey = canonicalKey(spec.path);
    (spec.designs ?? []).forEach((_, index) => {
      pushEdge(specKey, designCardKey(specKey, index), "explicit");
    });
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

function ThumbChrome() {
  return (
    <div className="document-map-card__thumb-chrome" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function WireframeThumb({
  documentPath,
  wireframe,
  readAsset,
}: {
  documentPath: string;
  wireframe: DocumentWireframe;
  readAsset: DocumentAssetReader;
}) {
  const { asset, failed } = useDocumentAsset(documentPath, wireframe.image, readAsset);
  return (
    <div className="document-map-card__thumb document-map-card__thumb--image">
      {asset ? (
        <img src={documentAssetSrc(asset)} alt={wireframe.title} />
      ) : (
        <span className="document-map-card__thumb-status">
          {failed ? "와이어프레임을 불러올 수 없습니다." : "와이어프레임 불러오는 중…"}
        </span>
      )}
    </div>
  );
}

function DesignMapCard({
  spec,
  design,
  readAsset,
  registerRef,
  onSelectDocument,
  onOpenExternal,
  onExpand,
}: {
  spec: DocumentSummary;
  design: DocumentDesignLink;
  readAsset: DocumentAssetReader;
  registerRef: (node: HTMLElement | null) => void;
  onSelectDocument: (path: string, preferredViewMode?: "html" | "markdown") => void;
  onOpenExternal?: (url: string) => void;
  onExpand: (preview: ExpandedDesignPreview) => void;
}) {
  const { asset, failed } = useDocumentAsset(spec.path, design.image, readAsset);
  const externalUrl = safeHttpUrl(design.url);

  return (
    <article
      ref={registerRef}
      className="document-map-card document-map-card--design"
      aria-label={`${design.title} 디자인 시안`}
      data-category="design"
    >
      <div className="document-map-card__top">
        <div className="document-map-card__badges">
          <span className="document-map-card__badge document-map-card__badge--design">
            디자인
          </span>
          {design.status ? (
            <span className="document-map-card__badge">{design.status}</span>
          ) : null}
        </div>
        {externalUrl && onOpenExternal ? (
          <IconButton
            type="button"
            label={`${design.title} 원본 디자인 열기`}
            tooltip={false}
            className="document-map-card__popout"
            onClick={() => onOpenExternal(externalUrl)}
          >
            <ExternalLink aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>

      <strong className="document-map-card__title">{design.title}</strong>
      {design.image ? (
        asset ? (
          <UnstyledButton
            type="button"
            className="document-map-card__thumb document-map-card__thumb--image"
            aria-label={`${design.title} 크게 보기`}
            onClick={() => onExpand({ asset, title: design.title, externalUrl })}
          >
            <img src={documentAssetSrc(asset)} alt={design.title} />
          </UnstyledButton>
        ) : (
          <div className="document-map-card__thumb document-map-card__thumb--image">
            <span className="document-map-card__thumb-status">
              {failed ? "시안 이미지를 불러올 수 없습니다." : "디자인 시안 불러오는 중…"}
            </span>
          </div>
        )
      ) : null}
      {design.wireframe ? (
        <p className="document-map-card__meta">{`와이어프레임 · ${design.wireframe}`}</p>
      ) : null}

      <div className="document-map-card__links">
        <UnstyledButton
          type="button"
          className="document-map-card__link-chip"
          onClick={() => onSelectDocument(spec.path, preferredViewOf(spec))}
        >
          {`← ${spec.title}`}
        </UnstyledButton>
      </div>
    </article>
  );
}

function DomainSectionBoard({
  group,
  lookupByPath,
  readAsset,
  onSelectDocument,
  onSelectScreenSpecs,
  onOpenInNewWindow,
  onNewDocumentInFolder,
  onOpenExternal,
  onExpandDesign,
}: {
  group: DocumentGroup;
  lookupByPath: ReadonlyMap<string, DocumentSummary>;
  readAsset: DocumentAssetReader;
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
  onOpenExternal?: (url: string) => void;
  onExpandDesign: (preview: ExpandedDesignPreview) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [svgSize, setSvgSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [measuredEdges, setMeasuredEdges] = useState<MeasuredEdge[]>([]);

  const columns = useMemo(() => {
    const cardsByStage = new Map<StageKey, MapCard[]>(
      STAGE_ORDER.map((stage) => [stage, []]),
    );
    for (const doc of group.documents) {
      cardsByStage
        .get(documentStage(doc))
        ?.push({ kind: "document", key: canonicalKey(doc.path), doc });
    }
    for (const card of cardsByStage.get("screen_spec") ?? []) {
      if (card.kind !== "document" || isAuxiliaryDocument(card.doc)) continue;
      (card.doc.designs ?? []).forEach((design, index) => {
        cardsByStage.get("design")?.push({
          kind: "design",
          key: designCardKey(card.key, index),
          spec: card.doc,
          design,
        });
      });
    }
    return STAGE_ORDER.map((stage) => ({
      key: stage,
      label: STAGE_LABELS[stage],
      cards: cardsByStage.get(stage) ?? [],
    })).filter((column) => column.cards.length > 0);
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

  const registerCard = (key: string) => (node: HTMLElement | null) => {
    if (node) {
      cardRefs.current.set(key, node);
    } else {
      cardRefs.current.delete(key);
    }
  };

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

    let rafId: number | null = null;
    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    observer?.observe(board);
    // Thumbnails load asynchronously and grow individual cards without resizing the board.
    for (const card of cardRefs.current.values()) {
      observer?.observe(card);
    }
    board.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      observer?.disconnect();
      board.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
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
            <div
              key={column.key}
              role="group"
              aria-label={column.label}
              className="document-domain-map__column"
            >
              <div className="document-domain-map__column-title" aria-hidden="true">
                <span>{column.label}</span>
                <small>{`${column.cards.length}`}</small>
              </div>
              <div className="document-domain-map__cards">
                {column.cards.map((card) => {
                  if (card.kind === "design") {
                    return (
                      <DesignMapCard
                        key={card.key}
                        spec={card.spec}
                        design={card.design}
                        readAsset={readAsset}
                        registerRef={registerCard(card.key)}
                        onSelectDocument={onSelectDocument}
                        onOpenExternal={onOpenExternal}
                        onExpand={onExpandDesign}
                      />
                    );
                  }

                  const { doc, key } = card;
                  const category = classifyDocumentCategory(doc);
                  const isScreenSpec = column.key === "screen_spec";
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

                  const preferredView = preferredViewOf(doc);
                  const headings = (doc.previewHeadings ?? []).slice(0, 3);
                  const designCount = doc.designs?.length ?? 0;
                  const wireframes = doc.wireframes ?? [];
                  const [firstWireframe] = wireframes;

                  return (
                    <article
                      key={doc.path}
                      ref={registerCard(key)}
                      className="document-map-card"
                      aria-label={doc.title}
                      data-category={column.key === "overview" ? "overview" : category}
                    >
                      <div className="document-map-card__top">
                        <div className="document-map-card__badges">
                          <span className="document-map-card__badge">
                            {column.key === "overview"
                              ? STAGE_LABELS.overview
                              : DOCUMENT_CATEGORY_LABELS[category]}
                          </span>
                          {doc.hasCompanionHtml ? (
                            <span className="document-map-card__badge document-map-card__badge--html">
                              HTML
                            </span>
                          ) : null}
                          {isScreenSpec ? (
                            wireframes.length > 0 ? (
                              <span className="document-map-card__badge document-map-card__badge--wireframe">
                                {`와이어프레임 ${wireframes.length}`}
                              </span>
                            ) : (
                              <span className="document-map-card__badge document-map-card__badge--warning">
                                와이어프레임 없음
                              </span>
                            )
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
                        {isScreenSpec && firstWireframe ? (
                          <WireframeThumb
                            documentPath={doc.path}
                            wireframe={firstWireframe}
                            readAsset={readAsset}
                          />
                        ) : (
                          <div className="document-map-card__thumb">
                            <ThumbChrome />
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
                        )}
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
                                onSelectDocument(target.path, preferredViewOf(target))
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
  readAsset,
  onSelectDocument,
  onSelectScreenSpecs,
  onOpenInNewWindow,
  onNewDocumentInFolder,
  onOpenExternal,
}: {
  documents: readonly DocumentSummary[];
  allDocuments?: readonly DocumentSummary[];
  readAsset?: DocumentAssetReader;
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
  onOpenExternal?: (url: string) => void;
}) {
  const docsContext = useOptionalDocuments();
  const assetReader = readAsset ?? docsContext?.readAsset ?? unavailableAssetReader;
  const externalOpener =
    onOpenExternal ??
    (docsContext ? (url: string) => void docsContext.openExternal(url) : undefined);
  const [expandedDesign, setExpandedDesign] = useState<ExpandedDesignPreview | null>(
    null,
  );
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
          readAsset={assetReader}
          onSelectDocument={onSelectDocument}
          onSelectScreenSpecs={onSelectScreenSpecs}
          onOpenInNewWindow={onOpenInNewWindow}
          onNewDocumentInFolder={onNewDocumentInFolder}
          onOpenExternal={externalOpener}
          onExpandDesign={setExpandedDesign}
        />
      ))}
      <DesignPreviewDialog
        preview={expandedDesign}
        onClose={() => setExpandedDesign(null)}
        onOpenExternal={externalOpener}
      />
    </div>
  );
}
