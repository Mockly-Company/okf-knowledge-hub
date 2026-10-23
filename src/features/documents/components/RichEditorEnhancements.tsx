import { createContext, useContext, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListNode } from "@lexical/list";
import { usePublisher } from "@mdxeditor/gurx";
import { $getNodeByKey, $createLineBreakNode } from "lexical";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  CodeMirrorEditor, useCodeBlockEditorContext, openEditImageDialog$,
  addComposerChild$, addTableCellEditorChild$, addImportVisitor$, realmPlugin,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { Copy, Check, Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AccessibleListItemNode } from "./AccessibleListItemNode";

export const RichEditorServices = createContext<{ copyText(value: string): Promise<void> }>({
  copyText: (value) => navigator.clipboard.writeText(value),
});

export const editorCodeLanguages = {
  text: "일반 텍스트", typescript: "TypeScript", javascript: "JavaScript",
  json: "JSON", yaml: "YAML", mermaid: "Mermaid",
};

// Override the built-in lineWrapping extension without replacing its editing/keybinding lifecycle.
export const codeEditorLayout = [EditorView.theme({
  ".cm-content": { whiteSpace: "pre", overflowWrap: "normal" },
  ".cm-scroller": { overflowX: "auto" },
  ".cm-scroller:focus-visible": { outline: "2px solid var(--color-primary)", outlineOffset: "-2px" },
}), ViewPlugin.define(view => {
  // The scroll container needs its own Tab stop, separate from the editable text.
  view.scrollDOM.tabIndex = 0;
  view.scrollDOM.setAttribute("role", "group");
  view.scrollDOM.setAttribute("aria-label", "코드 가로 스크롤");
  return {};
})];
export const codeEditorLabel = EditorView.contentAttributes.of({ "aria-label": "코드 내용" });
export const codeEditorHighlight = Prec.highest(syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: "var(--color-editor-code-keyword)" },
  { tag: tags.typeName, color: "var(--color-editor-code-type)" },
  { tag: tags.string, color: "var(--color-editor-code-string)" },
  { tag: tags.propertyName, color: "var(--color-editor-code-property)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-editor-code-number)" },
  { tag: [tags.punctuation, tags.operator], color: "var(--color-editor-code-punctuation)" },
  { tag: tags.comment, color: "var(--color-text-muted)", fontStyle: "italic" },
])));

export function DocumentCodeEditor(props: CodeBlockEditorProps) {
  const { setLanguage, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const { copyText } = useContext(RichEditorServices);
  const [copyStatus, setCopyStatus] = useState("");
  return <div className="document-editor-code" role="group" aria-label="코드 블록" contentEditable={false}>
    <div className="document-editor-code__header">
      <Select aria-label="코드 언어" value={props.language || "text"} onValueChange={setLanguage}>
        {Object.entries(editorCodeLanguages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {props.language && !(props.language in editorCodeLanguages) ? <option value={props.language}>{props.language}</option> : null}
      </Select>
      <div className="document-editor-code__actions">
        <span role="status" className="document-editor-code__status">{copyStatus}</span>
        <IconButton label="코드 복사" onClick={() => { void copyText(props.code).then(() => setCopyStatus("복사 완료"), () => setCopyStatus("복사 실패")); }}>{copyStatus === "복사 완료" ? <Check /> : <Copy />}</IconButton>
        <IconButton label="코드 블록 삭제" onClick={() => parentEditor.update(() => lexicalNode.remove())}><Trash2 /></IconButton>
      </div>
    </div>
    <CodeMirrorEditor {...props} />
  </div>;
}

interface ImageToolsProps {
  nodeKey: string; imageSource: string; initialImagePath: string | null;
  title: string; alt: string; width?: number | "inherit"; height?: number | "inherit";
}

export function DocumentImageTools(props: ImageToolsProps) {
  const [editor] = useLexicalComposerContext();
  const openEdit = usePublisher(openEditImageDialog$);
  return <div className="document-editor-image-tools" contentEditable={false}>
    <IconButton label="이미지 편집" onClick={() => openEdit({ nodeKey: props.nodeKey, initialValues: {
      src: props.initialImagePath ?? props.imageSource, title: props.title, altText: props.alt,
    } })}><Pencil /></IconButton>
    <IconButton label="이미지 삭제" onClick={() => editor.update(() => $getNodeByKey(props.nodeKey)?.remove())}><Trash2 /></IconButton>
  </div>;
}

function EditorSemantics() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const update = () => {
      const root = editor.getRootElement();
      if (!root) return;
      root.querySelectorAll("th").forEach((cell) => {
        if (!cell.textContent?.trim() && !cell.querySelector('[contenteditable="true"]')) {
          if (cell.querySelector("button")) cell.setAttribute("aria-label", "표 편집 도구");
          else {
            // Empty corner spacers are layout, not document column headers.
            cell.setAttribute("role", "presentation");
            cell.removeAttribute("aria-label");
          }
        }
      });
      root.querySelectorAll<HTMLButtonElement>('button[class*="addColumnButton"], button[class*="addRowButton"]').forEach((button) => {
        button.setAttribute("aria-label", button.className.includes("addColumnButton") ? "열 추가" : "행 추가");
      });
      if (root.closest("td, th")) {
        const cell = root.closest("td, th") as HTMLTableCellElement;
        const row = cell.parentElement as HTMLTableRowElement;
        root.setAttribute("aria-label", `표 ${row.rowIndex + 1}행 ${cell.cellIndex + 1}열`);
      }
    };
    let observer: MutationObserver | undefined;
    const unregisterRoot = editor.registerRootListener((root) => {
      observer?.disconnect();
      if (root) {
        observer = new MutationObserver(update);
        observer.observe(root, { childList: true, subtree: true });
      }
      update();
    });
    const unregisterUpdate = editor.registerUpdateListener(update);
    return () => { observer?.disconnect(); unregisterRoot(); unregisterUpdate(); };
  }, [editor]);
  return null;
}

export const editorSemanticsPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, {
      testNode: "listItem", priority: 100,
      visitNode({ mdastNode, lexicalParent, actions }) {
        if (mdastNode.type !== "listItem") { actions.nextVisitor(); return; }
        const checked = $isListNode(lexicalParent) && lexicalParent.getListType() === "check" ? mdastNode.checked ?? false : undefined;
        actions.addAndStepInto(new AccessibleListItemNode(1, checked));
      },
    });
    realm.pub(addImportVisitor$, {
      testNode: "paragraph", priority: 100,
      visitNode({ mdastNode, mdastParent, lexicalParent, actions }) {
        if (mdastNode.type !== "paragraph" || !(lexicalParent instanceof AccessibleListItemNode)) {
          actions.nextVisitor(); return;
        }
        const index = mdastParent?.children.indexOf(mdastNode) ?? -1;
        if (index > 0 && mdastParent?.children[index - 1].type === "paragraph") lexicalParent.append($createLineBreakNode(), $createLineBreakNode());
        actions.visitChildren(mdastNode, lexicalParent);
      },
    });
    realm.pub(addComposerChild$, EditorSemantics);
    realm.pub(addTableCellEditorChild$, EditorSemantics);
  },
});
