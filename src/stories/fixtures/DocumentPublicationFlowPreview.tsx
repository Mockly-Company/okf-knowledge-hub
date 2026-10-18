import { useEffect, useReducer, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import type { DocumentEditorState } from "@/features/documents/document-authoring-reducer";
import { documentTitle } from "@/features/documents/document-markdown";
import { DocumentDraftEditor } from "@/features/documents/components/DocumentDraftEditor";
import { MarkdownDocument } from "@/features/documents/components/MarkdownDocument";
import type { DocumentPublicationRequest } from "@/features/documents/components/DocumentPublicationDialog";
import { PageStoryFrame } from "../decorators/PageStoryFrame";
import { PublicationSuccessToast } from "./PublicationSuccessToast";
import { canPublishFlow, createPublicationPreview, nextPublicationReviewNumber, publicationFlowReducer, type PublicationReviewState, type PublicationBlocker } from "./document-publication-flow";
import "./document-publication-flow.css";

export interface PublicationFlowPreviewProps {
  editor: DocumentEditorState;
  baseline: string;
  review?: "pending" | "approved" | "changed";
  reviewState?: PublicationReviewState;
  unpublishedChanges?: boolean;
  publicationBlocker?: PublicationBlocker;
  discarded?: boolean;
  expired?: boolean;
  failure?: boolean;
  initialDiscardOpen?: boolean;
}

/** Disposable, in-memory UI simulation. No filesystem, Git, network or PR mutations. */
export function DocumentPublicationFlowPreview(props: PublicationFlowPreviewProps) {
  return <PublicationFlowContent key={JSON.stringify({ ...props, publicationBlocker: undefined })} {...props} />;
}

function PublicationFlowContent({ editor, baseline, review, reviewState, unpublishedChanges = false, publicationBlocker = "none", discarded = false, expired = false, failure = false, initialDiscardOpen = false }: PublicationFlowPreviewProps) {
  const { readAsset, copyText, showDocumentsHome } = useDocuments();
  const [now] = useState(() => Date.now());
  const [flow, dispatch] = useReducer(publicationFlowReducer, undefined, () => {
    // These owned fixtures use MDXEditor's canonical bullet spelling so its
    // initial normalization is not mistaken for a user edit to an approved PR.
    return createPublicationPreview(editor.markdown.replace(/^- /gm, "* "), baseline.replace(/^- /gm, "* "), {
      reviewState: reviewState ?? (review === "changed" ? "approved" : review ?? "none"),
      unpublishedChanges: unpublishedChanges || review === "changed", discarded, expired, now,
    });
  });
  const [editing, setEditing] = useState(!discarded && flow.review?.status !== "merged" && flow.review?.status !== "closed");
  const [mode, setMode] = useState(editor.mode);
  const [savedMarkdown, setSavedMarkdown] = useState(flow.markdown);
  const [saveStatus, setSaveStatus] = useState<DocumentEditorState["saveStatus"]>(editor.saveStatus);
  const [discardOpen, setDiscardOpen] = useState(initialDiscardOpen);
  const [listOpen, setListOpen] = useState(discarded && !baseline);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [result, setResult] = useState("");
  const canRestore = Boolean(flow.backup && Date.now() < flow.backup.expiresAt);
  const openList = () => { showDocumentsHome(); setListOpen(true); };
  const restore = () => {
    if (!flow.backup || Date.now() >= flow.backup.expiresAt) return;
    dispatch({ type: "restore", now: Date.now() });
    setRecoveryOpen(false);
    setListOpen(false);
    setEditing(true);
    setResult("초안을 복구했습니다.");
  };
  useEffect(() => {
    if (editor.error) return;
    if (flow.markdown === savedMarkdown) return;
    const saving = window.setTimeout(() => setSaveStatus("saving"), 250);
    const saved = window.setTimeout(() => { setSavedMarkdown(flow.markdown); setSaveStatus("saved"); }, 650);
    return () => { clearTimeout(saving); clearTimeout(saved); };
  }, [flow.markdown, savedMarkdown, editor.error]);

  const unpublishedEdits = Boolean(!flow.discarded && flow.review && flow.review.status !== "merged" && flow.review.status !== "closed" && flow.review.sharedMarkdown !== flow.markdown);
  const status = flow.review ? ({ pending: "검토 대기중", changes_requested: "수정 요청됨", approved: "검토 승인됨", merged: "발행 완료", closed: "검토 종료" })[flow.review.status] : flow.published ? "발행 완료" : "로컬 초안";
  const statusTone = flow.review ? ({ pending: "info", changes_requested: "warning", approved: "success", merged: "success", closed: "neutral" })[flow.review.status] : "neutral";
  const terminalReview = flow.review?.status === "closed" || flow.review?.status === "merged";
  const closedReview = flow.review?.status === "closed";
  const reviewDisabledReason = flow.review?.status === "merged" ? "발행된 문서를 다시 편집해 새 검토 요청을 시작해주세요." : undefined;
  const reviewNotice = closedReview ? "기존 PR이 종료되었습니다. 새 PR로 검토를 요청합니다." : undefined;
  const publishDisabledReason = terminalReview ? closedReview ? "종료된 PR은 발행할 수 없습니다. 검토 요청을 선택해 새 PR을 만들어주세요." : reviewDisabledReason : ({ none: undefined, review: "저장소에서 요구하는 검토 승인이 아직 충족되지 않았습니다.", checks_pending: "필수 검사가 진행 중입니다. 완료 후 발행할 수 있습니다.", checks: "필수 검사를 통과해야 발행할 수 있습니다.", conflict: "병합 충돌을 해결한 뒤 발행해주세요.", permission: "이 저장소에 발행할 권한이 없습니다." })[publicationBlocker];
  const needsReview = flow.review?.status === "approved" && flow.review.reviewedMarkdown !== flow.review.sharedMarkdown;
  const submit = async (request: DocumentPublicationRequest) => {
    await new Promise(resolve => window.setTimeout(resolve, 300));
    if (failure) throw new Error("Storybook-only simulated failure");
    if (request.intent === "review" && flow.review?.status === "merged") throw new Error("Merged PR cannot be reused");
    if (request.intent === "publish" && !canPublishFlow(flow, publicationBlocker)) throw new Error("The preview snapshot cannot be published");
    dispatch(request.intent === "review" ? { type: "review" } : { type: "publish", blocker: publicationBlocker });
    const reviewNumber = !closedReview && flow.review ? flow.review.number : nextPublicationReviewNumber(flow);
    setResult(request.intent === "publish" ? "문서를 발행했습니다." : flow.review && !closedReview ? unpublishedEdits ? `PR #${reviewNumber}에 수정 내용을 반영했습니다.` : `PR #${reviewNumber}의 검토를 다시 요청했습니다.` : `PR #${reviewNumber}로 검토를 요청했습니다.`);
    setEditing(false);
  };
  const reviewStatus = flow.review ? <span className="publication-flow-preview__review" aria-label="검토 상태"><a href={`https://github.com/Mockly-Company/okf-knowledge-hub/pull/${flow.review.number}`} target="_blank" rel="noopener noreferrer">PR #{flow.review.number}</a><span data-tone={statusTone}>{status}</span>{unpublishedEdits ? <span data-tone="warning">미공유 변경 있음</span> : null}{needsReview ? <span data-tone="warning">재검토 필요</span> : null}</span> : <span>{status}</span>;

  return <PageStoryFrame><div className="publication-flow-preview">
    {listOpen ? <DocumentsPage headerActions={<Button variant="secondary" onClick={() => setRecoveryOpen(true)}>최근 삭제한 초안</Button>} /> : editing ? <DocumentDraftEditor
      editor={{ ...editor, markdown: flow.markdown, savedMarkdown, mode, saveStatus }}
      readAsset={readAsset} copyText={copyText}
      headerMetadata={reviewStatus}
      headerSecondary={<Button variant="destructive" onClick={() => setDiscardOpen(true)}>변경 취소</Button>}
      publication={{ baselineMarkdown: flow.baseline, publishDisabledReason, reviewDisabledReason, reviewNotice, requiresCommitMessage: !flow.review || closedReview || unpublishedEdits, onSubmit: submit }}
      onMarkdownChange={markdown => { dispatch({ type: "edit", markdown }); setSaveStatus("dirty"); setResult(""); }}
      onModeChange={setMode} onAcceptDisk={() => {}} onAcceptHub={() => {}} onStartMerge={() => {}}
      onClose={() => setEditing(false)}
    /> : <section className="publication-flow-preview__reader" aria-label="문서 상태">
      <div><Button variant="ghost" onClick={openList}><ArrowLeft aria-hidden="true" />문서 목록</Button></div>
      <header><div><h1>{documentTitle(flow.markdown || editor.markdown)}</h1><div className="document-draft-editor__metadata" role="group" aria-label="문서 정보"><span>{editor.document.path}</span>{reviewStatus}</div></div>{!flow.discarded ? <Button variant="secondary" onClick={() => { dispatch({ type: "start_edit" }); setResult(""); setEditing(true); }}>편집</Button> : null}</header>
      {!flow.discarded && !flow.published && !result ? <p className="publication-flow-preview__local">로컬 초안</p> : null}
      {flow.markdown ? <MarkdownDocument hideHeader suppressSourceTitle document={{ summary: { path: editor.document.path, fileName: "map-search.md", title: documentTitle(flow.markdown), documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: 0, size: flow.markdown.length }, markdown: flow.markdown, properties: {}, tableOfContents: [], lastCommit: null }} /> : <p className="publication-flow-preview__local">아직 발행하지 않은 새 문서입니다. 확정본에는 변경이 없습니다.</p>}
    </section>}
    <PublicationSuccessToast message={result} action={result === "변경을 취소했습니다." && flow.discarded && canRestore ? <Button variant="secondary" onClick={restore}>실행 취소</Button> : undefined} />
    <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
      <DialogContent aria-label="최근 삭제한 초안">
        <DialogHeader><div><DialogTitle>최근 삭제한 초안</DialogTitle><DialogDescription>취소한 로컬 변경은 7일간 복구할 수 있습니다.</DialogDescription></div><DialogCloseButton label="최근 삭제한 초안 닫기" /></DialogHeader>
        <DialogBody>{canRestore && flow.backup ? <article className="publication-flow-preview__recovery-entry">
          <div><strong>{documentTitle(flow.backup.markdown)}</strong><p>{editor.document.path}</p><span>{flow.baseline ? "기존 문서의 로컬 변경" : "미발행 새 문서"}</span></div>
          <Button variant="secondary" onClick={restore}>초안 복구</Button>
        </article> : <p className="publication-flow-preview__empty">최근 삭제한 초안이 없습니다.</p>}</DialogBody>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <DialogContent aria-label="변경 취소" className="publication-flow-discard-dialog">
        <DialogHeader>
          <DialogTitle>변경 내용을 버릴까요?</DialogTitle>
          <DialogCloseButton label="변경 취소 닫기" />
        </DialogHeader>
        <DialogBody className="publication-flow-discard-dialog__body">
          <div className="publication-flow-discard-dialog__target">
            <DialogDescription><span className="block">{flow.baseline ? "마지막 확정본으로 돌아갑니다." : "새 문서를 삭제합니다."}</span><span className="block">버린 내용은 7일간 복구할 수 있습니다.</span></DialogDescription>
          </div>
          {flow.review ? <div className="publication-flow-discard-dialog__notes"><p>PR에 공유한 내용은 유지됩니다.</p></div> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDiscardOpen(false)}>계속 편집</Button>
          <Button variant="destructive" onClick={() => { dispatch({ type: "discard", now: Date.now() }); setDiscardOpen(false); setResult("변경을 취소했습니다."); setEditing(false); if (!flow.baseline) openList(); }}>변경 버리기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div></PageStoryFrame>;
}
