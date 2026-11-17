import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanionHtmlFrame } from "@/features/documents/components/CompanionHtmlFrame";
import {
  DesignLinksBar,
  extractDesignsFromProperties,
} from "@/features/documents/components/DesignLinksBar";
import { MarkdownDocument } from "@/features/documents/components/MarkdownDocument";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import {
  normalizeDocumentPath,
  type StandaloneDocumentPayload,
} from "@/features/documents/model";

interface WindowDocEntry {
  path: string;
  view?: "html" | "markdown";
  fragment?: string;
}

const MAX_WINDOW_HISTORY_ENTRIES = 30;

/** Rust `open_document_window` dispatches this when it reuses an already-open doc-viewer window. */
const DOC_WINDOW_NAVIGATE_EVENT = "okhub:doc-window-navigate";

function parseNavigateDetail(
  detail: unknown,
): { path: string; view?: "html" | "markdown" } | null {
  if (typeof detail !== "object" || detail === null) return null;
  const { path, view } = detail as { path?: unknown; view?: unknown };
  if (typeof path !== "string" || !path.trim()) return null;
  return {
    path,
    view: view === "html" || view === "markdown" ? view : undefined,
  };
}

function canonicalKey(path: string): string {
  return normalizeDocumentPath(path).replace(/\.html$/i, ".md").toLowerCase();
}

