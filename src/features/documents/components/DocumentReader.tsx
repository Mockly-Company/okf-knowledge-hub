import { EllipsisVertical, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { usePreferences } from "@/features/preferences/PreferencesProvider";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocuments } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { MarkdownDocument } from "./MarkdownDocument";
import { DocumentHistory } from "./DocumentHistory";
import { DocumentOverview } from "./DocumentOverview";

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
  const {
    state,
    authoringState,
    copyText,
    openExternal,
    selectCurrentVersion,
    editSelectedDocument,
  } = useDocuments();
  const { displayDensity, isLoading, setDisplayDensity } = usePreferences();
  const [tab, setTab] = useState<ContextTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const isNarrow = useSyncExternalStore(subscribeNarrow, isNarrowScreen, () => false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const readerRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const navigationTargetRef = useRef<string | null>(null);
  useEffect(() => { if (!isNarrow) setMobileContextOpen(false); }, [isNarrow]);
  const headerRef = useRef<HTMLElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const contextCloseRef = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(contextCollapsed);
  useEffect(() => {
    if (previousCollapsed.current !== contextCollapsed) (contextCollapsed ? contextToggleRef : contextCloseRef).current?.focus({preventScroll: true});
    previousCollapsed.current = contextCollapsed;
  }, [contextCollapsed]);
  const branch = state.branch ?? "main";
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
  }, [document.summary.path, state.selectedSearchMatch]);

  const contextContents = <>
    <div className="document-reader__context-header">
      <TabsList className="document-reader__tabs" aria-label="문서 문맥 탭">
        <TabsTrigger selected={tab === "overview"} onClick={() => setTab("overview")}>개요</TabsTrigger>
        <TabsTrigger selected={tab === "history"} onClick={() => setTab("history")}>History</TabsTrigger>
      </TabsList>
      <IconButton ref={contextCloseRef} label={isNarrow ? "문서 문맥 닫기" : "문서 문맥 접기"} tooltip={false} aria-controls="document-reader-context" aria-expanded onClick={() => isNarrow ? setMobileContextOpen(false) : setContextCollapsed(true)}><PanelRightClose aria-hidden="true" /></IconButton>
    </div>
    {tab === "overview" ? <DocumentOverview document={document} readerRef={readerRef} onNavigate={isNarrow ? id => { navigationTargetRef.current = id; setMobileContextOpen(false); } : undefined} /> : <DocumentHistory />}
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
            <p>{versionLabel ?? `확정본 · ${branch}`}</p>
            <small>{lastModifiedSummary(document)}</small>
          </div>
        </div>
        <div className="document-reader__actions">
          {state.selectedVersion === null ? (
            <Button
              disabled={authoringState.existingEdit.status === "opening"}
              onClick={onEdit ?? editSelectedDocument}
            >
              {authoringState.existingEdit.status === "opening"
                ? "편집 준비 중…"
                : "편집"}
            </Button>
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
          <MarkdownDocument document={document} hideHeader suppressSourceTitle />
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
    </section>
  );
}
