import { FilePlus2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { setPendingAiLaunch } from "@/features/ai/pendingAiLaunch";
import {
  classifyDocumentCategory,
  isAuxiliaryDocument,
  type DocumentGroup,
} from "@/features/documents/document-taxonomy";
import { DocumentDraftSwitcher } from "@/features/documents/components/DocumentDraftSwitcher";
import { NewDocumentDialog } from "@/features/documents/components/NewDocumentDialog";
import { DocumentSearch } from "@/features/documents/components/DocumentSearch";
import { DocumentReader } from "@/features/documents/components/DocumentReader";
import { DocumentWorkbenchTabs } from "@/features/documents/components/DocumentWorkbenchTabs";
import { PlanningPrReviewSection } from "@/features/documents/components/PlanningPrReviewPanel";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { documentsKeys } from "@/features/documents/queryKeys";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  ChooseProjectFirst,
  NotOkfNotice,
  ProjectDocsRepositoryPicker,
  WorkspaceDocsRepositoryPicker,
  useCurrentDocsRepositoryQuery,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { DocsPullNotice } from "@/features/docs-repository/DocsPullNotice";
import { WorkspaceContextBar } from "@/features/workspace-setup/WorkspaceContextBar";
import { WorkspaceSetupFlow } from "@/features/workspace-setup/WorkspaceSetupFlow";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import { projectBoardKeys } from "@/features/project-board/queryKeys";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";
import "@/features/documents/documents.css";
import { normalizeDocumentPath, type DocumentSummary } from "@/features/documents/model";

const sharedProjectBoardGateway = new TauriProjectBoardGateway();

function DocumentsRouterRedirect({
  to,
  onNavigated,
}: {
  to: string;
  onNavigated: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
    onNavigated();
  }, [navigate, to, onNavigated]);
  return null;
}

const DocumentDraftEditor = lazy(() =>
  import("@/features/documents/components/DocumentDraftEditor").then(
    (module) => ({ default: module.DocumentDraftEditor }),
  ),
);

function DocumentsDeepLinkSync({
  ready,
  selectedPath,
  showDocumentsHome,
  selectDocument,
}: {
  ready: boolean;
  selectedPath: string | null;
  showDocumentsHome: () => void;
  selectDocument: (
    path: string,
    searchMatch?: undefined,
    preferredViewMode?: "html" | "markdown",
  ) => void;
}) {
  const { state, listDocsPullRequests } = useDocuments();
  const sessionId = state.activeSessionId;
  const [searchParams, setSearchParams] = useSearchParams();
  const prParam = searchParams.get("pr");
  const docParam = searchParams.get("doc");
  const viewParam = searchParams.get("view");
  const preferredView =
    viewParam === "html" || viewParam === "markdown" ? viewParam : undefined;
  const lastConsumedDocRef = useRef<string | null>(null);
  const parsedPrNumber = prParam ? Number(prParam) : Number.NaN;
  const hasPositivePrNumber =
    Number.isInteger(parsedPrNumber) && parsedPrNumber > 0;

  const pullRequestsQuery = useQuery({
    queryKey: documentsKeys.pullRequests(sessionId ?? "inactive"),
    queryFn: () => listDocsPullRequests(),
    enabled:
      ready && sessionId !== null && Boolean(prParam) && hasPositivePrNumber,
    staleTime: 15_000,
  });

  const prListSettled =
    pullRequestsQuery.status === "success" && !pullRequestsQuery.isFetching;
  const prExists =
    hasPositivePrNumber &&
    prListSettled &&
    (pullRequestsQuery.data ?? []).some(
      (pr) => pr.number === parsedPrNumber,
    );
  const prConfirmedMissing = hasPositivePrNumber && prListSettled && !prExists;
  const prConfirmedValid = hasPositivePrNumber && prListSettled && prExists;

  useEffect(() => {
    if (!ready || sessionId === null || !prParam) return;
    if (!hasPositivePrNumber || prConfirmedMissing) {
      // 잘못되었거나 존재하지 않는 ?pr=은 열려 있던 문서나 동반 ?doc=을 지우지 않고 ?pr=만 비운다(M9, M10, S37).
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("pr");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (!prListSettled) {
      return;
    }
    if (selectedPath !== null) {
      showDocumentsHome();
    }
  }, [
    ready,
    sessionId,
    prParam,
    hasPositivePrNumber,
    prListSettled,
    prConfirmedMissing,
    selectedPath,
    showDocumentsHome,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!docParam) {
      lastConsumedDocRef.current = null;
      if (ready && !prParam && viewParam !== null) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("view");
            return next;
          },
          { replace: true },
        );
      }
      return;
    }
    if (!ready) return;
    if (prParam) {
      // 유효한 PR 딥링크가 확정된 경우에만 ?doc=/view=를 비우고, 미확정·무효 ?pr= 동안에는 보존한다(S21, S37).
      if (prConfirmedValid) {
        lastConsumedDocRef.current = null;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("doc");
            next.delete("view");
            return next;
          },
          { replace: true },
        );
      }
      return;
    }
    const consumedKey = `${docParam}|${preferredView ?? ""}`;
    if (lastConsumedDocRef.current === consumedKey) return;
    lastConsumedDocRef.current = consumedKey;
    selectDocument(docParam, undefined, preferredView);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("doc");
        next.delete("view");
        return next;
      },
      { replace: true },
    );
  }, [
    prParam,
    docParam,
    viewParam,
    preferredView,
    ready,
    prConfirmedValid,
    setSearchParams,
    selectDocument,
  ]);

  return null;
}

