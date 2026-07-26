import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
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
  WorkspaceSummary,
} from "@/features/workspace-connection/types";

const defaultUser = {
  id: 7,
  login: "hyeeun",
  avatarUrl: "https://example.test/avatar.png",
};

const defaultRepository: GithubRepositorySummary = {
  id: "R_kgDOExample",
  owner: "Mockly-Company",
  name: "mockly-knowledge",
  fullName: "Mockly-Company/mockly-knowledge",
  defaultBranch: "main",
  isEmpty: false,
};

const defaultSummary: WorkspaceSummary = {
  id: "89bf04ef-df57-4a76-b10a-b33107d8a6c2",
  name: "Mockly",
  documentRoots: ["docs"],
  repositoryCount: 0,
};

const defaultSnapshot: RepositorySnapshot = {
  root: "/work/mockly-knowledge",
  headOid: "abc123",
  defaultBranch: "main",
  isDirty: false,
  hasContent: true,
  remoteUrl: "https://github.com/Mockly-Company/mockly-knowledge.git",
  fingerprint: "fingerprint",
};

const defaultPreview: InitializationPreview = {
  id: "preview-1",
  workspaceId: "89bf04ef-df57-4a76-b10a-b33107d8a6c2",
  workspaceName: "Mockly",
  repositoryFingerprint: "fingerprint",
  branch: "okf/init-workspace",
  commitMessage: "chore: initialize OkHub workspace",
  strategy: { kind: "draft_pull_request", baseBranch: "main" },
  files: [],
};

export class FakeWorkspaceConnectionGateway implements WorkspaceConnectionGateway {
  currentWorkspace: CurrentWorkspaceState = null;
  authState: AuthState = { status: "signed_out" };
  repositories: GithubRepositorySummary[] = [defaultRepository];
  nextRepositoryCursor: string | null = null;
  selectedDirectory: string | null = "/work";
  repositorySnapshot: RepositorySnapshot = defaultSnapshot;
  workspaceInspection: WorkspaceInspection = {
    status: "ready",
    summary: defaultSummary,
  };
  initializationPreview: InitializationPreview = defaultPreview;
  connectedWorkspace: ConnectedWorkspace = {
    path: defaultSnapshot.root,
    status: "connected",
    summary: defaultSummary,
  };
  initializationResult: InitializationResult = {
    root: defaultSnapshot.root,
    branch: "okf/init-workspace",
    commitOid: "def456",
    commitMessage: "chore: initialize OkHub workspace",
    pushed: true,
    draftPullRequestUrl: "https://github.com/Mockly-Company/mockly-knowledge/pull/1",
  };

  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly openedUrls: string[] = [];
  readonly cancelledAuthRequests: string[] = [];
  readonly cancelledCloneRequests: string[] = [];

  private readonly authListeners = new Set<(event: AuthStatusEvent) => void>();
  private readonly cloneListeners = new Set<(event: CloneProgressEvent) => void>();
  private activeAuthorization: DeviceAuthorization | null = null;

  static disconnected(): FakeWorkspaceConnectionGateway {
    return new FakeWorkspaceConnectionGateway();
  }

  static connected(path = defaultSnapshot.root): FakeWorkspaceConnectionGateway {
    const gateway = new FakeWorkspaceConnectionGateway();
    gateway.currentWorkspace = {
      path,
      status: "connected",
      summary: defaultSummary,
    };
    gateway.connectedWorkspace = gateway.currentWorkspace;
    gateway.authState = { status: "authenticated", user: defaultUser };
    return gateway;
  }

  static existingReadyClone(): FakeWorkspaceConnectionGateway {
    const gateway = new FakeWorkspaceConnectionGateway();
    gateway.workspaceInspection = { status: "ready", summary: defaultSummary };
    return gateway;
  }

  async getCurrentWorkspace(): Promise<CurrentWorkspaceState> {
    this.record("getCurrentWorkspace");
    return this.currentWorkspace;
  }

  async getAuthState(): Promise<AuthState> {
    this.record("getAuthState");
    return this.authState;
  }

  async beginGithubAuth(): Promise<DeviceAuthorization> {
    this.record("beginGithubAuth");
    this.activeAuthorization = {
      requestId: "auth-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAtUnix: 2_000,
      intervalSeconds: 5,
    };
    return this.activeAuthorization;
  }

  async cancelGithubAuth(requestId: string): Promise<boolean> {
    this.record("cancelGithubAuth", requestId);
    this.cancelledAuthRequests.push(requestId);
    return this.activeAuthorization?.requestId === requestId;
  }

  async logoutGithub(): Promise<void> {
    this.record("logoutGithub");
    this.authState = { status: "signed_out" };
  }

  async onAuthStatus(listener: (event: AuthStatusEvent) => void): Promise<Unlisten> {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  async listRepositories(cursor?: string): Promise<Page<GithubRepositorySummary>> {
    this.record("listRepositories", cursor);
    return { items: this.repositories, nextCursor: this.nextRepositoryCursor };
  }

  async pickDirectory(): Promise<string | null> {
    this.record("pickDirectory");
    return this.selectedDirectory;
  }

  async openExternal(url: string): Promise<void> {
    this.record("openExternal", url);
    this.openedUrls.push(url);
  }

  async inspectExistingClone(
    path: string,
    repositoryId: string,
  ): Promise<RepositorySnapshot> {
    this.record("inspectExistingClone", path, repositoryId);
    return { ...this.repositorySnapshot, root: path };
  }

  async cloneRepository(
    repository: GithubRepositorySummary,
    parentDirectory: string,
  ): Promise<CloneJob> {
    this.record("cloneRepository", repository, parentDirectory);
    return {
      requestId: "clone-1",
      targetPath: `${parentDirectory}/${repository.name}`,
    };
  }

  async cancelRepositoryClone(requestId: string): Promise<boolean> {
    this.record("cancelRepositoryClone", requestId);
    this.cancelledCloneRequests.push(requestId);
    return requestId === "clone-1";
  }

  async onCloneProgress(
    listener: (event: CloneProgressEvent) => void,
  ): Promise<Unlisten> {
    this.cloneListeners.add(listener);
    return () => this.cloneListeners.delete(listener);
  }

  async inspectWorkspace(path: string): Promise<WorkspaceInspection> {
    this.record("inspectWorkspace", path);
    return this.workspaceInspection;
  }

  async connectWorkspace(path: string): Promise<ConnectedWorkspace> {
    this.record("connectWorkspace", path);
    return { ...this.connectedWorkspace, path };
  }

  async previewInitialization(
    input: PreviewInitializationInput,
  ): Promise<InitializationPreview> {
    this.record("previewInitialization", input);
    return this.initializationPreview;
  }

  async initializeWorkspace(previewId: string): Promise<InitializationResult> {
    this.record("initializeWorkspace", previewId);
    return this.initializationResult;
  }

  approveAuthentication(): void {
    if (!this.activeAuthorization) throw new Error("beginGithubAuth must run first");
    this.authState = { status: "authenticated", user: defaultUser };
    this.emitAuth({
      status: "authenticated",
      requestId: this.activeAuthorization.requestId,
      user: defaultUser,
    });
  }

  emitAuth(event: AuthStatusEvent): void {
    for (const listener of this.authListeners) listener(event);
  }

  emitClone(event: CloneProgressEvent): void {
    for (const listener of this.cloneListeners) listener(event);
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
