import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExternalLink, FilePlus2, GitCompareArrows, LayoutGrid } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import type { BoardIssue } from "@/features/project-board/model";
import { cn } from "@/lib/utils";
import { useOptionalDocuments } from "../DocumentsProvider";
import {
  classifyDocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  groupDocumentsByDomain,
  isAuxiliaryDocument,
  isOverviewDocument,
  type DocumentGroup,
} from "../document-taxonomy";
import { resolveDocumentImplStatus } from "../impl-status";
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

const STAGE_RANK: Record<StageKey, number> = {
  overview: 0,
  prd: 1,
  screen_spec: 2,
  design: 3,
  adr: 4,
  guide_ref: 5,
};

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
  fromKey: string;
  toKey: string;
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

export function buildDomainEdges(documents: readonly DocumentSummary[]): DomainEdge[] {
  const stageByKey = new Map<string, StageKey>();
  for (const doc of documents) {
    stageByKey.set(canonicalKey(doc.path), documentStage(doc));
  }

  const byStage = (stage: StageKey) =>
    documents.filter(
      (doc) => documentStage(doc) === stage && (stage === "overview" || !isAuxiliaryDocument(doc)),
    );
  const overviews = byStage("overview");
  const prds = byStage("prd");
  const specs = byStage("screen_spec");
  const adrs = byStage("adr");
  const hasPrds = prds.length > 0;

  const edges: DomainEdge[] = [];
  const seen = new Set<string>();
  const explicitPairs = new Set<string>();
  const incomingExplicitByStage = new Map<string, Set<string>>();

  const pushEdge = (fromKey: string, toKey: string, kind: DomainEdge["kind"]) => {
    const edgeId = `${fromKey}->${toKey}`;
    if (seen.has(edgeId)) return;
    seen.add(edgeId);
    edges.push({ id: edgeId, fromKey, toKey, kind });
  };

  for (const doc of documents) {
    const rawFromKey = canonicalKey(doc.path);
    const rawFromStage = stageByKey.get(rawFromKey);
    if (!rawFromStage) continue;

    for (const linked of doc.linkedPaths ?? []) {
      const rawToKey = canonicalKey(linked);
      const rawToStage = stageByKey.get(rawToKey);
      if (!rawToStage || rawToKey === rawFromKey) continue;

      let fromKey = rawFromKey;
      let toKey = rawToKey;
      let fromStage = rawFromStage;
      let toStage = rawToStage;

      // 화면명세 → 기획 역방향 참조는 화면상 기획 → 화면명세 정방향으로 정규화하고, 그 외 역방향/동일 컬럼 간선은 그리지 않는다.
      if (STAGE_RANK[fromStage] > STAGE_RANK[toStage]) {
        if (fromStage === "screen_spec" && toStage === "prd") {
          fromKey = rawToKey;
          fromStage = rawToStage;
          toKey = rawFromKey;
          toStage = rawFromStage;
        } else {
          continue;
        }
      }

      if (fromStage === toStage) continue;

      // 기획(PRD)이 있는 도메인에서는 개요 → 화면명세 직통 화살표를 생략해 개요 → 기획 → 화면명세 흐름만 유지한다.
      if (hasPrds && fromStage === "overview" && toStage !== "prd") {
        continue;
      }

      explicitPairs.add(`${fromKey}->${toKey}`);
      let targetsFromStage = incomingExplicitByStage.get(fromStage);
      if (!targetsFromStage) {
        targetsFromStage = new Set<string>();
        incomingExplicitByStage.set(fromStage, targetsFromStage);
      }
      targetsFromStage.add(toKey);
      pushEdge(fromKey, toKey, "explicit");
    }
  }

  // 명시적 related_docs 연결이 없는 다음 단계 카드만 대표 선행 문서의 암묵적 흐름선으로 잇는다.
  const linkFlow = (
    fromStageKey: StageKey,
    anchors: readonly DocumentSummary[],
    targets: readonly DocumentSummary[],
  ) => {
    const [anchor] = anchors;
    if (!anchor) return;
    const anchorKey = canonicalKey(anchor.path);
    const explicitlyLinkedTargets = incomingExplicitByStage.get(fromStageKey);
    for (const target of targets) {
      const targetKey = canonicalKey(target.path);
      if (explicitlyLinkedTargets?.has(targetKey)) continue;
      const linked = anchors.some((candidate) =>
        explicitPairs.has(`${canonicalKey(candidate.path)}->${targetKey}`),
      );
      if (!linked) pushEdge(anchorKey, targetKey, "flow");
    }
  };

  linkFlow("overview", overviews, hasPrds ? prds.slice(0, 1) : specs.slice(0, 1));
  linkFlow("prd", prds, specs);
  linkFlow("screen_spec", specs, adrs);

  for (const spec of specs) {
    const specKey = canonicalKey(spec.path);
    (spec.designs ?? []).forEach((_, index) => {
      pushEdge(specKey, designCardKey(specKey, index), "explicit");
    });
  }

  return edges;
}

