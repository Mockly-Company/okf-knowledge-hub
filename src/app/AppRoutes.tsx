import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DesignSystemPage } from "@/pages/DesignSystemPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="project" element={<ProjectPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dev/design-system" element={<DesignSystemPage />} />
      </Route>
    </Routes>
  );
}
