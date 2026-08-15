import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DesignSystemPage } from "@/pages/DesignSystemPage";
import { WorkspaceGate } from "@/features/workspace-connection/WorkspaceGate";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";

function ConnectedAppShell({ documentsGateway }: { documentsGateway: DocumentsGateway }) {
  return (
    <DocumentsProvider gateway={documentsGateway}>
      <AppShell />
    </DocumentsProvider>
  );
}

export function AppRoutes({ documentsGateway }: { documentsGateway: DocumentsGateway }) {
  return (
    <Routes>
      <Route element={<WorkspaceGate />}>
        <Route element={<ConnectedAppShell documentsGateway={documentsGateway} />}>
          <Route index element={<HomePage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="project" element={<ProjectPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="dev/design-system" element={<DesignSystemPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
