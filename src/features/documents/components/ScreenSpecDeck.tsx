import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GalleryHorizontalEnd,
  Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { useOptionalDocuments } from "../DocumentsProvider";
import {
  classifyDocumentCategory,
  isAuxiliaryDocument,
  resolveDocumentDomain,
} from "../document-taxonomy";
import {
  normalizeDocumentPath,
  type DocumentAsset,
  type DocumentContent,
  type DocumentSummary,
} from "../model";
import { CompanionHtmlFrame } from "./CompanionHtmlFrame";
import { DesignLinksBar, extractDesignsFromProperties } from "./DesignLinksBar";
import { handleHorizontalTabKeyDown } from "./DocumentWorkbenchTabs";
import { MarkdownDocument } from "./MarkdownDocument";

type DeckPresentationMode = "strip" | "slide";

const STRIP_BATCH_SIZE = 4;

function canonicalKey(path: string): string {
  return normalizeDocumentPath(path).replace(/\.html$/i, ".md").toLowerCase();
}

const unavailableAssetReader = async (): Promise<DocumentAsset> => {
  throw new Error("시안 에셋 리더를 사용할 수 없습니다.");
};

export interface ScreenSpecDeckProps {
  documents: readonly DocumentSummary[];
  initialDomainFilter?: string | null;
  onSelectDocument: (
    path: string,
    preferredViewMode?: "html" | "markdown",
  ) => void;
  onOpenInNewWindow?: (
    path: string,
    viewMode?: "html" | "markdown",
    title?: string,
  ) => void;
  readDocumentPreview?: (path: string) => Promise<DocumentContent>;
  readPreviewAsset?: (
    documentPath: string,
    assetPath: string,
  ) => Promise<DocumentAsset>;
  onOpenExternal?: (url: string) => void;
}

