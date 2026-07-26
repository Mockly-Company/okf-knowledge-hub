export type ErrorCode =
  | "authentication_expired"
  | "authentication_denied"
  | "reauthentication_required"
  | "credential_store_unavailable"
  | "github_permission_denied"
  | "github_unavailable"
  | "repository_path_conflict"
  | "repository_remote_mismatch"
  | "repository_dirty"
  | "clone_failed"
  | "workspace_missing"
  | "workspace_invalid"
  | "workspace_version_unsupported"
  | "workspace_changed_since_preview"
  | "push_failed"
  | "draft_pull_request_failed"
  | "local_settings_unavailable"
  | "desktop_only";

export type RecoveryAction =
  | "restart_login"
  | "reinstall_github_app"
  | "choose_another_directory"
  | "connect_existing_clone"
  | "clean_working_tree"
  | "open_workspace_file"
  | "update_okhub"
  | "retry";

export interface AppError {
  code: ErrorCode;
  message: string;
  recovery: RecoveryAction | null;
  details: Record<string, string>;
}

export interface GithubUserSummary {
  id: number;
  login: string;
  avatarUrl: string;
}

export type AuthState =
  | { status: "signed_out" }
  | { status: "authenticated"; user: GithubUserSummary }
  | { status: "reauthentication_required" };

export interface DeviceAuthorization {
  requestId: string;
  userCode: string;
  verificationUri: string;
  expiresAtUnix: number;
  intervalSeconds: number;
}

export type AuthStatusEvent =
  | { status: "waiting_for_user"; requestId: string }
  | { status: "authenticated"; requestId: string; user: GithubUserSummary }
  | { status: "reauthentication_required"; requestId: string }
  | { status: "failed"; requestId: string; error: AppError }
  | { status: "cancelled"; requestId: string };

