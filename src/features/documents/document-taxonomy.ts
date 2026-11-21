import { normalizeDocumentPath, type DocumentSummary } from "./model";

export type DocumentCategory =
  | "prd"
  | "screen_spec"
  | "adr"
  | "guide"
  | "reference";

export type DocumentGroupMode =
  | "map"
  | "overview"
  | "screen_specs"
  | "domain"
  | "type"
  | "flat";
export type DocumentCategoryFilter = "all" | DocumentCategory;
export type DocumentImplStatusFilter =
  | "all"
  | "unimplemented"
  | "partial"
  | "synced"
  | "unaudited";

export const DOCUMENT_CATEGORY_ORDER: readonly DocumentCategory[] = [
  "prd",
  "screen_spec",
  "adr",
  "guide",
  "reference",
];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  prd: "기획 · PRD",
  screen_spec: "화면명세",
  adr: "설계 · ADR",
  guide: "가이드",
  reference: "기타 · 참고",
};

const FRIENDLY_DOMAIN_LABELS: Record<string, string> = {
  documents: "Documents (문서)",
  dashboard: "Dashboard (대시보드)",
  workspace: "Workspace (워크스페이스)",
  "project-board": "Project Board (프로젝트)",
  architecture: "아키텍처 (architecture)",
  product: "제품 · 기획 (product)",
  "user-guide": "사용자 가이드 (user-guide)",
  development: "개발 안내 (development)",
  superpowers: "설계 · 계획 기록 (superpowers)",
  general: "공통 · 일반",
};

const RESERVED_STEMS = new Set(["index", "log", "readme", "agents"]);
const RESERVED_EXTENSIONS = new Set(["md", "html"]);

function normalizePortablePath(path: string): string {
  return normalizeDocumentPath(path);
}

function isReservedDocumentFileName(fileName: string): boolean {
  const trimmed = fileName.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) return false;
  const stem = trimmed.slice(0, dotIndex);
  const ext = trimmed.slice(dotIndex + 1);
  return RESERVED_STEMS.has(stem) && RESERVED_EXTENSIONS.has(ext);
}

export function isAuxiliaryDocument(
  doc: Pick<DocumentSummary, "fileName" | "path">,
): boolean {
  const normalizedPath = normalizePortablePath(doc.path).toLowerCase();
  if (normalizedPath.startsWith(".okf/")) {
    return true;
  }
  const rawFileName =
    normalizePortablePath(doc.fileName || "").split("/").pop() ||
    normalizedPath.split("/").pop() ||
    "";
  return isReservedDocumentFileName(rawFileName);
}

const OVERVIEW_STEMS = new Set(["index", "readme"]);

/** `index.md` / `README.md` outside `.okf/`: the entry point that introduces a domain folder. */
export function isOverviewDocument(
  doc: Pick<DocumentSummary, "fileName" | "path">,
): boolean {
  const normalizedPath = normalizePortablePath(doc.path).toLowerCase();
  if (normalizedPath.startsWith(".okf/")) return false;
  const fileName = normalizedPath.split("/").pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return false;
  return (
    OVERVIEW_STEMS.has(fileName.slice(0, dotIndex)) &&
    RESERVED_EXTENSIONS.has(fileName.slice(dotIndex + 1))
  );
}

function classifyByDocType(docType: string | null | undefined): DocumentCategory | null {
  const normalized = docType?.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized === "product spec" ||
    normalized === "prd" ||
    normalized === "feature_design" ||
    normalized === "feature_spec" ||
    normalized === "product-spec" ||
    normalized === "기획서"
  ) {
    return "prd";
  }
  if (
    normalized === "screen spec" ||
    normalized === "screen-spec" ||
    normalized === "screen_spec" ||
    normalized === "화면명세" ||
    normalized === "화면명세서"
  ) {
    return "screen_spec";
  }
  if (
    normalized === "adr" ||
    normalized === "decision" ||
    normalized === "decision-record" ||
    normalized === "design" ||
    normalized === "design-doc" ||
    normalized === "architecture" ||
    normalized === "tech_spec"
  ) {
    return "adr";
  }
  if (
    normalized === "guide" ||
    normalized === "user-guide" ||
    normalized === "runbook" ||
    normalized === "onboarding" ||
    normalized === "how-to"
  ) {
    return "guide";
  }
  return null;
}

