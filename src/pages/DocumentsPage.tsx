import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DocumentSearch } from "@/features/documents/components/DocumentSearch";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import "@/features/documents/documents.css";

export function DocumentsPage() {
  const {
    state,
    setSearchQuery,
    selectDocument,
    refresh,
    retrySession,
    clearRecoverableError,
  } = useDocuments();

  if (state.status === "error") {
    const invalidRoot = [
      "workspace_missing",
      "workspace_invalid",
      "document_path_invalid",
    ].includes(state.recoverableError?.code ?? "");
    const retryable = state.recoverableError?.recovery === "retry";
    return (
      <section className="documents-page" aria-labelledby="documents-title">
        <header className="documents-page__header">
          <h1 id="documents-title">Documents</h1>
          <p>프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다.</p>
        </header>
        <div className="documents-page__notice" role="alert">
          <strong>{state.recoverableError?.message ?? "문서를 불러오지 못했습니다."}</strong>
          {invalidRoot ? (
            <Link to="/settings">Settings에서 확인</Link>
          ) : retryable ? (
            <Button variant="secondary" onClick={retrySession}>
              다시 시도
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (state.selectedPath !== null) {
    return (
      <section className="documents-page" aria-labelledby="documents-title">
        <header className="documents-page__header">
          <h1 id="documents-title">Documents</h1>
          <p>{state.selectedDocument?.summary.title ?? "문서를 여는 중…"}</p>
        </header>
      </section>
    );
  }

  return (
    <section className="documents-page" aria-labelledby="documents-title">
      <header className="documents-page__header">
        <h1 id="documents-title">Documents</h1>
        <p>프로젝트 문서를 찾고 최근 읽던 문서로 돌아갑니다.</p>
      </header>

      {state.indexStatus.status === "degraded" ? (
        <div className="documents-page__notice" role="alert">
          <span>{state.indexStatus.message}</span>
          <Button
            variant="secondary"
            onClick={() => {
              clearRecoverableError();
              void refresh();
            }}
          >
            다시 시도
          </Button>
        </div>
      ) : null}

      <DocumentSearch
        query={state.searchQuery}
        documents={state.catalog.documents}
        results={state.searchResults}
        searchStatus={state.searchStatus}
        indexStatus={state.indexStatus}
        onQueryChange={setSearchQuery}
        onSelectDocument={selectDocument}
        onSelectResult={(result) =>
          selectDocument(result.path, {
            matchField: result.matchField,
            matchText: result.matchText,
          })
        }
      />
    </section>
  );
}
