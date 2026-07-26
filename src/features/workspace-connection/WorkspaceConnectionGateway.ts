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
  inspectExistingClone(path: string, repositoryId: string): Promise<RepositorySnapshot>;
  cloneRepository(
    requestId: string,
    repository: GithubRepositorySummary,
    parentDirectory: string,
  ): Promise<CloneJob>;
  cancelRepositoryClone(requestId: string): Promise<boolean>;
  onCloneProgress(listener: (event: CloneProgressEvent) => void): Promise<Unlisten>;
  inspectWorkspace(path: string): Promise<WorkspaceInspection>;
  connectWorkspace(path: string): Promise<ConnectedWorkspace>;
  previewInitialization(input: PreviewInitializationInput): Promise<InitializationPreview>;
  initializeWorkspace(previewId: string): Promise<InitializationResult>;
}
