import {
  ExternalLink,
  FileText,
  GitCompareArrows,
  Layers,
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import type { BoardIssue } from "@/features/project-board/model";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentGroup,
} from "../document-taxonomy";
import {
  buildProjectProgressSummary,
  canonicalDocumentKey,
  formatDocumentSize,
  type DocumentProgressBucket,
  type DocumentProgressItem,
  type DocumentStageKey,
  type DomainProgressSummary,
  type ProjectProgressSummary,
} from "../domain-progress";
import type { DocumentSummary } from "../model";
import { buildDomainEdges } from "./DocumentDomainMap";

export type IsometricHeightMetric = "volume" | "issues";

export interface IsometricPoint {
  x: number;
  y: number;
}

export interface IsometricBoxBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface IsometricBlockLayout {
  key: string;
  item: DocumentProgressItem;
  gx: number;
  gy: number;
  height: number;
  sortKey: number;
  topPoints: string;
  leftPoints: string;
  rightPoints: string;
  shadowPoints: string;
  badgePoints: string;
  topCenter: IsometricPoint;
  baseCenter: IsometricPoint;
}

export interface IsometricEdgeLayout {
  id: string;
  fromKey: string;
  toKey: string;
  kind: "explicit" | "flow";
  groundPath: string;
  elevatedPath: string;
  targetPoint: IsometricPoint;
}

export interface IsometricIslandLayout {
  domain: DomainProgressSummary;
  offsetX: number;
  offsetY: number;
  bounds: IsometricBoxBounds;
  platformTopPoints: string;
  platformLeftPoints: string;
  platformRightPoints: string;
  stageGridLines: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
  blocks: IsometricBlockLayout[];
  edges: IsometricEdgeLayout[];
  plaque: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    meta: string;
  };
}

export interface IsometricSceneLayout {
  width: number;
  height: number;
  islands: IsometricIslandLayout[];
  maxMetricValue: number;
  hasLinkedIssues: boolean;
}

interface DocumentIsometricOverviewProps {
  documents: readonly DocumentSummary[];
  allDocuments?: readonly DocumentSummary[];
  boardIssues?: readonly BoardIssue[];
  precomputedSummary?: ProjectProgressSummary;
  selectedDomainKey?: string | null;
  onSelectDocument(path: string, preferredViewMode?: "html" | "markdown"): void;
  onOpenDomainMap?(domainKey: string): void;
  onOpenInNewWindow?(
    path: string,
    viewMode?: "html" | "markdown",
    title?: string,
  ): void;
  onAuditCodeSync?(group: DocumentGroup): void;
}

const ISO_HALF_W = 24;
const ISO_HALF_H = 12;
const BLOCK_INSET = 0.16;
const PLATFORM_DEPTH = 9;
const MIN_BLOCK_H = 18;
const MAX_BLOCK_H = 88;
const NO_ISSUE_SMALL_H = 12;
const UNIFORM_NO_ISSUES_H = 34;
const PLAQUE_W = 166;
const PLAQUE_H = 40;
const TARGET_ROW_WIDTH = 690;
const ISLAND_GAP_X = 24;
const ISLAND_GAP_Y = 22;
const SCENE_PADDING = 16;

const STAGE_SEQUENCE: readonly DocumentStageKey[] = [
  "overview",
  "prd",
  "screen_spec",
  "adr",
  "guide_ref",
];

const BUCKET_LABELS: Record<DocumentProgressBucket, string> = {
  synced: "코드 반영 완료",
  partial: "일부 수정 필요",
  unimplemented: "미반영",
  unaudited: "미점검 / 참고",
};

function projectIso(gx: number, gy: number, z = 0): IsometricPoint {
  return {
    x: (gx - gy) * ISO_HALF_W,
    y: (gx + gy) * ISO_HALF_H - z,
  };
}

