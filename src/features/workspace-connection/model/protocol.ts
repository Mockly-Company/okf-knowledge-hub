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
  | {
      status: "completed";
      requestId: string;
      ownershipTargetPath: string;
      repository: RepositorySnapshot;
    }
  | { status: "failed"; requestId: string; error: AppError }
  | { status: "cancelled"; requestId: string };

export interface WorkspaceSummary {
  id: string;
  name: string;
  schemaVersion: number;
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
  repository?: {
    id: string;
    fullName: string;
  };
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

export interface AuthLoadRequest {
  id: string;
}

export interface LoginBeginRequest {
  id: string;
}

export interface RepositoryLoadRequest {
  id: string;
  userId: number;
  cursor: string | null;
  append: boolean;
}

export interface LocalInspectionRequest {
  id: string;
  repositoryId: string;
  path: string;
}

export interface CloneStartRequest {
  id: string;
  repositoryId: string;
  parentDirectory: string;
  targetPath: string;
}

export interface WorkspaceInspectionRequest {
  id: string;
  repositoryRoot: string;
}

export interface InitializationPreviewRequest {
  id: string;
  repositoryRoot: string;
  workspaceName: string;
}

export interface InitializationRequest {
  id: string;
  previewId: string;
  repositoryRoot: string;
}

export type WorkspaceConnectionRequest =
  | {
      id: string;
      repositoryRoot: string;
      repositoryId: string;
      repositoryFullName: string;
      source: "existing";
      initializationRequestId: null;
    }
  | {
      id: string;
      repositoryRoot: string;
      repositoryId: string;
      repositoryFullName: string;
      source: "initialization";
      initializationRequestId: string;
    };
