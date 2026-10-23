import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  ListsToggle,
  MDXEditor,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  type MDXEditorMethods,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentEditorState } from "../document-authoring-reducer";
import {
  documentTitle,
  isRichEditorCompatibleMarkdown,
  isDocumentTitleLinked,
  updateDocumentTitle,
} from "../document-markdown";
import { DocumentPublicationDialog, type DocumentPublicationRequest } from "./DocumentPublicationDialog";
import type { DocumentAsset } from "../model";
import { createEditorImagePreview } from "./editor-image-preview";
import { accessibleListItemNodes } from "./AccessibleListItemNode";
import { DocumentCodeEditor, DocumentImageTools, RichEditorServices, codeEditorLayout, codeEditorLabel, codeEditorHighlight, editorCodeLanguages, editorSemanticsPlugin } from "./RichEditorEnhancements";

interface DocumentDraftEditorProps {
  editor: DocumentEditorState;
  headerSecondary?: ReactNode;
  headerNavigation?: ReactNode;
  headerMetadata?: ReactNode;
  readAsset?(documentPath: string, assetPath: string): Promise<DocumentAsset>;
  copyText?(value: string): Promise<void>;
  publication?: {
    baselineMarkdown?: string | null;
    publishDisabledReason?: string;
    reviewDisabledReason?: string;
    reviewNotice?: string;
    requiresCommitMessage?: boolean;
    onSubmit?(request: DocumentPublicationRequest): Promise<void>;
  };
  onMarkdownChange(markdown: string): void;
  onModeChange(mode: "rich" | "source"): void;
  onAcceptDisk(): void;
  onAcceptHub(): void;
  onStartMerge(): void;
  onClose(): void;
}

const statusLabel = {
  saved: "로컬에 자동 저장 완료",
  dirty: "자동 저장 대기중",
  queued: "로컬에 저장중",
  saving: "로컬에 저장중",
  conflict: "외부 변경 감지",
  error: "로컬 저장 실패",
} as const;

const editorTranslations: Record<string, string> = {
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "문단 서식",
  "toolbar.blockTypeSelect.placeholder": "본문",
  "toolbar.blockTypes.paragraph": "본문",
  "toolbar.blockTypes.quote": "인용",
  "toolbar.blockTypes.heading": "제목 {{level}}",
  "toolbar.undo": "실행 취소 {{shortcut}}",
  "toolbar.redo": "다시 실행 {{shortcut}}",
  "toolbar.bold": "굵게",
  "toolbar.removeBold": "굵게 해제",
  "toolbar.italic": "기울임",
  "toolbar.removeItalic": "기울임 해제",
  "toolbar.underline": "밑줄",
  "toolbar.removeUnderline": "밑줄 해제",
  "toolbar.inlineCode": "인라인 코드",
  "toolbar.removeInlineCode": "인라인 코드 해제",
  "toolbar.bulletedList": "글머리 목록",
  "toolbar.numberedList": "번호 목록",
  "toolbar.checkList": "체크 목록",
  "toolbar.link": "링크 추가",
  "toolbar.image": "이미지 추가",
  "toolbar.table": "표 추가",
  "toolbar.codeBlock": "코드 블록 추가",
  "imageEditor.deleteImage": "이미지 삭제",
  "imageEditor.editImage": "이미지 편집",
};

