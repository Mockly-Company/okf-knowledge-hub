import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FormField } from "@/components/patterns/FormField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BOARD_LAYERS,
  BOARD_STATUSES,
  type BoardLayer,
  type BoardStatus,
} from "./model";
import {
  buildEpicStarterDrafts,
  pickDefaultRepository,
  type CreateBoardIssueInput,
  type ProjectWritableRepository,
} from "./backlogDerivation";

const NONE_OPTION = "__none__";
const AUTO_REPO = "__auto__";

export interface CreateBoardIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositories: ReadonlyArray<ProjectWritableRepository>;
  defaultLayer?: BoardLayer;
  defaultStatus?: BoardStatus;
  defaultParentIssueNumber?: number | null;
  defaultParentIssueRepository?: string | null;
  defaultMode?: "single" | "epic_starter";
  onSubmit: (items: CreateBoardIssueInput[]) => Promise<void>;
}

export function CreateBoardIssueDialog({
  open,
  onOpenChange,
  repositories,
  defaultLayer = "planning",
  defaultStatus = "backlog",
  defaultParentIssueNumber = null,
  defaultParentIssueRepository = null,
  defaultMode = "single",
  onSubmit,
}: CreateBoardIssueDialogProps) {
  const [mode, setMode] = useState<"single" | "epic_starter">(defaultMode);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [layer, setLayer] = useState<BoardLayer>(defaultLayer);
  const [status, setStatus] = useState<BoardStatus>(defaultStatus);
  const [kind, setKind] = useState<string>("작업");
  const [priority, setPriority] = useState<string>(NONE_OPTION);
  const [repositoryFullName, setRepositoryFullName] = useState<string>(AUTO_REPO);
  const [parentIssueInput, setParentIssueInput] = useState<string>(
    defaultParentIssueNumber ? String(defaultParentIssueNumber) : "",
  );
  const [dependsOnInput, setDependsOnInput] = useState<string>("");
  const [documentPath, setDocumentPath] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode(defaultParentIssueNumber ? "single" : defaultMode);
    setTitle("");
    setBody("");
    setLayer(defaultLayer);
    setStatus(defaultStatus);
    setKind(defaultParentIssueNumber ? "작업" : "기능");
    setPriority(NONE_OPTION);
    setRepositoryFullName(AUTO_REPO);
    setParentIssueInput(
      defaultParentIssueNumber ? String(defaultParentIssueNumber) : "",
    );
    setDependsOnInput("");
    setDocumentPath("");
    setSubmitError(null);
  }, [
    open,
    defaultMode,
    defaultLayer,
    defaultStatus,
    defaultParentIssueNumber,
  ]);

  const resolvedDefaultRepo = useMemo(() => {
    const preferredRole =
      layer === "frontend" || layer === "backend" || layer === "design"
        ? "code"
        : "docs";
    return pickDefaultRepository(repositories, preferredRole) ?? "";
  }, [layer, repositories]);

  const starterPreview = useMemo(() => {
    if (mode !== "epic_starter") {
      return [];
    }
    return buildEpicStarterDrafts({
      epicTitle: title || "신규 기능",
      epicBody: body,
      documentPath: documentPath || null,
      priority: priority === NONE_OPTION ? null : priority,
      repositories,
    });
  }, [mode, title, body, documentPath, priority, repositories]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSubmitError("제목을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "epic_starter") {
        const drafts = buildEpicStarterDrafts({
          epicTitle: trimmedTitle,
          epicBody: body,
          documentPath: documentPath || null,
          priority: priority === NONE_OPTION ? null : priority,
          repositories,
        });
        await onSubmit(drafts);
      } else {
        const parsedParent = parentIssueInput.trim()
          ? Number.parseInt(parentIssueInput.trim().replace(/^#/, ""), 10)
          : null;
        if (
          parentIssueInput.trim() &&
          (parsedParent === null || Number.isNaN(parsedParent) || parsedParent <= 0)
        ) {
          setSubmitError("상위 이슈 번호는 양의 정수여야 합니다.");
          setSubmitting(false);
          return;
        }
        const parsedDependsOn = dependsOnInput.trim()
          ? Number.parseInt(dependsOnInput.trim().replace(/^#/, ""), 10)
          : null;
        if (
          dependsOnInput.trim() &&
          (parsedDependsOn === null ||
            Number.isNaN(parsedDependsOn) ||
            parsedDependsOn <= 0)
        ) {
          setSubmitError("선행 이슈 번호는 양의 정수여야 합니다.");
          setSubmitting(false);
          return;
        }

        const chosenRepo =
          repositoryFullName === AUTO_REPO
            ? resolvedDefaultRepo || null
            : repositoryFullName;

        await onSubmit([
          {
            repositoryFullName: chosenRepo,
            title: trimmedTitle,
            body,
            layer,
            status,
            kind: kind === NONE_OPTION ? null : kind,
            priority: priority === NONE_OPTION ? null : priority,
            parentIssueNumber: parsedParent,
            parentIssueRepository:
              parsedParent && parsedParent === defaultParentIssueNumber
                ? defaultParentIssueRepository
                : null,
            dependsOn: parsedDependsOn,
          },
        ]);
      }
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : "이슈 생성에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" aria-label="새 보드 이슈 생성">
        <DialogHeader>
          <div>
            <DialogTitle>
              {defaultParentIssueNumber
                ? `#${defaultParentIssueNumber} 하위 이슈 추가`
                : "새 보드 이슈 만들기"}
            </DialogTitle>
            <DialogDescription>
              활성 GitHub Project와 연결된 저장소에 이슈를 등록하고 보드 필드(Status·영역·타입·Priority)를 즉시 설정합니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="닫기" />
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)]"
        >
          <DialogBody className="grid gap-[var(--space-4)] pr-[var(--space-1)]">
            {defaultParentIssueNumber == null ? (
              <div
                className="flex flex-wrap gap-[var(--space-2)]"
                role="group"
                aria-label="생성 방식"
              >
                <Button
                  type="button"
                  variant={mode === "single" ? "primary" : "secondary"}
                  aria-pressed={mode === "single"}
                  onClick={() => setMode("single")}
                >
                  단일 이슈 / 하위 이슈
                </Button>
                <Button
                  type="button"
                  variant={mode === "epic_starter" ? "primary" : "secondary"}
                  aria-pressed={mode === "epic_starter"}
                  onClick={() => setMode("epic_starter")}
                >
                  새 Epic + [기획]/[디자인] 상위 백로그 세트
                </Button>
              </div>
            ) : null}

            <FormField
              label={mode === "epic_starter" ? "Epic 기능명" : "이슈 제목"}
              required
            >
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  mode === "epic_starter"
                    ? "예: 결제 환불 자동화"
                    : "예: [기획] 환불 승인 정책 명세"
                }
              />
            </FormField>

            {mode === "epic_starter" ? (
              <>
                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  <FormField
                    label="연결 기획 문서 경로 (선택)"
                    description="본문에 AI 정본(.md) 참조 링크를 함께 넣습니다."
                  >
                    <Input
                      value={documentPath}
                      onChange={(event) => setDocumentPath(event.target.value)}
                      placeholder="예: docs/product/refund-spec.md"
                    />
                  </FormField>
                  <FormField label="Priority">
                    <Select value={priority} onValueChange={setPriority}>
                      <option value={NONE_OPTION}>지정 안 함</option>
                      <option value="P0">P0</option>
                      <option value="P1">P1</option>
                      <option value="P2">P2</option>
                    </Select>
                  </FormField>
                </div>

                <FormField label="배경 및 목표">
                  <Textarea
                    rows={4}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="해결하려는 문제와 핵심 요구사항을 적어 주세요."
                  />
                </FormField>

                <section
                  aria-label="상위 백로그 자동 구성 미리보기"
                  className="grid gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)]"
                >
                  <p className="m-0 text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    생성될 상위 백로그 (총 {starterPreview.length}건)
                  </p>
                  <ul className="m-0 grid gap-[var(--space-1)] pl-[var(--space-4)] text-[length:var(--font-meta-size)] text-[var(--color-text-default)]">
                    {starterPreview.map((draft, idx) => (
                      <li key={idx}>
                        <strong>{draft.title}</strong>
                        {draft.repositoryFullName
                          ? ` → ${draft.repositoryFullName}`
                          : ""}
                        {draft.dependsOnBatchIndex != null
                          ? " (기획 완료 후 진행)"
                          : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : (
              <>
                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  <FormField label="대상 저장소">
                    <Select
                      value={repositoryFullName}
                      onValueChange={setRepositoryFullName}
                    >
                      <option value={AUTO_REPO}>
                        {resolvedDefaultRepo
                          ? `자동 선택 (${resolvedDefaultRepo})`
                          : "연결된 기본 저장소"}
                      </option>
                      {repositories.map((repo) => (
                        <option key={repo.fullName} value={repo.fullName}>
                          {repo.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="영역 (Layer)">
                    <Select
                      value={layer}
                      onValueChange={(next) => setLayer(next as BoardLayer)}
                    >
                      {BOARD_LAYERS.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
                  <FormField label="상태 (Status)">
                    <Select
                      value={status}
                      onValueChange={(next) => setStatus(next as BoardStatus)}
                    >
                      {BOARD_STATUSES.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="타입">
                    <Select value={kind} onValueChange={setKind}>
                      <option value="기능">기능 (Epic/Story)</option>
                      <option value="작업">작업 (Task)</option>
                      <option value={NONE_OPTION}>지정 안 함</option>
                    </Select>
                  </FormField>

                  <FormField label="Priority">
                    <Select value={priority} onValueChange={setPriority}>
                      <option value={NONE_OPTION}>지정 안 함</option>
                      <option value="P0">P0</option>
                      <option value="P1">P1</option>
                      <option value="P2">P2</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  <FormField
                    label="상위 이슈 번호 (Sub-issue)"
                    description="비워 두면 최상위 항목으로 등록됩니다."
                  >
                    <Input
                      value={parentIssueInput}
                      onChange={(event) => setParentIssueInput(event.target.value)}
                      placeholder="예: 47"
                    />
                  </FormField>

                  <FormField
                    label="선행 이슈 번호 (이전 단계: #N)"
                    description="본문에 `이전 단계: #N`을 자동으로 추가합니다."
                  >
                    <Input
                      value={dependsOnInput}
                      onChange={(event) => setDependsOnInput(event.target.value)}
                      placeholder="예: 48"
                    />
                  </FormField>
                </div>

                <FormField label="본문 및 완료 조건">
                  <Textarea
                    rows={5}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={"## 완료 조건\n- [ ] 핵심 시나리오 검증 통과"}
                  />
                </FormField>
              </>
            )}

            {submitError ? (
              <p
                role="alert"
                className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-error)]"
              >
                {submitError}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {mode === "epic_starter" ? "상위 백로그 일괄 생성" : "이슈 생성"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
