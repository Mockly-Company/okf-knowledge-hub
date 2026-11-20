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

interface CardBox {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerY: number;
  colIndex: number;
}

interface RawEdgeGeometry {
  edge: DomainEdge;
  fromBox: CardBox;
  toBox: CardBox;
  isSkip: boolean;
}

interface GutterTrack {
  id: string;
  kind: "adjacent" | "skip-exit" | "skip-entry";
  minY: number;
  maxY: number;
  anchorY: number;
  meanDeltaY: number;
}

export interface DomainEdgeLayoutResult {
  edges: MeasuredEdge[];
  maxY: number;
  maxCardBottom: number;
}

function buildRoundedPolylinePath(
  rawPoints: ReadonlyArray<{ x: number; y: number }>,
  maxRadius = 8,
): string {
  const deduped: Array<{ x: number; y: number }> = [];
  for (const pt of rawPoints) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 0.5) {
      deduped.push(pt);
    }
  }

  const points: Array<{ x: number; y: number }> = [];
  for (const pt of deduped) {
    if (points.length >= 2) {
      const a = points[points.length - 2];
      const b = points[points.length - 1];
      if (a && b) {
        const dot = (b.x - a.x) * (pt.x - b.x) + (b.y - a.y) * (pt.y - b.y);
        const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - pt.x) < 0.5;
        const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - pt.y) < 0.5;
        if ((sameX || sameY) && dot >= 0) {
          points[points.length - 1] = pt;
          continue;
        }
      }
    }
    points.push(pt);
  }

  const first = points[0];
  const second = points[1];
  const last = points[points.length - 1];
  if (points.length < 2 || !first || !second || !last) return "";
  if (points.length === 2) {
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`;
  }

  const parts: string[] = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (!prev || !curr || !next) continue;
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const d1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const d2 = Math.hypot(dx2, dy2);
    if (d1 < 0.5 || d2 < 0.5) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    const limit1 = i === 1 ? d1 - 1 : d1 / 2 - 0.5;
    const limit2 = i === points.length - 2 ? d2 - 1 : d2 / 2 - 0.5;
    const r = Math.min(maxRadius, limit1, limit2);
    if (r < 2) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    const ux1 = dx1 / d1;
    const uy1 = dy1 / d1;
    const ux2 = dx2 / d2;
    const uy2 = dy2 / d2;
    const inX = curr.x - ux1 * r;
    const inY = curr.y - uy1 * r;
    const outX = curr.x + ux2 * r;
    const outY = curr.y + uy2 * r;
    parts.push(`L ${inX} ${inY} Q ${curr.x} ${curr.y} ${outX} ${outY}`);
  }
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}

function spreadBoxPortY(
  boxTop: number,
  boxHeight: number,
  index: number,
  total: number,
): number {
  if (total <= 1) {
    return boxTop + boxHeight * 0.5;
  }
  const ratio = 0.24 + (0.52 * index) / (total - 1);
  return boxTop + boxHeight * ratio;
}

export function layoutDomainEdgePathsWithBounds(
  edges: readonly DomainEdge[],
  cardRefs: ReadonlyMap<string, HTMLElement>,
  board: HTMLElement,
  boardRect: DOMRect,
  columnIndexByKey?: ReadonlyMap<string, number>,
): DomainEdgeLayoutResult {
  const rawBoxes: Array<Omit<CardBox, "colIndex">> = [];
  for (const [key, el] of cardRefs.entries()) {
    const rect = el.getBoundingClientRect();
    const left = rect.left - boardRect.left + board.scrollLeft;
    const right = rect.right - boardRect.left + board.scrollLeft;
    const top = rect.top - boardRect.top + board.scrollTop;
    const bottom = rect.bottom - boardRect.top + board.scrollTop;
    rawBoxes.push({
      key,
      left,
      right,
      top,
      bottom,
      width: rect.width,
      height: rect.height,
      centerY: top + rect.height / 2,
    });
  }

  const cardBoxes = new Map<string, CardBox>();
  if (columnIndexByKey) {
    for (const raw of rawBoxes) {
      const colIndex = columnIndexByKey.get(raw.key);
      if (colIndex === undefined) continue;
      cardBoxes.set(raw.key, { ...raw, colIndex });
    }
  } else {
    const byLeft = [...rawBoxes].sort((a, b) => a.left - b.left);
    let colIndex = 0;
    let anchorLeft = byLeft[0]?.left ?? 0;
    for (const raw of byLeft) {
      if (raw.left - anchorLeft >= 40) {
        colIndex += 1;
        anchorLeft = raw.left;
      }
      cardBoxes.set(raw.key, { ...raw, colIndex });
    }
  }

  const colLeft = new Map<number, number>();
  const colRight = new Map<number, number>();
  const colBottom = new Map<number, number>();
  let maxCardBottom = 0;
  for (const box of cardBoxes.values()) {
    maxCardBottom = Math.max(maxCardBottom, box.bottom);
    const prevL = colLeft.get(box.colIndex);
    colLeft.set(box.colIndex, prevL === undefined ? box.left : Math.min(prevL, box.left));
    const prevR = colRight.get(box.colIndex);
    colRight.set(box.colIndex, prevR === undefined ? box.right : Math.max(prevR, box.right));
    const prevB = colBottom.get(box.colIndex);
    colBottom.set(box.colIndex, prevB === undefined ? box.bottom : Math.max(prevB, box.bottom));
  }

  const geometries: RawEdgeGeometry[] = [];
  for (const edge of edges) {
    const fromBox = cardBoxes.get(edge.fromKey);
    const toBox = cardBoxes.get(edge.toKey);
    if (!fromBox || !toBox) continue;
    if (fromBox.colIndex >= toBox.colIndex || toBox.left - fromBox.left < 40) {
      continue;
    }
    geometries.push({
      edge,
      fromBox,
      toBox,
      isSkip: toBox.colIndex - fromBox.colIndex > 1,
    });
  }

  if (geometries.length === 0) {
    return { edges: [], maxY: maxCardBottom, maxCardBottom };
  }

  // Spread incoming ports per target card; adjacent edges enter upper/middle ports,
  // skip bypass edges enter the bottom port so risers never cross adjacent arrivals.
  const inPortY = new Map<string, number>();
  const incomingByTo = new Map<string, RawEdgeGeometry[]>();
  for (const geom of geometries) {
    const list = incomingByTo.get(geom.edge.toKey) ?? [];
    list.push(geom);
    incomingByTo.set(geom.edge.toKey, list);
  }
  for (const group of incomingByTo.values()) {
    group.sort(
      (a, b) =>
        (a.isSkip ? 1 : 0) - (b.isSkip ? 1 : 0) ||
        a.fromBox.centerY - b.fromBox.centerY ||
        a.edge.id.localeCompare(b.edge.id),
    );
    group.forEach((geom, idx) => {
      inPortY.set(
        geom.edge.id,
        spreadBoxPortY(geom.toBox.top, geom.toBox.height, idx, group.length),
      );
    });
  }

  // Group outgoing edges by source card so fan-out edges share one crisp bus anchor.
  const hasAdjacentOut = new Set<string>();
  const hasSkipOut = new Set<string>();
  for (const geom of geometries) {
    if (geom.isSkip) {
      hasSkipOut.add(geom.edge.fromKey);
    } else {
      hasAdjacentOut.add(geom.edge.fromKey);
    }
  }
  const outPortY = new Map<string, number>();
  for (const geom of geometries) {
    const { fromBox } = geom;
    const both = hasAdjacentOut.has(geom.edge.fromKey) && hasSkipOut.has(geom.edge.fromKey);
    const ratio = !both ? 0.5 : geom.isSkip ? 0.62 : 0.42;
    outPortY.set(geom.edge.id, fromBox.top + fromBox.height * ratio);
  }

  // Assign non-overlapping bottom-bypass Y corridors for non-adjacent edges.
  interface SkipGroupInfo {
    groupKey: string;
    fromKey: string;
    fromCol: number;
    toCol: number;
    anchorCenterY: number;
    geoms: RawEdgeGeometry[];
    bypassY: number;
  }
  const skipGroupMap = new Map<string, SkipGroupInfo>();
  for (const geom of geometries) {
    if (!geom.isSkip) continue;
    const groupKey = `${geom.edge.fromKey}->col:${geom.toBox.colIndex}`;
    const existing = skipGroupMap.get(groupKey);
    if (existing) {
      existing.geoms.push(geom);
    } else {
      skipGroupMap.set(groupKey, {
        groupKey,
        fromKey: geom.edge.fromKey,
        fromCol: geom.fromBox.colIndex,
        toCol: geom.toBox.colIndex,
        anchorCenterY: geom.fromBox.centerY,
        geoms: [geom],
        bypassY: 0,
      });
    }
  }

  const skipGroups = [...skipGroupMap.values()].sort(
    (a, b) =>
      a.fromCol - b.fromCol ||
      a.toCol - b.toCol ||
      a.anchorCenterY - b.anchorCenterY ||
      a.groupKey.localeCompare(b.groupKey),
  );
  const placedBypasses: SkipGroupInfo[] = [];
  for (const sg of skipGroups) {
    let obstacleBottom = 0;
    let foundIntermediate = false;
    for (let c = sg.fromCol + 1; c < sg.toCol; c += 1) {
      const b = colBottom.get(c);
      if (b !== undefined) {
        obstacleBottom = Math.max(obstacleBottom, b);
        foundIntermediate = true;
      }
    }
    if (!foundIntermediate) {
      const firstGeom = sg.geoms[0];
      if (!firstGeom) continue;
      obstacleBottom = Math.max(
        firstGeom.fromBox.bottom,
        ...sg.geoms.map((g) => g.toBox.bottom),
      );
    }
    let bypassY = obstacleBottom + 18;
    // Keep any horizontally overlapping bypass corridors vertically separated by >= 12px.
    const conflicts = placedBypasses.filter(
      (prev) => Math.max(prev.fromCol, sg.fromCol) < Math.min(prev.toCol, sg.toCol),
    );
    while (conflicts.some((prev) => Math.abs(prev.bypassY - bypassY) < 12)) {
      bypassY += 12;
    }
    sg.bypassY = bypassY;
    placedBypasses.push(sg);
  }

  // Collect vertical tracks inside each gutter [c -> c + 1] and allocate non-overlapping X lanes.
  const tracksByGutter = new Map<number, GutterTrack[]>();
  const addTrack = (gutterCol: number, track: GutterTrack) => {
    const list = tracksByGutter.get(gutterCol) ?? [];
    list.push(track);
    tracksByGutter.set(gutterCol, list);
  };

  // 1) Adjacent bus tracks grouped by source card
  const adjBySource = new Map<string, RawEdgeGeometry[]>();
  for (const geom of geometries) {
    if (geom.isSkip) continue;
    const list = adjBySource.get(geom.edge.fromKey) ?? [];
    list.push(geom);
    adjBySource.set(geom.edge.fromKey, list);
  }
  for (const [fromKey, list] of adjBySource.entries()) {
    const firstAdj = list[0];
    if (!firstAdj) continue;
    const fromCol = firstAdj.fromBox.colIndex;
    const y1 = outPortY.get(firstAdj.edge.id) ?? 0;
    const y2s = list.map((g) => inPortY.get(g.edge.id) ?? 0);
    const meanDelta = y2s.reduce((acc, y2) => acc + (y2 - y1), 0) / y2s.length;
    addTrack(fromCol, {
      id: `adj:${fromKey}`,
      kind: "adjacent",
      minY: Math.min(y1, ...y2s),
      maxY: Math.max(y1, ...y2s),
      anchorY: y1,
      meanDeltaY: meanDelta,
    });
  }

  // 2) Skip exit tracks grouped by source card (all skip edges leaving fromKey share one exit riser)
  const skipBySource = new Map<string, SkipGroupInfo[]>();
  for (const sg of skipGroups) {
    const list = skipBySource.get(sg.fromKey) ?? [];
    list.push(sg);
    skipBySource.set(sg.fromKey, list);
  }
  for (const [fromKey, list] of skipBySource.entries()) {
    const firstSkip = list[0];
    const firstSkipGeom = firstSkip?.geoms[0];
    if (!firstSkip || !firstSkipGeom) continue;
    const fromCol = firstSkip.fromCol;
    const y1 = outPortY.get(firstSkipGeom.edge.id) ?? 0;
    const bypassYs = list.map((sg) => sg.bypassY);
    const meanDelta = bypassYs.reduce((acc, by) => acc + (by - y1), 0) / bypassYs.length;
    addTrack(fromCol, {
      id: `skip-exit:${fromKey}`,
      kind: "skip-exit",
      minY: Math.min(y1, ...bypassYs),
      maxY: Math.max(y1, ...bypassYs),
      anchorY: y1,
      meanDeltaY: meanDelta,
    });
  }

  // 3) Skip entry tracks grouped by (fromKey, toCol) in gutter (toCol - 1)
  for (const sg of skipGroups) {
    const y2s = sg.geoms.map((g) => inPortY.get(g.edge.id) ?? 0);
    const meanDelta = y2s.reduce((acc, y2) => acc + (y2 - sg.bypassY), 0) / y2s.length;
    addTrack(sg.toCol - 1, {
      id: `skip-entry:${sg.groupKey}`,
      kind: "skip-entry",
      minY: Math.min(sg.bypassY, ...y2s),
      maxY: Math.max(sg.bypassY, ...y2s),
      anchorY: sg.bypassY,
      meanDeltaY: meanDelta,
    });
  }

  const laneXByTrackId = new Map<string, number>();
  for (const [gutterCol, tracks] of tracksByGutter.entries()) {
    const leftEdge = colRight.get(gutterCol);
    const rightEdge = colLeft.get(gutterCol + 1);
    const fallbackMid =
      leftEdge !== undefined && rightEdge !== undefined
        ? (leftEdge + rightEdge) / 2
        : 0;
    const laneMin = leftEdge !== undefined ? leftEdge + 10 : fallbackMid;
    const laneMax = rightEdge !== undefined ? rightEdge - 12 : fallbackMid;

    // Connected components of vertically overlapping tracks inside this gutter.
    const visited = new Array<boolean>(tracks.length).fill(false);
    for (let i = 0; i < tracks.length; i += 1) {
      if (visited[i]) continue;
      visited[i] = true;
      const queue = [i];
      const component: GutterTrack[] = [];
      while (queue.length > 0) {
        const idx = queue.shift();
        if (idx === undefined) break;
        const curr = tracks[idx];
        if (!curr) continue;
        component.push(curr);
        for (let j = 0; j < tracks.length; j += 1) {
          if (visited[j]) continue;
          const other = tracks[j];
          if (!other) continue;
          if (Math.min(curr.maxY, other.maxY) - Math.max(curr.minY, other.minY) > -4) {
            visited[j] = true;
            queue.push(j);
          }
        }
      }

      if (component.length === 1 || laneMax <= laneMin) {
        const xMid = laneMax <= laneMin ? fallbackMid : (laneMin + laneMax) / 2;
        for (const t of component) {
          laneXByTrackId.set(t.id, xMid);
        }
        continue;
      }

      const netDelta = component.reduce((sum, t) => sum + t.meanDeltaY, 0);
      component.sort((a, b) => {
        if (netDelta >= 0) {
          return (
            b.anchorY - a.anchorY ||
            (a.kind === "skip-exit" ? 1 : 0) - (b.kind === "skip-exit" ? 1 : 0) ||
            a.id.localeCompare(b.id)
          );
        }
        return (
          a.anchorY - b.anchorY ||
          (a.kind === "skip-exit" ? 1 : 0) - (b.kind === "skip-exit" ? 1 : 0) ||
          a.id.localeCompare(b.id)
        );
      });

      component.forEach((t, idx) => {
        const x = laneMin + ((laneMax - laneMin) * idx) / (component.length - 1);
        laneXByTrackId.set(t.id, x);
      });
    }
  }

  const bypassYByEdgeId = new Map<string, number>();
  for (const sg of skipGroups) {
    for (const geom of sg.geoms) {
      bypassYByEdgeId.set(geom.edge.id, sg.bypassY);
    }
  }

  const measured: MeasuredEdge[] = [];
  for (const geom of geometries) {
    const x1 = geom.fromBox.right;
    const x2 = geom.toBox.left;
    const y1 = outPortY.get(geom.edge.id) ?? 0;
    const y2 = inPortY.get(geom.edge.id) ?? 0;

    let path: string;
    if (!geom.isSkip) {
      const busX = laneXByTrackId.get(`adj:${geom.edge.fromKey}`) ?? (x1 + x2) / 2;
      path = buildRoundedPolylinePath([
        { x: x1, y: y1 },
        { x: busX, y: y1 },
        { x: busX, y: y2 },
        { x: x2, y: y2 },
      ]);
    } else {
      const bypassY = bypassYByEdgeId.get(geom.edge.id) ?? maxCardBottom + 18;
      const exitLaneX =
        laneXByTrackId.get(`skip-exit:${geom.edge.fromKey}`) ?? x1 + 14;
      const entryLaneX =
        laneXByTrackId.get(`skip-entry:${geom.edge.fromKey}->col:${geom.toBox.colIndex}`) ??
        x2 - 14;
      path = buildRoundedPolylinePath([
        { x: x1, y: y1 },
        { x: exitLaneX, y: y1 },
        { x: exitLaneX, y: bypassY },
        { x: entryLaneX, y: bypassY },
        { x: entryLaneX, y: y2 },
        { x: x2, y: y2 },
      ]);
    }

    measured.push({
      id: geom.edge.id,
      fromKey: geom.edge.fromKey,
      toKey: geom.edge.toKey,
      kind: geom.edge.kind,
      path,
    });
  }

  const maxBypassY = skipGroups.reduce((max, sg) => Math.max(max, sg.bypassY + 12), 0);
  return {
    edges: measured,
    maxY: Math.max(maxCardBottom, maxBypassY),
    maxCardBottom,
  };
}

export function layoutDomainEdgePaths(
  edges: readonly DomainEdge[],
  cardRefs: ReadonlyMap<string, HTMLElement>,
  board: HTMLElement,
  boardRect: DOMRect,
  columnIndexByKey?: ReadonlyMap<string, number>,
): MeasuredEdge[] {
  return layoutDomainEdgePathsWithBounds(
    edges,
    cardRefs,
    board,
    boardRect,
    columnIndexByKey,
  ).edges;
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
  highlighted,
  readAsset,
  registerRef,
  onSelectDocument,
  onOpenExternal,
  onExpand,
  onHoverChange,
}: {
  spec: DocumentSummary;
  design: DocumentDesignLink;
  highlighted?: boolean;
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
      data-focused-or-hovered={highlighted ? "true" : undefined}
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
            onFocus={() => onHoverChange?.(true)}
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
            onFocus={() => onHoverChange?.(true)}
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
          onFocus={() => onHoverChange?.(true)}
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
  const [extraBottomPadding, setExtraBottomPadding] = useState(0);
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

  const columnIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    columns.forEach((col, colIdx) => {
      for (const card of col.cards) {
        map.set(card.key, colIdx);
      }
    });
    return map;
  }, [columns]);

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
        setExtraBottomPadding((prev) => (prev === 0 ? prev : 0));
        return;
      }

      const { edges: nextEdges, maxY, maxCardBottom } =
        layoutDomainEdgePathsWithBounds(
          edges,
          cardRefs.current,
          board,
          boardRect,
          columnIndexByKey,
        );
      const nextExtra =
        maxY > maxCardBottom + 2 ? Math.ceil(maxY - maxCardBottom) + 8 : 0;
      setExtraBottomPadding((prev) => (prev === nextExtra ? prev : nextExtra));
      setSvgSize({
        width: Math.max(board.scrollWidth, boardRect.width),
        height: Math.max(
          board.scrollHeight,
          boardRect.height,
          Math.ceil(maxY + 8),
        ),
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
  }, [edges, columns, columnIndexByKey]);

  const folderPath = group.folderPath;
  const safeGroupKey = `${group.key.replace(/[^a-zA-Z0-9_-]/g, "_")}_${hashMarkerKey(group.key)}`;

  const renderEdgePath = (
    edge: MeasuredEdge,
    strokeWidth: number,
    opacity: number,
  ) => (
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
      strokeWidth={strokeWidth}
      opacity={opacity}
      strokeDasharray={edge.kind === "flow" ? "4 4" : undefined}
      markerEnd={
        edge.kind === "explicit"
          ? `url(#edge-arrow-explicit-${safeGroupKey})`
          : `url(#edge-arrow-flow-${safeGroupKey})`
      }
    />
  );

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
            {hoveredCardKey === null ? (
              <>
                <g opacity={0.52}>
                  {measuredEdges
                    .filter((edge) => edge.kind === "flow")
                    .map((edge) => renderEdgePath(edge, 1.25, 1))}
                </g>
                <g opacity={0.75}>
                  {measuredEdges
                    .filter((edge) => edge.kind === "explicit")
                    .map((edge) => renderEdgePath(edge, 1.5, 1))}
                </g>
              </>
            ) : (
              [...measuredEdges]
                .sort((a, b) => {
                  const aConn =
                    a.fromKey === hoveredCardKey || a.toKey === hoveredCardKey
                      ? 1
                      : 0;
                  const bConn =
                    b.fromKey === hoveredCardKey || b.toKey === hoveredCardKey
                      ? 1
                      : 0;
                  return aConn - bConn;
                })
                .map((edge) => {
                  const isConnected =
                    edge.fromKey === hoveredCardKey ||
                    edge.toKey === hoveredCardKey;
                  return renderEdgePath(
                    edge,
                    isConnected
                      ? 2.25
                      : edge.kind === "explicit"
                        ? 1.5
                        : 1.25,
                    isConnected ? 1 : 0.14,
                  );
                })
            )}
          </svg>
        ) : null}

        <div
          className="document-domain-map__columns"
          style={
            extraBottomPadding > 0
              ? { paddingBottom: `${extraBottomPadding}px` }
              : undefined
          }
        >
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
                        highlighted={hoveredCardKey === card.key}
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
                      data-focused-or-hovered={hoveredCardKey === key ? "true" : undefined}
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
                        onFocus={() => setHoveredCardKey(key)}
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
        role="region"
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
