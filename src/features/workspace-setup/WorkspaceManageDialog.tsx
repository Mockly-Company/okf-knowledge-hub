import { FolderGit2, SquareKanban, Trash2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusFeedback } from "@/components/ui/status-feedback";
import { useActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { aiKeys } from "@/features/ai/queryKeys";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  WorkspaceDocsRepositoryPicker,
  currentDocsRepositoryKey,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { useOptionalDocuments } from "@/features/documents/DocumentsProvider";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { ProjectPickerList } from "./ProjectPickerList";

export type WorkspaceManageInitialView =
  | "overview"
  | "attach-project"
  | "change-docs";

function describeManageError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.trim() !== ""
  ) {
    return (error as { message: string }).message;
  }
  return "워크스페이스 설정을 변경하지 못했습니다.";
}

export function WorkspaceManageDialog({
  open,
  onOpenChange,
  initialView = "overview",
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialView?: WorkspaceManageInitialView;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  const activeProject = useActiveProject();
  const documents = useOptionalDocuments();
  const queryClient = useQueryClient();
  const workspace = activeProject.activeWorkspace;

  const [editingProject, setEditingProject] = useState(
    initialView === "attach-project",
  );
  const [editingDocs, setEditingDocs] = useState(initialView === "change-docs");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !workspace) {
      onOpenChange(false);
      return;
    }
    if (open) {
      setEditingProject(initialView === "attach-project");
      setEditingDocs(initialView === "change-docs");
      setConfirmingRemove(false);
      setActionError(null);
    }
  }, [initialView, onOpenChange, open, workspace]);

  if (!workspace) {
    return null;
  }

  const otherLinkedProjectIds = activeProject.workspaces
    .filter((item) => item.id !== workspace.id)
    .flatMap((item) => (item.project ? [item.project.id] : []));

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: currentDocsRepositoryKey });
    await queryClient.invalidateQueries({ queryKey: aiKeys.agentsMd });
    documents?.retrySession();
  };

  const handleAttachProject = async (project: ResolvedGithubProject) => {
    setBusy(true);
    setActionError(null);
    try {
      await activeProject.attachProjectToWorkspace(workspace.id, project);
      setEditingProject(false);
    } catch (error) {
      setActionError(describeManageError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleDetachProject = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await activeProject.detachProjectFromWorkspace(workspace.id);
      setEditingProject(false);
      await refreshAll();
    } catch (error) {
      setActionError(describeManageError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveWorkspace = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await activeProject.removeWorkspace(workspace.id);
      await refreshAll();
      onOpenChange(false);
    } catch (error) {
      setActionError(describeManageError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" aria-label="워크스페이스 설정">
        <DialogHeader>
          <div className="grid gap-[var(--space-1)]">
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <DialogTitle>워크스페이스 설정 · {workspace.title}</DialogTitle>
              <StatusBadge tone={workspace.project ? "info" : "neutral"}>
                {workspace.project ? "Project + 문서" : "문서 전용"}
              </StatusBadge>
            </div>
            <DialogDescription>
              이 워크스페이스의 GitHub Project 보드와 소속 문서 저장소 연결을 관리합니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="닫기" />
        </DialogHeader>

        <DialogBody className="grid gap-[var(--space-4)] pt-[var(--space-2)]">
          {actionError ? (
            <StatusFeedback variant="field" tone="error">
              {actionError}
            </StatusFeedback>
          ) : null}

          <section
            aria-label="GitHub Project 보드 설정"
            className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
              <div className="flex items-start gap-[var(--space-2)]">
                <SquareKanban
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                />
                <div className="grid gap-[var(--space-1)]">
                  <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    GitHub Project 보드
                  </strong>
                  <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                    {workspace.project
                      ? `${workspace.project.title} · ${workspace.project.owner} #${workspace.project.number}`
                      : "연결된 GitHub Project 보드가 없습니다 (문서 저장소 단독 모드)"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setEditingProject((prev) => !prev)}
                >
                  {editingProject
                    ? "선택 닫기"
                    : workspace.project
                      ? "다른 Project로 변경"
                      : "GitHub Project 보드 연결"}
                </Button>
                {workspace.project ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleDetachProject()}
                  >
                    <Unlink aria-hidden="true" strokeWidth={1.75} />
                    보드만 연결 해제
                  </Button>
                ) : null}
              </div>
            </div>

            {editingProject ? (
              <div className="border-t border-[var(--color-border)] pt-[var(--space-3)]">
                <ProjectPickerList
                  disabledProjectIds={otherLinkedProjectIds}
                  busy={busy}
                  onSelectProject={(project) => void handleAttachProject(project)}
                />
              </div>
            ) : null}
          </section>

          <section
            aria-label="소속 문서 저장소 설정"
            className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
              <div className="flex items-start gap-[var(--space-2)]">
                <FolderGit2
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                />
                <div className="grid gap-[var(--space-1)]">
                  <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    소속 문서 저장소
                  </strong>
                  <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                    {workspace.docsRepository
                      ? workspace.docsRepository.fullName
                      : "아직 연결된 문서 저장소가 없습니다"}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditingDocs((prev) => !prev)}
              >
                {editingDocs
                  ? "선택 닫기"
                  : workspace.docsRepository
                    ? "다른 저장소로 변경"
                    : "문서 저장소 선택"}
              </Button>
            </div>

            {editingDocs ? (
              <div className="border-t border-[var(--color-border)] pt-[var(--space-3)]">
                <WorkspaceDocsRepositoryPicker
                  workspaceId={workspace.id}
                  preferredOwner={workspace.project?.owner ?? null}
                  gateway={docsRepositoryGateway}
                  repositoryGateway={repositoryGateway}
                  onDone={() => setEditingDocs(false)}
                />
              </div>
            ) : null}
          </section>

          <section
            aria-label="워크스페이스 제거"
            className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] p-[var(--space-4)]"
          >
            <div className="grid gap-[var(--space-1)]">
              <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                워크스페이스 연결 해제
              </strong>
              <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                앱 목록에서만 연결을 해제하며, GitHub의 원본 Project와 저장소 데이터는 삭제되지 않습니다.
              </span>
            </div>
            {confirmingRemove ? (
              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmingRemove(false)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  loading={busy}
                  onClick={() => void handleRemoveWorkspace()}
                >
                  연결 해제 확인
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmingRemove(true)}
              >
                <Trash2 aria-hidden="true" strokeWidth={1.75} />
                워크스페이스 연결 해제
              </Button>
            )}
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
