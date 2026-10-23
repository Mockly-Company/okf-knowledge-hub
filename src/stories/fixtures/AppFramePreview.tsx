import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Drawer from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, Folder, FolderOpen, House, Minus, PanelLeft, Settings, Square, SquareKanban, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { HomePage } from "@/pages/HomePage";
import { DocumentsFlowPreview, type DocumentFlowLocation, type ReviewState } from "./DocumentsFlowPreview";
import type { HomeTaskState, ReviewTask } from "@/pages/home/HomeTasks";
import { homeTaskExample, homeInsightExample } from "./home-tasks";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DocumentTree } from "@/features/documents/components/DocumentTree";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import type { DocumentContent } from "@/features/documents/model";
import { documentTitle } from "@/features/documents/document-markdown";
import { DocumentReviewPreview } from "./DocumentReviewPreview";
import { documentCollaborationExample as example } from "./document-collaboration-example";
import { documentFixtures } from "./documents";
import "./app-frame-preview.css";
import { FrameAccount } from "./FrameAccount";

export type FrameScreen = "home" | "documents" | "detail" | "editor" | "review";
type View = FrameScreen | "project" | "settings";
type Visit = { view: View; baseline: boolean; review?: ReviewTask | null; path?: string };
const menus = [
  { key: "home", label: "Home", Icon: House },
  { key: "documents", label: "Documents", Icon: FolderOpen },
  { key: "project", label: "Project", Icon: SquareKanban },
  { key: "settings", label: "Settings", Icon: Settings },
] as const;
const query = "(max-width: 1023px)";
function subscribe(callback: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", callback);
  return () => media?.removeEventListener("change", callback);
}
const narrowSnapshot = () => window.matchMedia?.(query).matches ?? false;
const catalog = documentFixtures.catalog(documentFixtures.mapSearchApi());
const buildInfo = { getBuildInfo: async () => ({ mode: "development" as const, branch: "storybook-preview", commit: "preview", dirty: false, credentialBackend: "system keychain" }) };