export function DocumentsPage({
  headerActions,
  additionalDocuments = [],
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
  projectBoardGateway,
}: {
  headerActions?: ReactNode;
  additionalDocuments?: DocumentSummary[];
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
  projectBoardGateway?: ProjectBoardGateway;
}) {
  const {
    state,
    authoringState,
    openTabs,
    canGoBackDocument,
    canGoForwardDocument,
    closeDocumentTab,
    goBackDocument,
    goForwardDocument,
    openDocumentInNewWindow,
    setSearchQuery,
    retrySearch,
    selectDocument,
    selectDocumentVersion,
    showDocumentsHome,
    refresh,
    retrySession,
    clearRecoverableError,
    openNewDocument,
    closeNewDocument,
    createNewDocument,
    useSuggestedFileName,
    updateDraftMarkdown,
    setDraftEditorMode,
    acceptDiskConflict,
    acceptHubConflict,
    startConflictMerge,
    closeDraftEditor,
    duplicateTeamTemplate,
    switchDraft,
    readAsset,
    copyText,
    openExternal,
    editorBaselineMarkdown,
    publishDocumentDraft,
  } = useDocuments();
  const [publishedPrNotice, setPublishedPrNotice] = useState<{
    pullRequestNumber: number;
    pullRequestUrl: string;
  } | null>(null);
  const inRouter = useInRouterContext();
  const [auditNavigateTarget, setAuditNavigateTarget] = useState<string | null>(
    null,
  );
  const [pendingTabFocus, setPendingTabFocus] = useState<"home" | string | null>(
    null,
  );
  const deepLinkSync = inRouter ? (
    <DocumentsDeepLinkSync
      ready={state.status === "ready"}
      selectedPath={state.selectedPath}
      showDocumentsHome={showDocumentsHome}
      selectDocument={selectDocument}
    />
  ) : null;

  // provider 밖(단위 테스트·스토리)에서는 null이므로 배너를 숨긴다.
  const activeProject = useOptionalActiveProject();
  const activeWorkspace = activeProject?.activeWorkspace ?? null;
  const docsMissing = activeProject?.docsMissing ?? false;
  const activeProjectId = activeProject?.activeProjectId ?? null;
  const effectiveBoardGateway =
    projectBoardGateway ?? sharedProjectBoardGateway;
  const boardQuery = useQuery({
    queryKey: projectBoardKeys.board(activeProjectId),
    queryFn: () => effectiveBoardGateway.getProjectBoard(),
    enabled:
      activeProjectId !== null &&
      (Boolean(projectBoardGateway) ||
        (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)),
    staleTime: 60_000,
    retry: false,
  });

  const handleAuditCodeSync = (group: DocumentGroup) => {
    const specDocs = group.documents.filter((doc) => {
      if (isAuxiliaryDocument(doc)) return false;
      const category = classifyDocumentCategory(doc);
      return category === "prd" || category === "screen_spec";
    });
    const targetDocs = specDocs.length > 0 ? specDocs : group.documents;
    const primaryDoc =
      targetDocs.find((doc) => classifyDocumentCategory(doc) === "prd") ??
      targetDocs[0];
    if (!primaryDoc) return;

    setPendingAiLaunch({
      request: {
        documentPath: primaryDoc.path,
        repositoryFullName: state.repositoryFullName || null,
        taskMode: "audit_code_sync",
        domainLabel: group.label,
        documentPaths: targetDocs.map((doc) => doc.path),
      },
      label: `코드 반영 점검 · ${group.label}`,
      layer: "planning",
      targetDescription: "코드 저장소 대조 후 문서 frontmatter(impl_status) 갱신",
    });
    if (inRouter) {
      setAuditNavigateTarget("/ai");
    }
  };
  const picker =
    activeWorkspace !== null ? (
      <WorkspaceDocsRepositoryPicker
        key={activeWorkspace.id}
        workspaceId={activeWorkspace.id}
        preferredOwner={activeWorkspace.project?.owner ?? null}
        gateway={docsRepositoryGateway}
        repositoryGateway={repositoryGateway}
      />
    ) : activeProjectId !== null ? (
      <ProjectDocsRepositoryPicker
        key={activeProjectId}
        projectId={activeProjectId}
        gateway={docsRepositoryGateway}
        repositoryGateway={repositoryGateway}
      />
    ) : null;
  const currentDocsQuery = useCurrentDocsRepositoryQuery(repositoryGateway);
  const connectedWorkspace =
    currentDocsQuery.data?.status === "connected"
      ? currentDocsQuery.data
      : null;
  const connectOrChooseProject = picker ?? <ChooseProjectFirst />;
  const invalidRoot = [
    "workspace_missing",
    "workspace_invalid",
    "document_path_invalid",
  ].includes(state.recoverableError?.code ?? "");
  const needsWorkspaceOnboarding =
    activeProject != null &&
    Array.isArray(activeProject.workspaces) &&
    activeProject.workspaces.length === 0 &&
    !connectedWorkspace &&
    !currentDocsQuery.isPending &&
    !currentDocsQuery.isError &&
    !activeProject.isListing &&
    !activeProject.isListError &&
    (state.status !== "error" || invalidRoot);
  const creationDialog = (
    <NewDocumentDialog
      state={authoringState}
      folderRoots={state.catalog.roots}
      onClose={closeNewDocument}
      onCreate={createNewDocument}
      onUseSuggestion={useSuggestedFileName}
      onDuplicateTemplate={duplicateTeamTemplate}
    />
  );

  if (needsWorkspaceOnboarding) {
    return (
      <section className="documents-page" aria-labelledby="documents-title">
        <PageHeader
          titleId="documents-title"
          title="Documents"
          description="Project와 문서 저장소를 연결하거나, 문서 저장소만 단독으로 관리합니다."
          actions={headerActions}
        />
        <WorkspaceSetupFlow
          docsRepositoryGateway={docsRepositoryGateway}
          repositoryGateway={repositoryGateway}
        />
      </section>
    );
  }

  if (state.status === "error") {
    const retryable = state.recoverableError?.recovery === "retry";
    return (
      <section className="documents-page" aria-labelledby="documents-title">
        <PageHeader
          titleId="documents-title"
          title="Documents"
          description="프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다."
        />
        <StatusFeedback
          variant="banner"
          tone="error"
          actionPlacement="end"
          className="documents-page__notice"
          action={
            retryable ? (
              <Button variant="secondary" onClick={retrySession}>
                다시 시도
              </Button>
            ) : undefined
          }
        >
          <strong>{state.recoverableError?.message ?? "문서를 불러오지 못했습니다."}</strong>
        </StatusFeedback>
        {invalidRoot ? connectOrChooseProject : null}
      </section>
    );
  }

  if (docsMissing) {
    return (
      <section className="documents-page" aria-labelledby="documents-title">
        <PageHeader
          titleId="documents-title"
          title="Documents"
          description="프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다."
          actions={headerActions}
        />
        {activeWorkspace?.project ? (
          <div className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)]">
            <StatusBadge tone="info">
              {`${activeWorkspace.project.owner} #${activeWorkspace.project.number}`}
            </StatusBadge>
            <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              &ldquo;{activeWorkspace.title}&rdquo;의 기획·명세를 관리할 문서 저장소를 선택하세요.
            </span>
          </div>
        ) : null}
        {connectOrChooseProject}
      </section>
    );
  }

  if (authoringState.editor) {
    return (
      <>
        <Suspense fallback={<p className="documents-page__loading">편집기를 준비하는 중…</p>}>
          <DocumentDraftEditor
            editor={authoringState.editor}
            readAsset={readAsset}
            copyText={copyText}
            headerNavigation={
              publishedPrNotice ? (
                <StatusFeedback
                  variant="banner"
                  tone="info"
                  actionPlacement="end"
                  className="document-draft-editor__warning"
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => void openExternal(publishedPrNotice.pullRequestUrl)}
                    >
                      GitHub에서 열기
                    </Button>
                  }
                >
                  <span>
                    {`검토 요청 PR #${publishedPrNotice.pullRequestNumber}을 생성했습니다.`}
                  </span>
                </StatusFeedback>
              ) : undefined
            }
            headerSecondary={
              <DocumentDraftSwitcher state={authoringState} onSwitch={switchDraft} />
            }
            publication={{
              baselineMarkdown: editorBaselineMarkdown,
              reviewNotice:
                "현재 초안 브랜치를 문서 저장소에 푸시하고 기획 검토 PR을 생성합니다.",
              onSubmit: async (request) => {
                const response = await publishDocumentDraft({
                  intent: request.intent,
                  message: request.message,
                  reviewNote: request.reviewNote,
                });
                if (!response.merged) {
                  setPublishedPrNotice({
                    pullRequestNumber: response.pullRequest.number,
                    pullRequestUrl: response.pullRequest.htmlUrl,
                  });
                } else {
                  setPublishedPrNotice(null);
                }
              },
            }}
            onMarkdownChange={updateDraftMarkdown}
            onModeChange={setDraftEditorMode}
            onAcceptDisk={acceptDiskConflict}
            onAcceptHub={acceptHubConflict}
            onStartMerge={startConflictMerge}
            onClose={() => {
              setPublishedPrNotice(null);
              closeDraftEditor();
            }}
          />
        </Suspense>
        {creationDialog}
      </>
    );
  }

  const hasWorkbenchTabs = openTabs.length > 0 || state.selectedPath !== null;
  const normalizedSelectedPath = state.selectedPath
    ? normalizeDocumentPath(state.selectedPath).toLowerCase()
    : null;
  const activeTabFlatIndex =
    normalizedSelectedPath === null
      ? 0
      : Math.max(
          0,
          openTabs.findIndex(
            (tab) =>
              normalizeDocumentPath(tab.path).toLowerCase() ===
              normalizedSelectedPath,
          ) + 1,
        );
  const workbenchPanelA11yProps = hasWorkbenchTabs
    ? {
        role: "tabpanel" as const,
        tabIndex: 0,
        "aria-labelledby": `documents-workbench-panel-tab-${activeTabFlatIndex}`,
      }
    : {};

  const workbenchTabsBar = (
    <DocumentWorkbenchTabs
      openTabs={openTabs}
      activePath={state.selectedPath}
      panelId="documents-workbench-panel"
      pendingFocusTarget={pendingTabFocus}
      onPendingFocusHandled={() => setPendingTabFocus(null)}
      onKeyboardSelectTarget={setPendingTabFocus}
      canGoBack={canGoBackDocument}
      canGoForward={canGoForwardDocument}
      onGoBack={goBackDocument}
      onGoForward={goForwardDocument}
      onSelectHome={showDocumentsHome}
      onSelectTab={(path) => selectDocument(path)}
      onCloseTab={closeDocumentTab}
      onOpenNewWindow={(path) => void openDocumentInNewWindow(path)}
    />
  );

  if (state.selectedPath !== null) {
    return (
      <section className="documents-page documents-page--reader" aria-labelledby="documents-title">
        {deepLinkSync}
        <h1 id="documents-title" className="sr-only">Documents</h1>
        {activeWorkspace && !docsMissing ? (
          <WorkspaceContextBar
            className="mb-[var(--space-4)]"
            docsRepositoryGateway={docsRepositoryGateway}
            repositoryGateway={repositoryGateway}
          />
        ) : null}
        {workbenchTabsBar}
        <div
          id="documents-workbench-panel"
          className="documents-page__workbench-panel"
          {...workbenchPanelA11yProps}
        >
        {state.selectedDocument ? (
          <DocumentReader
            document={state.selectedDocument}
            notice={state.documentNotice}
          />
        ) : state.documentStatus === "error" ? (
          <StatusFeedback
            variant="banner"
            tone="error"
            actionPlacement="end"
            className="documents-page__notice documents-page__read-error"
            action={
              <div className="documents-page__error-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (state.selectedVersion) {
                      selectDocumentVersion(state.selectedVersion);
                    } else {
                      selectDocument(state.selectedPath!);
                    }
                  }}
                >
                  {state.selectedVersion ? "버전 다시 열기" : "문서 다시 열기"}
                </Button>
                <Button variant="secondary" onClick={showDocumentsHome}>
                  Documents 홈
                </Button>
              </div>
            }
          >
            <div>
              <strong>
                {state.selectedVersion
                  ? "과거 버전을 열지 못했습니다."
                  : "문서를 열지 못했습니다."}
              </strong>
              <p>
                {state.recoverableError?.message ??
                  "문서 내용을 불러오지 못했습니다."}
              </p>
            </div>
          </StatusFeedback>
        ) : (
          <p className="documents-page__loading">문서를 여는 중…</p>
        )}
        </div>
      </section>
    );
  }

  return (
    <section className="documents-page" aria-labelledby="documents-title">
      {deepLinkSync}
      <PageHeader
        titleId="documents-title"
        title="Documents"
        description="프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다."
        actions={headerActions}
      />

      {activeWorkspace && !docsMissing ? (
        <WorkspaceContextBar
          className="mb-[var(--space-4)]"
          docsRepositoryGateway={docsRepositoryGateway}
          repositoryGateway={repositoryGateway}
        />
      ) : null}
      <NotOkfNotice gateway={repositoryGateway} />
      <DocsPullNotice />
      <PlanningPrReviewSection />

      {state.documentNotice ? (
        <StatusFeedback
          variant="banner"
          tone="info"
          className="documents-page__notice"
        >
          <span>{state.documentNotice}</span>
        </StatusFeedback>
      ) : null}

      {state.indexStatus.status === "degraded" ? (
        <StatusFeedback
          variant="banner"
          tone="warning"
          actionPlacement="end"
          className="documents-page__notice"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                clearRecoverableError();
                void refresh();
              }}
            >
              다시 시도
            </Button>
          }
        >
          <span>{state.indexStatus.message}</span>
        </StatusFeedback>
      ) : null}

      <div className="documents-page__tools">
        {workbenchTabsBar}
        <div
          id="documents-workbench-panel"
          className="documents-page__workbench-panel"
          {...workbenchPanelA11yProps}
        >
        <DocumentSearch
          query={state.searchQuery}
          documents={[...state.catalog.documents.filter(document => !additionalDocuments.some(extra => extra.path === document.path)), ...additionalDocuments]}
          results={state.searchResults}
          searchStatus={state.searchStatus}
          searchError={state.searchError}
          indexStatus={state.indexStatus}
          defaultGroupMode="map"
          boardIssues={boardQuery.data?.issues}
          onQueryChange={setSearchQuery}
          onSelectDocument={(path, preferredView) =>
            selectDocument(path, undefined, preferredView)
          }
          onSelectResult={(result) =>
            selectDocument(result.path, {
              matchField: result.matchField,
              matchText: result.matchText,
            })
          }
          onRetry={retrySearch}
          onAuditCodeSync={handleAuditCodeSync}
          onNewDocumentInFolder={openNewDocument}
          onOpenInNewWindow={(path, viewMode, title) =>
            void openDocumentInNewWindow(path, viewMode, title)
          }
          toolbarAction={
            <Button className="documents-page__new-document" onClick={() => openNewDocument("docs")}>
              <FilePlus2 aria-hidden="true" />
              새 문서
            </Button>
          }
        />
        </div>
      </div>
      {creationDialog}
      {inRouter && auditNavigateTarget ? (
        <DocumentsRouterRedirect
          to={auditNavigateTarget}
          onNavigated={() => setAuditNavigateTarget(null)}
        />
      ) : null}
    </section>
  );
}
