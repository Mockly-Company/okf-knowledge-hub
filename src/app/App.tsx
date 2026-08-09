import { useState } from "react";
import { HashRouter } from "react-router-dom";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import { createDocumentsGateway } from "@/infrastructure/documents/createDocumentsGateway";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { AppRoutes } from "./AppRoutes";

interface AppProps {
  workspaceGateway?: WorkspaceConnectionGateway;
  preferencesRepository?: PreferencesRepository;
  documentsGateway?: DocumentsGateway;
}

export function App({
  workspaceGateway = createWorkspaceConnectionGateway(),
  preferencesRepository = createPreferencesRepository(),
  documentsGateway = createDocumentsGateway(),
}: AppProps) {
  const [repository] = useState(() => preferencesRepository);
  const [workspace] = useState(() => workspaceGateway);
  const [documents] = useState(() => documentsGateway);

  return (
    <PreferencesProvider repository={repository}>
      <WorkspaceConnectionProvider gateway={workspace}>
        <DocumentsProvider gateway={documents}>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </DocumentsProvider>
      </WorkspaceConnectionProvider>
    </PreferencesProvider>
  );
}