export function classifyDocumentCategory(
  doc: Pick<DocumentSummary, "docType" | "path" | "fileName">,
): DocumentCategory {
  const fromType = classifyByDocType(doc.docType);
  if (fromType) return fromType;

  if (isAuxiliaryDocument(doc)) {
    return "reference";
  }

  const normalizedPath = normalizePortablePath(doc.path).toLowerCase();
  const fileName = (
    doc.fileName ||
    normalizedPath.split("/").pop() ||
    ""
  ).toLowerCase();
  const canonicalFileName = fileName.replace(/\.html$/i, ".md");

  if (
    canonicalFileName === "screen-spec.md" ||
    canonicalFileName.endsWith("-screen-spec.md") ||
    canonicalFileName === "screens.md" ||
    normalizedPath.startsWith("docs/screens/")
  ) {
    return "screen_spec";
  }

  if (
    canonicalFileName === "prd.md" ||
    canonicalFileName.endsWith("-prd.md") ||
    canonicalFileName.includes("product-spec")
  ) {
    return "prd";
  }

  if (
    normalizedPath.startsWith("docs/architecture/") ||
    normalizedPath.startsWith("docs/adr/") ||
    normalizedPath.startsWith("docs/decisions/") ||
    normalizedPath.startsWith("docs/superpowers/") ||
    canonicalFileName.startsWith("adr-")
  ) {
    return "adr";
  }

  if (
    normalizedPath.startsWith("docs/user-guide/") ||
    normalizedPath.startsWith("docs/development/") ||
    canonicalFileName.includes("guide") ||
    canonicalFileName === "getting-started.md"
  ) {
    return "guide";
  }

  if (normalizedPath.startsWith("docs/product/")) {
    return "prd";
  }

  return "reference";
}

export interface ResolvedDocumentDomain {
  key: string;
  label: string;
  folderPath: string;
  isExplicitDomain: boolean;
}

function parentDirectory(normalizedPath: string): string {
  const index = normalizedPath.lastIndexOf("/");
  if (index <= 0) return "docs";
  return normalizedPath.slice(0, index);
}

export function resolveDocumentDomain(
  doc: Pick<DocumentSummary, "domain" | "path">,
): ResolvedDocumentDomain {
  const normalizedPath = normalizePortablePath(doc.path);
  const parentDir = parentDirectory(normalizedPath);
  const segments = normalizedPath.split("/").filter(Boolean);

  const explicit = doc.domain?.trim();
  if (explicit) {
    const key = explicit.toLowerCase().replace(/\s+/g, "-");
    const isCanonicalDomainPath =
      segments[0]?.toLowerCase() === "docs" &&
      segments[1]?.toLowerCase() === "domains" &&
      segments.length >= 4 &&
      segments[2]?.toLowerCase() === key;
    const folderPath = isCanonicalDomainPath
      ? `docs/domains/${segments[2]}`
      : parentDir;
    return {
      key,
      label: FRIENDLY_DOMAIN_LABELS[key] ?? explicit,
      folderPath,
      isExplicitDomain: true,
    };
  }

  if (
    segments[0]?.toLowerCase() === "docs" &&
    segments[1]?.toLowerCase() === "domains" &&
    segments.length >= 4
  ) {
    const rawSlug = segments[2]!;
    const key = rawSlug.toLowerCase();
    return {
      key,
      label: FRIENDLY_DOMAIN_LABELS[key] ?? rawSlug,
      folderPath: `docs/domains/${rawSlug}`,
      isExplicitDomain: true,
    };
  }

  if (segments[0]?.toLowerCase() === "docs" && segments.length >= 3) {
    const topFolder = segments[1]!;
    const key = topFolder.toLowerCase();
    return {
      key,
      label: FRIENDLY_DOMAIN_LABELS[key] ?? topFolder,
      folderPath: `docs/${topFolder}`,
      isExplicitDomain: false,
    };
  }

  return {
    key: "general",
    label: FRIENDLY_DOMAIN_LABELS.general!,
    folderPath: "docs",
    isExplicitDomain: false,
  };
}

