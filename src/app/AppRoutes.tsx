import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/patterns/AppShell";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { HomePage } from "@/pages/HomePage";
import { ProjectPage } from "@/pages/ProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { DesignSystemPage } from "@/pages/DesignSystemPage";
import { WorkspaceGate } from "@/features/workspace-connection/WorkspaceGate";
import { DocumentsProvider } from "@/features/documents/DocumentsProvider";
import {
  DocumentsFollowActiveProject,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import { useDocsRepositorySync } from "@/features/docs-repository/useDocsRepositorySync";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import type { AiGateway } from "@/features/ai/AiGateway";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import { TauriAiGateway } from "@/infrastructure/ai/TauriAiGateway";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

function DocsRepositorySync({ gateway }: { gateway: DocsRepositoryGateway }) {
  useDocsRepositorySync(gateway);
  return null;
}

function ConnectedAppShell({
  documentsGateway,
  docsRepositoryGateway,
  repositoryGateway,
  aiGateway,
}: {
  documentsGateway: DocumentsGateway;
  docsRepositoryGateway: DocsRepositoryGateway;
  repositoryGateway: ProjectRepositoryGateway;
  aiGateway: AiGateway;
}) {
  return (
    <DocumentsProvider gateway={documentsGateway}>
      <DocumentsFollowActiveProject />
      <DocsRepositorySync gateway={docsRepositoryGateway} />
      <AppShell
        docsRepositoryGateway={docsRepositoryGateway}
        repositoryGateway={repositoryGateway}
        aiGateway={aiGateway}
      />
    </DocumentsProvider>
  );
}

// AI 화면을 열기 전에는 터미널 라이브러리를 불러오지 않는다.
const AiPage = lazy(() =>
  import("@/pages/AiPage").then((module) => ({ default: module.AiPage })),
);

const sharedAiGateway = new TauriAiGateway();
const sharedProjectBoardGateway = new TauriProjectBoardGateway();

function ConnectedAiPage({
  aiGateway,
  docsRepositoryGateway,
  repositoryGateway,
}: {
  aiGateway: AiGateway;
  docsRepositoryGateway: DocsRepositoryGateway;
  repositoryGateway: ProjectRepositoryGateway;
}) {
  return (
    <Suspense fallback={<p role="status">AI 화면을 불러오는 중…</p>}>
      <AiPage
        aiGateway={aiGateway}
        docsRepositoryGateway={docsRepositoryGateway}
        repositoryGateway={repositoryGateway}
      />
    </Suspense>
  );
}

export function AppRoutes({
  documentsGateway,
  aiGateway = sharedAiGateway,
  projectBoardGateway = sharedProjectBoardGateway,
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  documentsGateway: DocumentsGateway;
  aiGateway?: AiGateway;
  projectBoardGateway?: ProjectBoardGateway;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  return (
    <Routes>
      <Route element={<WorkspaceGate />}>
        <Route
          element={
            <ConnectedAppShell
              documentsGateway={documentsGateway}
              docsRepositoryGateway={docsRepositoryGateway}
              repositoryGateway={repositoryGateway}
              aiGateway={aiGateway}
            />
          }
        >
          <Route index element={<Navigate to="/documents" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route
            path="documents"
            element={
              <DocumentsPage
                docsRepositoryGateway={docsRepositoryGateway}
                repositoryGateway={repositoryGateway}
              />
            }
          />
          <Route
            path="project"
            element={
              <ProjectPage
                gateway={projectBoardGateway}
                docsRepositoryGateway={docsRepositoryGateway}
                repositoryGateway={repositoryGateway}
              />
            }
          />
          {/* /work는 /project 별칭. 사이드바 "Board" 탭과 같은 화면이다. */}
          <Route
            path="work"
            element={
              <ProjectPage
                gateway={projectBoardGateway}
                docsRepositoryGateway={docsRepositoryGateway}
                repositoryGateway={repositoryGateway}
              />
            }
          />
          <Route
            path="ai"
            element={
              <ConnectedAiPage
                aiGateway={aiGateway}
                docsRepositoryGateway={docsRepositoryGateway}
                repositoryGateway={repositoryGateway}
              />
            }
          />
          <Route path="settings" element={<SettingsPage aiGateway={aiGateway} />} />
          <Route path="dev/design-system" element={<DesignSystemPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
