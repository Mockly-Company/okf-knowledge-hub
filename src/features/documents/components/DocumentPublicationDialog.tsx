import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { compareDocumentLines, type DocumentDiffLine } from "../document-diff";
import { documentTitle } from "../document-markdown";
import type { DocumentContent } from "../model";
import { MarkdownDocument } from "./MarkdownDocument";
import "./DocumentPublicationDialog.css";

export interface DocumentPublicationRequest {
  intent: "publish" | "review";
  path: string;
  markdown: string;
  message: string;
  reviewNote: string;
}
export interface DocumentPublicationDialogProps {
  open: boolean;
  intent: "publish" | "review";
  path: string;
  markdown: string;
  /** undefined = not loaded; null = a new document with no confirmed version. */
  baselineMarkdown?: string | null;
  onOpenChange(open: boolean): void;
  onSubmit?(request: DocumentPublicationRequest): Promise<void>;
}

function previewDocument(path: string, markdown: string): DocumentContent {
  return { summary: { path, fileName: path.split("/").at(-1) ?? path, title: documentTitle(markdown), documentId: null, frontmatterStatus: { status: "missing" }, modifiedAtUnixMs: 0, size: markdown.length }, markdown, properties: {}, tableOfContents: [], lastCommit: null };
}

function SourceCell({ line, side, otherNumber }: { line: DocumentDiffLine | null; side: "before" | "after"; otherNumber?: number }) {
  return <div className={`document-source-diff__cell document-source-diff__cell--${side}`} data-kind={line?.kind ?? "gap"}>
    <span className="document-source-diff__number" aria-hidden="true">{line?.number}</span>
    <span className="document-source-diff__other-number" aria-hidden="true">{otherNumber}</span>
    <span className="document-source-diff__marker" aria-hidden="true">{line?.kind === "removed" ? "−" : line?.kind === "added" ? "+" : ""}</span>
    <span className="document-source-diff__text">{line?.kind === "removed" ? <span className="sr-only">삭제: </span> : line?.kind === "added" ? <span className="sr-only">추가: </span> : null}{line?.text || " "}</span>
  </div>;
}

