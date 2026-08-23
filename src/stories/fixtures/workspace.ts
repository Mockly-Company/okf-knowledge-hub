import type {
  AuthState,
  ConnectedWorkspace,
  CurrentWorkspaceState,
  GithubRepositorySummary,
  WorkspaceSummary,
} from "@/features/workspace-connection/types";

const DEMO_REPOSITORY: GithubRepositorySummary = {
  id: "R_demoKnowledge",
  owner: "okhub",
  name: "demo-knowledge",
  fullName: "okhub/demo-knowledge",
  defaultBranch: "main",
  isEmpty: false,
};

const DEMO_SUMMARY: WorkspaceSummary = {
  id: "0d4dfb65-1f6b-42f1-9c31-43a3f67a97e7",
  name: "OKHub 데모 워크스페이스",
  schemaVersion: 1,
  documentRoots: ["docs"],
  repositoryCount: 1,
};

const DEMO_CONNECTED_WORKSPACE: ConnectedWorkspace = {
  path: "/workspace/okhub-demo-knowledge",
  status: "connected",
  summary: DEMO_SUMMARY,
  repository: {
    id: DEMO_REPOSITORY.id,
    fullName: DEMO_REPOSITORY.fullName,
  },
};

const AUTHENTICATED_STATE: AuthState = {
  status: "authenticated",
  user: {
    id: 7,
    login: "storybook-bot",
    avatarUrl: "https://example.test/storybook-bot.png",
  },
};

export const workspaceFixtures = {
  repository: (): GithubRepositorySummary => ({ ...DEMO_REPOSITORY }),
  summary: (): WorkspaceSummary => ({
    ...DEMO_SUMMARY,
    documentRoots: [...DEMO_SUMMARY.documentRoots],
  }),
  connectedWorkspace: (): ConnectedWorkspace => ({
    ...DEMO_CONNECTED_WORKSPACE,
    summary: workspaceFixtures.summary(),
    repository: DEMO_CONNECTED_WORKSPACE.repository
      ? { ...DEMO_CONNECTED_WORKSPACE.repository }
      : undefined,
  }),
  currentWorkspace: (): CurrentWorkspaceState =>
    workspaceFixtures.connectedWorkspace(),
  authenticatedState: (): AuthState => ({
    status: AUTHENTICATED_STATE.status,
    user: { ...AUTHENTICATED_STATE.user },
  }),
};
