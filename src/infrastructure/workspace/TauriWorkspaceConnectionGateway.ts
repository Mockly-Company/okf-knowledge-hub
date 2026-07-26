import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
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
} from "@/features/workspace-connection/types";

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
type ListenDesktop = <T>(
  event: string,
  listener: (event: Event<T>) => void,
) => Promise<Unlisten>;
type PickDirectory = (options: {
  directory: true;
  multiple: false;
}) => Promise<string | null>;
type OpenExternal = (url: string) => Promise<void>;
type OpenLocalPath = (path: string) => Promise<void>;

const invokeDesktop: InvokeDesktop = (command, args) => invoke(command, args);
const listenDesktop: ListenDesktop = (event, listener) => listen(event, listener);
const pickDirectory: PickDirectory = (options) => open(options);
const openExternal: OpenExternal = (url) => openUrl(url);
const openLocalPath: OpenLocalPath = (path) => openPath(path);

export class TauriWorkspaceConnectionGateway implements WorkspaceConnectionGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
    private readonly listenEvent: ListenDesktop = listenDesktop,
    private readonly chooseDirectory: PickDirectory = pickDirectory,
    private readonly launchExternal: OpenExternal = openExternal,
    private readonly launchPath: OpenLocalPath = openLocalPath,
  ) {}

  getCurrentWorkspace(): Promise<CurrentWorkspaceState> {
    return this.invokeCommand("get_current_workspace");
  }

  getAuthState(): Promise<AuthState> {
    return this.invokeCommand("get_auth_state");
  }

  beginGithubAuth(requestId: string): Promise<DeviceAuthorization> {
    return this.invokeCommand("begin_github_auth", { requestId });
  }

  cancelGithubAuth(requestId: string): Promise<boolean> {
    return this.invokeCommand("cancel_github_auth", { requestId });
  }

  logoutGithub(): Promise<void> {
    return this.invokeCommand("logout_github");
  }

  onAuthStatus(listener: (event: AuthStatusEvent) => void): Promise<Unlisten> {
    return this.listenEvent<AuthStatusEvent>("github-auth-status", ({ payload }) => {
      listener(payload);
    });
  }

  listRepositories(cursor?: string): Promise<Page<GithubRepositorySummary>> {
    return this.invokeCommand("list_github_repositories", { cursor: cursor ?? null });
  }

  async pickDirectory(): Promise<string | null> {
    return this.chooseDirectory({ directory: true, multiple: false });
  }

  openExternal(url: string): Promise<void> {
    return this.launchExternal(url);
  }

  openPath(path: string): Promise<void> {
    return this.launchPath(path);
  }

  inspectExistingClone(
    path: string,
    repositoryId: string,
  ): Promise<RepositorySnapshot> {
    return this.invokeCommand("inspect_existing_clone", { path, repositoryId });
  }

  cloneRepository(
    requestId: string,
    repository: GithubRepositorySummary,
    parentDirectory: string,
  ): Promise<CloneJob> {
    return this.invokeCommand("clone_repository", {
      requestId,
      request: {
        repositoryId: repository.id,
        fullName: repository.fullName,
        httpsUrl: `https://github.com/${repository.fullName}.git`,
        parentDirectory,
      },
    });
  }

  cancelRepositoryClone(requestId: string): Promise<boolean> {
    return this.invokeCommand("cancel_repository_clone", { requestId });
  }

  onCloneProgress(
    listener: (event: CloneProgressEvent) => void,
  ): Promise<Unlisten> {
    return this.listenEvent<CloneProgressEvent>(
      "repository-clone-progress",
      ({ payload }) => {
        listener(payload);
      },
    );
  }

  inspectWorkspace(path: string): Promise<WorkspaceInspection> {
    return this.invokeCommand("inspect_workspace", { repositoryPath: path });
  }

  connectWorkspace(path: string): Promise<ConnectedWorkspace> {
    return this.invokeCommand("connect_workspace", { repositoryPath: path });
  }

  previewInitialization(
    input: PreviewInitializationInput,
  ): Promise<InitializationPreview> {
    return this.invokeCommand("preview_workspace_initialization", { request: input });
  }

  initializeWorkspace(previewId: string): Promise<InitializationResult> {
    return this.invokeCommand("initialize_workspace", { previewId });
  }
}