export function DocumentPublicationDialog({ open, intent, path, markdown, baselineMarkdown, onOpenChange, onSubmit }: DocumentPublicationDialogProps) {
  const id = useId();
  const [view, setView] = useState<"source" | "preview">("source");
  const [previewSide, setPreviewSide] = useState<"before" | "after">("after");
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const rows = useMemo(() => baselineMarkdown === undefined ? [] : compareDocumentLines(baselineMarkdown ?? "", markdown), [baselineMarkdown, markdown]);
  const added = rows.filter(row => row.after?.kind === "added").length;
  const removed = rows.filter(row => row.before?.kind === "removed").length;
  const available = Boolean(onSubmit) && baselineMarkdown !== undefined;
  const canSubmit = available && !busy && Boolean(message.trim()) && added + removed > 0;
  useEffect(() => { if (open) { setView("source"); setPreviewSide("after"); setExpanded(true); setError(false); } }, [open]);

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="document-publication-dialog" aria-label={intent === "review" ? "검토 요청" : "발행"} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <form className="document-publication-dialog__form" onSubmit={async event => {
        event.preventDefault(); if (!canSubmit || !onSubmit) return;
        setBusy(true); setError(false);
        try { await onSubmit({ intent, path, markdown, message: message.trim(), reviewNote: intent === "review" ? reviewNote.trim() : "" }); onOpenChange(false); }
        catch { setError(true); }
        finally { setBusy(false); }
      }}>
        <DialogHeader><div><DialogTitle>{intent === "review" ? "검토 요청" : "발행"}</DialogTitle><DialogDescription>{intent === "review" ? "현재 문서를 GitHub PR로 공유합니다. 요청만으로 확정본이 바뀌지는 않습니다." : "변경 내용을 확인하고 변경 설명(커밋 메시지)을 작성해주세요."}</DialogDescription></div><DialogCloseButton label="변경 확인 닫기" disabled={busy} /></DialogHeader>
        <DialogBody className="document-publication-dialog__body">
          <TabsList className="document-publication-dialog__tabs" aria-label="변경 확인 방식"><TabsTrigger id={`${id}-source-tab`} aria-controls={`${id}-comparison`} selected={view === "source"} onClick={() => setView("source")}>원문 비교</TabsTrigger><TabsTrigger id={`${id}-preview-tab`} aria-controls={`${id}-comparison`} selected={view === "preview"} onClick={() => setView("preview")}>문서 미리보기</TabsTrigger></TabsList>
          <div id={`${id}-comparison`} role="tabpanel" aria-labelledby={`${id}-${view}-tab`}>
            <section className="document-publication-document">
              <Button variant="ghost" type="button" className="document-publication-document__toggle" aria-expanded={expanded} aria-controls={`${id}-document-content`} onClick={() => setExpanded(value => !value)}>
                <ChevronDown className="document-publication-document__chevron" aria-hidden="true" size={18} strokeWidth={1.75} />
                <span className="document-publication-document__identity"><strong>{documentTitle(markdown) || "제목 없음"}</strong><span>{path}</span></span>
                {baselineMarkdown !== undefined ? <span className="document-publication-document__counts">추가 {added} · 삭제 {removed}</span> : null}
              </Button>
              <div id={`${id}-document-content`} hidden={!expanded}>
            {view === "source" ? baselineMarkdown === undefined ? <p className="document-publication-dialog__notice">이전 확정본이 아직 연결되지 않아 원문을 비교할 수 없습니다. 문서 미리보기에서 현재 작성본을 확인할 수 있습니다.</p> : <section className="document-source-diff" aria-label="원문 변경사항">
              <div className="document-source-diff__header"><span>이전 확정본 · main</span><span>현재 작성본 · 로컬 초안</span><span className="document-source-diff__mobile-heading">원문 · 삭제 − / 추가 +</span></div>
              {rows.length ? rows.map((row, index) => <div className="document-source-diff__row" data-same={row.before?.kind === "same" ? "true" : "false"} key={index}><SourceCell line={row.before} side="before" otherNumber={row.before?.kind === "same" ? row.after?.number : undefined} /><SourceCell line={row.after} side="after" /></div>) : <p className="document-publication-dialog__notice">문서가 비어 있습니다.</p>}
            </section> : <>
              <TabsList className="document-publication-dialog__preview-tabs" aria-label="미리보기 버전"><TabsTrigger selected={previewSide === "before"} onClick={() => setPreviewSide("before")}>이전 확정본</TabsTrigger><TabsTrigger selected={previewSide === "after"} onClick={() => setPreviewSide("after")}>현재 작성본</TabsTrigger></TabsList>
              <div className="document-publication-preview" data-side={previewSide}><section className="document-publication-preview__before" aria-label="이전 확정본 미리보기"><h3>이전 확정본 · main</h3>{baselineMarkdown ? <MarkdownDocument hideHeader document={previewDocument(path, baselineMarkdown)} /> : <p className="document-publication-dialog__notice">{baselineMarkdown === undefined ? "이전 확정본이 아직 연결되지 않았습니다." : "새 문서로 이전 확정본이 없습니다."}</p>}</section><section className="document-publication-preview__after" aria-label="현재 작성본 미리보기"><h3>현재 작성본 · 로컬 초안</h3><MarkdownDocument hideHeader document={previewDocument(path, markdown)} /></section></div>
            </>}
              </div>
            </section>
          </div>
          {!available ? <p className="document-publication-dialog__notice">발행 기능이 아직 연결되지 않았습니다. 초안은 로컬에 유지됩니다.</p> : added + removed === 0 ? <p className="document-publication-dialog__notice">확정본과 다른 변경 내용이 없습니다.</p> : null}
          <div className="document-publication-dialog__field"><label htmlFor={`${id}-message`}>변경 설명 <span>(필수)</span></label><Input id={`${id}-message`} value={message} onChange={event => setMessage(event.target.value)} placeholder="어떤 내용을 변경했나요?" required maxLength={120} disabled={busy} /></div>
          {intent === "review" ? <div className="document-publication-dialog__field"><label htmlFor={`${id}-note`}>검토 요청 메모 <span>(선택)</span></label><Textarea id={`${id}-note`} value={reviewNote} onChange={event => setReviewNote(event.target.value)} disabled={busy} placeholder="검토자가 확인할 내용을 적어주세요." /></div> : null}
          {error ? <StatusFeedback variant="content" tone="error">{intent === "review" ? "검토 요청" : "발행"} 결과를 확인하지 못했습니다. 초안과 변경 설명은 유지됩니다. 원격 상태를 확인한 뒤 다시 시도해주세요.</StatusFeedback> : null}
        </DialogBody>
        <DialogFooter className="document-publication-dialog__footer"><div><Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>작성으로 돌아가기</Button><Button type="submit" loading={busy} disabled={!canSubmit}>{intent === "review" ? "검토 요청 보내기" : "발행하기"}</Button></div></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
