import { homeIdentity } from "@/features/home/home-identity";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { ConnectedHomePage } from "@/features/home/ConnectedHomePage";
import { HomeProvider } from "@/features/home/HomeProvider";
import type { HomeGateway } from "@/features/home/HomeGateway";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { createHomeGateway } from "@/infrastructure/home/TauriHomeGateway";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DesignSystemPage } from "@/pages/DesignSystemPage";
import { WorkspaceGate } from "@/features/workspace-connection/WorkspaceGate";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";

function ConnectedSettingsPage(){const [params]=useSearchParams();return <SettingsPage initialCategory={params.get("category")==="home"?"홈":"화면"}/>;}

const defaultHomeGateway = createHomeGateway();
function ConnectedAppShell({ documentsGateway, homeGateway }: { documentsGateway: DocumentsGateway; homeGateway: HomeGateway }) {
  const {account,state}=useWorkspaceConnection();
  const identity=account.status==="authenticated"&&state.status==="connected"?homeIdentity(account.user.id,state.connectedWorkspace):"";
  return (
    <DocumentsProvider gateway={documentsGateway}>
      <HomeProvider identity={identity} gateway={homeGateway}><AppShell /></HomeProvider>
    </DocumentsProvider>
  );
}

export function AppRoutes({ documentsGateway, homeGateway = defaultHomeGateway }: { documentsGateway: DocumentsGateway; homeGateway?: HomeGateway }) {
  return (
    <Routes>
      <Route element={<WorkspaceGate />}>
        <Route element={<ConnectedAppShell documentsGateway={documentsGateway} homeGateway={homeGateway} />}>
          <Route index element={<ConnectedHomePage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="project" element={<ProjectPage />} />
          <Route path="settings" element={<ConnectedSettingsPage />} />
          <Route path="dev/design-system" element={<DesignSystemPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
