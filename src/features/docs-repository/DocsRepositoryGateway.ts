import type { ResolvedGithubProject } from "@/features/project-board/model";
import type { DocsRepositoryRef } from "@/features/project-board/ProjectBoardGateway";

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

/**
 * 통합 작업 단위(워크스페이스).
 * - `Project + 문서 저장소` 모드: `project !== null`
 * - `문서 저장소 단독` 모드: `project === null && docsRepository !== null`
 */
export interface HubWorkspace {
  id: string;
  title: string;
  project: ResolvedGithubProject | null;
  docsRepository: DocsRepositoryRef | null;
}

export interface HubWorkspaceList {
  workspaces: HubWorkspace[];
  activeWorkspaceId: string | null;
  activeDocsConnected: boolean;
}

export interface ActivatedHubWorkspace {
  workspace: HubWorkspace;
  docsConnected: boolean;
}

export interface ConnectedHubWorkspace {
  workspace: HubWorkspace;
  docsConnected: boolean;
  okf: boolean | null;
}

/** 최신 내용 받기 결과. `skipped_*`는 받지 않은 이유다. */
export type PullOutcome =
  | "updated"
  | "up_to_date"
  | "skipped_local_changes"
  | "skipped_not_on_default_branch"
  | "skipped_diverged";

/**
 * 워크스페이스 및 문서 저장소 게이트웨이.
 */
export interface DocsRepositoryGateway {
  prepare(fullName: string): Promise<PreparedDocsRepository>;
  connect(
    projectId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedDocsRepository>;
  pull(): Promise<PullOutcome>;
  listWorkspaces?(): Promise<HubWorkspaceList>;
  setActiveWorkspace?(workspaceId: string): Promise<ActivatedHubWorkspace>;
  createStandaloneWorkspace?(
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace>;
  createProjectWorkspace?(
    project: ResolvedGithubProject,
    repository?: DocsRepositoryRef | null,
  ): Promise<ConnectedHubWorkspace>;
  connectWorkspaceDocs?(
    workspaceId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace>;
  attachProject?(
    workspaceId: string,
    project: ResolvedGithubProject,
  ): Promise<HubWorkspace>;
  detachProject?(workspaceId: string): Promise<HubWorkspaceList>;
  removeWorkspace?(workspaceId: string): Promise<HubWorkspaceList>;
}
