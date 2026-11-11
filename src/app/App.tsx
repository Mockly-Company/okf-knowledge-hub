import { Suspense, lazy, useState } from "react";
import { HashRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/infrastructure/query/queryClient";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import type { AiGateway } from "@/features/ai/AiGateway";
import { PreferencesProvider } from "@/features/preferences/PreferencesProvider";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { ActiveProjectProvider } from "@/features/active-project/ActiveProjectProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import { WorkspaceConnectionProvider } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import { createDocumentsGateway } from "@/infrastructure/documents/createDocumentsGateway";
import { TauriDocsRepositoryGateway } from "@/infrastructure/docs-repository/TauriDocsRepositoryGateway";
import { createPreferencesRepository } from "@/infrastructure/preferences/createPreferencesRepository";
import { createWorkspaceConnectionGateway } from "@/infrastructure/workspace/createWorkspaceConnectionGateway";
import { TauriAiGateway } from "@/infrastructure/ai/TauriAiGateway";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";
import { AppRoutes } from "./AppRoutes";

interface AppProps {
  workspaceGateway?: WorkspaceConnectionGateway;
  preferencesRepository?: PreferencesRepository;
  documentsGateway?: DocumentsGateway;
  projectBoardGateway?: ProjectBoardGateway;
  docsRepositoryGateway?: DocsRepositoryGateway;
  aiGateway?: AiGateway;
}

// React Query devtools는 dev 웹뷰에서만 띄운다. 테스트에서는 DOM 오염 방지.
const showQueryDevtools =
  import.meta.env.DEV &&
  (typeof process === "undefined" || !process.env.VITEST);

// 프로덕션 빌드에서 동적 import까지 사라지도록 DEV로 직접 분기한다.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((module) => ({
        default: module.ReactQueryDevtools,
      })),
    )
  : null;

export function App({
  workspaceGateway = createWorkspaceConnectionGateway(),
  preferencesRepository = createPreferencesRepository(),
  documentsGateway = createDocumentsGateway(),
  projectBoardGateway,
  docsRepositoryGateway,
  aiGateway,
}: AppProps) {
  const [repository] = useState(() => preferencesRepository);
  const [workspace] = useState(() => workspaceGateway);
  const [documents] = useState(() => documentsGateway);
  const [projectBoard] = useState(
    () => projectBoardGateway ?? new TauriProjectBoardGateway(),
  );
  const [docsRepo] = useState(
    () => docsRepositoryGateway ?? new TauriDocsRepositoryGateway(),
  );
  const [ai] = useState(() => aiGateway ?? new TauriAiGateway());
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider repository={repository}>
        <WorkspaceConnectionProvider gateway={workspace}>
          <ActiveProjectProvider
            projectGateway={projectBoard}
            docsRepositoryGateway={docsRepo}
          >
            <HashRouter>
              <AppRoutes
                documentsGateway={documents}
                aiGateway={ai}
                projectBoardGateway={projectBoard}
                docsRepositoryGateway={docsRepo}
                repositoryGateway={workspace}
              />
            </HashRouter>
          </ActiveProjectProvider>
        </WorkspaceConnectionProvider>
      </PreferencesProvider>
      {ReactQueryDevtools && showQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
