import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, GitPullRequest, FileText, Play, Plus, Sparkles } from "lucide-react";
import { FormField } from "@/components/patterns/FormField";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dialogOverlayClassName } from "@/components/ui/dialog-styles";
import { Select } from "@/components/ui/select";
import {
  BOARD_LAYERS,
  BOARD_STATUSES,
  layerName,
  statusName,
  type BoardIssue,
  type BoardLayer,
  type BoardStatus,
} from "./model";
import { safeHref } from "./boardUtils";
import type {
  ProjectBoardIssueDetail,
  UpdateBoardItemInput,
} from "./ProjectBoardGateway";
import type { IssueReadiness } from "./readyFilter";

const PRIORITY_UNSET = "__unset__";

export interface ProjectIssueDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: BoardIssue | null;
  detail: ProjectBoardIssueDetail | null;
  isLoadingDetail: boolean;
  detailError: string | null;
  readiness: IssueReadiness | null;
  isUpdating: boolean;
  updateError: string | null;
  onRetryDetail?: () => void;
  onUpdateField?: (patch: Omit<UpdateBoardItemInput, "issueNumber">) => void;
  onAddSubIssue?: (issue: BoardIssue, repositoryFullName: string | null) => void;
  onDeriveBacklog?: (
    issue: BoardIssue,
    detail: ProjectBoardIssueDetail | null,
  ) => void;
  onStartWithAi?: (
    issue: BoardIssue,
    detail: ProjectBoardIssueDetail | null,
  ) => void;
}

