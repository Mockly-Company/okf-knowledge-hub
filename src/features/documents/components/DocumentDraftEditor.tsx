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
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentEditorState } from "../document-authoring-reducer";
import {
  documentTitle,
  isRichEditorCompatibleMarkdown,
  isDocumentTitleLinked,
  updateDocumentTitle,
} from "../document-markdown";

interface DocumentDraftEditorProps {
  editor: DocumentEditorState;
  onMarkdownChange(markdown: string): void;
  onModeChange(mode: "rich" | "source"): void;
  onAcceptDisk(): void;
  onAcceptHub(): void;
  onStartMerge(): void;
  onClose(): void;
}

const statusLabel = {
  saved: "로컬 저장됨",
  dirty: "저장 대기 중",
  queued: "저장 중",
  saving: "저장 중",
  conflict: "외부 변경 감지",
  error: "저장 실패",
} as const;

export function DocumentDraftEditor({
  editor,
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
  const lastRichMarkdown = useRef(editor.markdown);

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
    <section className="document-draft-editor" aria-label="새 문서 편집">
      <header className="document-draft-editor__header">
        <div className="document-draft-editor__heading">
          <Input
            aria-label="문서 제목"
            value={documentTitle(editor.markdown)}
            onChange={(event) =>
              onMarkdownChange(updateDocumentTitle(editor.markdown, event.target.value))
            }
          />
          <span>{editor.document.path}</span>
        </div>
        <div className="document-draft-editor__status">
          <span data-status={editor.saveStatus}>{statusLabel[editor.saveStatus]}</span>
          <Button variant="icon" aria-label="편집기 닫기" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>

      {!richCompatible ? (
        <div className="document-draft-editor__warning" role="status">
          <AlertTriangle aria-hidden="true" />
          지원 범위 밖의 Markdown이 있어 원문 모드로 편집합니다.
        </div>
      ) : null}

      {editor.error ? (
        <div className="document-draft-editor__warning" role="alert">
          <AlertTriangle aria-hidden="true" />
          {editor.error.message}
        </div>
      ) : null}

      {editor.conflict ? (
        <div className="document-draft-editor__conflict" role="alert">
          <div>
            <strong>디스크에서 문서가 변경되었습니다.</strong>
            <p>자동저장을 멈췄습니다. 어느 내용을 기준으로 계속할지 선택하세요.</p>
          </div>
          <div className="document-draft-editor__conflict-actions">
            <Button variant="secondary" onClick={onAcceptDisk}>디스크 내용 사용</Button>
            <Button variant="secondary" onClick={onAcceptHub}>내 내용으로 덮어쓰기</Button>
            <Button variant="secondary" onClick={onStartMerge}>직접 병합</Button>
          </div>
        </div>
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
        <MDXEditor
          ref={richEditorRef}
          key={editor.document.documentId}
          className={`document-draft-editor__mdx${
            isDocumentTitleLinked(editor.markdown) ? " is-title-linked" : ""
          }`}
          markdown={editor.markdown}
          onChange={handleRichMarkdownChange}
          plugins={[
            frontmatterPlugin(),
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            imagePlugin(),
            tablePlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: "text" }),
            codeMirrorPlugin({
              codeBlockLanguages: {
                text: "Text",
                typescript: "TypeScript",
                javascript: "JavaScript",
                json: "JSON",
                yaml: "YAML",
                mermaid: "Mermaid",
              },
            }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <>
                  <UndoRedo />
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
                  <CodeToggle />
                  <ListsToggle />
                  <CreateLink />
                  <InsertImage />
                  <InsertTable />
                  <InsertCodeBlock />
                </>
              ),
            }),
          ]}
        />
      )}
    </section>
  );
}