export function StandaloneDocumentWindowPage({
  documentsGateway,
}: {
  documentsGateway: DocumentsGateway;
}) {
  const [searchParams] = useSearchParams();
  const rawWorkspaceId = searchParams.get("workspaceId")?.trim();
  const workspaceId: string | null = rawWorkspaceId ? rawWorkspaceId : null;
  const rawDoc = searchParams.get("doc") ?? "";
  const rawView = searchParams.get("view");
  const rawFragment = searchParams.get("fragment");

  const initialPath = rawDoc
    ? normalizeDocumentPath(rawDoc).replace(/\.html$/i, ".md")
    : "";
  const initialView: "html" | "markdown" | undefined =
    rawView === "html" || rawView === "markdown" ? rawView : undefined;

  const [history, setHistory] = useState<{
    entries: WindowDocEntry[];
    index: number;
  }>(() => ({
    entries: initialPath
      ? [
          {
            path: initialPath,
            view: initialView,
            fragment: rawFragment || undefined,
          },
        ]
      : [],
    index: 0,
  }));

  const [viewOverrides, setViewOverrides] = useState<
    Record<string, "html" | "markdown">
  >({});
  const [externalError, setExternalError] = useState<string | null>(null);

  useEffect(() => {
    setHistory({
      entries: initialPath
        ? [
            {
              path: initialPath,
              view: initialView,
              fragment: rawFragment || undefined,
            },
          ]
        : [],
      index: 0,
    });
    setViewOverrides({});
  }, [initialPath, initialView, rawFragment, workspaceId]);

  const currentEntry = history.entries[history.index] ?? null;
  const canGoBack = history.index > 0;
  const canGoForward = history.index < history.entries.length - 1;

  const docQuery = useQuery<StandaloneDocumentPayload>({
    queryKey: [
      "documents",
      "standalone-window",
      workspaceId ?? "active",
      currentEntry?.path ?? "",
    ],
    queryFn: () => {
      if (!documentsGateway.readStandaloneDocument || !currentEntry?.path) {
        throw new Error("단독 문서 창에서 문서를 불러올 수 없습니다.");
      }
      return documentsGateway.readStandaloneDocument(
        workspaceId,
        currentEntry.path,
      );
    },
    enabled: Boolean(
      documentsGateway.readStandaloneDocument && currentEntry?.path,
    ),
    // workspaceId 없이 열린 창은 "현재 활성 워크스페이스"를 읽으므로, 메인 창에서 워크스페이스를
    // 바꾼 뒤 이전 워크스페이스 캐시가 재사용되지 않도록 캐시를 유지하지 않는다.
    staleTime: workspaceId ? undefined : 0,
    gcTime: workspaceId ? undefined : 0,
  });

  const payload = docQuery.data;
  const doc = payload?.document ?? null;
  const hasCompanionHtml = Boolean(doc?.companionHtml);

  useEffect(() => {
    if (doc?.summary.title) {
      document.title = `${doc.summary.title} — OkHub Docs`;
    }
  }, [doc?.summary.title]);

  const effectiveView: "html" | "markdown" = useMemo(() => {
    if (!currentEntry) return "markdown";
    const override = viewOverrides[canonicalKey(currentEntry.path)];
    const preferred = override ?? currentEntry.view;
    if (preferred === "markdown") return "markdown";
    if (hasCompanionHtml) return "html";
    return "markdown";
  }, [currentEntry, hasCompanionHtml, viewOverrides]);

  const designs = useMemo(() => {
    if (!doc) return [];
    if (doc.summary.designs && doc.summary.designs.length > 0) {
      return doc.summary.designs;
    }
    return extractDesignsFromProperties(doc.properties);
  }, [doc]);

  const navigateInWindow = (target: {
    path: string;
    view?: "html" | "markdown";
    fragment?: string;
  }) => {
    const normalizedTarget = normalizeDocumentPath(target.path).replace(
      /\.html$/i,
      ".md",
    );
    if (!normalizedTarget) return;

    if (
      currentEntry &&
      canonicalKey(normalizedTarget) === canonicalKey(currentEntry.path)
    ) {
      const nextView = target.view;
      if (nextView) {
        setViewOverrides((prev) => ({
          ...prev,
          [canonicalKey(normalizedTarget)]: nextView,
        }));
      }
      if (target.fragment) {
        setHistory((prev) => ({
          ...prev,
          entries: prev.entries.map((entry, idx) =>
            idx === prev.index ? { ...entry, fragment: target.fragment } : entry,
          ),
        }));
      }
      return;
    }

    setHistory((prev) => {
      const nextEntries = [
        ...prev.entries.slice(0, prev.index + 1),
        {
          path: normalizedTarget,
          view: target.view,
          fragment: target.fragment,
        },
      ].slice(-MAX_WINDOW_HISTORY_ENTRIES);
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
      };
    });
  };

  const navigateInWindowRef = useRef(navigateInWindow);
  navigateInWindowRef.current = navigateInWindow;
  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const target = parseNavigateDetail((event as CustomEvent<unknown>).detail);
      if (target) navigateInWindowRef.current(target);
    };
    window.addEventListener(DOC_WINDOW_NAVIGATE_EVENT, handleNavigate);
    return () =>
      window.removeEventListener(DOC_WINDOW_NAVIGATE_EVENT, handleNavigate);
  }, []);

  const resolvedWorkspaceId: string | null =
    payload?.workspaceId ?? workspaceId ?? null;
  // Stable identities: DesignLinksBar thumbnails refetch whenever `readAsset` changes.
  const handleOpenExternal = useCallback(
    (url: string) => {
      setExternalError(null);
      return documentsGateway.openExternal(url).catch(() => {
        setExternalError(`외부 링크를 열 수 없습니다: ${url}`);
      });
    },
    [documentsGateway],
  );
  const handleOpenExternalVoid = useCallback(
    (url: string) => void handleOpenExternal(url),
    [handleOpenExternal],
  );
  // Assets are only requested from DesignLinksBar/MarkdownDocument, which render after the
  // document payload has loaded; always read them against the workspace that served the payload.
  const assetWorkspaceId = payload?.workspaceId ?? null;
  const readWindowAsset = useCallback(
    (documentPath: string, assetPath: string) => {
      if (!documentsGateway.readStandaloneDocumentAsset) {
        return Promise.reject(new Error("시안 에셋 리더를 사용할 수 없습니다."));
      }
      if (!assetWorkspaceId) {
        return Promise.reject(new Error("문서 워크스페이스가 아직 확정되지 않았습니다."));
      }
      return documentsGateway.readStandaloneDocumentAsset(
        assetWorkspaceId,
        documentPath,
        assetPath,
      );
    },
    [assetWorkspaceId, documentsGateway],
  );

  if (!currentEntry) {
    return (
      <main className="standalone-doc-window">
        <StatusFeedback variant="content" tone="warning">
          <p>열릴 문서 경로가 지정되지 않았습니다.</p>
        </StatusFeedback>
      </main>
    );
  }

  return (
    <main className="standalone-doc-window" aria-label="문서 새 창 보기">
      <header className="standalone-doc-window__header">
        <div className="standalone-doc-window__nav">
          <IconButton
            type="button"
            label="이전 문서"
            tooltip={false}
            disabled={!canGoBack}
            onClick={() =>
              setHistory((prev) => ({
                ...prev,
                index: Math.max(0, prev.index - 1),
              }))
            }
          >
            <ArrowLeft aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            label="다음 문서"
            tooltip={false}
            disabled={!canGoForward}
            onClick={() =>
              setHistory((prev) => ({
                ...prev,
                index: Math.min(prev.entries.length - 1, prev.index + 1),
              }))
            }
          >
            <ArrowRight aria-hidden="true" />
          </IconButton>
          <div className="standalone-doc-window__title-group">
            {payload?.workspaceTitle ? (
              <span className="standalone-doc-window__workspace">
                {payload.workspaceTitle}
              </span>
            ) : null}
            <h1>{doc?.summary.title ?? currentEntry.path}</h1>
          </div>
        </div>

        <div className="standalone-doc-window__actions">
          {hasCompanionHtml ? (
            <TabsList aria-label="문서 표시 형식">
              <TabsTrigger
                selected={effectiveView === "html"}
                onClick={() =>
                  setViewOverrides((prev) => ({
                    ...prev,
                    [canonicalKey(currentEntry.path)]: "html",
                  }))
                }
              >
                사람용 보기 (.html)
              </TabsTrigger>
              <TabsTrigger
                selected={effectiveView === "markdown"}
                onClick={() =>
                  setViewOverrides((prev) => ({
                    ...prev,
                    [canonicalKey(currentEntry.path)]: "markdown",
                  }))
                }
              >
                원문 (.md)
              </TabsTrigger>
            </TabsList>
          ) : null}
          {documentsGateway.openDocumentWindow ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                void documentsGateway.openDocumentWindow?.(
                  currentEntry.path,
                  effectiveView,
                  doc?.summary.title,
                  resolvedWorkspaceId,
                )
              }
            >
              <ExternalLink aria-hidden="true" size={14} />
              새 창으로 복제
            </Button>
          ) : null}
        </div>
      </header>

      {externalError ? (
        <StatusFeedback variant="banner" tone="warning">
          <span>{externalError}</span>
        </StatusFeedback>
      ) : null}

      {docQuery.isPending ? (
        <p className="standalone-doc-window__status">문서를 불러오는 중…</p>
      ) : docQuery.isError || !doc ? (
        <StatusFeedback variant="content" tone="error">
          <p>문서를 불러오지 못했습니다. 문서가 삭제되었거나 접근할 수 없습니다.</p>
        </StatusFeedback>
      ) : (
        <div className="standalone-doc-window__content">
          {designs.length > 0 ? (
            <DesignLinksBar
              designs={designs}
              documentPath={doc.summary.path}
              readAsset={readWindowAsset}
              onOpenExternal={handleOpenExternalVoid}
            />
          ) : null}
          {effectiveView === "html" && doc.companionHtml ? (
            <CompanionHtmlFrame
              html={doc.companionHtml.html}
              title={`${doc.summary.title} 사람용 보기`}
              documentPath={doc.summary.path}
              initialFragment={currentEntry.fragment ?? null}
              onNavigateDocument={navigateInWindow}
              onOpenExternal={handleOpenExternalVoid}
            />
          ) : (
            <div className="standalone-doc-window__markdown">
              <MarkdownDocument
                document={doc}
                hideHeader
                suppressSourceTitle
                onSelectDocument={(path, view) =>
                  navigateInWindow({ path, view: view ?? "markdown" })
                }
                readAsset={readWindowAsset}
                onOpenExternal={handleOpenExternal}
                onCopyText={(value) => documentsGateway.copyText(value)}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
