import type { DocumentAsset } from "../model";
import { dataUrlForRaster, resolveRepositoryPath } from "./MarkdownImage";
import { sanitizeSvg } from "./MermaidBlock";

const unavailable = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="96" viewBox="0 0 480 96"><rect width="480" height="96" fill="#f7f8f9"/><text x="24" y="54" font-family="sans-serif" font-size="16" fill="#6c737d">이미지를 표시할 수 없습니다</text></svg>')}`;

export function createEditorImagePreview(documentPath: string, readAsset?: (documentPath: string, assetPath: string) => Promise<DocumentAsset>) {
  return async (source: string): Promise<string> => {
    if (!readAsset || !resolveRepositoryPath(documentPath, source)) return unavailable;
    try {
      const asset = await readAsset(documentPath, source.split(/[?#]/)[0]);
      return asset.kind === "svg"
        ? `data:image/svg+xml,${encodeURIComponent(sanitizeSvg(asset.source))}`
        : dataUrlForRaster(asset) ?? unavailable;
    } catch {
      return unavailable;
    }
  };
}
