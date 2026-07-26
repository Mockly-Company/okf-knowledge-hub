import { useState } from "react";
import { HashRouter } from "react-router-dom";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { AppRoutes } from "./AppRoutes";

interface AppProps {
  workspaceGateway?: WorkspaceConnectionGateway;
  preferencesRepository?: PreferencesRepository;
}

export function App({
  workspaceGateway = createWorkspaceConnectionGateway(),
  preferencesRepository = createPreferencesRepository(),
}: AppProps) {
  const [repository] = useState(() => preferencesRepository);
  const [gateway] = useState(() => workspaceGateway);

  return (
    <PreferencesProvider repository={repository}>
      <WorkspaceConnectionProvider gateway={gateway}>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </WorkspaceConnectionProvider>
    </PreferencesProvider>
  );
}
