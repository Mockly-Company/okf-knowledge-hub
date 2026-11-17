import { ExternalLink, Palette, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import type { DocumentAsset, DocumentDesignLink } from "../model";

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Keep extension matching aligned with Rust `frontmatter::looks_like_image_asset`. */
export function looksLikeImageAsset(path: string): boolean {
  const clean = path.split("#")[0]?.split("?")[0]?.trim() ?? "";
  return /\.(svg|png|jpe?g|gif|webp)$/i.test(clean);
}

export function extractDesignsFromProperties(
  properties: unknown,
): DocumentDesignLink[] {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  const record = properties as Record<string, unknown>;
  const rawList = Array.isArray(record.designs) ? record.designs : [];
  const designs: DocumentDesignLink[] = [];
  rawList.forEach((entry, index) => {
    if (typeof entry === "string" && entry.trim()) {
      const trimmed = entry.trim();
      const isImage = !isHttpUrl(trimmed) && looksLikeImageAsset(trimmed);
      designs.push({
        title: `디자인 시안 ${index + 1}`,
        url: isImage ? null : trimmed,
        image: isImage ? trimmed : null,
        status: null,
      });
      return;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      const url =
        typeof obj.url === "string" && obj.url.trim()
          ? obj.url.trim()
          : typeof obj.href === "string" && obj.href.trim()
            ? obj.href.trim()
            : null;
      const image =
        typeof obj.image === "string" && obj.image.trim()
          ? obj.image.trim()
          : typeof obj.asset === "string" && obj.asset.trim()
            ? obj.asset.trim()
            : null;
      if (!url && !image) return;
      const title =
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim()
          : typeof obj.label === "string" && obj.label.trim()
            ? obj.label.trim()
            : `디자인 시안 ${index + 1}`;
      const status =
        typeof obj.status === "string" && obj.status.trim()
          ? obj.status.trim()
          : null;
      const wireframe =
        typeof obj.wireframe === "string" && obj.wireframe.trim()
          ? obj.wireframe.trim()
          : null;
      designs.push({ title, url, image, status, wireframe });
    }
  });
  if (designs.length === 0) {
    const fallbackUrl =
      typeof record.design_url === "string" && record.design_url.trim()
        ? record.design_url.trim()
        : typeof record.figma_url === "string" && record.figma_url.trim()
          ? record.figma_url.trim()
          : null;
    if (fallbackUrl) {
      designs.push({
        title: "디자인 시안",
        url: fallbackUrl,
        image: null,
        status: null,
      });
    }
  }
  return designs;
}

export type DocumentAssetReader = (
  documentPath: string,
  assetPath: string,
) => Promise<DocumentAsset>;

/** Loads a document-relative image asset; `asset` stays null while loading or after failure. */
export function useDocumentAsset(
  documentPath: string,
  assetPath: string | null | undefined,
  readAsset: DocumentAssetReader,
): { asset: DocumentAsset | null; failed: boolean } {
  const [asset, setAsset] = useState<DocumentAsset | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAsset(null);
    setFailed(false);
    if (!assetPath) return;
    let active = true;
    void readAsset(documentPath, assetPath).then(
      (loaded) => {
        if (active) setAsset(loaded);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [assetPath, documentPath, readAsset]);

  return { asset, failed };
}

export function documentAssetSrc(asset: DocumentAsset): string {
  return asset.kind === "raster"
    ? `data:${asset.mimeType};base64,${asset.base64}`
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.source)}`;
}

export interface ExpandedDesignPreview {
  asset: DocumentAsset;
  title: string;
  externalUrl?: string | null;
}

export function safeHttpUrl(url: string | null | undefined): string | null {
  return url && isHttpUrl(url) ? url.trim() : null;
}

/** Full-size preview dialog shared by the design strip and the domain map design cards. */
export function DesignPreviewDialog({
  preview,
  onClose,
  onOpenExternal,
}: {
  preview: ExpandedDesignPreview | null;
  onClose(): void;
  onOpenExternal?: (url: string) => void;
}) {
  const externalUrl = preview?.externalUrl ?? null;
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="document-design-dialog"
        aria-label={preview?.title ?? "디자인 시안 미리보기"}
      >
        <DialogHeader>
          <DialogTitle>{preview?.title}</DialogTitle>
          <IconButton type="button" label="미리보기 닫기" tooltip={false} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </DialogHeader>
        <DialogBody className="document-design-dialog__body">
          {preview ? <img src={documentAssetSrc(preview.asset)} alt={preview.title} /> : null}
          {externalUrl ? (
            <div className="document-design-dialog__footer">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenExternal?.(externalUrl)}
              >
                <ExternalLink aria-hidden="true" />
                원본 디자인 링크 열기
              </Button>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DesignThumbnail({
  design,
  documentPath,
  readAsset,
  onOpenExternal,
  onExpand,
}: {
  design: DocumentDesignLink;
  documentPath: string;
  readAsset: DocumentAssetReader;
  onOpenExternal?: (url: string) => void;
  onExpand: (asset: DocumentAsset, title: string, externalUrl?: string | null) => void;
}) {
  const { asset, failed } = useDocumentAsset(documentPath, design.image, readAsset);

  const safeExternalUrl = safeHttpUrl(design.url);

  return (
    <div className="document-design-card">
      <div className="document-design-card__header">
        <span className="document-design-card__title">{design.title}</span>
        {design.status ? (
          <span className="document-design-card__status">{design.status}</span>
        ) : null}
      </div>

      {design.image ? (
        asset ? (
          <UnstyledButton
            type="button"
            className="document-design-card__preview"
            aria-label={`${design.title} 크게 보기`}
            onClick={() => onExpand(asset, design.title, safeExternalUrl)}
          >
            <img src={documentAssetSrc(asset)} alt={design.title} />
          </UnstyledButton>
        ) : (
          <div className="document-design-card__placeholder">
            {failed ? "시안 이미지를 불러올 수 없습니다." : "디자인 시안 불러오는 중…"}
          </div>
        )
      ) : null}

      {safeExternalUrl ? (
        <div className="document-design-card__actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenExternal?.(safeExternalUrl)}
          >
            <ExternalLink aria-hidden="true" />
            디자인 열기
          </Button>
        </div>
      ) : !design.image && design.url ? (
        <p className="document-design-card__ref">{design.url}</p>
      ) : null}
    </div>
  );
}

export function DesignLinksBar({
  designs,
  documentPath,
  readAsset,
  onOpenExternal,
  heading = "연결된 디자인 시안",
  emptyNotice,
}: {
  designs: readonly DocumentDesignLink[];
  documentPath: string;
  readAsset: (documentPath: string, assetPath: string) => Promise<DocumentAsset>;
  onOpenExternal?: (url: string) => void;
  heading?: string;
  emptyNotice?: string;
}) {
  const [expanded, setExpanded] = useState<ExpandedDesignPreview | null>(null);

  if (designs.length === 0) {
    if (!emptyNotice) return null;
    return (
      <div className="document-designs-empty">
        <Palette aria-hidden="true" size={14} />
        <span>{emptyNotice}</span>
      </div>
    );
  }

  return (
    <section className="document-designs-strip" aria-label={heading}>
      <div className="document-designs-strip__header">
        <span className="document-designs-strip__label">
          <Palette aria-hidden="true" size={14} />
          {heading}
        </span>
        <span className="document-designs-strip__count">{`${designs.length}건`}</span>
      </div>

      <div className="document-designs-strip__grid">
        {designs.map((design, index) => (
          <DesignThumbnail
            // Frontmatter may list the same title/image twice; the position keeps keys unique.
            key={`${index}-${design.title}-${design.image ?? design.url ?? ""}`}
            design={design}
            documentPath={documentPath}
            readAsset={readAsset}
            onOpenExternal={onOpenExternal}
            onExpand={(asset, title, externalUrl) =>
              setExpanded({ asset, title, externalUrl })
            }
          />
        ))}
      </div>

      <DesignPreviewDialog
        preview={expanded}
        onClose={() => setExpanded(null)}
        onOpenExternal={onOpenExternal}
      />
    </section>
  );
}
