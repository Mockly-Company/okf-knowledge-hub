/** 앱 폴더에 받을 문서 저장소 위치. 경로는 clone 명령에만 넘기고 화면에 보여 주지 않는다. */
export interface PreparedDocsRepository {
  parentDirectory: string;
  alreadyCloned: boolean;
}

export interface ConnectedDocsRepository {
  fullName: string;
  /** `.okf/workspace.yml`이 있는 OKF 저장소인지. */
  okf: boolean;
}

/** 최신 내용 받기 결과. `skipped_*`는 받지 않은 이유다. */
export type PullOutcome =
  | "updated"
  | "up_to_date"
  | "skipped_local_changes"
  | "skipped_not_on_default_branch"
  | "skipped_diverged";

/**
 * 프로젝트별 문서 저장소 게이트웨이.
 * - `prepare_docs_repository` `{ fullName }` → `{ parentDirectory, alreadyCloned }`
 * - `connect_project_docs_repository` `{ projectId, repositoryId, fullName }` → `{ fullName, okf }`
 * - `pull_docs_repository` {} → `PullOutcome`
 */
export interface DocsRepositoryGateway {
  prepare(fullName: string): Promise<PreparedDocsRepository>;
  connect(
    projectId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedDocsRepository>;
  pull(): Promise<PullOutcome>;
}
