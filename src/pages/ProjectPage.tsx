import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { FormField } from "@/components/patterns/FormField";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import {
  BOARD_LAYERS,
  BOARD_STATUSES,
  type BoardIssue,
  type BoardLayer,
  type BoardStatus,
  type ProjectBoard,
} from "@/features/project-board/model";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

type LayerFilter = "all" | BoardLayer;

const sharedGateway = new TauriProjectBoardGateway();

function issuesFor(
  board: ProjectBoard | null,
  layer: BoardLayer,
  status: BoardStatus,
): BoardIssue[] {
  if (!board) {
    return [];
  }
  return board.issues.filter(
    (issue) => issue.layer === layer && issue.status === status,
  );
}

function BoardColumn({
  layerName,
  statusName,
  issues,
  canAddIssue,
}: {
  layerName: string;
  statusName: string;
  issues: BoardIssue[];
  canAddIssue: boolean;
}) {
  return (
    <section
      className="min-w-[208px] flex-1"
      aria-label={`${layerName} ${statusName}`}
    >
      <header className="flex h-[var(--control-height)] items-center gap-[var(--space-2)] px-[var(--space-1)]">
        <span aria-hidden="true">{statusName}</span>
        <StatusBadge tone="neutral">{String(issues.length)}</StatusBadge>
      </header>
      <div className="grid gap-[var(--space-3)] pt-[var(--space-2)]">
        {issues.length === 0 ? (
          <div className="grid min-h-24 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-[var(--space-3)] text-center text-[var(--text-muted)]">
            연결된 Issue 없음
          </div>
        ) : (
          issues.map((issue) => (
            <article
              key={issue.number}
              className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
              aria-label={`Issue #${issue.number} ${issue.title}`}
            >
              <div className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
                #{issue.number}
              </div>
              <div>{issue.title}</div>
            </article>
          ))
        )}
        {canAddIssue ? (
          <div className="grid min-h-28 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] text-center">
            <div className="grid justify-items-center gap-[var(--space-2)]">
              <Button type="button" variant="secondary" disabled>
                <Plus aria-hidden="true" strokeWidth={1.75} />
                새 Issue
              </Button>
              <p className="m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--text-muted)]">
                GitHub Project와 Iteration을 연결하면 만들 수 있습니다.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ProjectPage({
  gateway = sharedGateway,
}: {
  gateway?: ProjectBoardGateway;
}) {
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LayerFilter>("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setBoard(await gateway.getProjectBoard());
    } catch {
      setLoadError("Project 보드를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleLayers = useMemo(
    () =>
      BOARD_LAYERS.filter(
        (layer) => filter === "all" || layer.id === filter,
      ),
    [filter],
  );

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="project-title"
    >
      <PageHeader
        titleId="project-title"
        title="Project"
        actions={
          <div className="flex items-center gap-[var(--space-3)]">
            <span
              className="text-[var(--font-meta-size)] text-[var(--text-muted)]"
              aria-live="polite"
            >
              {board?.fetchedAt
                ? `마지막 새로고침 ${board.fetchedAt}`
                : "아직 불러오지 않음"}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void load()}
              disabled={isLoading}
            >
              <RefreshCw aria-hidden="true" strokeWidth={1.75} />
              새로고침
            </Button>
            <div className="w-64 max-w-full">
              <FormField label="Iteration">
                <Select disabled defaultValue="none">
                  <option value="none">현재 Iteration 없음</option>
                </Select>
              </FormField>
            </div>
          </div>
        }
      />

      <div
        className="mt-[var(--space-4)] flex gap-[var(--space-2)]"
        role="group"
        aria-label="레이어 필터"
      >
        <Button
          type="button"
          variant={filter === "all" ? "primary" : "secondary"}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          전체
        </Button>
        {BOARD_LAYERS.map((layer) => (
          <Button
            key={layer.id}
            type="button"
            variant={filter === layer.id ? "primary" : "secondary"}
            aria-pressed={filter === layer.id}
            onClick={() => setFilter(layer.id)}
          >
            {layer.name}
          </Button>
        ))}
      </div>

      <div className="mt-[var(--space-6)] flex justify-end">
        <TabsList aria-label="Project 보기">
          <TabsTrigger selected>Board</TabsTrigger>
          <TabsTrigger selected={false} disabled>
            List
          </TabsTrigger>
        </TabsList>
      </div>

      {isLoading && board === null ? (
        <p role="status">Project 불러오는 중</p>
      ) : loadError ? (
        <div role="alert" className="grid gap-[var(--space-3)]">
          <p className="m-0">{loadError}</p>
          <div>
            <Button type="button" variant="secondary" onClick={() => void load()}>
              다시 시도
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-[var(--space-6)]">
          {visibleLayers.map((layer) => (
            <section key={layer.id} aria-label={`${layer.name} 레이어`}>
              <h2 className="m-0 mb-[var(--space-3)]">
                {layer.name}{" "}
                <span className="text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  {layer.label}
                </span>
              </h2>
              <section
                className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
                aria-label={`${layer.name} 보드`}
                tabIndex={0}
              >
                <div className="flex min-w-[1120px] gap-[var(--space-3)]">
                  {BOARD_STATUSES.map(({ id, name }) => (
                    <BoardColumn
                      key={id}
                      layerName={layer.name}
                      statusName={name}
                      issues={issuesFor(board, layer.id, id)}
                      canAddIssue={id === "backlog"}
                    />
                  ))}
                </div>
              </section>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