interface RawEdgeGeometry {
  edge: DomainEdge;
  fromRect: DOMRect;
  toRect: DOMRect;
  fromCenterY: number;
  toCenterY: number;
}

function buildRoundedOrthogonalPath(
  x1: number,
  y1: number,
  laneX: number,
  x2: number,
  y2: number,
): string {
  const dy = y2 - y1;
  if (Math.abs(dy) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dir = dy > 0 ? 1 : -1;
  const r = Math.min(
    8,
    Math.abs(laneX - x1) - 1,
    Math.abs(x2 - laneX) - 1,
    Math.abs(dy) / 2,
  );
  if (r < 2) {
    return `M ${x1} ${y1} L ${laneX} ${y1} L ${laneX} ${y2} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} L ${laneX - r} ${y1} Q ${laneX} ${y1} ${laneX} ${y1 + dir * r} L ${laneX} ${y2 - dir * r} Q ${laneX} ${y2} ${laneX + r} ${y2} L ${x2} ${y2}`;
}

function spreadPortY(
  rectTop: number,
  rectHeight: number,
  boardTop: number,
  scrollTop: number,
  index: number,
  total: number,
): number {
  const relTop = rectTop - boardTop + scrollTop;
  if (total <= 1) {
    return relTop + rectHeight * 0.5;
  }
  const ratio = 0.24 + (0.52 * index) / (total - 1);
  return relTop + rectHeight * ratio;
}

interface PositionedEdge {
  edge: DomainEdge;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export function layoutDomainEdgePaths(
  edges: readonly DomainEdge[],
  cardRefs: ReadonlyMap<string, HTMLElement>,
  board: HTMLElement,
  boardRect: DOMRect,
): MeasuredEdge[] {
  const geometries: RawEdgeGeometry[] = [];
  for (const edge of edges) {
    const fromEl = cardRefs.get(edge.fromKey);
    const toEl = cardRefs.get(edge.toKey);
    if (!fromEl || !toEl) continue;
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    if (toRect.left < fromRect.left || Math.abs(fromRect.left - toRect.left) < 40) {
      continue;
    }
    geometries.push({
      edge,
      fromRect,
      toRect,
      fromCenterY: fromRect.top + fromRect.height / 2,
      toCenterY: toRect.top + toRect.height / 2,
    });
  }

  if (geometries.length === 0) {
    return [];
  }

  const outPortY = new Map<string, number>();
  const outgoingByFrom = new Map<string, RawEdgeGeometry[]>();
  for (const geom of geometries) {
    const list = outgoingByFrom.get(geom.edge.fromKey) ?? [];
    list.push(geom);
    outgoingByFrom.set(geom.edge.fromKey, list);
  }
  for (const group of outgoingByFrom.values()) {
    group.sort(
      (a, b) => a.toCenterY - b.toCenterY || a.edge.id.localeCompare(b.edge.id),
    );
    group.forEach((geom, idx) => {
      outPortY.set(
        geom.edge.id,
        spreadPortY(
          geom.fromRect.top,
          geom.fromRect.height,
          boardRect.top,
          board.scrollTop,
          idx,
          group.length,
        ),
      );
    });
  }

  const inPortY = new Map<string, number>();
  const incomingByTo = new Map<string, RawEdgeGeometry[]>();
  for (const geom of geometries) {
    const list = incomingByTo.get(geom.edge.toKey) ?? [];
    list.push(geom);
    incomingByTo.set(geom.edge.toKey, list);
  }
  for (const group of incomingByTo.values()) {
    group.sort(
      (a, b) => a.fromCenterY - b.fromCenterY || a.edge.id.localeCompare(b.edge.id),
    );
    group.forEach((geom, idx) => {
      inPortY.set(
        geom.edge.id,
        spreadPortY(
          geom.toRect.top,
          geom.toRect.height,
          boardRect.top,
          board.scrollTop,
          idx,
          group.length,
        ),
      );
    });
  }

  const gutterGroups = new Map<string, PositionedEdge[]>();
  for (const geom of geometries) {
    const x1 = geom.fromRect.right - boardRect.left + board.scrollLeft;
    const x2 = geom.toRect.left - boardRect.left + board.scrollLeft;
    const y1 = outPortY.get(geom.edge.id) ?? 0;
    const y2 = inPortY.get(geom.edge.id) ?? 0;
    const gutterKey = `${Math.round(x1 / 24)}->${Math.round(x2 / 24)}`;
    const group = gutterGroups.get(gutterKey) ?? [];
    group.push({ edge: geom.edge, x1, x2, y1, y2 });
    gutterGroups.set(gutterKey, group);
  }

  const measured: MeasuredEdge[] = [];
  for (const group of gutterGroups.values()) {
    group.sort(
      (a, b) =>
        a.y1 - b.y1 || a.y2 - b.y2 || a.edge.id.localeCompare(b.edge.id),
    );
    group.forEach((item, idx) => {
      const laneMin = item.x1 + 10;
      const laneMax = item.x2 - 10;
      const laneX =
        laneMax <= laneMin
          ? (item.x1 + item.x2) / 2
          : group.length === 1
            ? (laneMin + laneMax) / 2
            : laneMin + ((laneMax - laneMin) * idx) / (group.length - 1);
      measured.push({
        id: item.edge.id,
        fromKey: item.edge.fromKey,
        toKey: item.edge.toKey,
        kind: item.edge.kind,
        path: buildRoundedOrthogonalPath(item.x1, item.y1, laneX, item.x2, item.y2),
      });
    });
  }

  return measured;
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
  onHoverChange,
}: {
  spec: DocumentSummary;
  design: DocumentDesignLink;
  readAsset: DocumentAssetReader;
  registerRef: (node: HTMLElement | null) => void;
  onSelectDocument: (path: string, preferredViewMode?: "html" | "markdown") => void;
  onOpenExternal?: (url: string) => void;
  onExpand: (preview: ExpandedDesignPreview) => void;
  onHoverChange?: (active: boolean) => void;
}) {
  const { asset, failed } = useDocumentAsset(spec.path, design.image, readAsset);
  const externalUrl = safeHttpUrl(design.url);

  return (
    <article
      ref={registerRef}
      className="document-map-card document-map-card--design"
      aria-label={`${design.title} 디자인 시안`}
      data-category="design"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onHoverChange?.(false);
        }
      }}
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

function hashMarkerKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function DomainSectionBoard({
  group,
  lookupByPath,
  boardIssues,
  readAsset,
  onSelectDocument,
  onSelectScreenSpecs,
  onAuditCodeSync,
  onOpenInNewWindow,
  onNewDocumentInFolder,
  onOpenExternal,
  onExpandDesign,
}: {
  group: DocumentGroup;
  lookupByPath: ReadonlyMap<string, DocumentSummary>;
  boardIssues?: readonly BoardIssue[];
  readAsset: DocumentAssetReader;
  onSelectDocument: (
    path: string,
    preferredViewMode?: "html" | "markdown",
  ) => void;
  onSelectScreenSpecs?: (domainKey: string) => void;
  onAuditCodeSync?: (group: DocumentGroup) => void;
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
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);

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
  const hasAuditableSpecs = useMemo(
    () =>
      group.documents.some((doc) => {
        if (isAuxiliaryDocument(doc)) return false;
        const cat = classifyDocumentCategory(doc);
        return cat === "prd" || cat === "screen_spec";
      }),
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

      const nextEdges = layoutDomainEdgePaths(
        edges,
        cardRefs.current,
        board,
        boardRect,
      );
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
  const safeGroupKey = `${group.key.replace(/[^a-zA-Z0-9_-]/g, "_")}_${hashMarkerKey(group.key)}`;

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
          {hasAuditableSpecs && onAuditCodeSync ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onAuditCodeSync(group)}
            >
              <GitCompareArrows aria-hidden="true" size={14} />
              AI 코드 반영 점검
            </Button>
          ) : null}
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
                id={`edge-arrow-explicit-${safeGroupKey}`}
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
                id={`edge-arrow-flow-${safeGroupKey}`}
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
            {[...measuredEdges]
              .sort((a, b) => {
                if (!hoveredCardKey) return 0;
                const aConn =
                  a.fromKey === hoveredCardKey || a.toKey === hoveredCardKey ? 1 : 0;
                const bConn =
                  b.fromKey === hoveredCardKey || b.toKey === hoveredCardKey ? 1 : 0;
                return aConn - bConn;
              })
              .map((edge) => {
                const isConnected =
                  hoveredCardKey !== null &&
                  (edge.fromKey === hoveredCardKey || edge.toKey === hoveredCardKey);
                const isDimmed = hoveredCardKey !== null && !isConnected;
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    data-edge-from={edge.fromKey}
                    data-edge-to={edge.toKey}
                    data-edge-kind={edge.kind}
                    fill="none"
                    stroke={
                      edge.kind === "explicit"
                        ? "var(--color-primary)"
                        : "var(--color-border-strong)"
                    }
                    strokeWidth={
                      isConnected ? 2.25 : edge.kind === "explicit" ? 1.5 : 1.25
                    }
                    opacity={
                      isConnected
                        ? 1
                        : isDimmed
                          ? 0.14
                          : edge.kind === "explicit"
                            ? 0.65
                            : 0.45
                    }
                    strokeDasharray={edge.kind === "flow" ? "4 4" : undefined}
                    markerEnd={
                      edge.kind === "explicit"
                        ? `url(#edge-arrow-explicit-${safeGroupKey})`
                        : `url(#edge-arrow-flow-${safeGroupKey})`
                    }
                  />
                );
              })}
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
                        onHoverChange={(active) =>
                          setHoveredCardKey((cur) =>
                            active ? card.key : cur === card.key ? null : cur,
                          )
                        }
                      />
                    );
                  }

                  const { doc, key } = card;
                  const category = classifyDocumentCategory(doc);
                  const isScreenSpec = column.key === "screen_spec";
                  const impl = resolveDocumentImplStatus(doc, boardIssues);
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
                      className={cn(
                        "document-map-card",
                        impl && `document-map-card--impl-${impl.status}`,
                      )}
                      aria-label={doc.title}
                      data-category={column.key === "overview" ? "overview" : category}
                      data-impl-status={impl?.status}
                      onMouseEnter={() => setHoveredCardKey(key)}
                      onMouseLeave={() =>
                        setHoveredCardKey((cur) => (cur === key ? null : cur))
                      }
                      onFocus={() => setHoveredCardKey(key)}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null,
                          )
                        ) {
                          setHoveredCardKey((cur) => (cur === key ? null : cur));
                        }
                      }}
                    >
                      <div className="document-map-card__top">
                        <div className="document-map-card__badges">
                          <span className="document-map-card__badge">
                            {column.key === "overview"
                              ? STAGE_LABELS.overview
                              : DOCUMENT_CATEGORY_LABELS[category]}
                          </span>
                          {impl ? (
                            <span
                              className={`document-map-card__badge document-map-card__badge--impl-${impl.status}`}
                            >
                              {impl.label}
                            </span>
                          ) : null}
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

                      {impl?.note ? (
                        <p
                          className={`document-map-card__impl-note document-map-card__impl-note--${impl.status}`}
                          title={impl.note}
                        >
                          {impl.note}
                        </p>
                      ) : null}

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
  boardIssues,
  readAsset,
  onSelectDocument,
  onSelectScreenSpecs,
  onAuditCodeSync,
  onOpenInNewWindow,
  onNewDocumentInFolder,
  onOpenExternal,
}: {
  documents: readonly DocumentSummary[];
  allDocuments?: readonly DocumentSummary[];
  boardIssues?: readonly BoardIssue[];
  readAsset?: DocumentAssetReader;
  onSelectDocument: (
    path: string,
    preferredViewMode?: "html" | "markdown",
  ) => void;
  onSelectScreenSpecs?: (domainKey: string) => void;
  onAuditCodeSync?: (group: DocumentGroup) => void;
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
      <div
        className="document-domain-map__legend"
        aria-label="코드 반영 상태 범례"
      >
        <span className="document-domain-map__legend-title">코드 반영 상태</span>
        <span className="document-domain-map__legend-item">
          <span
            className="document-domain-map__legend-dot document-domain-map__legend-dot--synced"
            aria-hidden="true"
          />
          코드 반영 완료
        </span>
        <span className="document-domain-map__legend-item">
          <span
            className="document-domain-map__legend-dot document-domain-map__legend-dot--partial"
            aria-hidden="true"
          />
          일부 수정 필요
        </span>
        <span className="document-domain-map__legend-item">
          <span
            className="document-domain-map__legend-dot document-domain-map__legend-dot--unimplemented"
            aria-hidden="true"
          />
          미반영
        </span>
      </div>
      {groups.map((group) => (
        <DomainSectionBoard
          key={group.key}
          group={group}
          lookupByPath={lookupByPath}
          boardIssues={boardIssues}
          readAsset={assetReader}
          onSelectDocument={onSelectDocument}
          onSelectScreenSpecs={onSelectScreenSpecs}
          onAuditCodeSync={onAuditCodeSync}
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
