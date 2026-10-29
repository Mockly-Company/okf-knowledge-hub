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
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import {
  BOARD_LAYERS,
  BOARD_STATUSES,
  type BoardIssue,
  type BoardLayer,
  type ProjectBoard,
  type ResolvedGithubProject,
} from "@/features/project-board/model";
import { ProjectTree } from "@/features/project-board/ProjectTree";
import {
  MAX_ISSUE_TREE_DEPTH,
  asIssueArray,
  enterPath,
  issueKey,
  safeHref,
} from "@/features/project-board/boardUtils";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

type LayerFilter = "all" | BoardLayer;

/** 연결 화면으로 안내해야 하는 백엔드 에러 코드. */
const UNLINKED_CODES = new Set(["workspace_invalid", "workspace_missing"]);


/** 레이어 뷰 집계용: 루트+자식을 모두 펼친다. 트리 children은 별도 집계가 아니면 사라진다. */
function* walkIssues(
  issues: BoardIssue[],
  depth = 0,
  path = new Set<string>(),
): Generator<BoardIssue> {
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return;
  }
  for (const issue of asIssueArray(issues)) {
    // 오염 캐시의 순환 참조에 대비해 재귀 경로상의 URL만 건너뛴다.
    // 집계(walkIssues)는 렌더와 달리 항상 전체 순회하므로, withoutDone과 같은
    // enterPath push/pop 백트래킹을 공유 집합에 적용한다. 집합은 이 집계 호출
    // 전용이라 조기 종료돼도 다음 집계가 새 집합을 만들어 오염되지 않는다.
    const release = enterPath(path, issueKey(issue));
    if (!release) {
      continue;
    }
    try {
      yield issue;
      yield* walkIssues(asIssueArray(issue.children), depth + 1, path);
    } finally {
      release();
    }
  }
}

function withoutDone(
  issues: BoardIssue[],
  depth = 0,
  path = new Set<string>(),
): BoardIssue[] {
  if (depth > MAX_ISSUE_TREE_DEPTH) {
    return [];
  }
  const kept: BoardIssue[] = [];
  for (const issue of asIssueArray(issues)) {
    const release = enterPath(path, issueKey(issue));
    if (!release) {
      continue;
    }
    try {
      const children = withoutDone(
        asIssueArray(issue.children),
        depth + 1,
        path,
      );
      if (issue.status === "done") {
        // 완료된 부모 밑에 진행 중 자식이 있으면 계층 맥락 유지를 위해
        // 부모를 남긴다(상태 배지로 Done임이 표시된다). 자식이 없으면 버린다.
        if (children.length > 0) {
          kept.push({ ...issue, children });
        }
      } else {
        kept.push({ ...issue, children });
      }
    } finally {
      release();
    }
  }
  return kept;
}

/** 손상된 workspace.yml은 미연결이 아니라 로드 에러로 보여야 한다. */
function errorDetail(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null || !("details" in error)) {
    return undefined;
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isUnlinkedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    UNLINKED_CODES.has(code) &&
    errorDetail(error, "reason") !== "workspace_file_unreadable"
  );
}

const sharedGateway = new TauriProjectBoardGateway();

const fetchedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatFetchedAt(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return iso;
  }
  return fetchedAtFormatter.format(new Date(time));
}

