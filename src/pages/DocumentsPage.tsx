import { FilePlus2 } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { DocumentDraftSwitcher } from "@/features/documents/components/DocumentDraftSwitcher";
import { NewDocumentDialog } from "@/features/documents/components/NewDocumentDialog";
import { DocumentSearch } from "@/features/documents/components/DocumentSearch";
import { DocumentReader } from "@/features/documents/components/DocumentReader";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  ChooseProjectFirst,
  NotOkfNotice,
  ProjectDocsRepositoryPicker,
  useCurrentDocsRepository,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { DocsPullNotice } from "@/features/docs-repository/DocsPullNotice";
import "@/features/documents/documents.css";
import type { DocumentSummary } from "@/features/documents/model";

const DocumentDraftEditor = lazy(() =>
  import("@/features/documents/components/DocumentDraftEditor").then(
    (module) => ({ default: module.DocumentDraftEditor }),
  ),
);

export function DocumentsPage({
  headerActions,
  additionalDocuments = [],
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  headerActions?: ReactNode;
  additionalDocuments?: DocumentSummary[];
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  const {
    state,
    authoringState,
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
  } = useDocuments();
  // provider 밖(단위 테스트·스토리)에서는 null이므로 배너를 숨긴다.
  const activeProject = useOptionalActiveProject();
  const docsMissing = activeProject?.docsMissing ?? false;
  const activeProjectId = activeProject?.activeProjectId ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  // 프로젝트를 바꾸면 열어 둔 저장소 선택을 닫는다.
  const [pickerProjectId, setPickerProjectId] = useState(activeProjectId);
  if (pickerProjectId !== activeProjectId) {
    setPickerProjectId(activeProjectId);
    setPickerOpen(false);
  }
  const picker =
    activeProjectId !== null ? (
      <ProjectDocsRepositoryPicker
        key={activeProjectId}
        projectId={activeProjectId}
        gateway={docsRepositoryGateway}
        repositoryGateway={repositoryGateway}
        onDone={() => setPickerOpen(false)}
      />
    ) : null;
  const connectedWorkspace = useCurrentDocsRepository(repositoryGateway);
  const connectOrChooseProject = picker ?? <ChooseProjectFirst />;
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

  if (state.status === "error") {
    const invalidRoot = [
      "workspace_missing",
      "workspace_invalid",
      "document_path_invalid",
    ].includes(state.recoverableError?.code ?? "");
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
            headerSecondary={
              <DocumentDraftSwitcher state={authoringState} onSwitch={switchDraft} />
            }
            onMarkdownChange={updateDraftMarkdown}
            onModeChange={setDraftEditorMode}
            onAcceptDisk={acceptDiskConflict}
            onAcceptHub={acceptHubConflict}
            onStartMerge={startConflictMerge}
            onClose={closeDraftEditor}
          />
        </Suspense>
        {creationDialog}
      </>
    );
  }

  if (state.selectedPath !== null) {
    return (
      <section className="documents-page documents-page--reader" aria-labelledby="documents-title">
        <h1 id="documents-title" className="sr-only">Documents</h1>
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
      </section>
    );
  }

  return (
    <section className="documents-page" aria-labelledby="documents-title">
      <PageHeader
        titleId="documents-title"
        title="Documents"
        description="프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다."
        actions={headerActions}
      />

      {connectedWorkspace && !docsMissing ? (
        <p
          role="status"
          className="documents-page__notice flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]"
        >
          <span className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            {connectedWorkspace.repository?.fullName ?? "저장소 정보 없음"}
          </span>
          {picker !== null ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPickerOpen((open) => !open)}
            >
              다른 저장소 연결
            </Button>
          ) : null}
        </p>
      ) : null}
      {pickerOpen ? picker : null}
      <NotOkfNotice gateway={repositoryGateway} />
      <DocsPullNotice />

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
        <DocumentSearch
          query={state.searchQuery}
          documents={[...state.catalog.documents.filter(document => !additionalDocuments.some(extra => extra.path === document.path)), ...additionalDocuments]}
          results={state.searchResults}
          searchStatus={state.searchStatus}
          searchError={state.searchError}
          indexStatus={state.indexStatus}
          onQueryChange={setSearchQuery}
          onSelectDocument={selectDocument}
          onSelectResult={(result) =>
            selectDocument(result.path, {
              matchField: result.matchField,
              matchText: result.matchText,
            })
          }
          onRetry={retrySearch}
          toolbarAction={
            <Button className="documents-page__new-document" onClick={() => openNewDocument("docs")}>
              <FilePlus2 aria-hidden="true" />
              새 문서
            </Button>
          }
        />
      </div>
      {creationDialog}
    </section>
  );
}
