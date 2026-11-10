import type {
  AuthState,
  AuthStatusEvent,
  CloneJob,
  CloneProgressEvent,
  CurrentWorkspaceState,
  DeviceAuthorization,
  GithubRepositorySummary,
  Page,
  Unlisten,
} from "./types";

/** GitHub 계정과 문서 저장소 clone을 다루는 데스크톱 게이트웨이. */
export interface WorkspaceConnectionGateway {
  getCurrentWorkspace(): Promise<CurrentWorkspaceState>;
  getAuthState(): Promise<AuthState>;
  beginGithubAuth(requestId: string): Promise<DeviceAuthorization>;
  cancelGithubAuth(requestId: string): Promise<boolean>;
  logoutGithub(): Promise<void>;
  onAuthStatus(listener: (event: AuthStatusEvent) => void): Promise<Unlisten>;
  listRepositories(cursor?: string): Promise<Page<GithubRepositorySummary>>;
  openExternal(url: string): Promise<void>;
  cloneRepository(
    requestId: string,
    repository: GithubRepositorySummary,
    parentDirectory: string,
  ): Promise<CloneJob>;
  cancelRepositoryClone(requestId: string): Promise<boolean>;
  onCloneProgress(listener: (event: CloneProgressEvent) => void): Promise<Unlisten>;
}
