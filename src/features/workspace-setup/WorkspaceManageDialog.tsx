import { FolderGit2, SquareKanban, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { aiKeys } from "@/features/ai/queryKeys";
import type {
  DocsRepositoryGateway,
  HubWorkspace,
} from "@/features/docs-repository/DocsRepositoryGateway";
import {
  WorkspaceDocsRepositoryPicker,
  currentDocsRepositoryKey,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { useOptionalDocuments } from "@/features/documents/DocumentsProvider";

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

function formatWorkspaceTabLabel(
  workspace: HubWorkspace,
  isInUse: boolean,
): string {
  const baseLabel = workspace.project
    ? workspace.title
    : `${workspace.title} (문서 전용)`;
  return isInUse ? `${baseLabel} · 사용 중` : baseLabel;
}

export function WorkspaceManageDialog({
  open,
  onOpenChange,
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  const activeProject = useActiveProject();
  const documents = useOptionalDocuments();
  const queryClient = useQueryClient();

  const workspaces = activeProject.workspaces;
  const activeWorkspaceId =
    activeProject.activeWorkspaceId ?? activeProject.activeWorkspace?.id ?? null;

  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [editingDocs, setEditingDocs] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (open && !activeProject.isListing && workspaces.length === 0) {
      onOpenChange(false);
    }
  }, [activeProject.isListing, onOpenChange, open, workspaces.length]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedTabId(activeWorkspaceId ?? workspaces[0]?.id ?? null);
      setEditingDocs(false);
      setConfirmingRemove(false);
      setActionError(null);
    }
    wasOpenRef.current = open;
  }, [activeWorkspaceId, open, workspaces]);

  const selectedWorkspace =
    (selectedTabId
      ? workspaces.find((item) => item.id === selectedTabId)
      : undefined) ??
    (activeWorkspaceId
      ? workspaces.find((item) => item.id === activeWorkspaceId)
      : undefined) ??
    workspaces[0] ??
    null;

  if (!selectedWorkspace) {
    return null;
  }

  const selectTab = (nextId: string) => {
    setSelectedTabId(nextId);
    setEditingDocs(false);
    setConfirmingRemove(false);
    setActionError(null);
  };

  const refreshActiveContext = async () => {
    await queryClient.invalidateQueries({ queryKey: currentDocsRepositoryKey });
    await queryClient.invalidateQueries({ queryKey: aiKeys.agentsMd });
    documents?.retrySession();
  };

  const handleRemoveWorkspace = async () => {
    const targetId = selectedWorkspace.id;
    const removedIndex = workspaces.findIndex((item) => item.id === targetId);
    const remaining = workspaces.filter((item) => item.id !== targetId);
    const wasActive = targetId === activeWorkspaceId;

    setBusy(true);
    setActionError(null);
    try {
      await activeProject.removeWorkspace(targetId);
      if (wasActive) {
        await refreshActiveContext();
      }
      setEditingDocs(false);
      setConfirmingRemove(false);

      if (remaining.length === 0) {
        onOpenChange(false);
        return;
      }

      const clampedIndex = Math.min(Math.max(removedIndex, 0), remaining.length - 1);
      const nextId = wasActive ? remaining[0]!.id : remaining[clampedIndex]!.id;
      setSelectedTabId(nextId);
      requestAnimationFrame(() => {
        tabRefs.current.get(nextId)?.focus();
      });
    } catch (error) {
      setActionError(describeManageError(error));
    } finally {
      setBusy(false);
    }
  };

  const tabId = `workspace-manage-tab-${selectedWorkspace.id}`;
  const panelId = `workspace-manage-panel-${selectedWorkspace.id}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="wide" aria-label="워크스페이스 설정">
        <DialogHeader>
          <div className="grid gap-[var(--space-1)]">
            <DialogTitle>워크스페이스 설정</DialogTitle>
            <DialogDescription>
              연결된 프로젝트별 문서 저장소를 바꾸거나 워크스페이스 연결을 해제합니다.
            </DialogDescription>
          </div>
          <DialogCloseButton label="닫기" />
        </DialogHeader>

        <TabsList
          aria-label="연결된 워크스페이스 목록"
          className="gap-[var(--space-5)] overflow-x-auto pb-0.5"
        >
          {workspaces.map((workspace) => {
            const isSelected = workspace.id === selectedWorkspace.id;
            const isInUse = workspace.id === activeWorkspaceId;
            return (
              <TabsTrigger
                key={workspace.id}
                ref={(el) => {
                  if (el) {
                    tabRefs.current.set(workspace.id, el);
                  } else {
                    tabRefs.current.delete(workspace.id);
                  }
                }}
                id={`workspace-manage-tab-${workspace.id}`}
                aria-controls={`workspace-manage-panel-${workspace.id}`}
                selected={isSelected}
                className="shrink-0 whitespace-nowrap"
                onClick={() => selectTab(workspace.id)}
              >
                {formatWorkspaceTabLabel(workspace, isInUse)}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <DialogBody className="grid gap-[var(--space-4)] pt-[var(--space-2)]">
          {actionError ? (
            <StatusFeedback variant="field" tone="error">
              {actionError}
            </StatusFeedback>
          ) : null}

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId}
            className="grid gap-[var(--space-4)]"
          >
            <section
              aria-label="선택된 Project"
              className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
                <div className="flex items-start gap-[var(--space-2)]">
                  <SquareKanban
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-[var(--color-primary-text)]"
                  />
                  <div className="grid gap-[var(--space-1)]">
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                        선택된 Project
                      </strong>
                      {selectedWorkspace.project ? (
                        <StatusBadge tone="info">
                          {`${selectedWorkspace.project.owner} #${selectedWorkspace.project.number}`}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">문서 전용</StatusBadge>
                      )}
                    </div>
                    <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      {selectedWorkspace.project
                        ? selectedWorkspace.project.title
                        : "문서 전용 워크스페이스 · 연결된 GitHub Project가 없습니다."}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section
              aria-label="문서 저장소"
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
                      문서 저장소
                    </strong>
                    <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      {selectedWorkspace.docsRepository
                        ? selectedWorkspace.docsRepository.fullName
                        : "아직 연결된 문서 저장소가 없습니다."}
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
                    : selectedWorkspace.docsRepository
                      ? "저장소 변경"
                      : "문서 저장소 선택"}
                </Button>
              </div>

              {editingDocs ? (
                <div className="border-t border-[var(--color-border)] pt-[var(--space-3)]">
                  <WorkspaceDocsRepositoryPicker
                    key={selectedWorkspace.id}
                    workspaceId={selectedWorkspace.id}
                    preferredOwner={selectedWorkspace.project?.owner ?? null}
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
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
