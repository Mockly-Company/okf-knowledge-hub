import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { FormField } from "@/components/patterns/FormField";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
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
  type ResolvedGithubProject,
} from "@/features/project-board/model";
import { ProjectTree } from "@/features/project-board/ProjectTree";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

type LayerFilter = "all" | BoardLayer;

const sharedGateway = new TauriProjectBoardGateway();

function issuesFor(
  board: ProjectBoard | null,
  layer: BoardLayer,
  status: BoardStatus,
  hideDone: boolean,
): BoardIssue[] {
  if (!board) {
    return [];
  }
  return flattenIssues(board.issues).filter(
    (issue) =>
      issue.layer === layer &&
      issue.status === status &&
      (!hideDone || issue.status !== "done"),
  );
}

function flattenIssues(issues: BoardIssue[]): BoardIssue[] {
  return issues.flatMap((issue) => [issue, ...flattenIssues(issue.children)]);
}

function withoutDone(issues: BoardIssue[]): BoardIssue[] {
  const kept: BoardIssue[] = [];
  for (const issue of issues) {
    const children = withoutDone(issue.children);
    if (issue.status === "done") {
      kept.push(...children);
    } else {
      kept.push({ ...issue, children });
    }
  }
  return kept;
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

type BoardView = "layers" | "tree";

export function ProjectPage({
  gateway = sharedGateway,
}: {
  gateway?: ProjectBoardGateway;
}) {
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUnlinked, setIsUnlinked] = useState(false);
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [projectUrl, setProjectUrl] = useState("");
  const [resolved, setResolved] = useState<ResolvedGithubProject | null>(null);
  const [projectOptions, setProjectOptions] = useState<
    ResolvedGithubProject[] | null
  >(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [filter, setFilter] = useState<LayerFilter>("all");
  const [view, setView] = useState<BoardView>("layers");
  const [hideDone, setHideDone] = useState(true);
  const panelVisible = isUnlinked || showLinkPanel;

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setIsUnlinked(false);
    try {
      setBoard(await gateway.getProjectBoard());
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "workspace_invalid"
      ) {
        setIsUnlinked(true);
        setBoard({ issues: [], fetchedAt: null });
      } else {
        setLoadError("Project 보드를 불러오지 못했습니다.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [gateway]);

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    setLoadError(null);
    try {
      setBoard(await gateway.syncProjectBoard());
      setIsUnlinked(false);
    } catch (error) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 보드를 가져오지 못했습니다.";
      const reason =
        typeof error === "object" &&
        error !== null &&
        "details" in error &&
        typeof (error as { details?: unknown }).details === "object" &&
        (error as { details: Record<string, string> }).details !== null
          ? (error as { details: Record<string, string> }).details.reason
          : undefined;
      setLoadError(reason ? `${message} (원인: ${reason})` : message);
    } finally {
      setIsSyncing(false);
    }
  }, [gateway]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(async () => {
    setIsResolving(true);
    setLinkError(null);
    setResolved(null);
    try {
      setResolved(await gateway.resolveGithubProject(projectUrl));
    } catch (error) {
      setLinkError(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 주소를 확인해 주세요.",
      );
    } finally {
      setIsResolving(false);
    }
  }, [gateway, projectUrl]);

  const listProjects = useCallback(async () => {
    setIsListing(true);
    setLinkError(null);
    try {
      setProjectOptions(await gateway.listGithubProjects());
    } catch (error) {
      setLinkError(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 목록을 가져오지 못했습니다.",
      );
    } finally {
      setIsListing(false);
    }
  }, [gateway]);
  const link = useCallback(async () => {
    if (!resolved) {
      return;
    }
    setIsLinking(true);
    setLinkError(null);
    try {
      await gateway.linkGithubProject(resolved);
      setShowLinkPanel(false);
      await load();
    } catch (error) {
      setLinkError(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 연결에 실패했습니다.",
      );
    } finally {
      setIsLinking(false);
    }
  }, [gateway, load, resolved]);

  useEffect(() => {
    if (panelVisible && projectOptions === null && !isListing) {
      void listProjects();
    }
  }, [panelVisible, projectOptions, isListing, listProjects]);

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
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-[var(--space-3)]">
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
              onClick={() => void refresh()}
              disabled={isLoading || isSyncing}
              loading={isSyncing}
            >
              <RefreshCw aria-hidden="true" strokeWidth={1.75} />
              새로고침
            </Button>
            {!isUnlinked ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowLinkPanel((shown) => !shown)}
                aria-expanded={isUnlinked || showLinkPanel}
                disabled={isLoading || isSyncing}
              >
                프로젝트 변경
              </Button>
            ) : null}
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

      {view === "layers" ? (
        <div
          className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]"
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
      ) : null}

      <div className="mt-[var(--space-6)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <div
            className="flex flex-wrap gap-[var(--space-2)]"
            role="group"
            aria-label="보드 보기 방식"
          >
            <Button
              type="button"
              variant={view === "layers" ? "primary" : "secondary"}
              aria-pressed={view === "layers"}
              onClick={() => setView("layers")}
            >
              영역별
            </Button>
            <Button
              type="button"
              variant={view === "tree" ? "primary" : "secondary"}
              aria-pressed={view === "tree"}
              onClick={() => setView("tree")}
            >
              계층별
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-[var(--space-2)] text-[var(--font-meta-size)] text-[var(--text-muted)]">
            <Checkbox
              checked={hideDone}
              onChange={(event) => setHideDone(event.target.checked)}
            />
            완료 항목 숨기기
          </label>
        </div>
        <TabsList aria-label="Project 보기">
          <TabsTrigger selected>Board</TabsTrigger>
          <TabsTrigger selected={false} disabled>
            List
          </TabsTrigger>
        </TabsList>
      </div>

      {isUnlinked || showLinkPanel ? (
        <section
          aria-label="GitHub Project 연결"
          className="mt-[var(--space-4)] grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        >
          <h2 className="m-0">GitHub Project 연결</h2>
          <p className="m-0 text-[var(--font-meta-size)] text-[var(--text-muted)]">
            Project 페이지 주소(URL)를 붙여넣으면 소유자·번호·Node
            ID를 자동으로 불러옵니다. 예:
            https://github.com/orgs/Mockly-Company/projects/1
          </p>
          <FormField label="Project URL">
            <Input
              value={projectUrl}
              onChange={(event) => setProjectUrl(event.target.value)}
              placeholder="https://github.com/orgs/{owner}/projects/{number}"
              inputMode="url"
            />
          </FormField>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void resolve()}
              disabled={isResolving || projectUrl.trim().length === 0}
              loading={isResolving}
            >
              불러오기
            </Button>
          </div>
          <FormField label="Project 목록">
            <Select
              value={resolved?.id ?? ""}
              disabled={isListing || projectOptions === null}
              onValueChange={(value) => {
                setResolved(
                  projectOptions?.find((option) => option.id === value) ?? null,
                );
                setLinkError(null);
              }}
            >
              <option value="">선택하세요</option>
              {(projectOptions ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} · {option.owner} #{option.number}
                </option>
              ))}
            </Select>
          </FormField>
          {resolved ? (
            <div className="grid gap-[var(--space-2)]">
              <p className="m-0">
                {resolved.title} · {resolved.owner} #{resolved.number}
              </p>
              <div>
                <Button
                  type="button"
                  onClick={() => void link()}
                  disabled={isLinking}
                  loading={isLinking}
                >
                  이 프로젝트 연결
                </Button>
              </div>
            </div>
          ) : null}
          {linkError ? (
            <p role="alert" className="m-0">
              {linkError}
            </p>
          ) : null}
        </section>
      ) : null}

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
      ) : view === "tree" ? (
        <ProjectTree issues={hideDone && board ? withoutDone(board.issues) : (board?.issues ?? [])} />
      ) : (
        <div className="grid gap-[var(--space-6)]">
          {visibleLayers.map((layer) => (
            <section key={layer.id} aria-label={`${layer.name} 레이어`} className="min-w-0">
              <h2 className="m-0 mb-[var(--space-3)]" title={layer.label}>
                {layer.name}
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
                      issues={issuesFor(board, layer.id, id, hideDone)}
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