/** Presentation prototype only: no operational shell, routing, disk or Git mutations. */
export function AppFramePreview({ screen = "home", initialCollapsed = false, platform = "macos", homeState = "ready", homeListSize = "few", homeInsightState = "ready", documentReviewState = "pending" }: { screen?: FrameScreen; initialCollapsed?: boolean; platform?: "macos" | "windows"; homeState?: HomeTaskState; homeListSize?: "few" | "many"; homeInsightState?: HomeTaskState; documentReviewState?: ReviewState | "none" }) {
  const narrow = useSyncExternalStore(subscribe, narrowSnapshot, () => false);
  const [history, setHistory] = useState<{ entries: Visit[]; index: number }>({ entries: [{ view: screen, baseline: false }], index: 0 });
  const { view, baseline: viewingBaseline, review: homeReview = null } = history.entries[history.index];
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navigationSelected = useRef(false);
  const navigationId = useId();
  const docs = useDocuments();
  useEffect(() => setHistory({ entries: [{ view: screen, baseline: false }], index: 0 }), [screen]);
  useEffect(() => setCollapsed(initialCollapsed), [initialCollapsed]);
  useEffect(() => setMobileOpen(false), [narrow]);
  const documentView = view === "documents" || view === "detail" || view === "editor" || view === "review";
  const choose = (next: View, baseline?: boolean, review?: ReviewTask | null, path?: string) => {
    setHistory(current => {
      const previous = current.entries[current.index];
      const visit = { view: next, baseline: baseline ?? previous.baseline, review: review === undefined ? next === "review" ? previous.review : null : review, path };
      if (visit.view === previous.view && visit.baseline === previous.baseline && visit.review?.id === previous.review?.id && visit.path === previous.path) return current;
      return { entries: [...current.entries.slice(0, current.index + 1), visit], index: current.index + 1 };
    });
    if (narrow && mobileOpen) { navigationSelected.current = true; setMobileOpen(false); }
  };
  const visibleMarkdown = viewingBaseline ? example.baseline : example.proposal;
  const documentRequest = useMemo<DocumentFlowLocation | undefined>(() => {
    const visit = history.entries[history.index];
    return documentView && !visit.review ? { view: visit.view as DocumentFlowLocation["view"], path: visit.path, baseline: visit.baseline } : undefined;
  }, [history, documentView]);
  const homeTasks = homeTaskExample(homeState, homeListSize);
  const reviewTitle = homeReview?.title ?? "지도 검색 API 계약";
  const sampleReview = homeReview && homeReview.id !== "map-search-review";
  const reviewMarkdown = sampleReview ? `# ${reviewTitle}\n\n이 문서는 홈 목록 탐색을 위한 검토 예시입니다.\n\n## 변경 내용\n\n${reviewTitle}에 대한 검토를 요청합니다.` : example.proposal;
  const reviewBaseline = sampleReview ? `# ${reviewTitle}\n\n## 변경 내용\n\n기존 정책을 유지합니다.` : example.baseline;
  const content: DocumentContent = {
    summary: { ...documentFixtures.mapSearchApi(), title: documentTitle(visibleMarkdown) },
    markdown: visibleMarkdown, properties: {}, tableOfContents: example.tableOfContents, lastCommit: null,
  };
  function navigation(rail: boolean) {
    return <div className={`frame-prototype__navigation${rail ? " frame-prototype__navigation--rail" : ""}`}>
      <nav aria-label="앱 탐색">
        {menus.map(({ key, label, Icon }) => {
          const active = key === "documents" ? documentView : key === view;
          const button = <Button variant="ghost" type="button" aria-label={label} aria-current={active ? "page" : undefined} onClick={() => choose(key)} className="frame-prototype__menu"><Icon aria-hidden="true" size={20} strokeWidth={1.75} />{!rail && <span>{label}</span>}</Button>;
          return rail ? <Tooltip key={key} content={label}>{button}</Tooltip> : <span key={key}>{button}</span>;
        })}
      </nav>
      {documentView && !rail ? <div className="frame-prototype__tree" role="region" aria-label="문서 탐색"><DocumentTree entries={catalog.roots} selectedPath={history.entries[history.index].path ?? (view === "documents" ? null : example.path)} onSelectDocument={path => choose("detail", true, null, path)} /></div> : null}
      <FrameAccount collapsed={rail} />
    </div>;
  }
  return <Drawer.Root open={narrow && mobileOpen} onOpenChange={setMobileOpen}>
    <div className="frame-prototype" data-rail={!narrow && collapsed} data-platform={platform}>
      <header className="frame-prototype__topbar">
        <div className="frame-prototype__titlebar-start">
        {!narrow && platform === "macos" && <span className="frame-prototype__window-controls" role="img" aria-label="macOS 창 제어 예시"><span /><span /><span /></span>}
        <div className="frame-prototype__toolbar" role="group" aria-label="화면 탐색">
          {!narrow && <>
            <IconButton label="뒤로 가기" disabled={history.index === 0} onClick={() => setHistory(current => ({ ...current, index: Math.max(0, current.index - 1) }))}><ArrowLeft aria-hidden="true" /></IconButton>
            <IconButton label="앞으로 가기" disabled={history.index === history.entries.length - 1} onClick={() => setHistory(current => ({ ...current, index: Math.min(current.entries.length - 1, current.index + 1) }))}><ArrowRight aria-hidden="true" /></IconButton>
          </>}
          <IconButton ref={toggleRef} label={narrow ? "탐색 메뉴 열기" : collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-controls={navigationId} aria-expanded={narrow ? mobileOpen : !collapsed} onClick={() => narrow ? setMobileOpen(true) : setCollapsed(value => !value)}>
            <PanelLeft aria-hidden="true" />
          </IconButton>
        </div>
        </div>
        <span className="frame-prototype__workspace">{!narrow && <Folder aria-hidden="true" size={18} strokeWidth={1.75} />}<span>Mockly</span></span>
        {!narrow && platform === "windows" && <span className="frame-prototype__windows-controls" role="img" aria-label="Windows 창 제어 예시"><Minus aria-hidden="true" /><Square aria-hidden="true" /><X aria-hidden="true" /></span>}
      </header>
      <div className="frame-prototype__layout">
        {!narrow && <aside id={navigationId} className="frame-prototype__sidebar">{navigation(collapsed)}</aside>}
        <main ref={mainRef} tabIndex={-1} aria-label="작업 공간" className="frame-prototype__main">
          {view === "home" && <HomePage tasks={homeTasks} insights={homeInsightExample(homeInsightState)} onOpenReview={id => choose("review", undefined, homeTasks.reviews.find(review => review.id === id) ?? null)} onOpenDocuments={() => { docs.showDocumentsHome(); choose("documents"); }} />}
          <div className="frame-prototype__documents" hidden={!documentView || !!homeReview}><DocumentsFlowPreview key={documentReviewState} reviewState={documentReviewState} request={documentRequest} onNavigate={documentView && !homeReview ? location => choose(location.view, location.baseline, null, location.path) : undefined} /></div>
          {view === "project" && <ProjectPage />}
          {view === "settings" && <SettingsPage buildInfoGateway={buildInfo} />}
          {view === "review" && homeReview && <DocumentReviewPreview key={homeReview.id} prNumber={homeReview.number} requesterName={homeReview.requester} document={{ ...content, markdown: reviewMarkdown, summary: { ...content.summary, title: reviewTitle, path: sampleReview ? `docs/review-examples/pr-${homeReview.number}.md` : content.summary.path } }} baselineMarkdown={reviewBaseline} />}
        </main>
      </div>
    </div>
    {narrow && <Drawer.Portal><Drawer.Overlay className="frame-prototype__scrim" onPointerDown={event => { if (event.target === event.currentTarget) setMobileOpen(false); }} /><Drawer.Content id={navigationId} className="frame-prototype__drawer" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); if (navigationSelected.current) mainRef.current?.focus(); else toggleRef.current?.focus(); navigationSelected.current = false; }}>
      <div className="frame-prototype__drawer-heading"><Drawer.Title>탐색 메뉴</Drawer.Title><Drawer.Close asChild><IconButton label="탐색 메뉴 닫기" tooltip={false}><X aria-hidden="true" /></IconButton></Drawer.Close></div>
      {navigation(false)}
    </Drawer.Content></Drawer.Portal>}
  </Drawer.Root>;
}
