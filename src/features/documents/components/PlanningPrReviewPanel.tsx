import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitPullRequest, ArrowLeft, Check } from "lucide-react";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { useDocuments } from "../DocumentsProvider";
import { compareDocumentLines, type DocumentDiffLine } from "../document-diff";
import type { DocumentContent, PlanningPrDocumentChange } from "../model";
import { documentsKeys } from "../queryKeys";
import { MarkdownDocument } from "./MarkdownDocument";
import "./DocumentPublicationDialog.css";

type ReviewTab = "html" | "markdown" | "diff";

function toPreviewDocument(
  path: string,
  title: string,
  markdown: string,
): DocumentContent {
  return {
    summary: {
      path,
      fileName: path.split("/").at(-1) ?? path,
      title,
      documentId: null,
      frontmatterStatus: { status: "missing" },
      modifiedAtUnixMs: 0,
      size: markdown.length,
    },
    markdown,
    properties: {},
    tableOfContents: [],
    lastCommit: null,
  };
}

function changeStatusMeta(status: string): {
  label: string;
  tone: "success" | "info" | "warning" | "neutral";
} {
  switch (status) {
    case "added":
      return { label: "+ 추가", tone: "success" };
    case "removed":
      return { label: "− 삭제", tone: "warning" };
    case "renamed":
      return { label: "→ 이동", tone: "info" };
    default:
      return { label: "~ 수정", tone: "info" };
  }
}

function defaultTabForDocument(
  doc: PlanningPrDocumentChange | null,
): ReviewTab {
  if (!doc) return "markdown";
  if (doc.hasCompanionHtml && doc.companionHtml) return "html";
  if (doc.headMarkdown === null) return "diff";
  return "markdown";
}

function DiffCell({
  line,
  side,
  otherNumber,
}: {
  line: DocumentDiffLine | null;
  side: "before" | "after";
  otherNumber?: number;
}) {
  return (
    <div
      className={`document-source-diff__cell document-source-diff__cell--${side}`}
      data-kind={line?.kind ?? "gap"}
    >
      <span className="document-source-diff__number" aria-hidden="true">
        {line?.number}
      </span>
      <span className="document-source-diff__other-number" aria-hidden="true">
        {otherNumber}
      </span>
      <span className="document-source-diff__marker" aria-hidden="true">
        {line?.kind === "removed" ? "−" : line?.kind === "added" ? "+" : ""}
      </span>
      <span className="document-source-diff__text">
        {line?.kind === "removed" ? (
          <span className="sr-only">삭제: </span>
        ) : line?.kind === "added" ? (
          <span className="sr-only">추가: </span>
        ) : null}
        {line?.text || " "}
      </span>
    </div>
  );
}

