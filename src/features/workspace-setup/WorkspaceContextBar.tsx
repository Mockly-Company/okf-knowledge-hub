import { FolderGit2, SquareKanban } from "lucide-react";
import type { ReactElement } from "react";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import type { ProjectRepositoryGateway } from "@/features/docs-repository/ProjectDocsRepository";
import { cn } from "@/lib/utils";

export interface WorkspaceContextBarProps {
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
  className?: string;
}

export function WorkspaceContextBar({
  className,
}: WorkspaceContextBarProps): ReactElement | null {
  const activeProject = useOptionalActiveProject();
  const workspace = activeProject?.activeWorkspace ?? null;

  if (!workspace) {
    return null;
  }

  return (
    <section
      aria-label="현재 작업 공간"
      className={cn(
        "flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-[var(--space-4)] py-[var(--space-3)]",
        className,
      )}
    >
      {workspace.project ? (
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--space-2)]">
          <SquareKanban
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-[var(--icon-size)] shrink-0 text-[var(--color-primary-text)]"
          />
          <StatusBadge tone="info">
            {`${workspace.project.owner} #${workspace.project.number}`}
          </StatusBadge>
          <strong className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            {`선택된 Project · ${workspace.title}`}
          </strong>
          <span aria-hidden="true" className="text-[var(--color-text-muted)]">
            ·
          </span>
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)]">
            <FolderGit2
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-[var(--color-text-muted)]"
            />
            {workspace.docsRepository ? (
              <span className="text-[var(--color-text-muted)]">
                {`문서 저장소 · ${workspace.docsRepository.fullName}`}
              </span>
            ) : (
              <span className="text-[var(--color-warning)]">
                문서 저장소 연결 필요
              </span>
            )}
          </span>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--space-2)]">
          <FolderGit2
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-[var(--icon-size)] shrink-0 text-[var(--color-text-muted)]"
          />
          <StatusBadge tone="neutral">문서 전용</StatusBadge>
          <strong className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            {`문서 저장소 · ${workspace.docsRepository?.fullName ?? workspace.title}`}
          </strong>
        </div>
      )}
    </section>
  );
}
