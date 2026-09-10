import { Ellipsis, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
}: {
  document: DocumentContent;
  notice?: string | null;
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
  const headerRef = useRef<HTMLElement>(null);
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

  return (
    <section className="document-reader" aria-labelledby={readerTitleId}>
      <header
        className="document-reader__header"
        ref={headerRef}
        tabIndex={-1}
      >
        <div className="document-reader__heading">
          <h1 id={readerTitleId}>{document.summary.title}</h1>
          <div className="document-reader__meta">
            <p>확정본 · {branch}</p>
            <small>{lastModifiedSummary(document)}</small>
          </div>
        </div>
        <div className="document-reader__actions">
          {state.selectedVersion === null ? (
            <Button
              disabled={authoringState.existingEdit.status === "opening"}
              onClick={editSelectedDocument}
            >
              {authoringState.existingEdit.status === "opening"
                ? "편집 준비 중…"
                : "편집"}
            </Button>
          ) : null}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton label="더보기" tooltip={false}>
                <Ellipsis aria-hidden="true" />
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
        </div>
      </header>
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
      <div
        className={`document-reader__layout${contextCollapsed ? " document-reader__layout--context-collapsed" : ""}`}
      >
        <div className="document-reader__canvas">
          <MarkdownDocument document={document} hideHeader suppressSourceTitle />
        </div>
        <IconButton
          className="document-reader__context-toggle"
          label={contextCollapsed ? "문서 문맥 펼치기" : "문서 문맥 접기"}
          aria-controls="document-reader-context"
          aria-expanded={!contextCollapsed}
          onClick={() => setContextCollapsed((collapsed) => !collapsed)}
        >
          {contextCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
        </IconButton>
        <aside
          id="document-reader-context"
          className="document-reader__context"
          aria-label="문서 문맥"
          hidden={contextCollapsed}
        >
          <TabsList className="document-reader__tabs" aria-label="문서 문맥 탭">
            <TabsTrigger selected={tab === "overview"} onClick={() => setTab("overview")}>개요</TabsTrigger>
            <TabsTrigger selected={tab === "history"} onClick={() => setTab("history")}>History</TabsTrigger>
          </TabsList>
          {tab === "overview" ? (
            <DocumentOverview document={document} />
          ) : (
            <DocumentHistory />
          )}
        </aside>
      </div>
    </section>
  );
}
