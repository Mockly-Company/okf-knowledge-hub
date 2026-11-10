import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  WorkspaceConnectionGateway,
} from "@/features/workspace-connection/WorkspaceConnectionGateway";
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
} from "@/features/workspace-connection/types";

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
type ListenDesktop = <T>(
  event: string,
  listener: (event: Event<T>) => void,
) => Promise<Unlisten>;
type OpenExternal = (url: string) => Promise<void>;

const invokeDesktop: InvokeDesktop = (command, args) => invoke(command, args);
const listenDesktop: ListenDesktop = (event, listener) => listen(event, listener);
const openExternal: OpenExternal = (url) => openUrl(url);

export class TauriWorkspaceConnectionGateway implements WorkspaceConnectionGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
    private readonly listenEvent: ListenDesktop = listenDesktop,
    private readonly launchExternal: OpenExternal = openExternal,
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

  openExternal(url: string): Promise<void> {
    return this.launchExternal(url);
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

}