export function ProjectIssueDrawer({
  open,
  onOpenChange,
  issue,
  detail,
  isLoadingDetail,
  detailError,
  readiness,
  isUpdating,
  updateError,
  onRetryDetail,
  onUpdateField,
  onAddSubIssue,
  onDeriveBacklog,
  onStartWithAi,
}: ProjectIssueDrawerProps) {
  const effectiveStatus = issue?.status ?? detail?.status ?? "backlog";
  const effectiveLayer = issue?.layer ?? detail?.layer ?? "planning";
  const effectivePriority = detail?.priority ?? PRIORITY_UNSET;
  const priorityOptions =
    detail && detail.priorityOptions.length > 0
      ? detail.priorityOptions
      : ["P0", "P1", "P2"];
  const canDeriveCascading =
    effectiveLayer === "planning" || effectiveLayer === "design";
  const githubHref = issue ? safeHref(issue.url) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClassName} />
        <DialogPrimitive.Content
          aria-label={
            issue ? `이슈 #${issue.number} 상세` : "보드 이슈 상세"
          }
          className="okhub-dialog-content-motion fixed inset-y-0 right-0 z-50 flex w-[min(100vw,34rem)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--dialog-padding)] shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-control-duration)] ease-[var(--motion-control-easing)] motion-reduce:animate-none motion-reduce:transition-none"
        >
          {issue ? (
            <>
              <DialogHeader>
                <div className="min-w-0 flex-1">
                  <div className="mb-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-2)]">
                    <span className="text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-muted)]">
                      #{issue.number}
                    </span>
                    <StatusBadge tone="neutral">
                      {statusName(effectiveStatus)}
                    </StatusBadge>
                    <StatusBadge tone="info">
                      {layerName(effectiveLayer)}
                    </StatusBadge>
                    {readiness?.state === "ready" ? (
                      <StatusBadge tone="success">시작 가능</StatusBadge>
                    ) : readiness?.state === "blocked" &&
                      readiness.waitingOn != null ? (
                      <StatusBadge tone="warning">
                        {`선행 #${readiness.waitingOn} 대기`}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <DialogTitle className="break-words">
                    {issue.title}
                  </DialogTitle>
                  <DialogDescription>
                    {detail?.repositoryFullName
                      ? `저장소: ${detail.repositoryFullName}`
                      : "활성 프로젝트 보드 항목"}
                  </DialogDescription>
                </div>
                <DialogCloseButton label="상세 닫기" />
              </DialogHeader>

              <DialogBody className="mt-[var(--space-4)] grid content-start gap-[var(--space-5)] pr-[var(--space-1)]">
                {onUpdateField ? (
                  <section
                    aria-label="필드 빠른 변경"
                    className="grid gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] sm:grid-cols-3"
                  >
                    <FormField label="상태 (Status)">
                      <Select
                        aria-label="이슈 상태 변경"
                        value={effectiveStatus}
                        disabled={isUpdating}
                        onValueChange={(next) =>
                          onUpdateField({
                            repositoryFullName: detail?.repositoryFullName,
                            status: next as BoardStatus,
                          })
                        }
                      >
                        {BOARD_STATUSES.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    <FormField label="영역 (Layer)">
                      <Select
                        aria-label="이슈 영역 변경"
                        value={effectiveLayer}
                        disabled={isUpdating}
                        onValueChange={(next) =>
                          onUpdateField({
                            repositoryFullName: detail?.repositoryFullName,
                            layer: next as BoardLayer,
                          })
                        }
                      >
                        {BOARD_LAYERS.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    <FormField label="Priority">
                      <Select
                        aria-label="이슈 우선순위 변경"
                        value={effectivePriority}
                        disabled={isUpdating || isLoadingDetail}
                        onValueChange={(next) =>
                          onUpdateField({
                            repositoryFullName: detail?.repositoryFullName,
                            priority: next === PRIORITY_UNSET ? null : next,
                          })
                        }
                      >
                        <option value={PRIORITY_UNSET}>지정 안 함</option>
                        {priorityOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </Select>
                    </FormField>

                    {updateError ? (
                      <p
                        role="alert"
                        className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-error)] sm:col-span-3"
                      >
                        {updateError}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {isLoadingDetail ? (
                  <p
                    role="status"
                    className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]"
                  >
                    이슈 상세 정보와 연결 문서·PR을 불러오는 중입니다…
                  </p>
                ) : detailError ? (
                  <div
                    role="alert"
                    className="grid gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-error-border)] bg-[var(--color-surface)] p-[var(--space-3)]"
                  >
                    <p className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-error)]">
                      {detailError}
                    </p>
                    {onRetryDetail ? (
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={onRetryDetail}
                        >
                          다시 불러오기
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <section aria-label="이슈 본문 및 완료 조건" className="grid gap-[var(--space-2)]">
                  <h3 className="m-0 text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    본문 및 완료 조건
                  </h3>
                  <div className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] text-[length:var(--font-meta-size)] leading-[var(--font-document-line)] text-[var(--color-text-default)]">
                    {detail?.body?.trim()
                      ? detail.body
                      : "등록된 본문이 없습니다."}
                  </div>
                </section>

                <section aria-label="하위 이슈 목록" className="grid gap-[var(--space-2)]">
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <h3 className="m-0 text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                      Sub-issues (
                      {detail ? detail.subIssues.length : issue.children.length}
                      )
                    </h3>
                    {onAddSubIssue ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          onAddSubIssue(issue, detail?.repositoryFullName ?? null)
                        }
                      >
                        <Plus aria-hidden="true" strokeWidth={1.75} />
                        하위 이슈 추가
                      </Button>
                    ) : null}
                  </div>
                  {(detail ? detail.subIssues : issue.children).length === 0 ? (
                    <p className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      연결된 하위 이슈가 없습니다.
                    </p>
                  ) : (
                    <ul className="m-0 grid list-none gap-[var(--space-1)] p-0">
                      {(detail ? detail.subIssues : issue.children).map((sub) => {
                        const subHref = safeHref(sub.url);
                        return (
                          <li
                            key={`${sub.number}-${sub.url}`}
                            className="flex items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--font-meta-size)]"
                          >
                            {subHref ? (
                              <a
                                href={subHref}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="min-w-0 truncate text-[var(--color-text-strong)] no-underline hover:underline"
                              >
                                #{sub.number} {sub.title}
                              </a>
                            ) : (
                              <span className="min-w-0 truncate">
                                #{sub.number} {sub.title}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section aria-label="연결된 문서" className="grid gap-[var(--space-2)]">
                  <h3 className="m-0 text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    연결된 문서 (.md / .html)
                  </h3>
                  {!detail || detail.linkedDocuments.length === 0 ? (
                    <p className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      본문에서 참조된 기획 문서(`.md`)가 없습니다.
                    </p>
                  ) : (
                    <ul className="m-0 grid list-none gap-[var(--space-1)] p-0">
                      {detail.linkedDocuments.map((doc) => (
                        <li
                          key={doc.path}
                          className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--font-meta-size)]"
                        >
                          <span className="flex items-center gap-[var(--space-2)] font-mono text-[var(--color-text-strong)]">
                            <FileText
                              aria-hidden="true"
                              className="size-[var(--icon-size)] text-[var(--color-text-muted)]"
                            />
                            {doc.path}
                          </span>
                          <StatusBadge
                            tone={doc.hasCompanionHtml ? "success" : "neutral"}
                          >
                            {doc.hasCompanionHtml
                              ? "2벌 (.md + .html)"
                              : ".md 단독"}
                          </StatusBadge>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-label="연결된 PR" className="grid gap-[var(--space-2)]">
                  <h3 className="m-0 text-[length:var(--font-meta-size)] font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    연결된 열린 PR
                  </h3>
                  {!detail || detail.linkedPullRequests.length === 0 ? (
                    <p className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      연결된 열린 PR이 없습니다.
                    </p>
                  ) : (
                    <ul className="m-0 grid list-none gap-[var(--space-1)] p-0">
                      {detail.linkedPullRequests.map((pr) => {
                        const prHref = safeHref(pr.htmlUrl);
                        return (
                          <li
                            key={`${pr.repositoryFullName}#${pr.number}`}
                            className="flex items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--font-meta-size)]"
                          >
                            <span className="flex min-w-0 items-center gap-[var(--space-2)]">
                              <GitPullRequest
                                aria-hidden="true"
                                className="size-[var(--icon-size)] shrink-0 text-[var(--color-text-muted)]"
                              />
                              {prHref ? (
                                <a
                                  href={prHref}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="truncate text-[var(--color-text-strong)] no-underline hover:underline"
                                >
                                  #{pr.number} {pr.title}
                                </a>
                              ) : (
                                <span className="truncate">
                                  #{pr.number} {pr.title}
                                </span>
                              )}
                            </span>
                            {pr.isDraft ? (
                              <StatusBadge tone="neutral">Draft</StatusBadge>
                            ) : (
                              <StatusBadge tone="info">Open</StatusBadge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </DialogBody>

              <DialogFooter className="mt-[var(--space-4)] justify-between border-t border-[var(--color-border)] pt-[var(--space-3)]">
                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  {githubHref ? (
                    <Button asChild variant="ghost">
                      <a
                        href={githubHref}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <ExternalLink aria-hidden="true" strokeWidth={1.75} />
                        GitHub
                      </a>
                    </Button>
                  ) : null}
                  {canDeriveCascading && onDeriveBacklog ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onDeriveBacklog(issue, detail)}
                    >
                      <Sparkles aria-hidden="true" strokeWidth={1.75} />
                      하위 백로그 파생
                    </Button>
                  ) : null}
                </div>

                {onStartWithAi ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => onStartWithAi(issue, detail)}
                  >
                    <Play aria-hidden="true" strokeWidth={1.75} />
                    AI로 작업 시작
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
