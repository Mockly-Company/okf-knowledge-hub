import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { useActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { ResolvedGithubProject } from "@/features/project-board/model";

function describeProjectError(error: unknown): string {
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
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  return "알 수 없는 오류";
}

function matchesProjectQuery(
  project: ResolvedGithubProject,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return (
    project.title.toLowerCase().includes(needle) ||
    project.owner.toLowerCase().includes(needle) ||
    String(project.number).includes(needle) ||
    `#${project.number}`.includes(needle)
  );
}

export function ProjectPickerList({
  disabledProjectIds = [],
  busy = false,
  onSelectProject,
  onSwitchToDocsOnly,
}: {
  disabledProjectIds?: string[];
  busy?: boolean;
  onSelectProject(project: ResolvedGithubProject): void;
  onSwitchToDocsOnly?(): void;
}) {
  const { searchProjects } = useActiveProject();
  const [query, setQuery] = useState("");
  const disabledSet = useMemo(
    () => new Set(disabledProjectIds),
    [disabledProjectIds],
  );

  const projectsQuery = useQuery({
    queryKey: ["workspaceSetup", "accessibleProjects"],
    queryFn: () => searchProjects(),
  });

  const projects = projectsQuery.data?.projects ?? [];
  const truncated = projectsQuery.data?.truncated ?? false;
  const visible = useMemo(
    () => projects.filter((project) => matchesProjectQuery(project, query)),
    [projects, query],
  );

  return (
    <div className="grid gap-[var(--space-3)]" role="group" aria-label="GitHub Project 선택">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="프로젝트 이름, 조직, #번호로 찾기"
          aria-label="프로젝트 검색"
          className="min-w-0 flex-1"
          disabled={busy}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void projectsQuery.refetch()}
          disabled={projectsQuery.isFetching || busy}
          loading={projectsQuery.isFetching}
        >
          <RefreshCw aria-hidden="true" strokeWidth={1.75} />
          새로고침
        </Button>
      </div>

      {projectsQuery.isError ? (
        <StatusFeedback variant="content" tone="error">
          <StatusFeedbackTitle>GitHub Project 목록을 불러오지 못했습니다</StatusFeedbackTitle>
          <StatusFeedbackDescription>
            {describeProjectError(projectsQuery.error)}
          </StatusFeedbackDescription>
        </StatusFeedback>
      ) : null}

      {truncated ? (
        <p role="status" className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
          접근 가능한 Project가 많아 최근 항목부터 일부만 표시합니다.
        </p>
      ) : null}

      {projectsQuery.isPending ? (
        <p role="status" className="m-0 text-[var(--color-text-muted)]">
          접근 가능한 GitHub Project 목록을 불러오는 중…
        </p>
      ) : projects.length === 0 && !projectsQuery.isError ? (
        <div className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-canvas)] p-[var(--space-4)]">
          <p className="m-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            접근 가능한 GitHub Project가 없습니다.
          </p>
          <p className="m-0 text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
            Project 보드 없이 문서 저장소만 먼저 연결해 바로 문서를 관리할 수 있습니다.
          </p>
          {onSwitchToDocsOnly ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={onSwitchToDocsOnly}
              >
                문서 저장소만 연결하기
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid max-h-72 gap-[var(--space-1)] overflow-y-auto">
          {visible.map((candidate) => {
            const alreadyLinked = disabledSet.has(candidate.id);
            return (
              <Button
                key={candidate.id}
                type="button"
                variant="secondary"
                className="h-auto min-h-[var(--control-height)] justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                disabled={busy || alreadyLinked}
                onClick={() => onSelectProject(candidate)}
              >
                <span className="grid min-w-0 text-left">
                  <span className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                    {candidate.title}
                  </span>
                  <span className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                    {candidate.owner} #{candidate.number}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-[var(--space-2)]">
                  <StatusBadge tone="neutral">
                    {candidate.scope === "organization" ? "조직" : "개인"}
                  </StatusBadge>
                  {alreadyLinked ? (
                    <StatusBadge tone="neutral">이미 연결됨</StatusBadge>
                  ) : null}
                </span>
              </Button>
            );
          })}
          {visible.length === 0 ? (
            <p className="m-0 text-[var(--color-text-muted)]">
              검색어와 일치하는 GitHub Project가 없습니다.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
