import { EllipsisVertical, ExternalLink, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setPendingAiLaunch } from "@/features/ai/pendingAiLaunch";
import { usePreferences } from "@/features/preferences/PreferencesProvider";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocuments } from "../DocumentsProvider";
import { normalizeDocumentPath, type DocumentContent } from "../model";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { CompanionHtmlFrame } from "./CompanionHtmlFrame";
import { DesignLinksBar, extractDesignsFromProperties } from "./DesignLinksBar";
import { MarkdownDocument } from "./MarkdownDocument";
import { DocumentHistory } from "./DocumentHistory";
import { DocumentOverview } from "./DocumentOverview";

function ReaderRouterRedirect({
  to,
  onNavigated,
}: {
  to: string;
  onNavigated: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
    onNavigated();
  }, [navigate, to, onNavigated]);
  return null;
}

type ContextTab = "overview" | "history";

const narrowQuery = "(max-width: 760px)";
function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia?.(narrowQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
function isNarrowScreen() { return window.matchMedia?.(narrowQuery).matches ?? false; }

function lastModifiedSummary(document: DocumentContent): string {
  const commit = document.lastCommit;
  if (commit) {
    return `마지막 수정 · ${commit.authorName} · ${new Date(commit.authoredAtUnix * 1000).toLocaleDateString("ko-KR")}`;
  }
  return `마지막 수정 · ${new Date(document.summary.modifiedAtUnixMs).toLocaleDateString("ko-KR")}`;
}

export function DocumentReader({
  document,
  notice,
  headerMetadata,
  navigation,
  onEdit,
  versionLabel,
}: {
  document: DocumentContent;
  notice?: string | null;
  headerMetadata?: ReactNode;
  navigation?: ReactNode;
  onEdit?(): void;
  versionLabel?: string;
}) {
  const inRouterContext = useInRouterContext();
  const {
    state,
    authoringState,
    preferredViewMode,
    preferredViewTargetPath,
    clearPreferredViewMode,
    copyText,
    openExternal,
    readAsset,
    selectDocument,
    selectCurrentVersion,
    editSelectedDocument,
    openDocumentInNewWindow,
  } = useDocuments();
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();
  const [tab, setTab] = useState<ContextTab>("overview");
  const [pendingHtmlFragment, setPendingHtmlFragment] = useState<{
    targetPath: string;
    fragment: string;
    seq: number;
  } | null>(null);
  const normalizedDocPath = normalizeDocumentPath(document.summary.path);
  const hasCompanionNow = Boolean(document.companionHtml);
  const matchingPreferredView =
    preferredViewTargetPath !== null &&
    preferredViewTargetPath.toLowerCase() === normalizedDocPath.toLowerCase()
      ? preferredViewMode
      : null;
  const [viewMode, setViewMode] = useState<"html" | "markdown">(() =>
    matchingPreferredView === "markdown"
      ? "markdown"
      : hasCompanionNow
        ? "html"
        : "markdown",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigateTarget, setNavigateTarget] = useState<string | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const isNarrow = useSyncExternalStore(subscribeNarrow, isNarrowScreen, () => false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const readerRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const navigationTargetRef = useRef<string | null>(null);
  const pendingHeadingRef = useRef<{ docPath: string; id: string } | null>(null);
  const lastDocumentPathRef = useRef(normalizedDocPath);
  const hadCompanionHtmlRef = useRef(hasCompanionNow);
  useEffect(() => { if (!isNarrow) setMobileContextOpen(false); }, [isNarrow]);
  useEffect(() => {
    const pathChanged = lastDocumentPathRef.current !== normalizedDocPath;
    const companionAdded = !hadCompanionHtmlRef.current && hasCompanionNow;
    lastDocumentPathRef.current = normalizedDocPath;
    hadCompanionHtmlRef.current = hasCompanionNow;
    if (pathChanged) {
      pendingHeadingRef.current = null;
    }

    if (state.selectedVersion !== null) {
      return;
    }

    if (matchingPreferredView !== null) {
      setViewMode(
        matchingPreferredView === "markdown"
          ? "markdown"
          : hasCompanionNow
            ? "html"
            : "markdown",
      );
      clearPreferredViewMode(normalizedDocPath);
      return;
    }

    if (pathChanged) {
      setViewMode(hasCompanionNow ? "html" : "markdown");
    } else if (companionAdded) {
      setViewMode("html");
    }
  }, [
    clearPreferredViewMode,
    hasCompanionNow,
    matchingPreferredView,
    normalizedDocPath,
    state.selectedVersion,
  ]);

  const handleStartAiFromDoc = () => {
    setPendingAiLaunch({
      request: {
        documentPath: document.summary.path,
        repositoryFullName: state.repositoryFullName || null,
      },
      label: `${document.summary.title} (${document.summary.path})`,
      layer: "planning",
      targetDescription: "문서 저장소 격리 worktree",
    });
    if (inRouterContext) {
      setNavigateTarget("/ai");
    }
  };
  const hasCompanionHtml = hasCompanionNow && state.selectedVersion === null;
  const effectiveView = hasCompanionHtml ? viewMode : "markdown";
  useEffect(() => {
    const currentDocKey = normalizedDocPath.toLowerCase();
    const pending = pendingHeadingRef.current;
    if (!pending) return;
    if (pending.docPath !== currentDocKey) {
      pendingHeadingRef.current = null;
      return;
    }
    if (effectiveView !== "markdown") return;
    const pendingId = pending.id;
    const frame = window.requestAnimationFrame(() => {
      if (
        pendingHeadingRef.current?.docPath === currentDocKey &&
        pendingHeadingRef.current?.id === pendingId
      ) {
        pendingHeadingRef.current = null;
      }
      if (lastDocumentPathRef.current.toLowerCase() !== currentDocKey) return;
      const reader = readerRef.current;
      const target = reader?.ownerDocument.getElementById(pendingId);
      if (!target || !reader?.contains(target)) return;
      const canvas = reader.querySelector<HTMLElement>(".document-reader__canvas");
      if (
        canvas &&
        /(auto|scroll)/.test(getComputedStyle(canvas).overflowY) &&
        canvas.scrollHeight > canvas.clientHeight
      ) {
        const offset = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        const desired =
          canvas.scrollTop +
          target.getBoundingClientRect().top -
          canvas.getBoundingClientRect().top -
          offset;
        const nextScrollTop = Math.max(
          0,
          Math.min(desired, canvas.scrollHeight - canvas.clientHeight),
        );
        if (typeof canvas.scrollTo === "function") {
          canvas.scrollTo({ top: nextScrollTop, behavior: "auto" });
        } else {
          canvas.scrollTop = nextScrollTop;
        }
        return;
      }
      target.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [effectiveView, normalizedDocPath]);
  const headerRef = useRef<HTMLElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const contextCloseRef = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(contextCollapsed);
  useEffect(() => {
    if (previousCollapsed.current !== contextCollapsed) (contextCollapsed ? contextToggleRef : contextCloseRef).current?.focus({preventScroll: true});
    previousCollapsed.current = contextCollapsed;
  }, [contextCollapsed]);
  const branch = state.branch ?? "main";
  const sourceLabel = state.selectedVersion
    ? `커밋 · ${state.selectedVersion.commitOid.slice(0, 7)}`
    : `${authoringState.activeChangeId === null ? "확정본" : "로컬 초안"} · ${branch}`;
  const githubUrl = `https://github.com/${state.repositoryFullName}/blob/${branch}/${encodeURIComponent(document.summary.path)}`;
  const firstTocEntry = document.tableOfContents[0];
  const readerTitleId =
    firstTocEntry?.level === 1 &&
    firstTocEntry.title.trim() === document.summary.title.trim()
      ? firstTocEntry.id
      : "document-reader-title";
  const changeDisplayDensity = (nextDensity: DisplayDensity) => {
    if (isLoading) return;

    void setDisplayDensity(nextDensity).catch(() => {});
  };

  useEffect(() => {
    const searchMatch = state.selectedSearchMatch;
    if (!searchMatch || searchMatch.matchField === "body") return;
    const frame = window.requestAnimationFrame(() => {
      const header = headerRef.current;
      header?.scrollIntoView?.({ block: "center" });
      header?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [normalizedDocPath, state.selectedSearchMatch]);

  const contextContents = <>
    <div className="document-reader__context-header">
      <TabsList className="document-reader__tabs" aria-label="문서 문맥 탭">
        <TabsTrigger selected={tab === "overview"} onClick={() => setTab("overview")}>개요</TabsTrigger>
        <TabsTrigger selected={tab === "history"} onClick={() => setTab("history")}>History</TabsTrigger>
      </TabsList>
      <IconButton ref={contextCloseRef} label={isNarrow ? "문서 문맥 닫기" : "문서 문맥 접기"} tooltip={false} aria-controls="document-reader-context" aria-expanded onClick={() => isNarrow ? setMobileContextOpen(false) : setContextCollapsed(true)}><PanelRightClose aria-hidden="true" /></IconButton>
    </div>
    {tab === "overview" ? (
      <DocumentOverview
        document={document}
        readerRef={readerRef}
        onNavigate={
          isNarrow
            ? (id) => {
                navigationTargetRef.current = id;
                setMobileContextOpen(false);
              }
            : undefined
        }
        onRequestHeading={(id) => {
          if (effectiveView === "html") {
            pendingHeadingRef.current = {
              docPath: normalizedDocPath.toLowerCase(),
              id,
            };
            setViewMode("markdown");
          }
        }}
      />
    ) : (
      <DocumentHistory />
    )}
  </>;

  return (
    <section ref={readerRef} className="document-reader" aria-labelledby={readerTitleId}>
      <div
        className={`document-reader__layout${contextCollapsed || isNarrow ? " document-reader__layout--context-collapsed" : ""}${isNarrow ? " document-reader__layout--narrow" : ""}`}
      >
        <div className="document-reader__canvas" tabIndex={0} role="region" aria-label="문서 읽기 영역">
      {navigation}
      <header
        className="document-reader__header"
        ref={headerRef}
        tabIndex={-1}
      >
        <div className="document-reader__heading">
          <h1 id={readerTitleId}>{document.summary.title}</h1>
          <div className="document-reader__meta">
            <p>{versionLabel ?? sourceLabel}</p>
            <small>{lastModifiedSummary(document)}</small>
          </div>
        </div>
        <div className="document-reader__actions">
          {hasCompanionHtml ? (
            <TabsList className="document-reader__view-tabs" aria-label="문서 표시 형식">
              <TabsTrigger
                selected={effectiveView === "html"}
                onClick={() => setViewMode("html")}
              >
                사람용 보기 (.html)
              </TabsTrigger>
              <TabsTrigger
                selected={effectiveView === "markdown"}
                onClick={() => setViewMode("markdown")}
              >
                원문 (.md)
              </TabsTrigger>
            </TabsList>
          ) : null}
          {state.selectedVersion === null ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void openDocumentInNewWindow(
                    document.summary.path,
                    effectiveView,
                    document.summary.title,
                  )
                }
              >
                <ExternalLink aria-hidden="true" size={14} />
                새 창으로 열기
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleStartAiFromDoc}
              >
                AI로 작업 시작
              </Button>
              <Button
                disabled={authoringState.existingEdit.status === "opening"}
                onClick={onEdit ?? editSelectedDocument}
              >
                {authoringState.existingEdit.status === "opening"
                  ? "편집 준비 중…"
                  : "편집"}
              </Button>
            </>
          ) : null}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton label="더보기" tooltip={false}>
                <EllipsisVertical aria-hidden="true" strokeWidth={1.75} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>보기 밀도</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={displayDensity}
                  >
                    <DropdownMenuRadioItem
                      value="default"
                      disabled={isLoading}
                      onSelect={() => changeDisplayDensity("default")}
                    >
                      편안하게
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="compact"
                      disabled={isLoading}
                      onSelect={() => changeDisplayDensity("compact")}
                    >
                      작게
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => void copyText(`[${document.summary.title}](${document.summary.path})`)}>
                문서 링크 복사
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText(document.summary.path)}>
                Git 파일 경로 복사
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openExternal(githubUrl)}>
                GitHub에서 보기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isNarrow ? <IconButton ref={mobileTriggerRef} label="문서 문맥 펼치기" tooltip={false} aria-haspopup="dialog" aria-expanded={mobileContextOpen} onClick={() => { navigationTargetRef.current = null; setMobileContextOpen(true); }}><PanelRightOpen aria-hidden="true" /></IconButton> : null}
        </div>
      </header>
      {headerMetadata}
      {notice ? (
        <div className="documents-page__notice" role="alert">
          <span>{notice}</span>
        </div>
      ) : null}
      {authoringState.existingEdit.error ? (
        <div className="document-reader__warning" role="alert">
          <strong>편집을 시작하지 못했습니다.</strong>
          <span>{authoringState.existingEdit.error.message}</span>
        </div>
      ) : null}
      {state.selectedVersion ? (
        <div className="document-reader__historical-version">
          <span>과거 버전 · {state.selectedVersion.commitOid.slice(0, 7)}</span>
          <Button variant="secondary" onClick={selectCurrentVersion}>
            현재 문서로 돌아가기
          </Button>
        </div>
      ) : null}
      {document.summary.frontmatterStatus.status === "invalid" ? (
        <div className="document-reader__warning" role="alert">
          <strong>frontmatter를 읽을 수 없습니다.</strong>
          <span>본문은 계속 표시됩니다</span>
        </div>
      ) : null}
      {state.selectedVersion === null && document.htmlSyncStatus === "outdated" ? (
        <div className="document-reader__warning" role="status">
          <strong>사람용 .html 뷰가 .md 원본보다 오래되었습니다.</strong>
          <span>최신 내용은 원문 (.md)에서 확인하고 다음 PR에서 함께 갱신해 주세요.</span>
        </div>
      ) : null}
          {state.selectedVersion === null &&
          ((document.summary.designs?.length ?? 0) > 0 ||
            extractDesignsFromProperties(document.properties).length > 0) ? (
            <DesignLinksBar
              designs={
                document.summary.designs && document.summary.designs.length > 0
                  ? document.summary.designs
                  : extractDesignsFromProperties(document.properties)
              }
              documentPath={document.summary.path}
              readAsset={readAsset}
              onOpenExternal={(url) => void openExternal(url)}
            />
          ) : null}
          {effectiveView === "html" && document.companionHtml ? (
            <CompanionHtmlFrame
              html={document.companionHtml.html}
              title={`${document.summary.title} 사람용 보기`}
              documentPath={document.summary.path}
              initialFragment={
                pendingHtmlFragment &&
                pendingHtmlFragment.targetPath.toLowerCase() ===
                  normalizedDocPath.toLowerCase()
                  ? pendingHtmlFragment.fragment
                  : null
              }
              onNavigateDocument={(target) => {
                const normalizedTarget = normalizeDocumentPath(target.path);
                setPendingHtmlFragment(
                  target.fragment
                    ? {
                        targetPath: normalizedTarget,
                        fragment: target.fragment,
                        seq: Date.now(),
                      }
                    : null,
                );
                if (
                  normalizedTarget.toLowerCase() ===
                  normalizedDocPath.toLowerCase()
                ) {
                  setViewMode(
                    target.view === "html" && hasCompanionNow
                      ? "html"
                      : "markdown",
                  );
                  return;
                }
                selectDocument(normalizedTarget, undefined, target.view);
              }}
              onOpenExternal={(url) => void openExternal(url)}
            />
          ) : (
            <MarkdownDocument document={document} hideHeader suppressSourceTitle />
          )}
        </div>
        {contextCollapsed && !isNarrow ? <IconButton
          ref={contextToggleRef}
          tooltip={false}
          className="document-reader__context-toggle"
          label={contextCollapsed ? "문서 문맥 펼치기" : "문서 문맥 접기"}
          aria-controls="document-reader-context"
          aria-expanded={!contextCollapsed}
          onClick={() => setContextCollapsed((collapsed) => !collapsed)}
        >
          {contextCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
        </IconButton> : null}
        {!isNarrow ? <aside
          id="document-reader-context"
          className="document-reader__context"
          aria-label="문서 문맥"
          hidden={contextCollapsed}
        >
          {contextContents}
        </aside> : null}
      </div>
      {isNarrow ? <Dialog open={mobileContextOpen} onOpenChange={setMobileContextOpen}>
        <DialogContent className="document-reader__context-dialog" aria-label="문서 문맥" aria-describedby={undefined} onCloseAutoFocus={event => {
          event.preventDefault();
          const target = navigationTargetRef.current ? readerRef.current?.ownerDocument.getElementById(navigationTargetRef.current) : null;
          navigationTargetRef.current = null;
          if (target) { target.setAttribute("tabindex", "-1"); target.focus({preventScroll: true}); }
          else mobileTriggerRef.current?.focus({preventScroll: true});
        }}>
          <DialogTitle className="sr-only">문서 문맥</DialogTitle>
          <DialogBody id="document-reader-context" className="document-reader__context-scroll">{contextContents}</DialogBody>
        </DialogContent>
      </Dialog> : null}
      {inRouterContext && navigateTarget ? (
        <ReaderRouterRedirect
          to={navigateTarget}
          onNavigated={() => setNavigateTarget(null)}
        />
      ) : null}
    </section>
  );
}
