import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { DocumentReader } from "@/features/documents/components/DocumentReader";
import { DocumentDraftEditor } from "@/features/documents/components/DocumentDraftEditor";
import { createInitialAuthoringState, type DocumentEditorState } from "@/features/documents/document-authoring-reducer";
import { DocumentDraftSwitcher } from "@/features/documents/components/DocumentDraftSwitcher";
import type { DocumentContent } from "@/features/documents/model";
import { documentTitle } from "@/features/documents/document-markdown";
import { DocumentReviewPreview, type DocumentReviewPreviewProps } from "./DocumentReviewPreview";
import { PublicationSuccessToast } from "./PublicationSuccessToast";
import { collaborationReviewComment, documentCollaborationExample } from "./document-collaboration-example";
import "./documents-flow.css";

export type ReviewState = NonNullable<DocumentReviewPreviewProps["reviewState"]>;
type Review = { number: number; state: ReviewState; markdown: string; note: string; own?: boolean; records?: NonNullable<DocumentReviewPreviewProps["initialRecords"]> };
type Entry = { baseline: string; draft?: DocumentEditorState; review?: Review };
const samplePath = documentCollaborationExample.path;
const sampleBaseline = documentCollaborationExample.baseline;
const labels = { pending: "검토 대기중", approved: "검토 승인됨", changes_requested: "수정 요청됨", merged: "발행 완료", closed: "검토 종료" } as const;
export type DocumentFlowLocation = { view: "documents" | "detail" | "editor" | "review"; path?: string; baseline: boolean };
function exampleEditor(path: string, markdown: string): DocumentEditorState {
  const changeId = `preview:${path}`;
  return { document: { changeId, documentId: path, path, markdown, contentHash: "preview", draft: { workspaceId: "preview", changeId, authorLogin: "Kim", baseCommit: "base", branch: "draft/kim/document", createdAtUnixMs: 1, lastOpenedAtUnixMs: 1 } }, markdown, savedMarkdown: markdown, contentHash: "preview", saveStatus: "saved", saveRequestId: null, saveSnapshot: null, conflict: null, error: null, mode: "rich", closeAfterSave: false };
}

