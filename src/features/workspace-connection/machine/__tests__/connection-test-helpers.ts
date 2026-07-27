import {
  connectionReducer,
  createInitialConnectionState,
} from "../connection-reducer";
import type {
  AppError,
  AuthLoadRequest,
  AuthStatusEvent,
  CloneProgressEvent,
  CloneStartRequest,
  ConnectedWorkspace,
  GithubRepositorySummary,
  InitializationPreview,
  InitializationPreviewRequest,
  InitializationRequest,
  InitializationResult,
  LoginBeginRequest,
  LocalInspectionRequest,
  RepositoryLoadRequest,
  RepositorySnapshot,
  WorkspaceInspectionRequest,
  WorkspaceInspection,
  WorkspaceConnectionRequest,
} from "../../model/protocol";
import type { LocalConnectionState } from "../connection-state";

export const user = { id: 7, login: "hyeeun", avatarUrl: "https://example.test/me" };
export const unavailableError: AppError = {
  code: "github_unavailable",
  message: "GitHub에 연결할 수 없습니다.",
  recovery: "retry",
  details: {},
};

export function repository(id: string): GithubRepositorySummary {
  return {
    id,
    owner: "Mockly-Company",
    name: `${id}-knowledge`,
    fullName: `Mockly-Company/${id}-knowledge`,
    defaultBranch: "main",
    isEmpty: false,
  };
}

export function localRepository(root = "/work/old-knowledge"): RepositorySnapshot {
  return {
    root,
    headOid: "abc123",
    defaultBranch: "main",
    isDirty: false,
    hasContent: true,
    remoteUrl: "https://github.com/Mockly-Company/old-knowledge.git",
    fingerprint: "fingerprint",
  };
}

export function preview(id = "preview-1"): InitializationPreview {
  return {
    id,
    workspaceId: "workspace-1",
    workspaceName: "Mockly",
    repositoryFingerprint: "fingerprint",
    branch: "okf/init-workspace",
    commitMessage: "chore: initialize OkHub workspace",
    strategy: { kind: "draft_pull_request", baseBranch: "main" },
    files: [
      {
        path: ".okf/workspace.yml",
        content: "schema_version: 1\n",
        overwritesExisting: false,
      },
    ],
  };
}

export function connected(path = "/work/old-knowledge"): ConnectedWorkspace {
  return {
    path,
    status: "connected",
    summary: {
      id: "workspace-1",
      name: "Mockly",
      schemaVersion: 1,
      documentRoots: ["docs"],
      repositoryCount: 0,
    },
  };
}

export function repositoryRequest(
  id = "repositories-1",
  cursor: string | null = null,
  append = false,
): RepositoryLoadRequest {
  return { id, userId: user.id, cursor, append };
}

export function localRequest(id: string, path: string): LocalInspectionRequest {
  return { id, repositoryId: "old", path };
}

export function cloneRequest(id: string, parentDirectory: string): CloneStartRequest {
  return {
    id,
    repositoryId: "old",
    parentDirectory,
    targetPath: `${parentDirectory}/old-knowledge`,
  };
}

export function workspaceRequest(id: string, root: string): WorkspaceInspectionRequest {
  return { id, repositoryRoot: root };
}

export function previewRequest(
  id: string,
  root: string,
  workspaceName = "Mockly",
): InitializationPreviewRequest {
  return { id, repositoryRoot: root, workspaceName };
}

export function authLoadRequest(id = "auth-load-1"): AuthLoadRequest {
  return { id };
}

export function loginBeginRequest(id = "login-begin-1"): LoginBeginRequest {
  return { id };
}

export function authorization(requestId: string) {
  return {
    requestId,
    userCode: "ABCD-EFGH",
    verificationUri: "https://github.com/login/device",
    expiresAtUnix: 2_000,
    intervalSeconds: 5,
  };
}

export function initializationRequest(
  id = "initialization-1",
  root = "/work/old-knowledge",
): InitializationRequest {
  return { id, previewId: "preview-1", repositoryRoot: root };
}

export function initializationResult(
  root = "/work/old-knowledge",
): InitializationResult {
  return {
    root,
    branch: "okf/init-workspace",
    commitOid: "commit-1",
    commitMessage: "chore: initialize OkHub workspace",
    pushed: true,
    draftPullRequestUrl: null,
  };
}

export function initializationConnectionRequest(
  id: string,
  initializationRequestId: string,
  root = "/work/old-knowledge",
): Extract<WorkspaceConnectionRequest, { source: "initialization" }> {
  return {
    id,
    repositoryRoot: root,
    repositoryId: "R_kgDOExample",
    repositoryFullName: "Mockly-Company/mockly-knowledge",
    source: "initialization",
    initializationRequestId,
  };
}

export function existingConnectionRequest(
  id: string,
  root = "/work/old-knowledge",
): Extract<WorkspaceConnectionRequest, { source: "existing" }> {
  return {
    id,
    repositoryRoot: root,
    repositoryId: "R_kgDOExample",
    repositoryFullName: "Mockly-Company/mockly-knowledge",
    source: "existing",
    initializationRequestId: null,
  };
}

export function repositoryState() {
  const request = authLoadRequest();
  const loading = connectionReducer(createInitialConnectionState(), {
    type: "authLoadStarted",
    request,
  });
  return connectionReducer(loading, {
    type: "authLoaded",
    request,
    auth: { status: "authenticated", user },
  });
}

export function selectedRepositoryState() {
  return connectionReducer(repositoryState(), {
    type: "repositorySelected",
    repository: repository("old"),
  });
}

export function localState(root = "/work/old-knowledge") {
  const request = localRequest(`local-${root}`, root);
  let state = connectionReducer(selectedRepositoryState(), {
    type: "localInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "localRepositoryChanged",
    request,
    repository: localRepository(root),
  });
}

export function initializationRequiredState(root = "/work/old-knowledge") {
  const request = workspaceRequest(`workspace-${root}`, root);
  let state = connectionReducer(localState(root), {
    type: "workspaceInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "workspaceInspected",
    request,
    inspection: { status: "initialization_required" },
  });
}

export function readyWorkspaceState(root = "/work/old-knowledge") {
  const request = workspaceRequest(`ready-workspace-${root}`, root);
  let state = connectionReducer(localState(root), {
    type: "workspaceInspectionStarted",
    request,
  });
  return connectionReducer(state, {
    type: "workspaceInspected",
    request,
    inspection: { status: "ready", summary: connected(root).summary },
  });
}

export function previewState() {
  const request = previewRequest("preview-request-1", "/work/old-knowledge");
  let state = connectionReducer(initializationRequiredState(), {
    type: "initializationPreviewStarted",
    request,
  });
  return connectionReducer(state, {
    type: "initializationPreviewLoaded",
    request,
    preview: preview(),
  });
}

export function readyToConnectState(request = initializationRequest()) {
  let state = connectionReducer(previewState(), {
    type: "initializationStarted",
    request,
  });
  return connectionReducer(state, {
    type: "initializationSucceeded",
    request,
    result: initializationResult(request.repositoryRoot),
  });
}

export function connectingState(
  initialization = initializationRequest(),
  connection = initializationConnectionRequest(
    "workspace-connection-1",
    initialization.id,
    initialization.repositoryRoot,
  ),
) {
  return connectionReducer(readyToConnectState(initialization), {
    type: "workspaceConnectionStarted",
    request: connection,
  });
}