function formatPoints(pts: readonly IsometricPoint[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function rawVolumeMetric(item: DocumentProgressItem): number {
  if (item.sizeBytes > 0) {
    return item.sizeBytes;
  }
  return Math.max(1, item.headingCount) * 200;
}

function computeBlockHeight(
  item: DocumentProgressItem,
  metric: IsometricHeightMetric,
  maxMetricValue: number,
  hasLinkedIssues: boolean,
): number {
  if (metric === "issues") {
    if (!hasLinkedIssues || maxMetricValue <= 0) {
      return UNIFORM_NO_ISSUES_H;
    }
    if (item.issues.total <= 0) {
      return NO_ISSUE_SMALL_H;
    }
    const ratio = Math.sqrt(item.issues.total) / Math.sqrt(maxMetricValue);
    return Math.round(MIN_BLOCK_H + ratio * (MAX_BLOCK_H - MIN_BLOCK_H));
  }

  if (maxMetricValue <= 0) {
    return UNIFORM_NO_ISSUES_H;
  }
  const value = rawVolumeMetric(item);
  const ratio = Math.sqrt(value) / Math.sqrt(maxMetricValue);
  return Math.round(MIN_BLOCK_H + ratio * (MAX_BLOCK_H - MIN_BLOCK_H));
}

function truncateSvgText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function computeIsometricScene(
  summary: ProjectProgressSummary,
  heightMetric: IsometricHeightMetric,
): IsometricSceneLayout {
  const activeDomains = summary.domains.filter((domain) => domain.items.length > 0);
  if (activeDomains.length === 0) {
    return {
      width: 640,
      height: 240,
      islands: [],
      maxMetricValue: 0,
      hasLinkedIssues: false,
    };
  }

  let maxIssueCount = 0;
  let maxVolumeCount = 0;
  for (const domain of activeDomains) {
    for (const item of domain.items) {
      maxIssueCount = Math.max(maxIssueCount, item.issues.total);
      maxVolumeCount = Math.max(maxVolumeCount, rawVolumeMetric(item));
    }
  }

  const hasLinkedIssues = maxIssueCount > 0;
  const maxMetricValue =
    heightMetric === "issues" ? maxIssueCount : maxVolumeCount;

  interface LocalIslandDraft {
    domain: DomainProgressSummary;
    localBounds: IsometricBoxBounds;
    platformTopPoints: string;
    platformLeftPoints: string;
    platformRightPoints: string;
    stageGridLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    blocks: IsometricBlockLayout[];
    edges: IsometricEdgeLayout[];
    plaque: IsometricIslandLayout["plaque"];
  }

  const drafts: LocalIslandDraft[] = activeDomains.map((domain) => {
    const itemsByStage = new Map<DocumentStageKey, DocumentProgressItem[]>(
      STAGE_SEQUENCE.map((stage) => [stage, []]),
    );
    for (const item of domain.items) {
      itemsByStage.get(item.stage)?.push(item);
    }

    let currentCol = 0;
    let maxRow = 0;
    const stageBoundaries: number[] = [];
    const placedBlocks: IsometricBlockLayout[] = [];

    for (const stage of STAGE_SEQUENCE) {
      const stageItems = itemsByStage.get(stage) ?? [];
      if (stageItems.length === 0) continue;

      if (currentCol > 0) {
        stageBoundaries.push(currentCol - 0.12);
      }

      const colsUsed = Math.ceil(stageItems.length / 3);
      stageItems.forEach((item, index) => {
        const gx = currentCol + Math.floor(index / 3);
        const gy = index % 3;
        maxRow = Math.max(maxRow, gy);

        const height = computeBlockHeight(
          item,
          heightMetric,
          maxMetricValue,
          hasLinkedIssues,
        );

        const u0 = gx + BLOCK_INSET;
        const u1 = gx + 1 - BLOCK_INSET;
        const v0 = gy + BLOCK_INSET;
        const v1 = gy + 1 - BLOCK_INSET;

        const topBack = projectIso(u0, v0, height);
        const topRight = projectIso(u1, v0, height);
        const topFront = projectIso(u1, v1, height);
        const topLeft = projectIso(u0, v1, height);

        const botBack = projectIso(u0, v0, 0);
        const botRight = projectIso(u1, v0, 0);
        const botFront = projectIso(u1, v1, 0);
        const botLeft = projectIso(u0, v1, 0);

        const shadowOffset = { dx: 5, dy: 3 };
        const shadowPts = [botBack, botRight, botFront, botLeft].map((pt) => ({
          x: pt.x + shadowOffset.dx,
          y: pt.y + shadowOffset.dy,
        }));

        const capInset = BLOCK_INSET + 0.16;
        const cu0 = gx + capInset;
        const cu1 = gx + 1 - capInset;
        const cv0 = gy + capInset;
        const cv1 = gy + 1 - capInset;
        const badgePoints = formatPoints([
          projectIso(cu0, cv0, height + 0.5),
          projectIso(cu1, cv0, height + 0.5),
          projectIso(cu1, cv1, height + 0.5),
          projectIso(cu0, cv1, height + 0.5),
        ]);

        placedBlocks.push({
          key: item.key,
          item,
          gx,
          gy,
          height,
          sortKey: gx + gy,
          topPoints: formatPoints([topBack, topRight, topFront, topLeft]),
          leftPoints: formatPoints([topLeft, topFront, botFront, botLeft]),
          rightPoints: formatPoints([topFront, topRight, botRight, botFront]),
          shadowPoints: formatPoints(shadowPts),
          badgePoints,
          topCenter: projectIso(gx + 0.5, gy + 0.5, height),
          baseCenter: projectIso(gx + 0.5, gy + 0.5, 0),
        });
      });

      currentCol += colsUsed;
    }

    placedBlocks.sort(
      (a, b) => a.sortKey - b.sortKey || a.gx - b.gx || a.key.localeCompare(b.key),
    );

    const maxCol = Math.max(0, currentCol - 1);
    const minGx = -0.35;
    const maxGx = Math.max(1.35, maxCol + 1.35);
    const minGy = -0.35;
    const maxGy = Math.max(1.35, maxRow + 1.35);

    const pTopBack = projectIso(minGx, minGy, 0);
    const pTopRight = projectIso(maxGx, minGy, 0);
    const pTopFront = projectIso(maxGx, maxGy, 0);
    const pTopLeft = projectIso(minGx, maxGy, 0);

    const pBotRight = projectIso(maxGx, minGy, -PLATFORM_DEPTH);
    const pBotFront = projectIso(maxGx, maxGy, -PLATFORM_DEPTH);
    const pBotLeft = projectIso(minGx, maxGy, -PLATFORM_DEPTH);

    const stageGridLines = stageBoundaries.map((boundaryGx) => {
      const start = projectIso(boundaryGx, minGy + 0.08, 0);
      const end = projectIso(boundaryGx, maxGy - 0.08, 0);
      return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    });

    const blockByKey = new Map<string, IsometricBlockLayout>();
    for (const b of placedBlocks) {
      blockByKey.set(b.key, b);
    }

    const domainEdges = buildDomainEdges(domain.group.documents);
    const edges: IsometricEdgeLayout[] = [];
    for (const edge of domainEdges) {
      const fromBlock = blockByKey.get(edge.fromKey);
      const toBlock = blockByKey.get(edge.toKey);
      if (!fromBlock || !toBlock) continue;

      const gMidX = (fromBlock.baseCenter.x + toBlock.baseCenter.x) / 2;
      const gMidY = (fromBlock.baseCenter.y + toBlock.baseCenter.y) / 2 - 4;
      const groundPath = `M ${fromBlock.baseCenter.x.toFixed(1)} ${fromBlock.baseCenter.y.toFixed(1)} Q ${gMidX.toFixed(1)} ${gMidY.toFixed(1)} ${toBlock.baseCenter.x.toFixed(1)} ${toBlock.baseCenter.y.toFixed(1)}`;

      const tMidX = (fromBlock.topCenter.x + toBlock.topCenter.x) / 2;
      const tCtrlY =
        Math.min(fromBlock.topCenter.y, toBlock.topCenter.y) - 24;
      const elevatedPath = `M ${fromBlock.topCenter.x.toFixed(1)} ${fromBlock.topCenter.y.toFixed(1)} Q ${tMidX.toFixed(1)} ${tCtrlY.toFixed(1)} ${toBlock.topCenter.x.toFixed(1)} ${toBlock.topCenter.y.toFixed(1)}`;

      edges.push({
        id: edge.id,
        fromKey: edge.fromKey,
        toKey: edge.toKey,
        kind: edge.kind,
        groundPath,
        elevatedPath,
        targetPoint: toBlock.topCenter,
      });
    }

    const plaqueX = pBotFront.x - PLAQUE_W / 2;
    const plaqueY = pBotFront.y + 10;

    let minBlockY = pTopBack.y - 12;
    for (const b of placedBlocks) {
      minBlockY = Math.min(minBlockY, b.topCenter.y - ISO_HALF_H - 28);
    }

    const minX = Math.min(pTopLeft.x - 10, plaqueX - 4);
    const maxX = Math.max(pTopRight.x + 10, plaqueX + PLAQUE_W + 4);
    const minY = minBlockY;
    const maxY = plaqueY + PLAQUE_H + 8;

    return {
      domain,
      localBounds: { minX, minY, maxX, maxY },
      platformTopPoints: formatPoints([pTopBack, pTopRight, pTopFront, pTopLeft]),
      platformLeftPoints: formatPoints([pTopLeft, pTopFront, pBotFront, pBotLeft]),
      platformRightPoints: formatPoints([pTopFront, pTopRight, pBotRight, pBotFront]),
      stageGridLines,
      blocks: placedBlocks,
      edges,
      plaque: {
        x: plaqueX,
        y: plaqueY,
        width: PLAQUE_W,
        height: PLAQUE_H,
        label: truncateSvgText(domain.group.label, 22),
        meta:
          domain.counts.issueTotal > 0
            ? `${domain.counts.total}건 · 이슈 ${domain.counts.issueDone}/${domain.counts.issueTotal}`
            : `${domain.counts.total}건 · ${formatDocumentSize(domain.counts.totalBytes)}`,
      },
    };
  });

  // Pack local islands into balanced non-overlapping shelf rows.
  const islands: IsometricIslandLayout[] = [];
  let cursorX = SCENE_PADDING;
  let rowY = SCENE_PADDING;
  let rowMaxHeight = 0;
  let maxRight = 0;
  let maxBottom = 0;

  for (const draft of drafts) {
    const w = draft.localBounds.maxX - draft.localBounds.minX;
    const h = draft.localBounds.maxY - draft.localBounds.minY;

    if (
      cursorX > SCENE_PADDING &&
      cursorX + w + SCENE_PADDING > TARGET_ROW_WIDTH
    ) {
      cursorX = SCENE_PADDING;
      rowY += rowMaxHeight + ISLAND_GAP_Y;
      rowMaxHeight = 0;
    }

    const offsetX = cursorX - draft.localBounds.minX;
    const offsetY = rowY - draft.localBounds.minY;

    const bounds: IsometricBoxBounds = {
      minX: draft.localBounds.minX + offsetX,
      minY: draft.localBounds.minY + offsetY,
      maxX: draft.localBounds.maxX + offsetX,
      maxY: draft.localBounds.maxY + offsetY,
    };

    islands.push({
      domain: draft.domain,
      offsetX,
      offsetY,
      bounds,
      platformTopPoints: draft.platformTopPoints,
      platformLeftPoints: draft.platformLeftPoints,
      platformRightPoints: draft.platformRightPoints,
      stageGridLines: draft.stageGridLines,
      blocks: draft.blocks,
      edges: draft.edges,
      plaque: draft.plaque,
    });

    cursorX += w + ISLAND_GAP_X;
    rowMaxHeight = Math.max(rowMaxHeight, h);
    maxRight = Math.max(maxRight, bounds.maxX);
    maxBottom = Math.max(maxBottom, bounds.maxY);
  }

  return {
    width: Math.max(480, Math.ceil(maxRight + SCENE_PADDING)),
    height: Math.max(260, Math.ceil(maxBottom + SCENE_PADDING)),
    islands,
    maxMetricValue,
    hasLinkedIssues,
  };
}

function preferredViewOf(doc: DocumentSummary): "html" | "markdown" {
  return doc.hasCompanionHtml ? "html" : "markdown";
}

function pickInitialActiveKey(summary: ProjectProgressSummary): string | null {
  const priorityOrder: DocumentProgressBucket[] = [
    "unimplemented",
    "partial",
    "synced",
    "unaudited",
  ];
  for (const bucket of priorityOrder) {
    for (const domain of summary.domains) {
      const match = domain.items.find((item) => item.bucket === bucket);
      if (match) return match.key;
    }
  }
  return null;
}

export function DocumentIsometricOverview({
  documents,
  allDocuments,
  boardIssues,
  precomputedSummary,
  selectedDomainKey,
  onSelectDocument,
  onOpenDomainMap,
  onOpenInNewWindow,
  onAuditCodeSync,
}: DocumentIsometricOverviewProps) {
  const [heightMetric, setHeightMetric] =
    useState<IsometricHeightMetric>("volume");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const summary = useMemo(
    () =>
      precomputedSummary ?? buildProjectProgressSummary(documents, boardIssues),
    [precomputedSummary, documents, boardIssues],
  );

  useEffect(() => {
    if (selectedKey && !summary.itemsByKey.has(selectedKey)) {
      setSelectedKey(null);
    }
    if (hoveredKey && !summary.itemsByKey.has(hoveredKey)) {
      setHoveredKey(null);
    }
  }, [summary, selectedKey, hoveredKey]);

  const scene = useMemo(
    () => computeIsometricScene(summary, heightMetric),
    [summary, heightMetric],
  );

  const lookupByKey = useMemo(() => {
    const map = new Map<string, DocumentSummary>();
    for (const doc of allDocuments ?? documents) {
      map.set(canonicalDocumentKey(doc.path), doc);
    }
    return map;
  }, [allDocuments, documents]);

  const fallbackKey = useMemo(() => pickInitialActiveKey(summary), [summary]);
  const highlightedKey =
    hoveredKey && summary.itemsByKey.has(hoveredKey) ? hoveredKey : null;
  const highlightedItem = highlightedKey
    ? summary.itemsByKey.get(highlightedKey) ?? null
    : null;
  const activeKey =
    highlightedKey ??
    (selectedKey && summary.itemsByKey.has(selectedKey)
      ? selectedKey
      : fallbackKey);
  const activeItem = activeKey
    ? summary.itemsByKey.get(activeKey) ?? null
    : null;

  if (summary.counts.total === 0) {
    return (
      <p className="document-search__empty">
        전체 조망에 표시할 문서가 없습니다.
      </p>
    );
  }

  const activeDomain = activeItem
    ? summary.domains.find((d) => d.group.key === activeItem.domainKey) ?? null
    : null;
  const activeConnectedKeys = new Set<string>();
  if (highlightedItem) {
    const highlightedIsland = scene.islands.find(
      (isl) => isl.domain.group.key === highlightedItem.domainKey,
    );
    for (const edge of highlightedIsland?.edges ?? []) {
      if (edge.fromKey === highlightedItem.key) {
        activeConnectedKeys.add(edge.toKey);
      }
      if (edge.toKey === highlightedItem.key) {
        activeConnectedKeys.add(edge.fromKey);
      }
    }
  }

  const activeRelatedDocs: DocumentSummary[] = [];
  if (activeItem) {
    const seen = new Set<string>([activeItem.key]);
    for (const linked of activeItem.doc.linkedPaths ?? []) {
      const targetKey = canonicalDocumentKey(linked);
      if (seen.has(targetKey)) continue;
      const target = lookupByKey.get(targetKey);
      if (target) {
        seen.add(targetKey);
        activeRelatedDocs.push(target);
      }
      if (activeRelatedDocs.length >= 4) break;
    }
  }

  const activeDomainHasAuditable = activeDomain
    ? activeDomain.stages.prd > 0 || activeDomain.stages.screen_spec > 0
    : false;

  const handleBlockKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    doc: DocumentSummary,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectDocument(doc.path, preferredViewOf(doc));
    }
  };

  return (
    <section
      className="document-iso-overview"
      aria-label="문서 전체 조망 (2.5D)"
    >
      <div className="document-iso-overview__toolbar">
        <div className="document-iso-overview__metric-group">
          <span className="document-iso-overview__toolbar-label">
            높이 기준
          </span>
          <div
            className="document-iso-overview__metric-switch"
            role="group"
            aria-label="블록 높이 기준"
          >
            <UnstyledButton
              type="button"
              className="document-iso-overview__metric-chip"
              data-active={heightMetric === "volume"}
              aria-pressed={heightMetric === "volume"}
              onClick={() => setHeightMetric("volume")}
            >
              문서량
            </UnstyledButton>
            <UnstyledButton
              type="button"
              className="document-iso-overview__metric-chip"
              data-active={heightMetric === "issues"}
              aria-pressed={heightMetric === "issues"}
              onClick={() => setHeightMetric("issues")}
            >
              업무량 (이슈)
            </UnstyledButton>
          </div>
          {heightMetric === "issues" && !scene.hasLinkedIssues ? (
            <span className="document-iso-overview__metric-hint">
              연결된 보드 이슈가 없어 기본 높이로 표시 중
            </span>
          ) : null}
        </div>

        <div className="document-iso-overview__legend">
          <span className="document-iso-overview__legend-note">
            <Layers aria-hidden="true" size={14} />
            {heightMetric === "volume"
              ? "높이 = 문서 크기 · 색상 = 반영 상태"
              : "높이 = 연결 이슈 수 · 색상 = 반영 상태"}
          </span>
          <div className="document-iso-overview__zoom-controls">
            <IconButton
              type="button"
              label="축소"
              tooltip={false}
              disabled={zoom <= 0.76}
              onClick={() =>
                setZoom((prev) => Math.max(0.75, Math.round((prev - 0.15) * 100) / 100))
              }
            >
              <ZoomOut aria-hidden="true" />
            </IconButton>
            <UnstyledButton
              type="button"
              className="document-iso-overview__zoom-reset"
              aria-label="기본 배율로 초기화"
              onClick={() => setZoom(1)}
            >
              {`${Math.round(zoom * 100)}%`}
            </UnstyledButton>
            <IconButton
              type="button"
              label="확대"
              tooltip={false}
              disabled={zoom >= 1.49}
              onClick={() =>
                setZoom((prev) => Math.min(1.5, Math.round((prev + 0.15) * 100) / 100))
              }
            >
              <ZoomIn aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>

      <div className="document-iso-overview__workspace">
        <div className="document-iso-overview__stage">
          <svg
            className="document-iso-overview__svg"
            role="group"
            aria-label="문서 전체 조망 2.5D 맵"
            viewBox={`0 0 ${scene.width} ${scene.height}`}
            style={
              zoom === 1
                ? {
                    width: "100%",
                    maxWidth: `${scene.width}px`,
                    height: "auto",
                  }
                : {
                    width: `${Math.round(scene.width * zoom)}px`,
                    height: `${Math.round(scene.height * zoom)}px`,
                  }
            }
          >
            {scene.islands.map((island) => {
              const isSelectedIsland =
                selectedDomainKey === island.domain.group.key;
              const isHighlightedIsland =
                highlightedItem?.domainKey === island.domain.group.key;
              const dimThresholdActive =
                highlightedItem !== null && isHighlightedIsland;

              return (
                <g
                  key={island.domain.group.key}
                  className={cn(
                    "document-iso-island",
                    isSelectedIsland && "document-iso-island--selected",
                  )}
                  transform={`translate(${island.offsetX.toFixed(1)}, ${island.offsetY.toFixed(1)})`}
                >
                  <polygon
                    className="document-iso-platform__top"
                    points={island.platformTopPoints}
                  />
                  <polygon
                    className="document-iso-platform__left"
                    points={island.platformLeftPoints}
                  />
                  <polygon
                    className="document-iso-platform__right"
                    points={island.platformRightPoints}
                  />

                  {island.stageGridLines.map((line, index) => (
                    <line
                      key={`${island.domain.group.key}-grid-${index}`}
                      className="document-iso-platform__grid-line"
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                    />
                  ))}

                  {island.edges.map((edge) => (
                    <path
                      key={`ground-${edge.id}`}
                      className={cn(
                        "document-iso-edge--ground",
                        edge.kind === "explicit" &&
                          "document-iso-edge--ground-explicit",
                      )}
                      d={edge.groundPath}
                    />
                  ))}

                  {island.blocks.map((block) => {
                    const isActive = activeItem?.key === block.key;
                    const isNeighbor = activeConnectedKeys.has(block.key);
                    const isDimmed =
                      dimThresholdActive &&
                      highlightedItem?.key !== block.key &&
                      !isNeighbor;
                    const bucketLabel = Object.hasOwn(
                      BUCKET_LABELS,
                      block.item.bucket,
                    )
                      ? BUCKET_LABELS[block.item.bucket]
                      : "미점검";

                    return (
                      <g
                        key={block.key}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "document-iso-block",
                          `document-iso-block--${block.item.bucket}`,
                          isActive && "document-iso-block--active",
                          isDimmed && "document-iso-block--dimmed",
                        )}
                        data-doc-path={block.item.doc.path}
                        data-impl-bucket={block.item.bucket}
                        data-block-height={block.height}
                        data-active={isActive ? "true" : undefined}
                        aria-label={`${block.item.doc.title} — ${block.item.domainLabel}, ${bucketLabel}, ${formatDocumentSize(block.item.sizeBytes)}`}
                        onMouseEnter={() => {
                          setHoveredKey(block.key);
                          setSelectedKey(block.key);
                        }}
                        onMouseLeave={() =>
                          setHoveredKey((cur) =>
                            cur === block.key ? null : cur,
                          )
                        }
                        onFocus={() => {
                          setHoveredKey(block.key);
                          setSelectedKey(block.key);
                        }}
                        onBlur={() =>
                          setHoveredKey((cur) =>
                            cur === block.key ? null : cur,
                          )
                        }
                        onClick={() =>
                          onSelectDocument(
                            block.item.doc.path,
                            preferredViewOf(block.item.doc),
                          )
                        }
                        onKeyDown={(event) =>
                          handleBlockKeyDown(event, block.item.doc)
                        }
                      >
                        <polygon
                          className="document-iso-block__shadow"
                          points={block.shadowPoints}
                        />
                        <polygon
                          className="document-iso-block__left"
                          points={block.leftPoints}
                        />
                        <polygon
                          className="document-iso-block__right"
                          points={block.rightPoints}
                        />
                        <polygon
                          className="document-iso-block__top"
                          points={block.topPoints}
                        />
                        {block.item.stage === "prd" ||
                        block.item.stage === "screen_spec" ? (
                          <polygon
                            className="document-iso-block__cap"
                            points={block.badgePoints}
                          />
                        ) : null}
                      </g>
                    );
                  })}

                  {isHighlightedIsland && highlightedItem
                    ? island.edges
                        .filter(
                          (edge) =>
                            edge.fromKey === highlightedItem.key ||
                            edge.toKey === highlightedItem.key,
                        )
                        .map((edge) => (
                          <g key={`arc-${edge.id}`}>
                            <path
                              className={cn(
                                "document-iso-edge--elevated",
                                edge.kind === "explicit" &&
                                  "document-iso-edge--elevated-explicit",
                              )}
                              d={edge.elevatedPath}
                            />
                            <circle
                              className={cn(
                                "document-iso-edge__target-dot",
                                edge.kind === "explicit" &&
                                  "document-iso-edge__target-dot--explicit",
                              )}
                              cx={edge.targetPoint.x}
                              cy={edge.targetPoint.y}
                              r={3}
                            />
                          </g>
                        ))
                    : null}

                  <g
                    className="document-iso-plaque"
                    role={onOpenDomainMap ? "button" : undefined}
                    tabIndex={onOpenDomainMap ? 0 : undefined}
                    aria-label={
                      onOpenDomainMap
                        ? `${island.domain.group.label} 도메인 맵 보기`
                        : undefined
                    }
                    onClick={() => onOpenDomainMap?.(island.domain.group.key)}
                    onKeyDown={(event) => {
                      if (
                        onOpenDomainMap &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        onOpenDomainMap(island.domain.group.key);
                      }
                    }}
                  >
                    <rect
                      x={island.plaque.x}
                      y={island.plaque.y}
                      width={island.plaque.width}
                      height={island.plaque.height}
                      rx={8}
                    />
                    <text
                      className="document-iso-plaque__title"
                      x={island.plaque.x + island.plaque.width / 2}
                      y={island.plaque.y + 16}
                      textAnchor="middle"
                    >
                      {island.plaque.label}
                    </text>
                    <text
                      className="document-iso-plaque__meta"
                      x={island.plaque.x + island.plaque.width / 2}
                      y={island.plaque.y + 31}
                      textAnchor="middle"
                    >
                      {island.plaque.meta}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        <aside
          className="document-iso-overview__inspector"
          aria-label="선택 문서 상세 정보"
        >
          {activeItem ? (
            <>
              <div className="document-iso-overview__inspector-badges">
                <span className="document-map-card__badge">
                  {activeItem.domainLabel}
                </span>
                <span className="document-map-card__badge">
                  {Object.hasOwn(DOCUMENT_CATEGORY_LABELS, activeItem.category)
                    ? DOCUMENT_CATEGORY_LABELS[activeItem.category]
                    : "기타"}
                </span>
                {activeItem.impl ? (
                  <span
                    className={`document-map-card__badge document-map-card__badge--impl-${activeItem.impl.status}`}
                  >
                    {activeItem.impl.label}
                  </span>
                ) : (
                  <span className="document-map-card__badge">미점검</span>
                )}
                {activeItem.doc.hasCompanionHtml ? (
                  <span className="document-map-card__badge document-map-card__badge--html">
                    HTML
                  </span>
                ) : null}
              </div>

              <div className="document-iso-overview__inspector-head">
                <h3>{activeItem.doc.title}</h3>
                {activeItem.doc.description ? (
                  <p>{activeItem.doc.description}</p>
                ) : null}
              </div>

              <dl className="document-iso-overview__metrics">
                <div className="document-iso-overview__metric-card">
                  <dt>문서량</dt>
                  <dd>
                    <strong>{formatDocumentSize(activeItem.sizeBytes)}</strong>
                    <span>{`섹션 ${activeItem.headingCount}개`}</span>
                  </dd>
                </div>
                <div className="document-iso-overview__metric-card">
                  <dt>연결 이슈</dt>
                  <dd>
                    {activeItem.issues.total > 0 ? (
                      <>
                        <strong>
                          {`${activeItem.issues.done}/${activeItem.issues.total} 완료`}
                        </strong>
                        <span>
                          {activeItem.issues.assignees.length > 0
                            ? activeItem.issues.assignees.slice(0, 3).join(", ")
                            : `진행 ${activeItem.issues.active} · 대기 ${activeItem.issues.open}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>연결 없음</strong>
                        <span>관련 프로젝트 이슈 없음</span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>

              {activeItem.wireframeCount > 0 || activeItem.designCount > 0 ? (
                <p className="document-iso-overview__assets-line">
                  {`시각 자료 · 와이어프레임 ${activeItem.wireframeCount} · 디자인 시안 ${activeItem.designCount}`}
                </p>
              ) : null}

              {activeItem.impl?.note ? (
                <p
                  className={`document-iso-overview__impl-note document-iso-overview__impl-note--${activeItem.impl.status}`}
                >
                  {activeItem.impl.note}
                </p>
              ) : null}

              <div className="document-iso-overview__inspector-actions">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() =>
                    onSelectDocument(
                      activeItem.doc.path,
                      preferredViewOf(activeItem.doc),
                    )
                  }
                >
                  <FileText aria-hidden="true" />
                  문서 열기
                </Button>
                {onOpenDomainMap ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onOpenDomainMap(activeItem.domainKey)}
                  >
                    <MapIcon aria-hidden="true" />
                    도메인 맵 보기
                  </Button>
                ) : null}
                {onOpenInNewWindow ? (
                  <IconButton
                    type="button"
                    label="새 창으로 열기"
                    tooltip={false}
                    onClick={() =>
                      onOpenInNewWindow(
                        activeItem.doc.path,
                        preferredViewOf(activeItem.doc),
                        activeItem.doc.title,
                      )
                    }
                  >
                    <ExternalLink aria-hidden="true" />
                  </IconButton>
                ) : null}
                {activeDomain && activeDomainHasAuditable && onAuditCodeSync ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onAuditCodeSync(activeDomain.group)}
                  >
                    <GitCompareArrows aria-hidden="true" />
                    AI 코드 반영 점검
                  </Button>
                ) : null}
              </div>

              {activeRelatedDocs.length > 0 ? (
                <div className="document-iso-overview__related">
                  <span className="document-iso-overview__related-label">
                    연결된 문서
                  </span>
                  <div className="document-iso-overview__related-chips">
                    {activeRelatedDocs.map((target) => (
                      <UnstyledButton
                        key={target.path}
                        type="button"
                        className="document-map-card__link-chip"
                        onClick={() =>
                          onSelectDocument(
                            target.path,
                            preferredViewOf(target),
                          )
                        }
                      >
                        {`→ ${target.title}`}
                      </UnstyledButton>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
