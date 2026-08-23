import type {
  DocumentCatalog,
  DocumentContent,
  DocumentSummary,
} from "@/features/documents/model";

function fileNameFromPath(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function documentSummary(input: {
  path: string;
  title: string;
  documentId: string;
  modifiedAtUnixMs?: number;
  size?: number;
}): DocumentSummary {
  return {
    path: input.path,
    fileName: fileNameFromPath(input.path),
    title: input.title,
    documentId: input.documentId,
    frontmatterStatus: { status: "valid" },
    modifiedAtUnixMs: input.modifiedAtUnixMs ?? 1_726_000_000_000,
    size: input.size ?? 240,
  };
}

type MutableTreeNode = {
  kind: "folder";
  name: string;
  path: string;
  children: Array<MutableTreeNode | { kind: "document"; summary: DocumentSummary }>;
};

function createCatalog(documents: DocumentSummary[]): DocumentCatalog {
  const roots: MutableTreeNode[] = [];
  const folders = new Map<string, MutableTreeNode>();

  for (const summary of documents) {
    const segments = summary.path.split("/");
    const fileName = segments.pop();
    if (!fileName) continue;

    let parentChildren = roots as MutableTreeNode["children"];
    let folderPath = "";

    for (const segment of segments) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = {
          kind: "folder",
          name: segment,
          path: folderPath,
          children: [],
        };
        folders.set(folderPath, folder);
        parentChildren.push(folder);
      }
      parentChildren = folder.children;
    }

    parentChildren.push({ kind: "document", summary });
  }

  return { documents, roots };
}

function createContent(summary: DocumentSummary, markdown?: string): DocumentContent {
  return {
    summary,
    markdown: markdown ?? `# ${summary.title}\n`,
    properties: {},
    tableOfContents: [],
    lastCommit: null,
  };
}

export const documentFixtures = {
  emptyCatalog: (): DocumentCatalog => ({ documents: [], roots: [] }),
  mapSearchApi: (): DocumentSummary =>
    documentSummary({
      path: "docs/api/map-search.md",
      title: "지도 검색 API 계약",
      documentId: "5cd46f15-cc70-49ca-8a62-14c020e07af0",
    }),
  mapSearchFeature: (): DocumentSummary =>
    documentSummary({
      path: "docs/features/map-search.md",
      title: "지도 장소 검색 기능",
      documentId: "0997aebc-faa6-4c77-96d3-9f179b9da327",
    }),
  catalog: (...documents: DocumentSummary[]): DocumentCatalog =>
    createCatalog(documents),
  content: (summary: DocumentSummary, markdown?: string): DocumentContent =>
    createContent(summary, markdown),
  defaultCatalog: (): DocumentCatalog =>
    createCatalog([
      documentFixtures.mapSearchApi(),
      documentFixtures.mapSearchFeature(),
    ]),
};
