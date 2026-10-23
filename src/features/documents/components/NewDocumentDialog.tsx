import { useEffect, useState } from "react";
import { FormField } from "@/components/patterns/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectOption } from "@/components/ui/select";
import { MarkdownDocument } from "./MarkdownDocument";
import { DocumentFolderField } from "./DocumentFolderField";
import type { DocumentContent, DocumentTreeEntry } from "../model";
import { getDocumentTemplateExample } from "../document-template-examples";
import { documentFileName } from "../document-file-name";
import type { DocumentCreationInput } from "../document-authoring-reducer";
import type { DocumentAuthoringState } from "../document-authoring-reducer";
import type { TeamTemplateCopyInput } from "../document-authoring-reducer";

interface NewDocumentDialogProps {
  state: DocumentAuthoringState;
  folderRoots?: DocumentTreeEntry[];
  onClose(): void;
  onCreate(input: DocumentCreationInput): void;
  onUseSuggestion(): void;
  onDuplicateTemplate(input: TeamTemplateCopyInput): void;
}

export function NewDocumentDialog({
  state,
  folderRoots = [],
  onClose,
  onCreate,
}: NewDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState(state.defaultFolder);
  const [templateId, setTemplateId] = useState("builtin:blank");

  useEffect(() => setFolder(state.defaultFolder), [state.defaultFolder]);
  useEffect(() => { if (!state.dialogOpen) { setTitle(""); setTemplateId("builtin:blank"); setFolder(state.defaultFolder); } }, [state.dialogOpen, state.defaultFolder]);
  const fileName = documentFileName(title);

  const templates = state.templateCatalog.templates;
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const example = getDocumentTemplateExample(templateId);
  const previewTitle = example?.title ?? (title.trim() || "문서 제목");
  const previewMarkdown = example?.markdown ?? selectedTemplate?.body.replaceAll("{{title}}", previewTitle) ?? "";
  const preview: DocumentContent = {
    summary: {
      path: selectedTemplate?.source === "team"
        ? `.okf/templates/${selectedTemplate.id.replace(/^team:/, "")}`
        : `${folder}/${fileName || "document.md"}`,
      fileName: fileName || "document.md",
      title: previewTitle,
      documentId: null,
      frontmatterStatus: { status: "missing" },
      modifiedAtUnixMs: 0,
      size: previewMarkdown.length,
    },
    markdown: previewMarkdown,
    properties: {},
    tableOfContents: [],
    lastCommit: null,
  };

  if (!state.dialogOpen) return null;
  const busy = ["validating", "creating"].includes(state.creation.status);
  const canCreate = title.trim() !== "" && fileName.trim() !== "" && !busy;

  return (
    <Dialog open={state.dialogOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="new-document-dialog w-[min(calc(100vw-3rem),64rem)]" onEscapeKeyDown={event => {
        if (event.target instanceof Element && event.target.closest(".document-folder-field__creation")) event.preventDefault();
      }}>
        <header>
          <div>
            <DialogTitle id="new-document-title">새 문서</DialogTitle>
            <DialogDescription>
              로컬 Draft에서 작성한 뒤 나중에 검수와 PR로 확정할 수 있습니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="새 문서 창 닫기" onClick={onClose} />
        </header>

        <DialogBody className="new-document-dialog__body">
        <div className="new-document-dialog__columns">
        <div className="new-document-dialog__form-column">
        <div className="new-document-dialog__fields">
          <div className="new-document-dialog__title-field"><FormField label="제목" description="파일명은 제목으로 자동 생성되며, 중복 시 숫자가 붙습니다.">
            <Input
              autoFocus
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="제목을 입력해주세요"
            />
          </FormField></div>
          <DocumentFolderField roots={folderRoots} value={folder} onValueChange={setFolder} disabled={busy} />
        </div>

        <FormField label="템플릿" description={selectedTemplate?.description}>
          <Select value={templateId} onValueChange={setTemplateId}>
            {templates.map((template) => (
              <SelectOption
                key={template.id}
                value={template.id}
                description={template.source === "team" ? "팀 템플릿" : "기본 템플릿"}
              >
                {template.label}
              </SelectOption>
            ))}
          </Select>
        </FormField>
        </div>
        <section aria-label="템플릿 미리보기" className="new-document-dialog__preview">
          <h3>{example ? "작성 예시" : "템플릿 구조"}</h3>
          <p className="new-document-dialog__preview-note">
            {templateId === "builtin:blank" ? "제목만 포함된 빈 문서로 시작합니다." : example ? "가상 작성 예시입니다. 예시 내용은 생성되는 문서에 포함되지 않습니다." : "등록된 작성 예시가 없어 실제 템플릿 구조를 보여줍니다."}
          </p>
          <div className="new-document-dialog__preview-frame" role="group" aria-label="템플릿 본문 미리보기" tabIndex={0}>
          {selectedTemplate ? (
            <MarkdownDocument document={preview} hideHeader />
          ) : (
            <p className="text-[var(--color-text-muted)]">템플릿을 선택하면 미리보기가 표시됩니다.</p>
          )}
          </div>
        </section>
        </div>

        {state.templateCatalog.diagnostics.length > 0 ? (
          <div className="new-document-dialog__template-diagnostics" role="alert">
            <strong>불러오지 못한 팀 템플릿</strong>
            <ul>
              {state.templateCatalog.diagnostics.map((diagnostic) => (
                <li key={diagnostic.templateId}>
                  <code>{diagnostic.templateId}</code>: {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.creation.error ? (
          <p className="new-document-dialog__error" role="alert">
            {state.creation.error.message}
          </p>
        ) : null}

        </DialogBody>
        <footer>
          <div>
            <Button variant="secondary" onClick={onClose}>취소</Button>
            <Button
              disabled={!canCreate}
              onClick={() =>
                onCreate({
                  title: title.trim(),
                  fileName: fileName.trim(),
                  folder: folder.trim(),
                  templateId,
                  separateChange: false,
                })
              }
            >
              {busy ? "만드는 중…" : "문서 만들기"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
