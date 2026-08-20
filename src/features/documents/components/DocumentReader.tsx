import { Ellipsis, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { useDocuments } from "../DocumentsProvider";
import type { DocumentContent } from "../model";
import { MarkdownDocument } from "./MarkdownDocument";
import { DocumentHistory } from "./DocumentHistory";
import { DocumentOverview } from "./DocumentOverview";

type ContextTab = "overview" | "connections" | "history";

function lastModifiedSummary(document: DocumentContent): string {
  const commit = document.lastCommit;
  if (commit) {
    return `마지막 수정 · ${commit.authorName} · ${new Date(commit.authoredAtUnix * 1000).toLocaleDateString("ko-KR")}`;
  }
  return `마지막 수정 · ${new Date(document.summary.modifiedAtUnixMs).toLocaleDateString("ko-KR")}`;
}

export function DocumentReader({ document }: { document: DocumentContent }) {
  const {
    state,
    authoringState,
    copyText,
    openExternal,
    selectCurrentVersion,
    editSelectedDocument,
  } = useDocuments();
  const [tab, setTab] = useState<ContextTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const branch = state.branch ?? "main";
  const githubUrl = `https://github.com/${state.repositoryFullName}/blob/${branch}/${encodeURIComponent(document.summary.path)}`;

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
    <section className="document-reader" aria-labelledby="document-reader-title">
      <header
        className="document-reader__header"
        ref={headerRef}
        tabIndex={-1}
      >
        <div>
          <h1 id="document-reader-title">{document.summary.title}</h1>
          <p>확정본 · {branch}</p>
          <small>{lastModifiedSummary(document)}</small>
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
          <Button
            variant="icon"
            aria-label="더보기"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
          {menuOpen ? (
            <div className="document-reader__menu" role="menu">
              <UnstyledButton role="menuitem" onClick={() => void copyText(`[${document.summary.title}](${document.summary.path})`)}>
                문서 링크 복사
              </UnstyledButton>
              <UnstyledButton role="menuitem" onClick={() => void copyText(document.summary.path)}>
                Git 파일 경로 복사
              </UnstyledButton>
              <UnstyledButton role="menuitem" onClick={() => void openExternal(githubUrl)}>
                GitHub에서 보기
              </UnstyledButton>
            </div>
          ) : null}
        </div>
      </header>
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
          <MarkdownDocument document={document} hideHeader />
        </div>
        <Button
          variant="icon"
          className="document-reader__context-toggle"
          aria-label={contextCollapsed ? "문서 문맥 펼치기" : "문서 문맥 접기"}
          aria-controls="document-reader-context"
          aria-expanded={!contextCollapsed}
          onClick={() => setContextCollapsed((collapsed) => !collapsed)}
        >
          {contextCollapsed ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
        </Button>
        <aside
          id="document-reader-context"
          className="document-reader__context"
          aria-label="문서 문맥"
          hidden={contextCollapsed}
        >
          <TabsList className="document-reader__tabs" aria-label="문서 문맥 탭">
            <TabsTrigger selected={tab === "overview"} onClick={() => setTab("overview")}>개요</TabsTrigger>
            <TabsTrigger selected={tab === "connections"} onClick={() => setTab("connections")}>연결</TabsTrigger>
            <TabsTrigger selected={tab === "history"} onClick={() => setTab("history")}>History</TabsTrigger>
          </TabsList>
          {tab === "overview" ? (
            <DocumentOverview document={document} />
          ) : tab === "connections" ? (
            <section aria-label="연결된 항목" className="document-reader__connections">
              <h2>연결</h2>
              <p>관련 항목 파싱이 준비되면 여기에 표시됩니다.</p>
            </section>
          ) : (
            <DocumentHistory />
          )}
        </aside>
      </div>
    </section>
  );
}
