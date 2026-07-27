import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import type {
  AppError,
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

const DESKTOP_ONLY_MESSAGE =
  "GitHub 연결은 OkHub 데스크톱 앱에서 사용할 수 있습니다.";

export function desktopOnlyError(): AppError {
  return {
    code: "desktop_only",
    message: DESKTOP_ONLY_MESSAGE,
    recovery: null,
    details: {},
  };
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(desktopOnlyError());
}

export class UnavailableWorkspaceConnectionGateway
  implements WorkspaceConnectionGateway
{
  getCurrentWorkspace(): Promise<CurrentWorkspaceState> {
    return unavailable();
  }

  getAuthState(): Promise<AuthState> {
    return unavailable();
  }

  beginGithubAuth(_requestId: string): Promise<DeviceAuthorization> {
    return unavailable();
  }

  cancelGithubAuth(_requestId: string): Promise<boolean> {
    return unavailable();
  }

  logoutGithub(): Promise<void> {
    return unavailable();
  }

  onAuthStatus(_listener: (event: AuthStatusEvent) => void): Promise<Unlisten> {
    return unavailable();
  }

  listRepositories(_cursor?: string): Promise<Page<GithubRepositorySummary>> {
    return unavailable();
  }

  pickDirectory(): Promise<string | null> {
    return unavailable();
  }

  openExternal(_url: string): Promise<void> {
    return unavailable();
  }

  openPath(_path: string): Promise<void> {
    return unavailable();
  }

  inspectExistingClone(
    _path: string,
    _repositoryId: string,
  ): Promise<RepositorySnapshot> {
    return unavailable();
  }

  cloneRepository(
    _requestId: string,
    _repository: GithubRepositorySummary,
    _parentDirectory: string,
  ): Promise<CloneJob> {
    return unavailable();
  }

  cancelRepositoryClone(_requestId: string): Promise<boolean> {
    return unavailable();
  }

  onCloneProgress(
    _listener: (event: CloneProgressEvent) => void,
  ): Promise<Unlisten> {
    return unavailable();
  }

  inspectWorkspace(_path: string): Promise<WorkspaceInspection> {
    return unavailable();
  }

  connectWorkspace(
    _path: string,
    _repository: Pick<GithubRepositorySummary, "id" | "fullName">,
  ): Promise<ConnectedWorkspace> {
    return unavailable();
  }

  previewInitialization(
    _input: PreviewInitializationInput,
  ): Promise<InitializationPreview> {
    return unavailable();
  }

  initializeWorkspace(_previewId: string): Promise<InitializationResult> {
    return unavailable();
  }
}