/** Connected Storybook-only journey. All publication/review state stays in memory. */
export function DocumentsFlowPreview({ reviewState = "pending", request, onNavigate }: { reviewState?: ReviewState | "none"; request?: DocumentFlowLocation; onNavigate?: (location: DocumentFlowLocation) => void }) {
  const docs = useDocuments();
  const [entries, setEntries] = useState<Record<string, Entry>>(() => ({ [samplePath]: {
    baseline: reviewState === "merged" ? documentCollaborationExample.proposal : sampleBaseline,
    draft: exampleEditor(samplePath, documentCollaborationExample.proposal),
    review: reviewState === "none" ? undefined : { number: 42, state: reviewState, markdown: documentCollaborationExample.proposal, note: documentCollaborationExample.requestNote, records: [collaborationReviewComment, ...(reviewState === "approved" || reviewState === "changes_requested" ? [{ name: "Lee", time: "11:00", intent: reviewState === "approved" ? "approve" as const : "request_changes" as const, body: reviewState === "approved" ? documentCollaborationExample.approval : documentCollaborationExample.changesRequested }] : [])] },
  } }));
  const [localEditor, setLocalEditor] = useState<DocumentEditorState | null>(null);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [backup, setBackup] = useState<{ path: string; editor: DocumentEditorState; expiresAt: number } | null>(null);
  const [viewingBaseline, setViewingBaseline] = useState(true);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    const requested = requestRef.current;
    if (requested && requested.view !== "documents") return;
    setLocalEditor(null); setReviewOpen(false); setDetailPath(docs.state.selectedPath); setViewingBaseline(true);
    if (docs.state.selectedPath) navigateRef.current?.({ view: "detail", path: docs.state.selectedPath, baseline: true });
  }, [docs.state.selectedPath]);
  useEffect(() => {
    if (!request) return;
    if (request.view === "documents") { setLocalEditor(null); setDetailPath(null); setReviewOpen(false); docs.closeDraftEditor(); docs.showDocumentsHome(); return; }
    const target = request.path ?? samplePath;
    setDetailPath(target); setViewingBaseline(request.baseline); setReviewOpen(request.view === "review");
    if (request.view === "editor") setLocalEditor(entries[target]?.draft ?? (docs.authoringState.editor?.document.path === target ? docs.authoringState.editor : exampleEditor(target, entries[target]?.baseline ?? "")));
    else { setLocalEditor(null); docs.closeDraftEditor(); }
    // A request is a frame history entry, not a dependency on every editor keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  useEffect(() => {
    const created = docs.authoringState.editor;
    if (created && requestRef.current?.view !== "editor") navigateRef.current?.({ view: "editor", path: created.document.path, baseline: false });
  }, [docs.authoringState.editor?.document.changeId]);
  const editor = localEditor ?? docs.authoringState.editor;
  const path = editor?.document.path ?? detailPath ?? docs.state.selectedPath;
  const selected = docs.state.selectedDocument;
  const entry = path ? entries[path] ?? { baseline: selected?.summary.path === path ? selected.markdown : "" } : null;
  const saveEntry = (target: string, next: Entry) => setEntries(current => ({ ...current, [target]: next }));
  const leaveEditor = () => { setLocalEditor(null); docs.closeDraftEditor(); };
  const restore = () => {
    if (!backup || backup.expiresAt <= Date.now()) return;
    saveEntry(backup.path, { ...entries[backup.path], draft: backup.editor });
    setLocalEditor(backup.editor); setViewingBaseline(false); setDetailPath(backup.path); onNavigate?.({ view: "editor", path: backup.path, baseline: false }); setBackup(null); setRecoveryOpen(false); setNotice("초안을 복구했습니다.");
  };
  const notify = (view: DocumentFlowLocation["view"], baseline = viewingBaseline) => onNavigate?.({ view, path: path ?? undefined, baseline });
  const openList = () => { setLocalEditor(null); docs.closeDraftEditor(); setReviewOpen(false); setDetailPath(null); docs.showDocumentsHome(); setNotice(""); notify("documents", true); };
  const activeDraft = entry?.draft ?? editor;
  const picker = path && entry ? <DocumentDraftSwitcher state={{ ...createInitialAuthoringState(), drafts: activeDraft ? [activeDraft.document.draft] : [], activeChangeId: viewingBaseline ? null : activeDraft?.document.changeId ?? null }} onSwitch={changeId => {
    const baseline = changeId === null; setViewingBaseline(baseline);
    if (baseline) { leaveEditor(); notify("detail", true); }
    else { if (editor && activeDraft) setLocalEditor(activeDraft); notify(editor ? "editor" : "detail", false); }
  }} /> : null;
  const navigation = <div className="documents-flow__navigation"><Button variant="ghost" onClick={openList}><ArrowLeft aria-hidden="true" size={16} />문서 목록</Button>{picker}</div>;
  const metadata = entry?.review ? <div className="documents-flow__review"><a href={`https://github.com/Mockly-Company/okf-knowledge-hub/pull/${entry.review.number}`} target="_blank" rel="noopener noreferrer">PR #{entry.review.number}</a><StatusBadge tone={entry.review.state === "pending" ? "info" : entry.review.state === "changes_requested" ? "warning" : entry.review.state === "closed" ? "neutral" : "success"}>{labels[entry.review.state]}</StatusBadge><Button variant="secondary" onClick={() => { setReviewOpen(true); notify("review"); }}>리뷰 보기</Button></div> : null;
  const content = (markdown: string, documentPath = path ?? samplePath): DocumentContent => ({ summary: { path: documentPath, title: documentTitle(markdown), fileName: documentPath.split("/").at(-1)!, documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: selected?.summary.path === documentPath ? selected.summary.modifiedAtUnixMs : Date.UTC(2026, 9, 19), size: markdown.length }, markdown, properties: documentPath === samplePath ? { type: "API 계약", owner: "검색 플랫폼" } : {}, tableOfContents: documentPath === samplePath ? documentCollaborationExample.tableOfContents : [], lastCommit: null });
  let screen;
  if (reviewOpen && entry?.review) {
    const review = entry.review;
    screen = <DocumentReviewPreview document={content(review.markdown)} baselineMarkdown={entry.baseline} prNumber={review.number} requestNote={review.note} requesterName={review.own ? "나" : "Kim"} viewer={review.own ? "author" : "reviewer"} reviewState={review.state} initialRecords={review.records} showExampleRecord={false} navigation={<div className="documents-flow__navigation"><Button variant="ghost" onClick={() => { setReviewOpen(false); notify("detail"); }}><ArrowLeft aria-hidden="true" size={16} />문서로 돌아가기</Button></div>} onReviewSubmitted={(intent, body) => {
      saveEntry(path!, { ...entry, review: { ...review, state: intent === "comment" ? review.state : intent === "approve" ? "approved" : "changes_requested", records: [...(review.records ?? []), { intent, body }] } });
    }} />;
  } else if (editor && entry) {
    const currentEditor = entry.draft ?? (entry.baseline ? { ...editor, markdown: entry.baseline, savedMarkdown: entry.baseline } : editor);
    screen = <DocumentDraftEditor editor={currentEditor} readAsset={docs.readAsset} copyText={docs.copyText} headerNavigation={<div className="documents-flow__version">{picker}</div>} headerMetadata={metadata} headerSecondary={<Button variant="destructive" onClick={() => setDiscardOpen(true)}>변경 취소</Button>}
      onMarkdownChange={markdown => {
        saveEntry(path!, { ...entry, draft: { ...currentEditor, markdown, savedMarkdown: markdown, saveStatus: "saved" } });
        if (!localEditor) docs.updateDraftMarkdown(markdown);
      }} onModeChange={mode => saveEntry(path!, { ...entry, draft: { ...currentEditor, mode } })}
      onAcceptDisk={docs.acceptDiskConflict} onAcceptHub={docs.acceptHubConflict} onStartMerge={docs.startConflictMerge}
      onClose={() => { saveEntry(path!, { ...entry, draft: currentEditor }); setDetailPath(path); setViewingBaseline(true); leaveEditor(); notify("detail", true); }}
      publication={{ baselineMarkdown: entry.baseline, onSubmit: async request => {
        const number = entry.review && !["closed", "merged"].includes(entry.review.state) ? entry.review.number : (entry.review?.number ?? 41) + 1;
        saveEntry(path!, request.intent === "publish" ? { baseline: request.markdown, draft: { ...currentEditor, markdown: request.markdown }, review: entry.review ? { ...entry.review, state: "merged", markdown: request.markdown } : undefined } : { ...entry, draft: currentEditor, review: { ...entry.review, number, own: entry.review && !["closed", "merged"].includes(entry.review.state) ? Boolean(entry.review.own) : true, state: "pending", markdown: request.markdown, note: request.reviewNote || entry.review?.note || "" } });
        setDetailPath(path); setViewingBaseline(true); leaveEditor(); notify("detail", true);
        setNotice(request.intent === "publish" ? "문서를 발행했습니다." : `PR #${number}로 검토를 요청했습니다.`);
      }} } />;
  } else if (path && entry && (selected || detailPath)) {
    const markdown = !viewingBaseline && entry.draft ? entry.draft.markdown : entry.baseline || entry.draft?.markdown || `# ${selected?.summary.title ?? "새 문서"}`;
    screen = <section className="documents-page documents-page--reader"><DocumentReader document={content(markdown)} navigation={navigation} versionLabel={!viewingBaseline || !entry.baseline ? "로컬 초안" : undefined} headerMetadata={<>{metadata}{entry.draft && entry.draft.markdown !== entry.baseline ? <p className="documents-flow__draft">로컬 초안 있음</p> : null}</>} onEdit={() => { setLocalEditor(entry.draft ?? exampleEditor(path!, markdown)); setViewingBaseline(false); notify("editor", false); }} /></section>;
  } else screen = <DocumentsPage headerActions={<Button variant="secondary" onClick={() => setRecoveryOpen(true)}>최근 삭제한 초안</Button>} additionalDocuments={Object.entries(entries).filter(([, value]) => value.draft || value.baseline).map(([documentPath, value]) => content(value.draft?.markdown ?? value.baseline, documentPath).summary)} />;
  return <div className="documents-flow">{screen}
    <PublicationSuccessToast message={notice} action={backup && backup.expiresAt > Date.now() && notice === "변경을 취소했습니다." ? <Button variant="secondary" onClick={restore}>실행 취소</Button> : undefined} />
    <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}><DialogContent aria-label="최근 삭제한 초안"><DialogHeader><DialogTitle>최근 삭제한 초안</DialogTitle><DialogCloseButton label="최근 삭제한 초안 닫기" /></DialogHeader><DialogBody>{backup && backup.expiresAt > Date.now() ? <div className="documents-flow__recovery"><div><strong>{documentTitle(backup.editor.markdown)}</strong><p>{backup.path}</p></div><Button variant="secondary" onClick={restore}>초안 복구</Button></div> : <p>최근 삭제한 초안이 없습니다.</p>}</DialogBody></DialogContent></Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}><DialogContent aria-label="변경 취소"><DialogHeader><DialogTitle>변경 내용을 버릴까요?</DialogTitle><DialogCloseButton label="변경 취소 닫기" /></DialogHeader><DialogBody><DialogDescription><span className="block">{entry?.baseline ? "마지막 확정본으로 돌아갑니다." : "새 문서를 삭제합니다."}</span><span className="block">버린 내용은 7일간 복구할 수 있습니다.</span></DialogDescription></DialogBody><DialogFooter><Button variant="secondary" onClick={() => setDiscardOpen(false)}>계속 편집</Button><Button variant="destructive" onClick={() => {
      if (!editor || !entry || !path) return;
      setBackup({ path, editor: entry.draft ?? editor, expiresAt: Date.now() + 7 * 86400000 }); saveEntry(path, { ...entry, draft: entry.baseline ? { ...editor, markdown: entry.baseline, savedMarkdown: entry.baseline, saveStatus: "saved" } : undefined }); setDetailPath(entry.baseline ? path : null); setViewingBaseline(true); leaveEditor(); if (!entry.baseline) docs.showDocumentsHome(); notify(entry.baseline ? "detail" : "documents", true); setDiscardOpen(false); setNotice("변경을 취소했습니다.");
    }}>변경 버리기</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
