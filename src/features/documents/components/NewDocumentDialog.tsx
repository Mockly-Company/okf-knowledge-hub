import { Check, FilePlus2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import type { DocumentCreationInput } from "../document-authoring-reducer";
import type { DocumentAuthoringState } from "../document-authoring-reducer";
import type { TeamTemplateCopyInput } from "../document-authoring-reducer";

interface NewDocumentDialogProps {
  state: DocumentAuthoringState;
  onClose(): void;
  onCreate(input: DocumentCreationInput): void;
  onUseSuggestion(): void;
  onDuplicateTemplate(input: TeamTemplateCopyInput): void;
}

export function NewDocumentDialog({
  state,
  onClose,
  onCreate,
  onUseSuggestion,
  onDuplicateTemplate,
}: NewDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [folder, setFolder] = useState(state.defaultFolder);
  const [templateId, setTemplateId] = useState("builtin:blank");
  const [separateChange, setSeparateChange] = useState(false);
  const [copyingTemplate, setCopyingTemplate] = useState(false);
  const [teamLabel, setTeamLabel] = useState("");
  const [teamFileName, setTeamFileName] = useState("");

  useEffect(() => setFolder(state.defaultFolder), [state.defaultFolder]);

  const templates = useMemo(
    () => ({
      builtIn: state.templateCatalog.templates.filter(
        (template) => template.source === "built_in",
      ),
      team: state.templateCatalog.templates.filter(
        (template) => template.source === "team",
      ),
    }),
    [state.templateCatalog.templates],
  );

  if (!state.dialogOpen) return null;
  const busy = ["validating", "creating"].includes(state.creation.status);
  const canCreate = title.trim() !== "" && fileName.trim() !== "" && !busy;

  const templateGroup = (
    label: string,
    items: typeof templates.builtIn,
  ) =>
    items.length > 0 ? (
      <section className="new-document-dialog__templates" aria-label={label}>
        <h3>{label}</h3>
        <div className="new-document-dialog__template-grid">
          {items.map((template) => {
            const selected = template.id === templateId;
            return (
              <UnstyledButton
                key={template.id}
                type="button"
                className={selected ? "is-selected" : undefined}
                aria-pressed={selected}
                onClick={() => setTemplateId(template.id)}
              >
                <FilePlus2 aria-hidden="true" />
                <span>
                  <strong>{template.label}</strong>
                  {template.description ? <small>{template.description}</small> : null}
                </span>
                {selected ? <Check aria-hidden="true" /> : null}
              </UnstyledButton>
            );
          })}
        </div>
      </section>
    ) : null;

  return (
    <Dialog open={state.dialogOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="new-document-dialog">
        <header>
          <div>
            <DialogTitle id="new-document-title">새 문서</DialogTitle>
            <DialogDescription>
              로컬 Draft에서 작성한 뒤 나중에 검수와 PR로 확정할 수 있습니다.
            </DialogDescription>
          </div>
          <Button variant="icon" aria-label="새 문서 창 닫기" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="new-document-dialog__fields">
          <label>
            <span>제목</span>
            <Input
              autoFocus
              value={title}
              onChange={(event) => {
                const value = event.target.value;
                setTitle(value);
                if (!fileNameTouched) setFileName(value);
              }}
              placeholder="예: 지도 검색 API 계약"
            />
          </label>
          <label>
            <span>파일명</span>
            <Input
              value={fileName}
              onChange={(event) => {
                setFileNameTouched(true);
                setFileName(event.target.value);
              }}
              placeholder="map-search-api.md"
            />
          </label>
          <label>
            <span>폴더</span>
            <Input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="docs/api"
            />
          </label>
        </div>

        <div className="new-document-dialog__template-list">
          {templateGroup("기본 템플릿", templates.builtIn)}
          {templateGroup("팀 템플릿", templates.team)}
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

        {copyingTemplate ? (
          <section className="new-document-dialog__team-copy" aria-label="팀 템플릿 만들기">
            <h3>선택한 템플릿을 팀 템플릿으로 복제</h3>
            <p>생성된 파일은 <code>.okf/templates/</code>에서 Git으로 공유됩니다.</p>
            <div>
              <label>
                <span>표시 이름</span>
                <Input value={teamLabel} onChange={(event) => setTeamLabel(event.target.value)} />
              </label>
              <label>
                <span>파일명</span>
                <Input value={teamFileName} onChange={(event) => setTeamFileName(event.target.value)} />
              </label>
            </div>
            <div className="new-document-dialog__team-copy-actions">
              <Button variant="secondary" onClick={() => setCopyingTemplate(false)}>닫기</Button>
              <Button
                disabled={teamLabel.trim() === "" || teamFileName.trim() === "" || state.templateCopy.status === "copying"}
                onClick={() =>
                  onDuplicateTemplate({
                    sourceTemplateId: templateId,
                    label: teamLabel.trim(),
                    fileName: teamFileName.trim(),
                    description: null,
                    separateChange,
                  })
                }
              >
                {state.templateCopy.status === "copying" ? "복제 중…" : "팀 템플릿 만들기"}
              </Button>
            </div>
            {state.templateCopy.path ? <p role="status">{state.templateCopy.path}에 만들었습니다.</p> : null}
            {state.templateCopy.error ? <p role="alert">{state.templateCopy.error.message}</p> : null}
          </section>
        ) : (
          <Button variant="secondary" onClick={() => setCopyingTemplate(true)}>
            선택한 템플릿을 팀 템플릿으로 복제
          </Button>
        )}

        {state.creation.status === "collision" ? (
          <div className="new-document-dialog__notice" role="alert">
            <span>같은 경로에 문서가 있습니다.</span>
            {state.creation.validation?.suggestedFileName ? (
              <Button variant="secondary" onClick={onUseSuggestion}>
                {state.creation.validation.suggestedFileName} 사용
              </Button>
            ) : null}
          </div>
        ) : null}
        {state.creation.error ? (
          <p className="new-document-dialog__error" role="alert">
            {state.creation.error.message}
          </p>
        ) : null}

        <footer>
          <label className="new-document-dialog__separate-change">
            <Checkbox
              checked={separateChange}
              onChange={(event) => setSeparateChange(event.target.checked)}
            />
            <span>별도 변경으로 만들기</span>
          </label>
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
                  separateChange,
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
