import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Decorator } from "@storybook/react-vite";
import { DocumentsProvider, type DocumentsProviderProps } from "@/features/documents/DocumentsProvider";
import type {
  DocumentCatalog,
  IndexStatus,
  SearchResult,
} from "@/features/documents/model";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { DisplayDensity } from "@/features/preferences/display-density";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type {
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
  authState?: AuthState;
  currentWorkspace?: CurrentWorkspaceState;
  repositories?: GithubRepositorySummary[];
  selectedDirectory?: string | null;
}

interface StorybookDocumentsOptions {
  catalog?: DocumentCatalog;
  selectedPath?: string | null;
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

  const documents = new FakeDocumentsGateway();
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
      searchDebounceMs={0}
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
          <MemoryRouter initialEntries={initialEntries}>{appChildren}</MemoryRouter>
        </WorkspaceConnectionProvider>
      </PreferencesProvider>
    </StorybookBoundaryContext.Provider>
  );
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
  return function WithAppProvidersDecorator(Story: Parameters<Decorator>[0]) {
    return (
      <StorybookAppProviders {...options}>
        <Story />
      </StorybookAppProviders>
    );
  };
}