export function PlanningPrReviewSection() {
  const {
    state,
    listDocsPullRequests,
    getDocsPullRequestDetail,
    approveAndMergeDocsPullRequest,
    openExternal,
  } = useDocuments();
  const sessionId = state.activeSessionId;
  const ready = state.status === "ready" && sessionId !== null;

  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ReviewTab>("html");
  const [reviewComment, setReviewComment] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);

  const pullRequestsQuery = useQuery({
    queryKey: documentsKeys.pullRequests(sessionId ?? "inactive"),
    queryFn: () => listDocsPullRequests(),
    enabled: ready,
    staleTime: 15_000,
  });

  const detailQuery = useQuery({
    queryKey: documentsKeys.pullRequestDetail(
      sessionId ?? "inactive",
      selectedPrNumber ?? 0,
    ),
    queryFn: () => getDocsPullRequestDetail(selectedPrNumber!),
    enabled: ready && selectedPrNumber !== null,
  });

  useEffect(() => {
    setSelectedPrNumber(null);
    setSelectedDocPath(null);
    setApproveError(null);
    setApprovalNotice(null);
  }, [state.repositoryFullName]);

  const openPullRequests = pullRequestsQuery.data ?? [];
  const detail = detailQuery.data ?? null;
  const activeDoc = useMemo(() => {
    if (!detail || detail.documents.length === 0) return null;
    return (
      detail.documents.find((item) => item.path === selectedDocPath) ??
      detail.documents[0]
    );
  }, [detail, selectedDocPath]);

  useEffect(() => {
    if (!activeDoc) return;
    setViewTab(defaultTabForDocument(activeDoc));
  }, [selectedPrNumber, activeDoc?.path, activeDoc?.hasCompanionHtml]);

  const diffRows = useMemo(() => {
    if (!activeDoc) return [];
    return compareDocumentLines(
      activeDoc.baseMarkdown ?? "",
      activeDoc.headMarkdown ?? "",
    );
  }, [activeDoc]);

  const handleOpenPr = (number: number) => {
    setSelectedPrNumber(number);
    setSelectedDocPath(null);
    setReviewComment("");
    setApproveError(null);
    setApprovalNotice(null);
  };

  const handleApproveAndMerge = async () => {
    if (selectedPrNumber === null || approving) return;
    setApproving(true);
    setApproveError(null);
    try {
      const targetNumber = selectedPrNumber;
      const trimmedComment = reviewComment.trim();
      await approveAndMergeDocsPullRequest(
        targetNumber,
        trimmedComment.length > 0 ? trimmedComment : undefined,
      );
      setSelectedPrNumber(null);
      setSelectedDocPath(null);
      setReviewComment("");
      setApprovalNotice(
        `기획 PR #${targetNumber}을 승인하고 머지했습니다. 최신 확정 문서로 동기화되었습니다.`,
      );
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "승인 및 머지를 완료하지 못했습니다. GitHub 권한 또는 충돌 여부를 확인해주세요.";
      setApproveError(message);
    } finally {
      setApproving(false);
    }
  };

  if (!ready) return null;
  if (
    openPullRequests.length === 0 &&
    selectedPrNumber === null &&
    !approvalNotice
  ) {
    return null;
  }

  return (
    <section
      className="planning-pr-section"
      aria-label="열린 기획 PR 검토 및 승인"
    >
      {approvalNotice ? (
        <StatusFeedback
          variant="banner"
          tone="info"
          actionPlacement="end"
          className="documents-page__notice"
          action={
            <Button
              variant="ghost"
              onClick={() => setApprovalNotice(null)}
            >
              닫기
            </Button>
          }
        >
          <span>{approvalNotice}</span>
        </StatusFeedback>
      ) : null}

      {selectedPrNumber === null ? (
        openPullRequests.length > 0 ? (
          <div className="planning-pr-banner">
            <div className="planning-pr-banner__header">
              <div className="planning-pr-banner__title-row">
                <GitPullRequest aria-hidden="true" size={16} />
                <strong>열린 기획 PR</strong>
                <StatusBadge tone="info">{`${openPullRequests.length}건`}</StatusBadge>
              </div>
              <span className="planning-pr-banner__hint">
                바뀐 사람용 문서(.html)와 원문 Diff(.md)를 확인하고 바로 승인·머지할 수 있습니다.
              </span>
            </div>
            <ul className="planning-pr-list">
              {openPullRequests.map((pr) => (
                <li key={pr.number} className="planning-pr-list__item">
                  <div className="planning-pr-list__copy">
                    <div className="planning-pr-list__meta">
                      <StatusBadge tone={pr.isDraft ? "neutral" : "info"}>
                        {pr.isDraft ? `초안 #${pr.number}` : `PR #${pr.number}`}
                      </StatusBadge>
                      <span>{`${pr.baseRef} ← ${pr.headRef}`}</span>
                      <span>{`작성자 @${pr.authorLogin}`}</span>
                    </div>
                    <strong className="planning-pr-list__title">
                      {pr.title}
                    </strong>
                  </div>
                  <div className="planning-pr-list__actions">
                    <Button
                      variant="secondary"
                      onClick={() => handleOpenPr(pr.number)}
                      aria-label={
                        openPullRequests.length > 1
                          ? `PR #${pr.number} 변경 문서 확인 · 승인`
                          : "변경 문서 확인 · 승인"
                      }
                    >
                      변경 문서 확인 · 승인
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ) : (
        <div className="planning-pr-panel" role="region" aria-label={`기획 PR #${selectedPrNumber} 검토`}>
          <div className="planning-pr-panel__topbar">
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedPrNumber(null);
                setApproveError(null);
              }}
              disabled={approving}
            >
              <ArrowLeft aria-hidden="true" size={16} />
              문서 목록으로 닫기
            </Button>
            {detail ? (
              <Button
                variant="ghost"
                onClick={() => void openExternal(detail.pullRequest.htmlUrl)}
              >
                GitHub에서 열기
                <ExternalLink aria-hidden="true" size={14} />
              </Button>
            ) : null}
          </div>

          {detailQuery.isPending ? (
            <p className="planning-pr-panel__status">
              변경된 기획 문서를 불러오는 중…
            </p>
          ) : detailQuery.isError || !detail ? (
            <StatusFeedback variant="content" tone="error">
              기획 PR 상세 정보를 불러오지 못했습니다.
            </StatusFeedback>
          ) : (
            <>
              <header className="planning-pr-panel__header">
                <div className="planning-pr-panel__identity">
                  <div className="planning-pr-list__meta">
                    <StatusBadge tone={detail.pullRequest.isDraft ? "neutral" : "info"}>
                      {`PR #${detail.pullRequest.number}`}
                    </StatusBadge>
                    <span>{`${detail.pullRequest.baseRef} ← ${detail.pullRequest.headRef}`}</span>
                    <span>{`작성자 @${detail.pullRequest.authorLogin}`}</span>
                  </div>
                  <h2>{detail.pullRequest.title}</h2>
                  {detail.pullRequest.body ? (
                    <p className="planning-pr-panel__body">
                      {detail.pullRequest.body}
                    </p>
                  ) : null}
                </div>

                <div className="planning-pr-panel__approve-box">
                  <Input
                    aria-label="승인 코멘트 (선택)"
                    placeholder="승인 메모 (선택)"
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    disabled={approving}
                  />
                  <Button
                    onClick={() => void handleApproveAndMerge()}
                    loading={approving}
                    disabled={
                      approving ||
                      detail.pullRequest.isDraft ||
                      detail.pullRequest.mergeable === false
                    }
                  >
                    <Check aria-hidden="true" size={16} />
                    승인 및 머지
                  </Button>
                </div>
              </header>

              {detail.pullRequest.mergeable === false ? (
                <StatusFeedback variant="content" tone="warning">
                  기준 브랜치와 충돌이 있어 자동 머지할 수 없습니다. GitHub에서 충돌을 먼저 해결해주세요.
                </StatusFeedback>
              ) : null}

              {approveError ? (
                <StatusFeedback variant="content" tone="error">
                  {approveError}
                </StatusFeedback>
              ) : null}

              {detail.documents.length === 0 ? (
                <p className="planning-pr-panel__status">
                  이 PR에는 변경된 기획 문서(.md/.html)가 없습니다.
                </p>
              ) : (
                <div className="planning-pr-panel__workspace">
                  <nav
                    className="planning-pr-panel__sidebar"
                    aria-label="변경된 문서 목록"
                  >
                    <h3>{`변경된 문서 (${detail.documents.length})`}</h3>
                    <ul>
                      {detail.documents.map((doc) => {
                        const selected = activeDoc?.path === doc.path;
                        const statusMeta = changeStatusMeta(doc.status);
                        return (
                          <li key={doc.path}>
                            <UnstyledButton
                              className={`planning-pr-doc-item${
                                selected ? " is-selected" : ""
                              }`}
                              aria-current={selected ? "true" : undefined}
                              onClick={() => setSelectedDocPath(doc.path)}
                            >
                              <div className="planning-pr-doc-item__top">
                                <StatusBadge tone={statusMeta.tone}>
                                  {statusMeta.label}
                                </StatusBadge>
                                {doc.hasCompanionHtml ? (
                                  <span className="planning-pr-doc-item__html-tag">
                                    HTML
                                  </span>
                                ) : null}
                              </div>
                              <strong>{doc.title}</strong>
                              <small>{doc.path}</small>
                            </UnstyledButton>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>

                  {activeDoc ? (
                    <div className="planning-pr-panel__viewer">
                      <div className="planning-pr-panel__viewer-bar">
                        <div>
                          <strong>{activeDoc.title}</strong>
                          <span>{activeDoc.path}</span>
                        </div>
                        <TabsList aria-label="문서 검토 보기 방식">
                          {activeDoc.hasCompanionHtml &&
                          activeDoc.companionHtml ? (
                            <TabsTrigger
                              selected={viewTab === "html"}
                              onClick={() => setViewTab("html")}
                            >
                              사람용 보기 (.html)
                            </TabsTrigger>
                          ) : null}
                          {activeDoc.headMarkdown !== null ? (
                            <TabsTrigger
                              selected={viewTab === "markdown"}
                              onClick={() => setViewTab("markdown")}
                            >
                              제안 문서 (.md)
                            </TabsTrigger>
                          ) : null}
                          <TabsTrigger
                            selected={viewTab === "diff"}
                            onClick={() => setViewTab("diff")}
                          >
                            원문 Diff (.md)
                          </TabsTrigger>
                        </TabsList>
                      </div>

                      {viewTab === "html" &&
                      activeDoc.hasCompanionHtml &&
                      activeDoc.companionHtml ? (
                        <iframe
                          className="document-reader__html-frame"
                          sandbox=""
                          referrerPolicy="no-referrer"
                          srcDoc={activeDoc.companionHtml}
                          title={`${activeDoc.title} 사람용 보기`}
                        />
                      ) : viewTab === "markdown" &&
                        activeDoc.headMarkdown !== null ? (
                        <div className="planning-pr-panel__markdown">
                          <MarkdownDocument
                            hideHeader
                            suppressSourceTitle
                            document={toPreviewDocument(
                              activeDoc.path,
                              activeDoc.title,
                              activeDoc.headMarkdown,
                            )}
                          />
                        </div>
                      ) : (
                        <section
                          className="document-source-diff"
                          aria-label="원문 변경사항"
                        >
                          <div className="document-source-diff__header">
                            <span>{`기준 브랜치 · ${detail.pullRequest.baseRef}`}</span>
                            <span>{`제안 브랜치 · ${detail.pullRequest.headRef}`}</span>
                            <span className="document-source-diff__mobile-heading">
                              원문 · 삭제 − / 추가 +
                            </span>
                          </div>
                          {diffRows.length > 0 ? (
                            diffRows.map((row, index) => (
                              <div
                                className="document-source-diff__row"
                                data-same={
                                  row.before?.kind === "same" ? "true" : "false"
                                }
                                key={index}
                              >
                                <DiffCell
                                  line={row.before}
                                  side="before"
                                  otherNumber={
                                    row.before?.kind === "same"
                                      ? row.after?.number
                                      : undefined
                                  }
                                />
                                <DiffCell line={row.after} side="after" />
                              </div>
                            ))
                          ) : (
                            <p className="planning-pr-panel__status">
                              변경된 Markdown 줄이 없습니다.
                            </p>
                          )}
                        </section>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
