import { useEffect, useState, type FormEvent } from "react";
import { FormField } from "@/components/patterns/FormField";
import { StatusBadge } from "@/components/patterns/StatusBadge";
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
import { BOARD_LAYERS, layerName, type BoardLayer } from "./model";
import {
  buildCascadingSubIssuesFromIssue,
  buildDocumentBacklogDrafts,
  type CreateBoardIssueInput,
  type ProjectWritableRepository,
} from "./backlogDerivation";

export type BacklogDeriveSource =
  | {
      kind: "issue";
      issueNumber: number;
      title: string;
      layer: BoardLayer;
      repositoryFullName?: string | null;
      priority?: string | null;
      documentPath?: string | null;
    }
  | {
      kind: "document";
      documentTitle: string;
      documentPath: string;
      markdown: string;
    };

export interface BacklogDeriveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: BacklogDeriveSource | null;
  repositories: ReadonlyArray<ProjectWritableRepository>;
  onSubmit: (items: CreateBoardIssueInput[]) => Promise<void>;
}

export function BacklogDeriveDialog({
  open,
  onOpenChange,
  source,
  repositories,
  onSubmit,
}: BacklogDeriveDialogProps) {
  const [docMode, setDocMode] = useState<"implementation" | "upper">(
    "implementation",
  );
  const [drafts, setDrafts] = useState<CreateBoardIssueInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !source) {
      return;
    }
    setSubmitError(null);
    if (source.kind === "issue") {
      setDrafts(
        buildCascadingSubIssuesFromIssue({
          sourceIssueNumber: source.issueNumber,
          sourceTitle: source.title,
          sourceLayer: source.layer,
          sourceRepositoryFullName: source.repositoryFullName,
          priority: source.priority,
          documentPath: source.documentPath,
          repositories,
        }),
      );
    } else {
      setDrafts(
        buildDocumentBacklogDrafts({
          documentTitle: source.documentTitle,
          documentPath: source.documentPath,
          markdown: source.markdown,
          mode: docMode,
          repositories,
        }),
      );
    }
  }, [open, source, docMode, repositories]);

  const updateDraft = (
    index: number,
    patch: Partial<CreateBoardIssueInput>,
  ) => {
    setDrafts((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    );
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index);
      return filtered.map((item) => ({
        ...item,
        parentBatchIndex:
          item.parentBatchIndex == null
            ? item.parentBatchIndex
            : item.parentBatchIndex === index
              ? null
              : item.parentBatchIndex > index
                ? item.parentBatchIndex - 1
                : item.parentBatchIndex,
        dependsOnBatchIndex:
          item.dependsOnBatchIndex == null
            ? item.dependsOnBatchIndex
            : item.dependsOnBatchIndex === index
              ? null
              : item.dependsOnBatchIndex > index
                ? item.dependsOnBatchIndex - 1
                : item.dependsOnBatchIndex,
      }));
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (drafts.length === 0) {
      setSubmitError("파생할 백로그 항목이 없습니다.");
      return;
    }
    if (drafts.some((d) => !d.title.trim())) {
      setSubmitError("모든 항목의 제목을 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(drafts);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : "하위 백로그 생성에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" aria-label="하위 백로그 파생 미리보기">
        <DialogHeader>
          <div>
            <DialogTitle>
              {source?.kind === "issue"
                ? `#${source.issueNumber} 하위 구현 백로그 파생`
                : "문서 기반 백로그 파생"}
            </DialogTitle>
            <DialogDescription>
              {source?.kind === "issue"
                ? `상위 ${layerName(source.layer)} 문서 확정 후 이어질 개발자 핸드오프([백엔드]·[프론트엔드]) 백로그와 선행 순서(이전 단계: #N)를 일괄 등록합니다. (OkHub는 코드 구현을 수행하지 않습니다.)`
                : `기획 문서(${source?.documentPath ?? ""}) 링크가 포함된 직군별 백로그 세트를 미리 확인하고 일괄 등록합니다. ([기획]·[디자인] 문서화까지만 OkHub AI가 수행합니다.)`}
            </DialogDescription>
          </div>
          <DialogCloseButton label="닫기" />
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)]"
        >
          <DialogBody className="grid gap-[var(--space-3)] pr-[var(--space-1)]">
            {source?.kind === "document" ? (
              <div
                className="flex flex-wrap gap-[var(--space-2)]"
                role="group"
                aria-label="문서 파생 유형"
              >
                <Button
                  type="button"
                  variant={docMode === "implementation" ? "primary" : "secondary"}
                  aria-pressed={docMode === "implementation"}
                  onClick={() => setDocMode("implementation")}
                >
                  개발 핸드오프 세트 (Epic + [백엔드] + [프론트엔드])
                </Button>
                <Button
                  type="button"
                  variant={docMode === "upper" ? "primary" : "secondary"}
                  aria-pressed={docMode === "upper"}
                  onClick={() => setDocMode("upper")}
                >
                  전체 직군 세트 (Epic + [기획]·[디자인]·[백엔드]·[프론트엔드])
                </Button>
              </div>
            ) : null}

            {drafts.length === 0 ? (
              <p className="m-0 text-[var(--color-text-muted)]">
                생성할 파생 항목이 없습니다.
              </p>
            ) : (
              drafts.map((draft, index) => {
                const defaultRepo =
                  draft.repositoryFullName ??
                  repositories[0]?.fullName ??
                  "__default__";
                return (
                  <article
                    key={index}
                    aria-label={`파생 백로그 ${index + 1}`}
                    className="grid gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <StatusBadge tone="info">
                          {layerName(draft.layer ?? "planning")}
                        </StatusBadge>
                        {draft.parentIssueNumber != null ? (
                          <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                            상위 #{draft.parentIssueNumber}
                          </span>
                        ) : draft.parentBatchIndex != null ? (
                          <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                            상위 항목 #{draft.parentBatchIndex + 1}
                          </span>
                        ) : null}
                        {draft.dependsOn != null ? (
                          <StatusBadge tone="neutral">
                            {`이전 단계: #${draft.dependsOn}`}
                          </StatusBadge>
                        ) : draft.dependsOnBatchIndex != null ? (
                          <StatusBadge tone="neutral">
                            {`이전 단계: 항목 #${draft.dependsOnBatchIndex + 1}`}
                          </StatusBadge>
                        ) : null}
                      </div>
                      {drafts.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeDraft(index)}
                        >
                          제외
                        </Button>
                      ) : null}
                    </div>

                    <FormField label={`항목 ${index + 1} 제목`}>
                      <Input
                        value={draft.title}
                        onChange={(event) =>
                          updateDraft(index, { title: event.target.value })
                        }
                      />
                    </FormField>

                    <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                      <FormField label={`항목 ${index + 1} 영역`}>
                        <Select
                          value={draft.layer ?? "planning"}
                          onValueChange={(next) =>
                            updateDraft(index, { layer: next as BoardLayer })
                          }
                        >
                          {BOARD_LAYERS.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>

                      <FormField label={`항목 ${index + 1} 저장소`}>
                        <Select
                          value={defaultRepo}
                          onValueChange={(next) =>
                            updateDraft(index, {
                              repositoryFullName:
                                next === "__default__" ? null : next,
                            })
                          }
                        >
                          {repositories.length === 0 ? (
                            <option value="__default__">기본 저장소</option>
                          ) : (
                            repositories.map((repo) => (
                              <option key={repo.fullName} value={repo.fullName}>
                                {repo.label}
                              </option>
                            ))
                          )}
                        </Select>
                      </FormField>
                    </div>
                  </article>
                );
              })
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
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={drafts.length === 0}
            >
              {`${drafts.length}개 백로그 일괄 등록`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
