import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, ExternalLink, GitPullRequest, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { StatusBadge, type StatusTone } from "@/components/patterns/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogCloseButton, DialogBody } from "@/components/ui/dialog";
import { MarkdownDocument } from "@/features/documents/components/MarkdownDocument";
import { compareDocumentLines, type DocumentDiffLine } from "@/features/documents/document-diff";
import type { DocumentContent } from "@/features/documents/model";
import { PublicationSuccessToast } from "./PublicationSuccessToast";
import { useReviewPanelWidth } from "./useReviewPanelWidth";
import { collaborationReviewComment, documentCollaborationExample } from "./document-collaboration-example";
import "@/features/documents/documents.css";
import "@/features/documents/components/DocumentPublicationDialog.css";
import "./document-review.css";

export interface DocumentReviewPreviewProps {
  document?: DocumentContent;
  baselineMarkdown?: string;
  prNumber?: number;
  requestNote?: string;
  requesterName?: string;
  onReviewSubmitted?(intent: "comment" | "approve" | "request_changes", body: string): void;
  initialRecords?: { intent: "comment" | "approve" | "request_changes"; body: string; name?: string; time?: string }[];
  showExampleRecord?: boolean;
  navigation?: import("react").ReactNode;
  view?: "document" | "diff";
  reviewState?: "pending" | "changes_requested" | "approved" | "closed" | "merged";
  viewer?: "reviewer" | "author" | "read_only";
  loadState?: "ready" | "loading" | "error";
  submissionFails?: boolean;
  versionChanged?: boolean;
}

type ReviewState = NonNullable<DocumentReviewPreviewProps["reviewState"]>;
type ReviewIntent = "comment" | "approve" | "request_changes";
const labels: Record<ReviewState, string> = { pending: "검토 대기중", changes_requested: "수정 요청됨", approved: "검토 승인됨", closed: "검토 종료", merged: "발행 완료" };
const tones: Record<ReviewState, StatusTone> = { pending: "info", changes_requested: "warning", approved: "success", closed: "neutral", merged: "success" };
const intentLabels: Record<ReviewIntent, string> = { comment: "의견 남기기", approve: "승인", request_changes: "수정 요청" };
const recordLabels: Record<ReviewIntent, string> = { comment: "의견", approve: "승인", request_changes: "수정 요청" };

/** Keep each review pane's scrollbar visible only while that pane is moving. */
function useReviewScrollActivity() {
  const [scrolling, setScrolling] = useState(false);
  const timeout = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timeout.current), []);
  return {
    "data-scrolling": scrolling,
    onScroll: () => {
      setScrolling(true);
      window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => setScrolling(false), 700);
    },
  };
}

function ReviewRecord({ name, role, time, intent, body }: { name: string; role?: string; time: string; intent: ReviewIntent; body?: string }) {
  const Icon = intent === "comment" ? MessageSquare : intent === "approve" ? CircleCheck : CircleAlert;
  return <article aria-label={`${name}의 ${recordLabels[intent]}`}>
    <header>
      <span className="document-review__record-identity"><strong>{name}</strong></span>{role ? <span>{role}</span> : null}
      <span className="document-review__record-kind" data-intent={intent}>
        <Icon aria-hidden="true" size={14} strokeWidth={1.75} /><span>{recordLabels[intent]}</span>
      </span>
      <time>{time}</time>
    </header>
    {body ? <p>{body}</p> : null}
  </article>;
}
const before = documentCollaborationExample.baseline;
const after = documentCollaborationExample.proposal;
const proposal: DocumentContent = { summary: { path: "docs/api/map-search.md", fileName: "map-search.md", title: "지도 검색 API 계약", documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: 0, size: after.length }, markdown: after, properties: {}, tableOfContents: [], lastCommit: null };

function DiffCell({ line, side, otherNumber }: { line: DocumentDiffLine | null; side: "before" | "after"; otherNumber?: number }) {
  return <div className={`document-source-diff__cell document-source-diff__cell--${side}`} data-kind={line?.kind ?? "gap"}>
    <span className="document-source-diff__number" aria-hidden="true">{line?.number}</span>
    <span className="document-source-diff__other-number" aria-hidden="true">{otherNumber}</span>
    <span className="document-source-diff__marker" aria-hidden="true">{line?.kind === "removed" ? "−" : line?.kind === "added" ? "+" : ""}</span>
    <span className="document-source-diff__text">{line?.kind === "removed" ? <span className="sr-only">삭제: </span> : line?.kind === "added" ? <span className="sr-only">추가: </span> : null}{line?.text || " "}</span>
  </div>;
}

