import type {
  AuthState,
  AuthStatusEvent,
  CloneJob,
  CloneProgressEvent,
  ConnectedWorkspace,
  CurrentWorkspaceState,
  DeviceAuthorization,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationResult,
  Page,
  PreviewInitializationInput,
  RepositorySnapshot,
  Unlisten,
  WorkspaceInspection,
} from "./types";

export interface RememberedWorkspace {
  projectId: string;
  path: string;
}

export interface WorkspaceConnectionGateway {
  getCurrentWorkspace(): Promise<CurrentWorkspaceState>;
  getAuthState(): Promise<AuthState>;
  beginGithubAuth(requestId: string): Promise<DeviceAuthorization>;
  cancelGithubAuth(requestId: string): Promise<boolean>;
  logoutGithub(): Promise<void>;
  onAuthStatus(listener: (event: AuthStatusEvent) => void): Promise<Unlisten>;
  listRepositories(cursor?: string): Promise<Page<GithubRepositorySummary>>;
  pickDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  inspectExistingClone(path: string, repositoryId: string): Promise<RepositorySnapshot>;
  cloneRepository(
    requestId: string,
    repository: GithubRepositorySummary,
    parentDirectory: string,
  ): Promise<CloneJob>;
  cancelRepositoryClone(requestId: string): Promise<boolean>;
  onCloneProgress(listener: (event: CloneProgressEvent) => void): Promise<Unlisten>;
  inspectWorkspace(path: string): Promise<WorkspaceInspection>;
  connectWorkspace(
    path: string,
    repository: Pick<GithubRepositorySummary, "id" | "fullName">,
  ): Promise<ConnectedWorkspace>;
  previewInitialization(input: PreviewInitializationInput): Promise<InitializationPreview>;
  initializeWorkspace(previewId: string): Promise<InitializationResult>;
  /**
   * 프로젝트 전환 시 docs 저장소 매핑 기억/복원용.
   * 백엔드 lane이 없으면 Tauri 게이트웨이가 catch → 로컬 폴백한다.
   */
  getWorkspaceForProject(projectId: string): Promise<string | null>;
  setWorkspaceForProject(projectId: string, path: string): Promise<void>;
  listRememberedWorkspaces(): Promise<RememberedWorkspace[]>;
}