const EMPTY_ISSUES: BoardIssue[] = [];

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
        <h3 className="m-0 text-[var(--font-meta-size)] font-[number:var(--font-weight-control)]">
          {statusName}
        </h3>
        <StatusBadge tone="neutral">{String(issues.length)}</StatusBadge>
      </header>
      <div className="grid gap-[var(--space-3)] pt-[var(--space-2)]">
        {issues.length === 0 ? (
          <div className="grid min-h-24 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-[var(--space-3)] text-center text-[var(--color-text-muted)]">
            연결된 Issue 없음
          </div>
        ) : (
          issues.map((issue) => (
            <article
              key={`${issue.number}-${issueKey(issue)}`}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)]"
              aria-label={`Issue #${issue.number} ${issue.title}`}
            >
              <div className="text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
                #{issue.number}
              </div>
              <div>
                {(() => {
                  // 계층 보기와 같은 검증·렌더 규칙을 쓴다.
                  const safeUrl = safeHref(issue.url);
                  return safeUrl ? (
                    <a
                      href={safeUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-inherit no-underline hover:underline"
                    >
                      {issue.title}
                    </a>
                  ) : (
                    <span>{issue.title}</span>
                  );
                })()}
              </div>
            </article>
          ))
        )}
        {canAddIssue ? (
          <div className="grid min-h-28 place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)] text-center">
            <div className="grid justify-items-center gap-[var(--space-2)]">
              <Button type="button" variant="secondary" disabled>
                <Plus aria-hidden="true" strokeWidth={1.75} />
                새 Issue
              </Button>
              <p className="m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">
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
  const [isProjectListTruncated, setIsProjectListTruncated] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [listFailed, setListFailed] = useState(false);
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
      if (isUnlinkedError(error)) {
        setIsUnlinked(true);
        setBoard({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
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
    setIsUnlinked(false);
    try {
      setBoard(await gateway.syncProjectBoard());
      setIsUnlinked(false);
    } catch (error) {
      if (isUnlinkedError(error)) {
        setIsUnlinked(true);
        return;
      }
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 보드를 가져오지 못했습니다.";
      const reason = errorDetail(error, "reason");
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
    setListFailed(false);
    try {
      const list = await gateway.listGithubProjects();
      setProjectOptions(list.projects);
      setIsProjectListTruncated(list.truncated);
    } catch (error) {
      setListFailed(true);
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
      await refresh();
    } catch (error) {
      setLinkError(
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "Project 연결에 실패했습니다.",
      );
    } finally {
      setIsLinking(false);
    }
  }, [gateway, refresh, resolved]);

  useEffect(() => {
    if (panelVisible && projectOptions === null && !isListing && !listFailed) {
      void listProjects();
    }
  }, [panelVisible, projectOptions, isListing, listFailed, listProjects]);

  const visibleLayers = useMemo(
    () =>
      BOARD_LAYERS.filter(
        (layer) => filter === "all" || layer.id === filter,
      ),
    [filter],
  );
  const groupedIssues = useMemo(() => {
    const grouped = new Map<string, BoardIssue[]>();
    // 다이아몬드 공유 자식은 여러 부모 경로에서 walk되므로 같은 셀에
    // 두 번 펼치지 않도록 레이어:상태:URL 기준으로 한 번만 집계한다.
    const emitted = new Set<string>();
    for (const issue of walkIssues(board?.issues ?? [])) {
      if (hideDone && issue.status === "done") {
        continue;
      }
      const dedupeKey = `${issue.layer}:${issue.status}:${issueKey(issue)}`;
      if (emitted.has(dedupeKey)) {
        continue;
      }
      emitted.add(dedupeKey);
      const key = `${issue.layer}:${issue.status}`;
      const list = grouped.get(key);
      if (list) {
        list.push(issue);
      } else {
        grouped.set(key, [issue]);
      }
    }
    return grouped;
  }, [board, hideDone]);

  // 트리 펼침 상태(useState)가 무관한 렌더에 리셋되지 않도록 메모한다.
  const treeIssues = useMemo(
    () =>
      hideDone && board ? withoutDone(board.issues) : (board?.issues ?? []),
    [hideDone, board],
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
              className="text-[var(--font-meta-size)] text-[var(--color-text-muted)]"
              aria-live="polite"
            >
              {board?.fetchedAt ? (
                <>
                  마지막 새로고침{" "}
                  <time dateTime={board.fetchedAt}>
                    {formatFetchedAt(board.fetchedAt)}
                  </time>
                </>
              ) : (
                "아직 불러오지 않음"
              )}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void refresh()}
              disabled={isLoading || isSyncing || isUnlinked}
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

      {isUnlinked || board === null ? null : (
        <>
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

      {board && board.skipped > 0 ? (
        <p className="m-0 mt-[var(--space-3)] text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
          {board.skipped}개 항목은 레이어·상태를 판별할 수 없어 제외됐습니다.
          Project의 영역 값과 상태 값을 확인해 주세요.
        </p>
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
      </div>
      {board && board.truncated ? (
        <p className="m-0 mt-[var(--space-3)] text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
          보드 항목이 많아 일부만 표시됩니다. (보드 최대 500개·에픽별 하위 이슈 최대 20개)
        </p>
      ) : null}
        </>
      )}

      {isUnlinked || showLinkPanel ? (
        <section
          aria-label="GitHub Project 연결"
          className="mt-[var(--space-4)] grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
        >
          <h2 className="m-0">GitHub Project 연결</h2>
          <p className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
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
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void listProjects()}
              disabled={isListing}
              loading={isListing}
            >
              목록에서 고르기
            </Button>
          </div>
          {projectOptions ? (
            <div
              role="radiogroup"
              aria-label="GitHub Project 목록"
              className="grid gap-[var(--space-2)]"
            >
              {projectOptions.length === 0 ? (
                <p className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
                  볼 수 있는 Project가 없습니다.
                </p>
              ) : null}
              {isProjectListTruncated ? (
                <p className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
                  목록이 잘렸을 수 있습니다. (조직 최대 20개·목록별 최대 100개까지 표시)
                </p>
              ) : null}
              {projectOptions.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-[var(--space-2)]"
                >
                  <Radio
                    name="github-project-choice"
                    value={option.id}
                    checked={resolved?.id === option.id}
                    onChange={() => {
                      setResolved(option);
                      setLinkError(null);
                    }}
                  />
                  <span>
                    {option.title} · {option.owner} #{option.number}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {listFailed ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void listProjects()}
                disabled={isListing}
                loading={isListing}
              >
                목록 다시 불러오기
              </Button>
            </div>
          ) : null}
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
      ) : (
        <>
          {loadError ? (
            <div role="alert" className="grid gap-[var(--space-3)]">
              <p className="m-0">{loadError}</p>
              <div>
                <Button type="button" variant="secondary" onClick={() => void load()}>
                  다시 시도
                </Button>
              </div>
            </div>
          ) : null}
          {!isUnlinked && board ? (
            view === "tree" ? (
              <ProjectTree issues={treeIssues} />
            ) : (
        <div className="grid gap-[var(--space-6)]">
          {visibleLayers.map((layer) => (
            <section key={layer.id} aria-label={`${layer.name} 레이어`} className="min-w-0">
              <h2 className="m-0 mb-[var(--space-3)]" title={layer.label}>
                {layer.name}
              </h2>
              <section
                className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-4)]"
                aria-label={`${layer.name} 보드`}
                tabIndex={0}
              >
                <div className="flex min-w-[1120px] gap-[var(--space-3)]">
                  {BOARD_STATUSES.map(({ id, name }) => (
                    <BoardColumn
                      key={id}
                      layerName={layer.name}
                      statusName={name}
                      issues={groupedIssues.get(`${layer.id}:${id}`) ?? EMPTY_ISSUES}
                      canAddIssue={id === "backlog"}
                    />
                  ))}
                </div>
              </section>
            </section>
          ))}
        </div>
          )
        ) : null}
        </>
      )}
    </section>
  );
}