export function ScreenSpecDeck({
  documents,
  initialDomainFilter = null,
  onSelectDocument,
  onOpenInNewWindow,
  readDocumentPreview,
  readPreviewAsset,
  onOpenExternal,
}: ScreenSpecDeckProps) {
  const docsContext = useOptionalDocuments();
  const [domainFilter, setDomainFilter] = useState<string>(
    initialDomainFilter ?? "all",
  );
  const [mode, setMode] = useState<DeckPresentationMode>("strip");
  const [activeIndex, setActiveIndex] = useState(0);
  const [stripLimit, setStripLimit] = useState(STRIP_BATCH_SIZE);
  const stripSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDomainFilter(initialDomainFilter ?? "all");
    setActiveIndex(0);
    setStripLimit(STRIP_BATCH_SIZE);
  }, [initialDomainFilter]);

  const screenSpecs = useMemo(
    () =>
      documents.filter(
        (doc) =>
          !isAuxiliaryDocument(doc) &&
          classifyDocumentCategory(doc) === "screen_spec",
      ),
    [documents],
  );

  const lookupByPath = useMemo(() => {
    const map = new Map<string, DocumentSummary>();
    for (const doc of documents) {
      map.set(canonicalKey(doc.path), doc);
    }
    return map;
  }, [documents]);

  const domainOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const spec of screenSpecs) {
      const domain = resolveDocumentDomain(spec);
      if (!map.has(domain.key)) {
        map.set(domain.key, domain.label);
      }
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [screenSpecs]);

  const effectiveDomainFilter =
    domainFilter !== "all" &&
    domainOptions.some((option) => option.key === domainFilter)
      ? domainFilter
      : "all";

  const filteredSpecs = useMemo(() => {
    if (effectiveDomainFilter === "all") return screenSpecs;
    return screenSpecs.filter(
      (spec) => resolveDocumentDomain(spec).key === effectiveDomainFilter,
    );
  }, [effectiveDomainFilter, screenSpecs]);

  const clampedIndex =
    filteredSpecs.length === 0
      ? 0
      : Math.min(activeIndex, filteredSpecs.length - 1);

  const visibleSpecs = useMemo(() => {
    if (mode === "slide") {
      const current = filteredSpecs[clampedIndex];
      return current ? [current] : [];
    }
    return filteredSpecs.slice(0, stripLimit);
  }, [clampedIndex, filteredSpecs, mode, stripLimit]);

  useEffect(() => {
    if (
      mode !== "strip" ||
      visibleSpecs.length >= filteredSpecs.length ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const target = stripSentinelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setStripLimit((current) =>
            Math.min(filteredSpecs.length, current + STRIP_BATCH_SIZE),
          );
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredSpecs.length, mode, visibleSpecs.length]);

  const knownWorkspaceId = docsContext?.state.workspaceId ?? null;
  // Without a workspace id the reader follows the active session, so key by session instead:
  // switching workspaces opens a new session and must refetch even while this deck stays mounted.
  const effectiveWorkspaceKey =
    knownWorkspaceId ??
    `unknown-workspace:${docsContext?.state.activeSessionId ?? "none"}`;
  const previewReader = readDocumentPreview ?? docsContext?.readDocumentPreview;
  const assetReader =
    readPreviewAsset ??
    docsContext?.readPreviewAsset ??
    docsContext?.readAsset ??
    unavailableAssetReader;
  const externalOpener =
    onOpenExternal ??
    (docsContext ? (url: string) => void docsContext.openExternal(url) : undefined);

  const contentQueries = useQueries({
    queries: visibleSpecs.map((spec) => ({
      queryKey: [
        "documents",
        "screen-spec-preview",
        effectiveWorkspaceKey,
        spec.path,
      ] as const,
      queryFn: () => {
        if (!previewReader) {
          throw new Error("화면명세 미리보기 리더를 사용할 수 없습니다.");
        }
        return previewReader(spec.path);
      },
      enabled: Boolean(previewReader),
      // Without a known workspace the reader resolves "whatever is active", so the same path may
      // belong to a different workspace next time; never serve such previews from cache.
      staleTime: knownWorkspaceId ? 30_000 : 0,
      gcTime: knownWorkspaceId ? undefined : 0,
    })),
  });

  if (screenSpecs.length === 0) {
    return (
      <div className="screen-spec-deck__empty">
        <strong>아직 등록된 화면명세서가 없습니다.</strong>
        <p>
          문서 저장소의 <code>screen-spec.md</code> 또는 <code>type: screen-spec</code> 문서가 추가되면 이곳에서 한눈에 이어 볼 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="screen-spec-deck">
      <div className="screen-spec-deck__toolbar">
        <div
          className="screen-spec-deck__domains"
          role="group"
          aria-label="화면명세 도메인 필터"
        >
          <UnstyledButton
            type="button"
            className="document-search__filter-chip"
            data-active={effectiveDomainFilter === "all"}
            aria-pressed={effectiveDomainFilter === "all"}
            onClick={() => {
              setDomainFilter("all");
              setActiveIndex(0);
              setStripLimit(STRIP_BATCH_SIZE);
            }}
          >
            {`전체 (${screenSpecs.length})`}
          </UnstyledButton>
          {domainOptions.map((option) => (
            <UnstyledButton
              key={option.key}
              type="button"
              className="document-search__filter-chip"
              data-active={effectiveDomainFilter === option.key}
              aria-pressed={effectiveDomainFilter === option.key}
              onClick={() => {
                setDomainFilter(option.key);
                setActiveIndex(0);
                setStripLimit(STRIP_BATCH_SIZE);
              }}
            >
              {option.label}
            </UnstyledButton>
          ))}
        </div>

        <div
          className="screen-spec-deck__mode-switch"
          role="group"
          aria-label="화면명세 보기 방식"
        >
          <UnstyledButton
            type="button"
            className="document-search__mode-chip"
            data-active={mode === "strip"}
            aria-pressed={mode === "strip"}
            onClick={() => setMode("strip")}
          >
            <Rows3 aria-hidden="true" size={14} />
            연속 스트립
          </UnstyledButton>
          <UnstyledButton
            type="button"
            className="document-search__mode-chip"
            data-active={mode === "slide"}
            aria-pressed={mode === "slide"}
            onClick={() => setMode("slide")}
          >
            <GalleryHorizontalEnd aria-hidden="true" size={14} />
            한 화면씩 넘기기
          </UnstyledButton>
        </div>
      </div>

      {mode === "slide" && filteredSpecs.length > 0 ? (
        <div className="screen-spec-deck__slide-controls">
          <div className="screen-spec-deck__slide-nav">
            <Button
              type="button"
              variant="secondary"
              disabled={clampedIndex <= 0}
              onClick={() => setActiveIndex(Math.max(0, clampedIndex - 1))}
            >
              <ChevronLeft aria-hidden="true" size={16} />
              이전 화면명세
            </Button>
            <span className="screen-spec-deck__slide-counter">
              {`${clampedIndex + 1} / ${filteredSpecs.length}`}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={clampedIndex >= filteredSpecs.length - 1}
              onClick={() =>
                setActiveIndex(
                  Math.min(filteredSpecs.length - 1, clampedIndex + 1),
                )
              }
            >
              다음 화면명세
              <ChevronRight aria-hidden="true" size={16} />
            </Button>
          </div>

          <div
            className="screen-spec-deck__filmstrip"
            role="tablist"
            aria-label="화면명세 슬라이드 목차"
          >
            {filteredSpecs.map((spec, idx) => (
              <UnstyledButton
                key={spec.path}
                type="button"
                id={`screen-spec-tab-${idx}`}
                role="tab"
                aria-selected={idx === clampedIndex}
                aria-controls="screen-spec-deck-panel"
                tabIndex={idx === clampedIndex ? 0 : -1}
                data-active={idx === clampedIndex}
                className="screen-spec-deck__filmstrip-item"
                onClick={() => setActiveIndex(idx)}
                onKeyDown={(event) =>
                  handleHorizontalTabKeyDown(
                    event,
                    idx,
                    filteredSpecs.length,
                    setActiveIndex,
                  )
                }
              >
                <span>{`${idx + 1}. ${spec.title}`}</span>
              </UnstyledButton>
            ))}
          </div>
        </div>
      ) : null}

      <div
        id="screen-spec-deck-panel"
        className="screen-spec-deck__list"
        role={mode === "slide" && filteredSpecs.length > 0 ? "tabpanel" : undefined}
        tabIndex={mode === "slide" && filteredSpecs.length > 0 ? 0 : undefined}
        aria-labelledby={
          mode === "slide" && filteredSpecs.length > 0
            ? `screen-spec-tab-${clampedIndex}`
            : undefined
        }
      >
        {visibleSpecs.map((spec, idx) => {
          const query = contentQueries[idx];
          const content = query?.data;
          const domain = resolveDocumentDomain(spec);
          const preferredView: "html" | "markdown" =
            content?.companionHtml || spec.hasCompanionHtml ? "html" : "markdown";
          const designs =
            content?.summary.designs && content.summary.designs.length > 0
              ? content.summary.designs
              : content
                ? extractDesignsFromProperties(content.properties)
                : (spec.designs ?? []);
          const wireframes =
            content?.summary.wireframes && content.summary.wireframes.length > 0
              ? content.summary.wireframes
              : (spec.wireframes ?? []);
          const relatedDocs = (spec.linkedPaths ?? [])
            .map((linkedPath) => lookupByPath.get(canonicalKey(linkedPath)))
            .filter(
              (target): target is DocumentSummary =>
                target !== undefined &&
                canonicalKey(target.path) !== canonicalKey(spec.path),
            )
            .slice(0, 4);

          return (
            <article
              key={spec.path}
              className="screen-spec-card"
              aria-label={`${spec.title} 화면명세`}
            >
              <header className="screen-spec-card__header">
                <div className="screen-spec-card__identity">
                  <div className="screen-spec-card__badges">
                    <span className="document-map-card__badge">{domain.label}</span>
                    {spec.hasCompanionHtml ? (
                      <span className="document-map-card__badge document-map-card__badge--html">
                        HTML
                      </span>
                    ) : null}
                    {wireframes.length > 0 ? (
                      <span className="document-map-card__badge document-map-card__badge--wireframe">
                        {`와이어프레임 ${wireframes.length}`}
                      </span>
                    ) : (
                      <span className="document-map-card__badge document-map-card__badge--warning">
                        와이어프레임 없음
                      </span>
                    )}
                    {designs.length > 0 ? (
                      <span className="document-map-card__badge document-map-card__badge--design">
                        {`디자인 ${designs.length}`}
                      </span>
                    ) : null}
                  </div>
                  <h3>{spec.title}</h3>
                  {spec.description ? (
                    <p className="screen-spec-card__description">
                      {spec.description}
                    </p>
                  ) : null}
                  {relatedDocs.length > 0 ? (
                    <div className="screen-spec-card__related">
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
                          {`연결 · ${target.title}`}
                        </UnstyledButton>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="screen-spec-card__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onSelectDocument(spec.path, preferredView)}
                  >
                    탭으로 열기
                  </Button>
                  {onOpenInNewWindow ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        onOpenInNewWindow(spec.path, preferredView, spec.title)
                      }
                    >
                      <ExternalLink aria-hidden="true" size={14} />
                      새 창으로 열기
                    </Button>
                  ) : null}
                </div>
              </header>

              <div className="screen-spec-card__body">
                <div className="screen-spec-card__viewer">
                  {previewReader && query?.isPending ? (
                    <p className="screen-spec-card__loading">
                      화면명세 본문을 불러오는 중…
                    </p>
                  ) : content?.companionHtml ? (
                    <CompanionHtmlFrame
                      html={content.companionHtml.html}
                      title={`${spec.title} 화면명세 보기`}
                      documentPath={spec.path}
                      onNavigateDocument={(target) =>
                        onSelectDocument(target.path, target.view)
                      }
                      onOpenExternal={externalOpener}
                    />
                  ) : content ? (
                    <div className="screen-spec-card__markdown">
                      <MarkdownDocument
                        document={content}
                        hideHeader
                        suppressSourceTitle
                        onSelectDocument={onSelectDocument}
                        readAsset={assetReader}
                        onOpenExternal={externalOpener}
                      />
                    </div>
                  ) : (
                    <p className="screen-spec-card__error">
                      화면명세 미리보기를 불러오지 못했습니다. 상단의 탭으로 열어 확인해 주세요.
                    </p>
                  )}
                </div>

                <div className="screen-spec-card__designs">
                  <DesignLinksBar
                    designs={wireframes.map((wireframe) => ({
                      title: wireframe.title,
                      image: wireframe.image,
                    }))}
                    documentPath={spec.path}
                    readAsset={assetReader}
                    heading="화면 와이어프레임"
                    emptyNotice="와이어프레임이 아직 없습니다. 화면마다 frontmatter의 wireframes 항목에 와이어프레임 이미지를 등록해 주세요."
                  />
                  <DesignLinksBar
                    designs={designs}
                    documentPath={spec.path}
                    readAsset={assetReader}
                    onOpenExternal={externalOpener}
                    heading="연결된 디자인 · 화면 시안"
                    emptyNotice="연결된 디자인 시안이 아직 없습니다. frontmatter의 designs 항목에 시안 이미지나 링크를 연결하면 명세서와 나란히 표시됩니다."
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {mode === "strip" && visibleSpecs.length < filteredSpecs.length ? (
        <div ref={stripSentinelRef} className="screen-spec-deck__more">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setStripLimit((current) =>
                Math.min(filteredSpecs.length, current + STRIP_BATCH_SIZE),
              )
            }
          >
            {`화면명세 더 불러오기 (${filteredSpecs.length - visibleSpecs.length}개 남음)`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
