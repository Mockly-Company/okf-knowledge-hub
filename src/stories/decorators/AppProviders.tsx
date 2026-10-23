import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Decorator } from "@storybook/react-vite";
import { DocumentsProvider, type DocumentsProviderProps } from "@/features/documents/DocumentsProvider";
import type {
  DocumentAsset,
  DocumentCatalog,
  DraftSummary,
  IndexStatus,
  SearchResult,
} from "@/features/documents/model";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { WorkspaceConnectionProvider, useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type {
  AppError,
  AuthState,
  CurrentWorkspaceState,
  GithubRepositorySummary,
} from "@/features/workspace-connection/types";
import { FakeDocumentsGateway } from "@/test/FakeDocumentsGateway";
import { FakePreferencesRepository } from "@/test/FakePreferencesRepository";
import { FakeWorkspaceConnectionGateway } from "@/test/FakeWorkspaceConnectionGateway";
import { documentFixtures } from "../fixtures/documents";
import { workspaceFixtures } from "../fixtures/workspace";

interface StorybookPreferencesOptions {
  displayDensity?: DisplayDensity;
}

interface StorybookWorkspaceOptions {
  cloneOutcome?: "success" | "failure";
  existingCloneError?: AppError;
  authState?: AuthState;
  currentWorkspace?: CurrentWorkspaceState;
  repositories?: GithubRepositorySummary[];
  repositoryLoading?: boolean;
  selectedDirectory?: string | null;
}

interface StorybookDocumentsOptions {
  asset?: DocumentAsset;
  catalog?: DocumentCatalog;
  drafts?: DraftSummary[];
  selectedPath?: string | null;
  initialSearchQuery?: string;
  searchResults?: SearchResult[];
  branch?: string;
  repositoryFullName?: string;
  workspaceId?: string;
  indexStatus?: IndexStatus;
}

interface StorybookRouterOptions {
  initialEntries?: string[];
}

export interface StorybookAppProvidersOptions {
  preferences?: StorybookPreferencesOptions;
  workspace?: StorybookWorkspaceOptions;
  documents?: StorybookDocumentsOptions;
  router?: StorybookRouterOptions;
  includeDocumentsProvider?: boolean;
}

interface ProviderBoundary {
  preferences: FakePreferencesRepository;
  workspace: FakeWorkspaceConnectionGateway;
  documents: FakeDocumentsGateway;
  createId: DocumentsProviderProps["createId"];
}

const StorybookBoundaryContext = createContext<ProviderBoundary | null>(null);

function createBoundary(
  options: StorybookAppProvidersOptions = {},
): ProviderBoundary {
  const preferences = new FakePreferencesRepository(
    options.preferences?.displayDensity ?? "default",
  );

  const workspace = FakeWorkspaceConnectionGateway.disconnected();
  if (options.workspace?.repositoryLoading) {
    workspace.listRepositories = () => new Promise(() => {});
  }
  const connectedWorkspace =
    options.workspace?.currentWorkspace === undefined
      ? workspaceFixtures.connectedWorkspace()
      : options.workspace.currentWorkspace?.status === "connected"
        ? options.workspace.currentWorkspace
        : null;
  workspace.authState =
    options.workspace?.authState ?? workspaceFixtures.authenticatedState();
  workspace.currentWorkspace =
    options.workspace?.currentWorkspace ?? connectedWorkspace;
  if (connectedWorkspace) {
    workspace.connectedWorkspace = connectedWorkspace;
  }
  workspace.repositories = options.workspace?.repositories ?? [
    workspaceFixtures.repository(),
  ];
  workspace.selectedDirectory =
    options.workspace?.selectedDirectory ?? "/workspace";
  workspace.existingCloneError = options.workspace?.existingCloneError ?? null;
  if (options.workspace?.cloneOutcome) {
    workspace.workspaceInspection = { status: "ready", summary: workspaceFixtures.summary() };
    workspace.connectedWorkspace = workspaceFixtures.connectedWorkspace();
  }

  const documents = new FakeDocumentsGateway();
  if (options.documents?.asset) documents.asset = options.documents.asset;
  const catalog = options.documents?.catalog ?? documentFixtures.defaultCatalog();
  const selectedPath =
    options.documents?.selectedPath &&
    catalog.documents.some((document) => document.path === options.documents?.selectedPath)
      ? options.documents.selectedPath
      : null;

  documents.sessionSnapshot = {
    ...documents.sessionSnapshot,
    workspaceId:
      options.documents?.workspaceId ??
      connectedWorkspace?.summary.id ??
      workspaceFixtures.summary().id,
    repositoryFullName:
      options.documents?.repositoryFullName ??
      connectedWorkspace?.repository?.fullName ??
      workspaceFixtures.repository().fullName,
    branch: options.documents?.branch ?? "main",
    catalog,
    indexStatus: options.documents?.indexStatus ?? { status: "ready" },
    lastOpenedPath: selectedPath,
  };
  documents.searchResults = options.documents?.searchResults ?? [];
  documents.drafts = options.documents?.drafts ?? [];

  let idCounter = 0;
  const createId = () => `storybook-documents-${++idCounter}`;

  return { preferences, workspace, documents, createId };
}

export function StorybookAppProviders({
  children,
  ...options
}: PropsWithChildren<StorybookAppProvidersOptions>) {
  const optionsKey = JSON.stringify(options);
  const boundary = useMemo(() => createBoundary(options), [optionsKey]);
  const initialEntries = options.router?.initialEntries ?? ["/"];
  const includeDocumentsProvider = options.includeDocumentsProvider ?? true;

  const appChildren = includeDocumentsProvider ? (
    <DocumentsProvider
      gateway={boundary.documents}
      createId={boundary.createId}
      initialSearchQuery={options.documents?.initialSearchQuery}
    >
      {children}
    </DocumentsProvider>
  ) : (
    children
  );

  return (
    <StorybookBoundaryContext.Provider value={boundary}>
      <PreferencesProvider key={optionsKey} repository={boundary.preferences}>
        <WorkspaceConnectionProvider gateway={boundary.workspace}>
          <MemoryRouter initialEntries={initialEntries}>
            <StorybookCloneSimulation outcome={options.workspace?.cloneOutcome} />
            {appChildren}
          </MemoryRouter>
        </WorkspaceConnectionProvider>
      </PreferencesProvider>
    </StorybookBoundaryContext.Provider>
  );
}

function StorybookCloneSimulation({ outcome }: { outcome?: "success" | "failure" }) {
  const boundary = useStorybookProviderBoundary();
  const { state } = useWorkspaceConnection();
  const job = state.step === "local" && state.status === "cloning" ? state.cloneJob : null;
  const repository = state.step === "local" ? state.selectedRepository : null;
  useEffect(() => {
    if (!outcome || !job || !repository) return;
    const progress = setTimeout(() => boundary.workspace.emitClone({
      status: "progress", requestId: job.requestId,
      progress: { stage: "receiving_objects", completed: 4, total: 10 },
    }), 250);
    const completion = setTimeout(() => {
      if (outcome === "failure") {
        boundary.workspace.emitClone({ status: "failed", requestId: job.requestId,
          error: { code: "clone_failed", message: "다운로드 연결이 끊겼습니다. 다시 시도하세요.", recovery: "retry", details: {} },
        });
      } else {
        boundary.workspace.emitClone({ status: "completed", requestId: job.requestId,
          ownershipTargetPath: job.targetPath,
          repository: { ...boundary.workspace.repositorySnapshot, root: job.targetPath, remoteUrl: `https://github.com/${repository.fullName}.git` },
        });
      }
    }, 1200);
    return () => { clearTimeout(progress); clearTimeout(completion); };
  }, [boundary, job, repository, outcome]);
  return null;
}

export function useStorybookProviderBoundary(): ProviderBoundary {
  const boundary = useContext(StorybookBoundaryContext);
  if (!boundary) {
    throw new Error("useStorybookProviderBoundary must be used inside StorybookAppProviders");
  }
  return boundary;
}

export function withAppProviders(
  options: StorybookAppProvidersOptions = {},
): Decorator {
  return function WithAppProvidersDecorator(Story, context) {
    return (
      <StorybookAppProviders {...options} preferences={{
        ...options.preferences,
        displayDensity: options.preferences?.displayDensity ?? (context.globals.displayDensity === "compact" ? "compact" : "default"),
      }}>
        <Story />
      </StorybookAppProviders>
    );
  };
}
