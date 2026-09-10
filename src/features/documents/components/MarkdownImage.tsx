import { useEffect, useState, type ReactNode } from "react";
import type { DocumentAsset } from "../model";
import { sanitizeSvg } from "./MermaidBlock";

export interface MarkdownImageProps {
  src?: string;
  alt: string;
  title?: string;
  documentPath: string;
  readAsset: (documentPath: string, assetPath: string) => Promise<DocumentAsset>;
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function splitSuffix(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return { path: match?.[1] ?? value, suffix: match?.[2] ?? "" };
}

function resolveRepositoryPath(documentPath: string, value: string): string | null {
  const { path } = splitSuffix(value.trim());
  if (!path || isAbsoluteUrl(path) || path.startsWith("/") || path.includes("\\")) {
    return null;
  }
  const segments = documentPath.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (segment.includes(":")) return null;
    segments.push(segment);
  }
  return segments.join("/") || null;
}

function dataUrlForRaster(asset: Extract<DocumentAsset, { kind: "raster" }>): string | null {
  return /^image\/(avif|bmp|gif|jpeg|png|webp)$/i.test(asset.mimeType)
    ? `data:${asset.mimeType};base64,${asset.base64}`
    : null;
}

function sourceFileName(src?: string): string {
  const path = splitSuffix(src?.trim() ?? "").path;
  return path.split("/").filter(Boolean).at(-1) ?? "이미지";
}

function AssetFallback({ src, reason }: { src?: string; reason: string }) {
  return (
    <span className="markdown-document__asset-error" role="status">
      <strong>{sourceFileName(src)}</strong>
      <span>{reason}</span>
    </span>
  );
}

export function MarkdownImage({
  src,
  alt,
  title,
  documentPath,
  readAsset,
}: MarkdownImageProps) {
  const assetPath =
    src && resolveRepositoryPath(documentPath, src)
      ? splitSuffix(src).path
      : null;
  const [asset, setAsset] = useState<DocumentAsset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setAsset(null);
    setFailed(false);
    if (!assetPath) return () => {
      active = false;
    };
    void readAsset(documentPath, assetPath).then(
      (next) => {
        if (active) setAsset(next);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [assetPath, documentPath, readAsset]);

  let content: ReactNode;
  if (!assetPath) {
    content = <AssetFallback src={src} reason="외부 이미지는 표시할 수 없습니다." />;
  } else if (failed) {
    content = <AssetFallback src={src} reason="이미지를 표시할 수 없습니다." />;
  } else if (asset === null) {
    content = <span className="markdown-document__asset-loading">이미지를 불러오는 중…</span>;
  } else if (asset.kind === "svg") {
    content = (
      <span
        className="markdown-document__svg-asset"
        role="img"
        aria-label={alt}
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(asset.source) }}
      />
    );
  } else {
    const dataUrl = dataUrlForRaster(asset);
    content = dataUrl ? (
      <img className="markdown-document__raster-asset" src={dataUrl} alt={alt} />
    ) : (
      <AssetFallback src={src} reason="지원하지 않는 이미지 형식입니다." />
    );
  }

  return title ? (
    <figure className="markdown-document__figure">
      {content}
      <figcaption>{title}</figcaption>
    </figure>
  ) : content;
}
