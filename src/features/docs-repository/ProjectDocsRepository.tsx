import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { useDocuments } from "@/features/documents/DocumentsProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  DocsRepositoryPicker,
  NOT_OKF_WARNING,
} from "@/features/docs-repository/DocsRepositoryPicker";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import { TauriDocsRepositoryGateway } from "@/infrastructure/docs-repository/TauriDocsRepositoryGateway";
import { TauriWorkspaceConnectionGateway } from "@/infrastructure/workspace/TauriWorkspaceConnectionGateway";

export const sharedDocsRepositoryGateway: DocsRepositoryGateway =
  new TauriDocsRepositoryGateway();
export const sharedRepositoryGateway = new TauriWorkspaceConnectionGateway();

export type ProjectRepositoryGateway = Pick<
  WorkspaceConnectionGateway,
  | "getCurrentWorkspace"
  | "listRepositories"
  | "cloneRepository"
  | "cancelRepositoryClone"
  | "onCloneProgress"
>;

export const currentDocsRepositoryKey = ["docsRepository", "current"] as const;

/** 현재 문서 저장소가 OKF 형식이 아니면 경고한다. 조회에 실패하면 아무것도 보여 주지 않는다. */
export function NotOkfNotice({ gateway }: { gateway: ProjectRepositoryGateway }) {
  const current = useQuery({
    queryKey: currentDocsRepositoryKey,
    queryFn: () => gateway.getCurrentWorkspace(),
  });
  const workspace = current.data;
  if (workspace?.status !== "connected" || workspace.okf !== false) {
    return null;
  }
  return (
    <StatusFeedback variant="banner" tone="warning" className="documents-page__notice">
      <div>
        <strong>{NOT_OKF_WARNING}</strong>
        <p>저장소의 마크다운 문서를 그대로 보여 줍니다.</p>
      </div>
    </StatusFeedback>
  );
}

/** 활성 프로젝트의 문서 저장소를 고른다. 연결되면 프로젝트를 다시 선택해 Documents를 새로 연다. */
export function ProjectDocsRepositoryPicker({
  projectId,
  gateway,
  repositoryGateway,
  onDone,
}: {
  projectId: string;
  gateway: DocsRepositoryGateway;
  repositoryGateway: ProjectRepositoryGateway;
  onDone?(): void;
}) {
  const activeProject = useOptionalActiveProject();
  const { retrySession } = useDocuments();
  const queryClient = useQueryClient();
  return (
    <DocsRepositoryPicker
      projectId={projectId}
      gateway={gateway}
      repositoryGateway={repositoryGateway}
      onConnected={() => {
        void (async () => {
          // 백엔드가 현재 워크스페이스를 이 저장소로 바꾸고 "문서 저장소 없음"을 해제한다.
          await activeProject?.selectProject(projectId).catch(() => undefined);
          await queryClient.invalidateQueries({ queryKey: currentDocsRepositoryKey });
          retrySession();
          onDone?.();
        })();
      }}
    />
  );
}

export function DocsRepositoryErrorDetail({ title }: { title: string }) {
  return (
    <StatusFeedback variant="content" tone="info">
      <StatusFeedbackTitle>{title}</StatusFeedbackTitle>
      <StatusFeedbackDescription>사이드바에서 프로젝트를 먼저 선택하세요.</StatusFeedbackDescription>
    </StatusFeedback>
  );
}