function compareDeterministicText(left: string, right: string): number {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  if (leftLower < rightLower) return -1;
  if (leftLower > rightLower) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortDocumentsInGroup(docs: readonly DocumentSummary[]): DocumentSummary[] {
  return [...docs].sort((a, b) => {
    const aAux = isAuxiliaryDocument(a) ? 1 : 0;
    const bAux = isAuxiliaryDocument(b) ? 1 : 0;
    if (aAux !== bAux) return aAux - bAux;

    const aRank = DOCUMENT_CATEGORY_ORDER.indexOf(classifyDocumentCategory(a));
    const bRank = DOCUMENT_CATEGORY_ORDER.indexOf(classifyDocumentCategory(b));
    if (aRank !== bRank) return aRank - bRank;

    return compareDeterministicText(a.path, b.path);
  });
}

export interface DocumentGroup {
  key: string;
  label: string;
  folderPath: string | null;
  isExplicitDomain: boolean;
  documents: DocumentSummary[];
}

function isCanonicalDomainFolder(
  folderPath: string | null,
  key: string,
): boolean {
  return (
    folderPath !== null &&
    folderPath.toLowerCase() === `docs/domains/${key}`
  );
}

export function groupDocumentsByDomain(
  docs: readonly DocumentSummary[],
): DocumentGroup[] {
  const buckets = new Map<string, DocumentGroup>();

  for (const doc of docs) {
    const resolved = resolveDocumentDomain(doc);
    const existing = buckets.get(resolved.key);
    if (existing) {
      existing.documents.push(doc);
      if (resolved.isExplicitDomain && !existing.isExplicitDomain) {
        existing.isExplicitDomain = true;
      }
      if (
        isCanonicalDomainFolder(resolved.folderPath, resolved.key) &&
        !isCanonicalDomainFolder(existing.folderPath, resolved.key)
      ) {
        existing.folderPath = resolved.folderPath;
      } else if (
        !isCanonicalDomainFolder(existing.folderPath, resolved.key) &&
        existing.folderPath !== resolved.folderPath
      ) {
        existing.folderPath = null;
      }
    } else {
      buckets.set(resolved.key, {
        key: resolved.key,
        label: resolved.label,
        folderPath: resolved.folderPath,
        isExplicitDomain: resolved.isExplicitDomain,
        documents: [doc],
      });
    }
  }

  return [...buckets.values()]
    .map((group) => ({
      ...group,
      documents: sortDocumentsInGroup(group.documents),
    }))
    .sort((a, b) => {
      const aGeneral = a.key === "general" ? 2 : a.isExplicitDomain ? 0 : 1;
      const bGeneral = b.key === "general" ? 2 : b.isExplicitDomain ? 0 : 1;
      if (aGeneral !== bGeneral) return aGeneral - bGeneral;
      return compareDeterministicText(a.key, b.key);
    });
}

export function groupDocumentsByCategory(
  docs: readonly DocumentSummary[],
): DocumentGroup[] {
  const buckets = new Map<DocumentCategory, DocumentSummary[]>();
  for (const doc of docs) {
    const category = classifyDocumentCategory(doc);
    const list = buckets.get(category);
    if (list) {
      list.push(doc);
    } else {
      buckets.set(category, [doc]);
    }
  }

  return DOCUMENT_CATEGORY_ORDER.flatMap((category) => {
    const items = buckets.get(category);
    if (!items || items.length === 0) return [];
    return [
      {
        key: category,
        label: DOCUMENT_CATEGORY_LABELS[category],
        folderPath: null,
        isExplicitDomain: false,
        documents: sortDocumentsInGroup(items),
      },
    ];
  });
}