export interface GithubRepositorySummary {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isEmpty: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RepositorySnapshot {
  root: string;
  headOid: string | null;
  defaultBranch: string | null;
  isDirty: boolean;
  hasContent: boolean;
  remoteUrl: string | null;
  fingerprint: string;
}

export type CloneProgressStage =
  | "receiving_objects"
  | "resolving_deltas"
  | "checking_out";

export interface CloneProgress {
  stage: CloneProgressStage;
  completed: number;
  total: number;
}

export interface CloneJob {
  requestId: string;
  targetPath: string;
}

export type CloneProgressEvent =
  | { status: "progress"; requestId: string; progress: CloneProgress }
  | { status: "completed"; requestId: string; repository: RepositorySnapshot }
  | { status: "failed"; requestId: string; error: AppError }
  | { status: "cancelled"; requestId: string };

export interface WorkspaceSummary {
  id: string;
  name: string;
  documentRoots: string[];
  repositoryCount: number;
}

export type WorkspaceDiagnosticCode =
  | "workspace_yaml_invalid"
  | "workspace_structure_invalid"
  | "schema_version_invalid"
  | "workspace_type_invalid"
  | "workspace_id_missing"
  | "workspace_id_type_invalid"
  | "workspace_id_not_v4"
  | "workspace_name_missing"
  | "workspace_name_type_invalid"
  | "workspace_name_empty"
  | "documents_type_invalid"
  | "document_roots_missing"
  | "document_roots_type_invalid"
  | "document_root_type_invalid"
  | "document_root_path_missing"
  | "document_root_path_type_invalid"
  | "document_root_empty"
  | "document_root_outside_repository"
  | "repositories_type_invalid"
  | "repository_type_invalid"
  | "duplicate_repository_key"
  | "duplicate_repository_label"
  | "repository_key_missing"
  | "repository_key_type_invalid"
  | "repository_key_empty"
  | "repository_key_invalid"
  | "repository_label_missing"
  | "repository_label_type_invalid"
  | "repository_github_missing"
  | "repository_github_type_invalid"
  | "repository_github_id_missing"
  | "repository_github_id_type_invalid"
  | "repository_github_full_name_missing"
  | "repository_github_full_name_type_invalid"
  | "github_type_invalid"
  | "github_project_type_invalid"
  | "github_project_id_missing"
  | "github_project_id_type_invalid"
  | "github_project_owner_missing"
  | "github_project_owner_type_invalid"
  | "github_project_number_missing"
  | "github_project_number_type_invalid"
  | "unknown_repository_key";

export interface WorkspaceDiagnostic {
  code: WorkspaceDiagnosticCode;
  path: string;
  message: string;
  value?: string;
}

export type WorkspaceInspection =
  | { status: "ready"; summary: WorkspaceSummary }
  | { status: "initialization_required" }
  | { status: "invalid"; diagnostics: WorkspaceDiagnostic[] }
  | { status: "unsupported_version"; foundVersion: number };

export type InitializationStrategy =
  | { kind: "direct_push" }
  | { kind: "draft_pull_request"; baseBranch: string };

export interface PreviewFile {
  path: string;
  content: string;
  overwritesExisting: boolean;
}

export interface InitializationPreview {
  id: string;
  workspaceId: string;
  workspaceName: string;
  repositoryFingerprint: string;
  branch: string;
  commitMessage: string;
  strategy: InitializationStrategy;
  files: PreviewFile[];
}

export interface InitializationResult {
  root: string;
  branch: string;
  commitOid: string;
  commitMessage: string;
  pushed: boolean;
  draftPullRequestUrl: string | null;
}

export interface ConnectedWorkspace {
  path: string;
  status: "connected";
  summary: WorkspaceSummary;
}

export interface RecoveryRequiredWorkspace {
  path: string;
  status: "recovery_required";
  summary?: null;
}

export type CurrentWorkspace = ConnectedWorkspace | RecoveryRequiredWorkspace;
export type CurrentWorkspaceState = CurrentWorkspace | null;

export interface PreviewInitializationInput {
  repositoryPath: string;
  workspaceName: string;
  repositoryId: string;
  repositoryFullName: string;
}

export type Unlisten = () => void;

interface ConnectionStateValues {
  mode: "initial" | "replacement";
  auth: AuthState | null;
  authorization: DeviceAuthorization | null;
  repositories: GithubRepositorySummary[];
  nextRepositoryCursor: string | null;
  selectedRepository: GithubRepositorySummary | null;
  localRepository: RepositorySnapshot | null;
  cloneJob: CloneJob | null;
  cloneProgress: CloneProgress | null;
  workspaceInspection: WorkspaceInspection | null;
  initializationPreview: InitializationPreview | null;
  connectedWorkspace: ConnectedWorkspace | null;
  replacementWorkspace: ConnectedWorkspace | null;
  error: AppError | null;
}

export interface AuthConnectionState extends ConnectionStateValues {
  step: "auth";
  status:
    | "idle"
    | "loading"
    | "waiting_for_user"
    | "reauthentication_required"
    | "error";
}

export interface RepositoryConnectionState extends ConnectionStateValues {
  step: "repository";
  status: "idle" | "loading" | "error";
  auth: Extract<AuthState, { status: "authenticated" }>;
}

export interface LocalConnectionState extends ConnectionStateValues {
  step: "local";
  status:
    | "idle"
    | "inspecting"
    | "cloning"
    | "clone_cancelling"
    | "validation_failed"
    | "error";
  auth: Extract<AuthState, { status: "authenticated" }>;
  selectedRepository: GithubRepositorySummary;
}

export interface InitializeConnectionState extends ConnectionStateValues {
  step: "initialize";
  status: "preview" | "initializing" | "connected" | "error";
}

export type ConnectionState =
  | AuthConnectionState
  | RepositoryConnectionState
  | LocalConnectionState
  | InitializeConnectionState;

export type ConnectionAction =
  | { type: "currentWorkspaceLoaded"; workspace: CurrentWorkspaceState }
  | { type: "authLoading" }
  | { type: "authLoaded"; auth: AuthState }
  | { type: "loginStarted"; authorization: DeviceAuthorization }
  | { type: "authEventReceived"; event: AuthStatusEvent }
  | { type: "repositoryLoading"; append: boolean }
  | {
      type: "repositoryPageLoaded";
      userId: number;
      page: Page<GithubRepositorySummary>;
      append: boolean;
    }
  | { type: "repositorySelected"; repository: GithubRepositorySummary }
  | { type: "localInspectionStarted" }
  | {
      type: "localRepositoryChanged";
      repositoryId: string;
      repository: RepositorySnapshot;
    }
  | { type: "cloneStarted"; repositoryId: string; job: CloneJob }
  | { type: "cloneCancellationRequested"; requestId: string }
  | { type: "cloneEventReceived"; event: CloneProgressEvent }
  | {
      type: "workspaceInspected";
      repositoryRoot: string;
      inspection: WorkspaceInspection;
    }
  | {
      type: "initializationPreviewLoaded";
      repositoryRoot: string;
      preview: InitializationPreview;
    }
  | { type: "initializationStarted" }
  | { type: "initializationFailed"; error: AppError }
  | { type: "workspaceConnected"; workspace: ConnectedWorkspace }
  | { type: "operationFailed"; error: AppError }
  | { type: "replacementStarted" }
  | { type: "replacementCancelled" };