/** In-memory Storybook fixture only. Does not call GitHub or modify a document. */
export function DocumentReviewPreview({ document = proposal, baselineMarkdown = before, prNumber = 42, requesterName = "Kim", requestNote = documentCollaborationExample.requestNote, onReviewSubmitted, initialRecords = [collaborationReviewComment], showExampleRecord = true, navigation, view = "document", reviewState = "pending", viewer = "reviewer", loadState = "ready", submissionFails = false, versionChanged = false }: DocumentReviewPreviewProps) {
  const id = useId();
  const [activeView, setActiveView] = useState(view);
  const [localState, setLocalState] = useState<ReviewState | null>(null);
  const [opinion, setOpinion] = useState("");
  const [intent, setIntent] = useState<ReviewIntent>("comment");
  const [records, setRecords] = useState<{ id: number; intent: ReviewIntent; body: string; name?: string; time?: string }[]>(() => initialRecords.map((record, index) => ({ ...record, id: index + 1 })));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const canvasScroll = useReviewScrollActivity();
  const panelScroll = useReviewScrollActivity();
  const drawerScroll = useReviewScrollActivity();
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 960px)").matches);
  const [retried, setRetried] = useState(false);
  const host = useRef<HTMLElement>(null);
  const panelSize = useReviewPanelWidth(narrow, host, loadState === "ready" || retried);
  useEffect(() => setActiveView(view), [view]);
  useEffect(() => setLocalState(null), [reviewState]);
  useEffect(() => setRetried(false), [loadState]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 960px)");
    const update = () => { setNarrow(query.matches); if (!query.matches) setPanelOpen(false); };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const state = localState ?? reviewState;
  const terminal = state === "closed" || state === "merged";
  const canSubmit = !busy && !terminal && viewer !== "read_only" && !versionChanged && (intent === "comment" || viewer === "reviewer") && (intent === "approve" || Boolean(opinion.trim()));
  const rows = compareDocumentLines(baselineMarkdown, document.markdown);
  const successToast = <PublicationSuccessToast message={notice} className="document-review__toast" />;
  const added = rows.filter(row => row.after?.kind === "added").length;
  const removed = rows.filter(row => row.before?.kind === "removed").length;
  const panel = <div className="document-review__panel-content">
    {!narrow ? <div className="document-review__panel-heading"><h2>리뷰</h2></div> : null}
    <section className="document-review__request" aria-label="검토 요청 메모">
      <div className="document-review__request-author"><GitPullRequest aria-hidden="true" size={16} strokeWidth={1.75} /><strong>{requesterName}</strong><span>요청자</span><time>10:30</time></div>
      <p>{requestNote || "검토 요청 메모가 없습니다."}</p>
    </section>
    <section aria-label="리뷰 기록" className="document-review__history">
      {(!showExampleRecord || (reviewState !== "changes_requested" && reviewState !== "approved")) && records.length === 0 ? <p className="document-review__muted">아직 리뷰 기록이 없습니다.</p> : null}
      {showExampleRecord && (reviewState === "changes_requested" || reviewState === "approved") ? <ReviewRecord name="Lee" time="11:00" intent={reviewState === "approved" ? "approve" : "request_changes"} body={reviewState === "approved" ? documentCollaborationExample.approval : documentCollaborationExample.changesRequested} /> : null}
      {records.map(record => <ReviewRecord key={record.id} name={record.name ?? "나"} role={!record.name && viewer === "author" ? "요청자" : undefined} time={record.time ?? "방금"} intent={record.intent} body={record.body} />)}
    </section>
    {terminal ? <p className="document-review__muted">{state === "merged" ? "발행이 완료된 PR입니다." : "종료된 PR입니다."} 리뷰 기록만 확인할 수 있습니다.</p> : viewer === "read_only" ? <StatusFeedback variant="content" tone="info">이 PR에 리뷰를 남길 권한이 없습니다.</StatusFeedback> : <form className="document-review__form" onSubmit={async event => {
      event.preventDefault(); if (!canSubmit) return;
      setBusy(true); setFailed(false); setNotice("");
      await new Promise(resolve => window.setTimeout(resolve, 200));
      setBusy(false);
      if (submissionFails) { setFailed(true); return; }
      setRecords(current => [...current, { id: current.length + 1, intent, body: opinion.trim() }]);
      if (intent !== "comment") setLocalState(intent === "approve" ? "approved" : "changes_requested");
      onReviewSubmitted?.(intent, opinion.trim());
      setOpinion(""); setNotice("리뷰를 남겼습니다.");
    }}>
      <label htmlFor={`${id}-opinion`}>리뷰 의견</label>
      <Textarea id={`${id}-opinion`} rows={4} value={opinion} disabled={busy} onChange={event => { setOpinion(event.target.value); setFailed(false); }} placeholder="이 문서에 대한 의견을 남겨주세요." />
      <fieldset disabled={busy}><legend>검토 결과</legend><div className="document-review__choices">{(["comment", "approve", "request_changes"] as const).map(value => <label key={value}><input type="radio" name={`${id}-result`} checked={intent === value} disabled={value !== "comment" && viewer === "author"} onChange={() => setIntent(value)} />{intentLabels[value]}</label>)}</div></fieldset>
      {viewer === "author" ? <p className="document-review__muted">내 PR에는 의견만 남길 수 있습니다.</p> : null}
      {versionChanged ? <StatusFeedback variant="content" tone="warning">검토 중 새 수정본이 공유되었습니다. 최신 버전을 확인한 뒤 리뷰해주세요.</StatusFeedback> : null}
      {failed ? <StatusFeedback variant="field" tone="error">리뷰를 전송하지 못했습니다. 작성한 의견은 유지됩니다. 다시 시도해주세요.</StatusFeedback> : null}
      <Button type="submit" disabled={!canSubmit} loading={busy}>리뷰 제출</Button>
    </form>}
  </div>;

  if (loadState === "loading" && !retried) return <section className="document-review__loading" role="status">리뷰 문서를 불러오는 중…</section>;
  if (loadState === "error" && !retried) return <section className="document-review__loading"><StatusFeedback variant="content" tone="error" action={<Button variant="secondary" onClick={() => setRetried(true)}>다시 시도</Button>}>리뷰 문서를 불러오지 못했습니다.</StatusFeedback></section>;
  return <section ref={host} className="document-review" aria-label="문서 리뷰" style={narrow ? undefined : { gridTemplateColumns: `minmax(0, 1fr) ${panelSize.width}px` }}>
    <div className="document-review__canvas" {...canvasScroll}>
      {navigation}
      <header className="document-review__header">
        <div className="document-review__eyebrow">문서 리뷰</div>
        <div className="document-review__title-row"><h1>{document.summary.title}</h1>{narrow ? <Button ref={panelTrigger} variant="secondary" aria-haspopup="dialog" aria-expanded={panelOpen} onClick={() => setPanelOpen(true)}><MessageSquare aria-hidden="true" size={18} />리뷰 열기</Button> : null}</div>
        <p>{document.summary.path}</p>
        <div className="document-review__metadata"><div className="document-review__pr-status"><a href={`https://github.com/Mockly-Company/okf-knowledge-hub/pull/${prNumber}`} target="_blank" rel="noopener noreferrer">PR #{prNumber} <ExternalLink aria-hidden="true" size={14} /></a><StatusBadge tone={tones[state]}>{labels[state]}</StatusBadge></div><span className="document-review__author">요청자 {requesterName}</span></div>
      </header>
      <TabsList className="document-review__tabs" aria-label="리뷰 보기"><TabsTrigger id={`${id}-document-tab`} aria-controls={`${id}-content`} selected={activeView === "document"} onClick={() => setActiveView("document")}>제안 문서</TabsTrigger><TabsTrigger id={`${id}-diff-tab`} aria-controls={`${id}-content`} selected={activeView === "diff"} onClick={() => setActiveView("diff")}>변경 비교</TabsTrigger></TabsList>
      <div id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-${activeView === "document" ? "document" : "diff"}-tab`} className="document-review__body">
        {activeView === "document" ? <MarkdownDocument hideHeader suppressSourceTitle document={document} /> : <>
          <div className="document-review__diff-summary"><details className="document-review__versions"><summary>버전 정보</summary><dl><div><dt>이전 확정본</dt><dd>main</dd></div><div><dt>제안 버전</dt><dd>b72e5c1</dd></div></dl></details><span>추가 {added} · 삭제 {removed}</span></div>
          <section className="document-source-diff" aria-label="원문 변경사항"><div className="document-source-diff__header"><span>이전 확정본 · main</span><span>제안 문서</span><span className="document-source-diff__mobile-heading">원문 · 삭제 − / 추가 +</span></div>{rows.map((row, index) => <div className="document-source-diff__row" data-same={row.before?.kind === "same" ? "true" : "false"} key={index}><DiffCell line={row.before} side="before" otherNumber={row.before?.kind === "same" ? row.after?.number : undefined} /><DiffCell line={row.after} side="after" /></div>)}</section>
        </>}
      </div>
    </div>
    {!narrow ? <aside className="document-review__panel" aria-label="리뷰 패널">{panelSize.handle}<div className="document-review__panel-scroll" {...panelScroll}>{panel}</div></aside> : <Dialog open={panelOpen} onOpenChange={setPanelOpen}><DialogContent className="document-review__drawer" style={{ width: panelSize.width }} aria-label="리뷰 패널" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); panelTrigger.current?.focus({ preventScroll: true }); }}><DialogHeader role="presentation"><DialogTitle>리뷰</DialogTitle><DialogCloseButton label="리뷰 패널 닫기" /></DialogHeader><DialogBody className="document-review__drawer-scroll" {...drawerScroll}>{panel}</DialogBody>{successToast}{panelSize.handle}</DialogContent></Dialog>}
    {(!narrow || !panelOpen) && successToast}
  </section>;
}