export function DocumentDraftEditor({
  editor,
  headerSecondary,
  headerNavigation,
  headerMetadata,
  readAsset,
  copyText,
  publication,
  onMarkdownChange,
  onModeChange,
  onAcceptDisk,
  onAcceptHub,
  onStartMerge,
  onClose,
}: DocumentDraftEditorProps) {
  const richCompatible = isRichEditorCompatibleMarkdown(editor.markdown);
  const mode = richCompatible ? editor.mode : "source";
  const richEditorRef = useRef<MDXEditorMethods>(null);
  const imagePreviewHandler = useMemo(() => createEditorImagePreview(editor.document.path, readAsset), [editor.document.path, readAsset]);
  const lastRichMarkdown = useRef(editor.markdown);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [publicationSnapshot, setPublicationSnapshot] = useState<{ intent: "publish" | "review"; markdown: string; baselineMarkdown?: string | null } | null>(null);
  const openPublication = (intent: "publish" | "review") => {
    setPublicationSnapshot({ intent, markdown: editor.markdown, baselineMarkdown: publication?.baselineMarkdown });
    setPublicationOpen(true);
  };

  useEffect(() => {
    if (
      mode === "rich" &&
      richEditorRef.current &&
      lastRichMarkdown.current !== editor.markdown
    ) {
      lastRichMarkdown.current = editor.markdown;
      richEditorRef.current.setMarkdown(editor.markdown);
    }
  }, [editor.markdown, mode]);

  const handleRichMarkdownChange = (markdown: string) => {
    lastRichMarkdown.current = markdown;
    onMarkdownChange(markdown);
  };

  return (
    <section className="document-draft-editor" aria-label="문서 편집기">
      <div className="document-draft-editor__back-row">
        <Button variant="ghost" onClick={onClose}><ArrowLeft aria-hidden="true" strokeWidth={1.75} />편집 종료</Button>
        <div className="document-draft-editor__status"><span role="status" aria-live="polite" data-status={editor.saveStatus}>{statusLabel[editor.saveStatus]}</span></div>
      </div>
      {headerNavigation}
      <header className="document-draft-editor__header">
        <div className="document-draft-editor__heading">
          <Input
            aria-label="문서 제목"
            value={documentTitle(editor.markdown)}
            onChange={(event) =>
              onMarkdownChange(updateDocumentTitle(editor.markdown, event.target.value))
            }
          />
          <div className="document-draft-editor__metadata" role="group" aria-label="문서 정보">
            <span>{editor.document.path}</span>
            {headerMetadata}
          </div>
        </div>
        <div className="document-draft-editor__header-secondary">
          {headerSecondary}
          <div className="document-draft-editor__publish-actions">
            <Button onClick={() => openPublication("publish")} disabled={Boolean(editor.conflict)}>발행</Button>
          </div>
        </div>
      </header>

      {!richCompatible ? (
        <StatusFeedback
          variant="banner"
          tone="warning"
          className="document-draft-editor__warning"
        >
          지원 범위 밖의 Markdown이 있어 원문 모드로 편집합니다.
        </StatusFeedback>
      ) : null}

      {editor.error ? (
        <StatusFeedback
          variant="content"
          tone="error"
          className="document-draft-editor__warning"
        >
          {editor.error.message}
        </StatusFeedback>
      ) : null}

      {editor.conflict ? (
        <StatusFeedback
          variant="content"
          tone="error"
          className="document-draft-editor__conflict"
          action={(
            <>
              <Button variant="secondary" onClick={onAcceptDisk}>디스크 내용 사용</Button>
              <Button variant="secondary" onClick={onAcceptHub}>내 내용으로 덮어쓰기</Button>
              <Button variant="secondary" onClick={onStartMerge}>직접 병합</Button>
            </>
          )}
        >
          <div>
            <strong>디스크에서 문서가 변경되었습니다.</strong>
            <p>자동저장을 멈췄습니다. 어느 내용을 기준으로 계속할지 선택하세요.</p>
          </div>
        </StatusFeedback>
      ) : null}

      <TabsList className="document-draft-editor__mode-tabs" aria-label="편집 모드">
        <TabsTrigger
          selected={mode === "rich"}
          disabled={!richCompatible}
          onClick={() => onModeChange("rich")}
        >
          문서 편집
        </TabsTrigger>
        <TabsTrigger
          selected={mode === "source"}
          onClick={() => onModeChange("source")}
        >
          Markdown 원문
        </TabsTrigger>
      </TabsList>

      {mode === "source" ? (
        <Textarea
          className="document-draft-editor__source"
          aria-label="Markdown 원문"
          spellCheck={false}
          value={editor.markdown}
          onChange={(event) => onMarkdownChange(event.target.value)}
        />
      ) : (
        <RichEditorServices.Provider value={{ copyText: copyText ?? ((value) => navigator.clipboard.writeText(value)) }}><MDXEditor
          ref={richEditorRef}
          key={editor.document.documentId}
          className={`document-draft-editor__mdx${
            isDocumentTitleLinked(editor.markdown) ? " is-title-linked" : ""
          }`}
          markdown={editor.markdown}
          additionalLexicalNodes={accessibleListItemNodes}
          translation={(key, fallback, values) =>
            (editorTranslations[key] ?? fallback).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""))
          }
          onChange={handleRichMarkdownChange}
          plugins={[
            frontmatterPlugin(),
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            imagePlugin({ imagePreviewHandler, EditImageToolbar: DocumentImageTools as React.FC, disableImageResize: true }),
            tablePlugin(),
            editorSemanticsPlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: "text", codeBlockEditorDescriptors: [{ priority: 100, match: () => true, Editor: DocumentCodeEditor }] }),
            codeMirrorPlugin({
              codeBlockLanguages: editorCodeLanguages,
              codeMirrorExtensions: [codeEditorLayout, codeEditorLabel, codeEditorHighlight],
            }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <div className="document-editor-toolbar__group" role="group" aria-label="편집 기록"><UndoRedo /></div>
                  <div className="document-editor-toolbar__group" role="group" aria-label="글자 서식"><BlockTypeSelect /><BoldItalicUnderlineToggles /><CodeToggle /></div>
                  <div className="document-editor-toolbar__group" role="group" aria-label="목록"><ListsToggle /></div>
                  <div className="document-editor-toolbar__group" role="group" aria-label="삽입"><CreateLink /><InsertImage /><InsertTable /><InsertCodeBlock /></div>
                </>
              ),
            }),
          ]}
        /></RichEditorServices.Provider>
      )}
      <DocumentPublicationDialog key={`publication-${editor.document.documentId}`} open={publicationOpen} onOpenChange={setPublicationOpen} intent={publicationSnapshot?.intent ?? "publish"} path={editor.document.path} markdown={publicationSnapshot?.markdown ?? editor.markdown} baselineMarkdown={publicationSnapshot?.baselineMarkdown} publishDisabledReason={publication?.publishDisabledReason} reviewDisabledReason={publication?.reviewDisabledReason} reviewNotice={publication?.reviewNotice} requiresCommitMessage={publication?.requiresCommitMessage} onSubmit={publication?.onSubmit} />
    </section>
  );
}
