import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useInRouterContext,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectOption } from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setPendingAiLaunch } from "@/features/ai/pendingAiLaunch";
import type {
  ProjectBoardGateway,
  ProjectBoardIssueDetail,
  UpdateBoardItemInput,
} from "@/features/project-board/ProjectBoardGateway";
import { ProjectIssueDrawer } from "@/features/project-board/ProjectIssueDrawer";
import {
  buildIssueReadinessIndex,
  filterTreeToReadyOnly,
  inferRepositoryFullNameFromUrl,
  type IssueReadinessIndex,
} from "@/features/project-board/readyFilter";
import {
  BOARD_LAYERS,
  BOARD_STATUSES,
  layerName as resolveLayerName,
  type BoardIssue,
  type BoardLayer,
  type ProjectBoard,
  type ResolvedGithubProject,
} from "@/features/project-board/model";
import {
  LEGACY_BOARD_ID,
  projectBoardKeys,
} from "@/features/project-board/queryKeys";
import {
  MAX_ISSUE_TREE_DEPTH,
  asIssueArray,
  enterPath,
  issueKey,
  safeHref,
} from "@/features/project-board/boardUtils";
import { ProjectTree } from "@/features/project-board/ProjectTree";
import { IssueAssigneeBadge } from "@/features/project-board/IssueAssigneeBadge";
import {
  ASSIGNEE_FILTER_ALL,
  ASSIGNEE_FILTER_UNASSIGNED,
  collectBoardAssignees,
  filterTreeByAssignee,
  matchesAssigneeFilter,
} from "@/features/project-board/assigneeFilter";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { useOptionalWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import {
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { WorkspaceContextBar } from "@/features/workspace-setup/WorkspaceContextBar";
import { ProjectPickerList } from "@/features/workspace-setup/ProjectPickerList";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

type LayerFilter = "all" | BoardLayer;

/**
 * 노드가 존재할 수 있는 가장 깊은 위치. 게이트웨이 normalizeIssue는 depth > 상한인
 * 노드를 자식 없는 생략 노드로 남기므로, 집계·필터도 그 노드까지 포함해야
 * 트리 렌더·카운터와 같은 결과가 된다.
 */
const LAST_NODE_DEPTH = MAX_ISSUE_TREE_DEPTH + 1;

/** 프론트 집계 순회 총량 상한. 백엔드 MAX_COUNT_NODES와 같은 취지다. */
const MAX_WALK_NODES = 100_000;

/** 연결 화면으로 안내해야 하는 백엔드 에러 코드. */
const UNLINKED_CODES = new Set(["workspace_invalid", "workspace_missing"]);


/** 레이어 집계용: 루트+자식을 모두 펼친다. 트리 children은 별도 집계가 아니면 사라진다. */
function* walkIssues(
  issues: BoardIssue[],
  depth = 0,
  path = new Set<string>(),
  budget: { count: number; capped: boolean } = { count: 0, capped: false },
): Generator<BoardIssue> {
  // 빈 입력은 잘린 것이 없으므로 배너를 세우지 않는다(리프 기준 통일).
  if (asIssueArray(issues).length === 0) {
    return;
  }
  if (depth > LAST_NODE_DEPTH) {
    // 깊이 절단도 잘림이므로 배너 조건에 합친다.
    // (백엔드·게이트웨이가 truncated를 세우는 것과 같은 취지.)
    budget.capped = true;
    return;
  }
  for (const issue of asIssueArray(issues)) {
    // 초과 이후에는 형제 루프를 즉시 중단한다. 현재 호출의 return만으로는
    // 바깥 재귀 레벨의 for가 다음 형제로 계속 진행해 상한이 무력화된다.
    if (budget.capped) {
      return;
    }
    // 오염 캐시의 순환 참조에 대비해 재귀 경로상의 URL만 건너뛴다.
    // 집계(walkIssues)는 렌더와 달리 항상 전체 순회하므로, withoutDone과 같은
    // enterPath push/pop 백트래킹을 공유 집합에 적용한다. 집합은 이 집계 호출
    // 전용이라 조기 종료돼도 다음 집계가 새 집합을 만들어 오염되지 않는다.
    const release = enterPath(path, issueKey(issue));
    if (!release) {
      continue;
    }
    try {
      budget.count += 1;
      // 백엔드 MAX_COUNT_NODES와 같은 취지의 총량 상한. 다이아몬드 공유를
      // 매번 펼치면 집계 자체가 기하급수 팽창하므로 여기서 멈춘다.
      if (budget.count > MAX_WALK_NODES) {
        budget.capped = true;
        return;
      }
      yield issue;
      yield* walkIssues(asIssueArray(issue.children), depth + 1, path, budget);
    } finally {
      release();
    }
  }
}

function withoutDone(
  issues: BoardIssue[],
  depth = 0,
  path = new Set<string>(),
  budget: { count: number; capped: boolean } = { count: 0, capped: false },
): BoardIssue[] {
  if (asIssueArray(issues).length === 0) {
    return [];
  }
  if (depth > LAST_NODE_DEPTH) {
    // 깊이 절단도 잘림이므로 배너 조건에 합친다.
    budget.capped = true;
    return [];
  }
  const kept: BoardIssue[] = [];
  for (const issue of asIssueArray(issues)) {
    // 하위에서 예산이 초과됐으면 형제 순회를 중단한다.
    // (walkIssues의 상향 전파와 동일한 규칙.)
    if (budget.capped) {
      break;
    }
    const release = enterPath(path, issueKey(issue));
    if (!release) {
      continue;
    }
    try {
      budget.count += 1;
      // walkIssues와 같은 총량 상한. 초과분은 펼치지 않고 중단한다.
      // 계속 돌면 잘린 플레이스홀더 자체가 O(N) DOM이 되므로, 초과 지점부터는
      // 남은 형제를 펼치지 않고 중단한다(중단은 capped 플래그로 배너에 알린다).
      // hideDone 필터를 우회하지 않도록 done 항목은 플레이스홀더도 남기지 않는다.
      // (withoutDone은 hideDone=true일 때만 호출된다.)
      if (budget.count > MAX_WALK_NODES) {
        budget.capped = true;
        if (issue.status !== "done") {
          // 자식이 없는 리프는 잘린 것이 없으므로 생략 표시를 하지 않는다.
          kept.push({
            ...issue,
            children: [],
            childrenTruncated: asIssueArray(issue.children).length > 0,
          });
        }
        break;
      }
      const rawChildren = asIssueArray(issue.children);
      // 깊이 절단으로 잘린 자식은 부모에 생략 플래그를 남긴다.
      // (백엔드 build_tree·게이트웨이 normalizeIssue와 동일한 규칙.)
      // 절단은 배너 조건에도 합친다.
      const cut = depth > MAX_ISSUE_TREE_DEPTH && rawChildren.length > 0;
      if (cut) {
        budget.capped = true;
      }
      const children = cut
        ? []
        : withoutDone(rawChildren, depth + 1, path, budget);
      const flagged = cut ? { childrenTruncated: true as const } : {};
      if (issue.status === "done") {
        // 완료된 부모 밑에 진행 중 자식이 있으면 계층 맥락 유지를 위해
        // 부모를 남긴다(상태 배지로 Done임이 표시된다). 자식이 없으면 버린다.
        // 깊이 절단된 부모는 숨은 자식이 남아 있을 수 있어 생략 표시와 함께 남긴다.
        if (children.length > 0 || cut) {
          kept.push({ ...issue, children, ...flagged });
        }
      } else if (
        !cut &&
        children.length === rawChildren.length &&
        children.every((child, index) => child === rawChildren[index])
      ) {
        // 자식에 변함이 없으면 원본 참조를 유지해 TreeNode memo가 동작한다.
        // (얕은 복사를 남발하면 hideDone=true 기본값에서 memo가 무효화된다.)
        kept.push(issue);
      } else {
        kept.push({ ...issue, children, ...flagged });
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

/** 고정 안내 뒤에 백엔드가 알려 준 원인을 붙인다. */
function describeBoardError(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : null;
  const text = typeof error === "string" && error.trim() ? error : null;
  const cause = errorDetail(error, "reason") ?? message ?? text;
  return cause
    ? `Project 보드를 불러오지 못했습니다. (원인: ${cause})`
    : "Project 보드를 불러오지 못했습니다.";
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

function RouterRedirect({
  to,
  onNavigated,
}: {
  to: string;
  onNavigated: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
    onNavigated();
  }, [navigate, to, onNavigated]);
  return null;
}

function RouterIssueDeepLinkSync({
  ready,
  issues,
  onSelectIssueNumber,
}: {
  ready: boolean;
  issues: ReadonlyArray<BoardIssue>;
  onSelectIssueNumber: (issueNumber: number, fallback: BoardIssue | null) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!ready) return;
    const raw = searchParams.get("issue");
    if (!raw) return;
    const issueNumber = Number(raw);
    if (Number.isInteger(issueNumber) && issueNumber > 0) {
      const found = findIssueByNumber(issues, issueNumber);
      if (found) {
        onSelectIssueNumber(issueNumber, found);
      }
    }
    const next = new URLSearchParams(searchParams);
    next.delete("issue");
    setSearchParams(next, { replace: true });
  }, [ready, issues, searchParams, setSearchParams, onSelectIssueNumber]);

  return null;
}

function patchIssueInTree(
  issues: BoardIssue[],
  issueNumber: number,
  patch: Partial<Pick<BoardIssue, "status" | "layer" | "kind">>,
): BoardIssue[] {
  return issues.map((item) => {
    const nextChildren =
      item.children.length > 0
        ? patchIssueInTree(item.children, issueNumber, patch)
        : item.children;
    if (item.number !== issueNumber) {
      return nextChildren === item.children
        ? item
        : { ...item, children: nextChildren };
    }
    return {
      ...item,
      ...patch,
      children: nextChildren,
    };
  });
}

function findIssueByNumber(
  issues: ReadonlyArray<BoardIssue>,
  issueNumber: number,
): BoardIssue | null {
  for (const item of issues) {
    if (item.number === issueNumber) {
      return item;
    }
    if (item.children.length > 0) {
      const child = findIssueByNumber(item.children, issueNumber);
      if (child) {
        return child;
      }
    }
  }
  return null;
}

function BoardColumn({
  layerName,
  statusName,
  issues,
  readinessIndex,
  onSelectIssue,
}: {
  layerName: string;
  statusName: string;
  issues: BoardIssue[];
  readinessIndex: IssueReadinessIndex | null;
  onSelectIssue: (issue: BoardIssue) => void;
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
          issues.map((issue) => {
            const readiness = readinessIndex?.getStatus(issue);
            return (
              <article
                key={`${issue.number}-${issueKey(issue)}`}
                className="grid gap-[var(--space-2)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)]"
                aria-label={`Issue #${issue.number} ${issue.title}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                  <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                    <span className="text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
                      #{issue.number}
                    </span>
                    {readiness?.state === "ready" ? (
                      <StatusBadge tone="success">시작 가능</StatusBadge>
                    ) : readiness?.state === "blocked" &&
                      readiness.waitingOn != null ? (
                      <StatusBadge tone="warning">
                        {`선행 #${readiness.waitingOn} 대기`}
                      </StatusBadge>
                    ) : null}
                    <IssueAssigneeBadge assignees={issue.assignees} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`#${issue.number} 상세 보기`}
                    onClick={() => onSelectIssue(issue)}
                  >
                    상세
                  </Button>
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
            );
          })
        )}
      </div>
    </section>
  );
}

type BoardView = "layers" | "tree";

export function ProjectPage({
  gateway = sharedGateway,
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
}: {
  gateway?: ProjectBoardGateway;
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
}) {
  const inRouterContext = useInRouterContext();
  const activeProject = useOptionalActiveProject();
  const workspaceConnection = useOptionalWorkspaceConnection();
  const viewerLogin =
    workspaceConnection?.account.status === "authenticated"
      ? workspaceConnection.account.user.login
      : null;
  const activeWorkspace = activeProject?.activeWorkspace ?? null;
  const isStandaloneDocsWorkspace =
    activeWorkspace !== null && activeWorkspace.project === null;
  const activeProjectId = activeProject?.activeProjectId ?? null;
  // provider 없으면 기존 단일 프로젝트 경로로 조회한다(테스트·스토리 폴백).
  const queryProjectId = activeProject ? activeProjectId : LEGACY_BOARD_ID;

  // 보드는 프로젝트 id를 키로 쓴다. 전환하면 이전 키 데이터가 아닌 새 키로
  // 조회되므로, 예전처럼 수동으로 비우거나 revision을 맞출 필요가 없다.
  // 마운트·전환·재시도는 저렴한 읽기(get)부터 쓰고, 캐시가 비어 있을 때만
  // 네트워크 동기화(sync)로 채운다. 명시적 새로고침은 항상 sync다.
  const queryClient = useQueryClient();
  const boardQuery = useQuery({
    queryKey: projectBoardKeys.board(queryProjectId),
    queryFn: async () => {
      const cached = await gateway.getProjectBoard();
      // 백엔드 get은 프로젝트별 캐시 읽기라, 한 번도 동기화하지 않은
      // 프로젝트는 빈 보드를 돌려준다. 그때만 sync로 채운다.
      if (cached.issues.length === 0 && cached.fetchedAt === null) {
        return gateway.syncProjectBoard();
      }
      return cached;
    },
    enabled: queryProjectId !== null,
  });
  const syncMutation = useMutation({
    mutationFn: () => gateway.syncProjectBoard(),
    onSuccess: (fresh) => {
      if (queryProjectId !== null) {
        queryClient.setQueryData(
          projectBoardKeys.board(queryProjectId),
          fresh,
        );
      }
    },
  });
  const board: ProjectBoard | null = boardQuery.data ?? null;
  const queryFailed = boardQuery.isError;
  const isUnlinked =
    queryProjectId === null ||
    (queryFailed && isUnlinkedError(boardQuery.error));
  const loadError =
    queryFailed && !isUnlinked
      ? describeBoardError(boardQuery.error)
      : syncMutation.isError
        ? describeBoardError(syncMutation.error)
        : null;
  // disabled 쿼리(None 상태)는 isPending이므로 id 가드로 제외한다.
  const boardLoading =
    queryProjectId !== null &&
    board === null &&
    (boardQuery.isPending || boardQuery.isFetching);
  const isFetchingBoard = boardQuery.isFetching;
  const isSyncingBoard = syncMutation.isPending;
  const retryLoad = () => {
    syncMutation.reset();
    void boardQuery.refetch();
  };

  const [filter, setFilter] = useState<LayerFilter>("all");
  const [view, setView] = useState<BoardView>("tree");
  const [hideDone, setHideDone] = useState(true);
  const [readyOnly, setReadyOnly] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    ASSIGNEE_FILTER_ALL,
  );
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [attachingProject, setAttachingProject] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(
    null,
  );
  const [selectedIssueFallback, setSelectedIssueFallback] =
    useState<BoardIssue | null>(null);
  const [navigateTarget, setNavigateTarget] = useState<string | null>(null);

  const workspaceResetKey = `${activeWorkspace?.id ?? "none"}::${queryProjectId ?? "none"}`;
  const prevWorkspaceResetKeyRef = useRef(workspaceResetKey);
  useEffect(() => {
    if (prevWorkspaceResetKeyRef.current === workspaceResetKey) {
      return;
    }
    prevWorkspaceResetKeyRef.current = workspaceResetKey;
    setFilter("all");
    setView("tree");
    setHideDone(true);
    setReadyOnly(false);
    setAssigneeFilter(ASSIGNEE_FILTER_ALL);
    setAttachDialogOpen(false);
    setAttachingProject(false);
    setAttachError(null);
    setSelectedIssueNumber(null);
    setSelectedIssueFallback(null);
  }, [workspaceResetKey]);

  const linkedProjectIds = useMemo(() => {
    const workspaces = activeProject?.workspaces ?? [];
    return workspaces.flatMap((workspace) =>
      workspace.project ? [workspace.project.id] : [],
    );
  }, [activeProject?.workspaces]);

  const handleAttachProject = async (project: ResolvedGithubProject) => {
    if (!activeProject || !activeWorkspace || attachingProject) {
      return;
    }
    setAttachingProject(true);
    setAttachError(null);
    try {
      await activeProject.attachProjectToWorkspace(activeWorkspace.id, project);
      setAttachDialogOpen(false);
    } catch (error) {
      setAttachError(describeBoardError(error));
    } finally {
      setAttachingProject(false);
    }
  };

  const selectedIssue = useMemo(() => {
    if (selectedIssueNumber === null) {
      return null;
    }
    return (
      (board ? findIssueByNumber(board.issues, selectedIssueNumber) : null) ??
      selectedIssueFallback
    );
  }, [board, selectedIssueNumber, selectedIssueFallback]);

  const selectedRepoHint = selectedIssue
    ? inferRepositoryFullNameFromUrl(selectedIssue.url)
    : null;
  const issueDetailQuery = useQuery({
    queryKey: [
      "project-board",
      "issue-detail",
      workspaceResetKey,
      selectedIssueNumber,
      selectedRepoHint,
    ],
    queryFn: () =>
      gateway.getIssueDetail!(selectedIssueNumber!, selectedRepoHint),
    enabled:
      !isUnlinked &&
      selectedIssueNumber !== null &&
      Boolean(gateway.getIssueDetail),
  });

  const updateItemMutation = useMutation({
    mutationFn: (request: UpdateBoardItemInput) =>
      gateway.updateBoardItem!(request),
    onMutate: async (request) => {
      if (queryProjectId === null) {
        return { previous: undefined as ProjectBoard | undefined };
      }
      const key = projectBoardKeys.board(queryProjectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectBoard>(key);
      if (previous) {
        queryClient.setQueryData<ProjectBoard>(key, {
          ...previous,
          issues: patchIssueInTree(previous.issues, request.issueNumber, {
            ...(request.status !== undefined ? { status: request.status } : {}),
            ...(request.layer !== undefined ? { layer: request.layer } : {}),
            ...(request.kind !== undefined ? { kind: request.kind } : {}),
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _request, context) => {
      if (queryProjectId !== null && context?.previous) {
        queryClient.setQueryData(
          projectBoardKeys.board(queryProjectId),
          context.previous,
        );
      }
    },
    onSuccess: (fresh) => {
      if (queryProjectId !== null) {
        queryClient.setQueryData(projectBoardKeys.board(queryProjectId), fresh);
      }
      void issueDetailQuery.refetch();
    },
  });

  const handleStartWithAi = (
    issue: BoardIssue,
    detail: ProjectBoardIssueDetail | null,
  ) => {
    if (issue.layer === "backend" || issue.layer === "frontend") {
      return;
    }
    const repoFullName =
      detail?.repositoryFullName ?? inferRepositoryFullNameFromUrl(issue.url);
    const firstDoc = detail?.linkedDocuments[0]?.path ?? null;
    setPendingAiLaunch({
      request: {
        issueNumber: issue.number,
        repositoryFullName: repoFullName,
        documentPath: firstDoc,
      },
      label: `#${issue.number} ${issue.title}`,
      layer: issue.layer,
      targetDescription: `문서 저장소 격리 worktree (${resolveLayerName(issue.layer)} — PRD·화면명세서 작성 전용, 코드 구현 비수행)`,
    });
    if (
      queryProjectId !== null &&
      board &&
      (issue.status === "backlog" || issue.status === "ready")
    ) {
      queryClient.setQueryData<ProjectBoard>(
        projectBoardKeys.board(queryProjectId),
        {
          ...board,
          issues: patchIssueInTree(board.issues, issue.number, {
            status: "in_progress",
          }),
        },
      );
    }
    setSelectedIssueNumber(null);
    if (inRouterContext) {
      setNavigateTarget("/ai");
    }
  };

  // 전환 중 로딩 문구에 쓸 프로젝트 명. 목록에 없으면 일반 문구로 폴백.
  const switchingTitle =
    activeProject?.projects.find(
      (candidate) => candidate.id === activeProjectId,
    )?.title ?? null;

  const readinessIndex = useMemo(
    () => (board ? buildIssueReadinessIndex(board.issues) : null),
    [board],
  );

  const assigneeOptions = useMemo(() => {
    const discovered = collectBoardAssignees(board?.issues ?? [], viewerLogin);
    if (
      assigneeFilter !== ASSIGNEE_FILTER_ALL &&
      assigneeFilter !== ASSIGNEE_FILTER_UNASSIGNED &&
      !discovered.some(
        (member) => member.login.toLowerCase() === assigneeFilter.toLowerCase(),
      )
    ) {
      return [...discovered, { login: assigneeFilter }];
    }
    return discovered;
  }, [board?.issues, viewerLogin, assigneeFilter]);

  const isMineOnly =
    viewerLogin !== null &&
    assigneeFilter.trim().toLowerCase() === viewerLogin.trim().toLowerCase();

  const handleDeepLinkIssueSelect = useCallback(
    (issueNumber: number, fallback: BoardIssue | null) => {
      setSelectedIssueFallback(fallback);
      setSelectedIssueNumber(issueNumber);
    },
    [],
  );

  const visibleLayers = useMemo(
    () =>
      BOARD_LAYERS.filter(
        (layer) => filter === "all" || layer.id === filter,
      ),
    [filter],
  );
  const {
    grouped: groupedIssues,
    capped: walkCapped,
    totalCount: groupedIssueCount,
  } = useMemo(() => {
    // 계층 뷰에서는 레이어 셀이 렌더되지 않으므로 집계를 건너뛴다.
    // (walkIssues 전체 순회 + emitted Set 비용을 아낀다.)
    if (view !== "layers" || !board) {
      return {
        grouped: new Map<string, BoardIssue[]>(),
        capped: false,
        totalCount: 0,
      };
    }
    const grouped = new Map<string, BoardIssue[]>();
    // 다이아몬드 공유 자식은 여러 부모 경로에서 walk되므로 같은 셀에
    // 두 번 펼치지 않도록 레이어:상태:URL 기준으로 한 번만 집계한다.
    const emitted = new Set<string>();
    const budget = { count: 0, capped: false };
    let totalCount = 0;
    for (const issue of walkIssues(board?.issues ?? [], 0, new Set<string>(), budget)) {
      if (hideDone && issue.status === "done") {
        continue;
      }
      if (
        readyOnly &&
        readinessIndex &&
        readinessIndex.getStatus(issue).state !== "ready"
      ) {
        continue;
      }
      if (
        assigneeFilter !== ASSIGNEE_FILTER_ALL &&
        !matchesAssigneeFilter(issue, assigneeFilter)
      ) {
        continue;
      }
      const dedupeKey = `${issue.layer}:${issue.status}:${issueKey(issue)}`;
      if (emitted.has(dedupeKey)) {
        continue;
      }
      emitted.add(dedupeKey);
      if (filter === "all" || issue.layer === filter) {
        totalCount += 1;
      }
      const key = `${issue.layer}:${issue.status}`;
      const list = grouped.get(key);
      if (list) {
        list.push(issue);
      } else {
        grouped.set(key, [issue]);
      }
    }
    return { grouped, capped: budget.capped, totalCount };
  }, [assigneeFilter, board, filter, hideDone, readyOnly, readinessIndex, view]);

  // 트리 펼침 상태(useState)가 무관한 렌더에 리셋되지 않도록 메모한다.
  const { issues: treeIssues, capped: treeCapped } = useMemo(() => {
    if (!board) {
      return { issues: EMPTY_ISSUES, capped: false };
    }
    let baseIssues = board.issues;
    let capped = false;
    if (view === "tree" && hideDone) {
      const budget = { count: 0, capped: false };
      baseIssues = withoutDone(board.issues, 0, new Set<string>(), budget);
      capped = budget.capped;
    }
    if (view === "tree" && readyOnly && readinessIndex) {
      baseIssues = filterTreeToReadyOnly(baseIssues, readinessIndex);
    }
    if (view === "tree" && assigneeFilter !== ASSIGNEE_FILTER_ALL) {
      baseIssues = filterTreeByAssignee(baseIssues, assigneeFilter);
    }
    return { issues: baseIssues, capped };
  }, [assigneeFilter, hideDone, readyOnly, readinessIndex, board, view]);

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="project-title"
    >
      <PageHeader
        titleId="project-title"
        title="Board"
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
              onClick={() => syncMutation.mutate()}
              disabled={isFetchingBoard || isSyncingBoard || isUnlinked}
              loading={isFetchingBoard || isSyncingBoard}
            >
              <RefreshCw aria-hidden="true" strokeWidth={1.75} />
              새로고침
            </Button>
          </div>
        }
      />

      {activeWorkspace ? (
        <WorkspaceContextBar
          className="mt-[var(--space-4)]"
          docsRepositoryGateway={docsRepositoryGateway}
          repositoryGateway={repositoryGateway}
        />
      ) : null}

      {isStandaloneDocsWorkspace && activeWorkspace ? (
        <section
          aria-label="Project 보드 연결 안내"
          className="mt-[var(--space-6)] grid max-w-2xl justify-items-start gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-6)]"
        >
          <StatusBadge tone="neutral">문서 전용</StatusBadge>
          <h2 className="m-0 text-[length:var(--font-section-size)] leading-[var(--font-section-line)] font-[number:var(--font-weight-section-title)] text-[var(--color-text-strong)]">
            문서 저장소 단독으로 관리 중인 워크스페이스입니다
          </h2>
          <p className="m-0 text-[var(--color-text-muted)]">
            현재는 상위 Project 보드 없이 문서만 단독으로 관리하고 있습니다. 칸반 보드와 이슈 흐름이 필요해지면 언제든 GitHub Project 보드를 이 워크스페이스에 연결할 수 있습니다.
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={attachingProject}
            loading={attachingProject}
            onClick={() => {
              setAttachError(null);
              setAttachDialogOpen(true);
            }}
          >
            GitHub Project 보드 연결
          </Button>
          {attachError && !attachDialogOpen ? (
            <p role="alert" className="m-0 text-[var(--color-error)]">
              {attachError}
            </p>
          ) : null}
          <Dialog
            open={attachDialogOpen}
            onOpenChange={setAttachDialogOpen}
          >
            <DialogContent size="wide" aria-label="GitHub Project 보드 연결">
              <DialogHeader>
                <div className="min-w-0">
                  <DialogTitle>GitHub Project 보드 연결</DialogTitle>
                  <DialogDescription>
                    {activeWorkspace.docsRepository
                      ? `${activeWorkspace.docsRepository.fullName} 문서 저장소와 연결할 GitHub Project 보드를 선택하세요.`
                      : "이 워크스페이스에 연결할 GitHub Project 보드를 선택하세요."}
                  </DialogDescription>
                </div>
                <DialogCloseButton label="GitHub Project 보드 연결 닫기" />
              </DialogHeader>
              <DialogBody className="mt-[var(--space-4)] grid gap-[var(--space-3)]">
                {attachError ? (
                  <p role="alert" className="m-0 text-[var(--color-error)]">
                    {attachError}
                  </p>
                ) : null}
                <ProjectPickerList
                  disabledProjectIds={linkedProjectIds}
                  busy={attachingProject}
                  onSelectProject={(project) => {
                    void handleAttachProject(project);
                  }}
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </section>
      ) : isUnlinked ? (
        <div className="mt-[var(--space-4)] grid justify-items-start gap-[var(--space-3)]">
          {activeProject &&
          Array.isArray(activeProject.workspaces) &&
          activeProject.workspaces.length === 0 &&
          !activeProject.isListing &&
          !activeProject.isListError ? (
            <>
              <p role="status" className="m-0 text-[var(--color-text-muted)]">
                아직 연결된 워크스페이스가 없습니다. 먼저 워크스페이스를 시작해 GitHub Project 보드를 연결하세요.
              </p>
              <Button asChild variant="secondary">
                {inRouterContext ? (
                  <Link to="/documents">워크스페이스 시작하기</Link>
                ) : (
                  <a href="#/documents">워크스페이스 시작하기</a>
                )}
              </Button>
            </>
          ) : (
            <p role="status" className="m-0 text-[var(--color-text-muted)]">
              선택된 프로젝트가 없습니다. 사이드바에서 프로젝트를 추가하면 이슈를 볼 수 있습니다.
            </p>
          )}
        </div>
      ) : null}

      {isUnlinked || board === null ? null : (
        <>
          {board.issues.length > 0 && view === "layers" ? (
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

          {board.issues.length > 0 ? (
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
                <label className="flex cursor-pointer items-center gap-[var(--space-2)] text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  <Checkbox
                    checked={readyOnly}
                    onChange={(event) => setReadyOnly(event.target.checked)}
                  />
                  시작 가능만 보기
                </label>
                <label className="flex cursor-pointer items-center gap-[var(--space-2)] text-[var(--font-meta-size)] text-[var(--text-muted)]">
                  <Checkbox
                    disabled={viewerLogin === null}
                    checked={isMineOnly}
                    onChange={(event) =>
                      setAssigneeFilter(
                        event.target.checked && viewerLogin
                          ? viewerLogin
                          : ASSIGNEE_FILTER_ALL,
                      )
                    }
                  />
                  내 담당만 보기
                </label>
                <div className="min-w-[10.5rem]">
                  <Select
                    aria-label="담당자 필터"
                    value={assigneeFilter}
                    onValueChange={setAssigneeFilter}
                  >
                    <SelectOption value={ASSIGNEE_FILTER_ALL}>
                      전체 담당자
                    </SelectOption>
                    {assigneeOptions.map((member) => (
                      <SelectOption key={member.login} value={member.login}>
                        {member.login.toLowerCase() ===
                        viewerLogin?.toLowerCase()
                          ? `@${member.login} (나)`
                          : member.name
                            ? `@${member.login} (${member.name})`
                            : `@${member.login}`}
                      </SelectOption>
                    ))}
                    <SelectOption value={ASSIGNEE_FILTER_UNASSIGNED}>
                      미배정
                    </SelectOption>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}
          {board && (board.truncated || walkCapped || treeCapped) ? (
            <p className="m-0 mt-[var(--space-3)] text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
              보드 항목이 많아 일부만 표시됩니다. (보드 최대 500개·에픽별 하위 이슈
              최대 520개
              {walkCapped || treeCapped
                ? "·화면 표시 상한, 화면에서 생략된 항목은 제외 개수에 포함되지 않음"
                : ""}
              )
            </p>
          ) : null}
        </>
      )}

      {boardLoading ? (
        <p role="status">
          {switchingTitle ? `"${switchingTitle}" 보드 가져오는 중` : "Project 불러오는 중"}
        </p>
      ) : (
        <>
          {loadError ? (
            <div role="alert" className="grid gap-[var(--space-3)]">
              <p className="m-0">{loadError}</p>
              <div>
                <Button type="button" variant="secondary" onClick={retryLoad}>
                  다시 시도
                </Button>
              </div>
            </div>
          ) : null}
          {!isUnlinked && board ? (
            board.issues.length === 0 ? (
              <section
                aria-label="빈 보드 안내"
                className="mt-[var(--space-6)] grid max-w-2xl justify-items-start gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-6)]"
              >
                <p className="m-0 text-[var(--color-text-muted)]">
                  아직 등록된 백로그가 없습니다. AI 화면에서 구현하고 싶은 아이디어를 이야기하면 PRD·화면명세서와 담당자별 백로그가 자동으로 준비됩니다.
                </p>
                <Button asChild variant="primary">
                  {inRouterContext ? (
                    <Link to="/ai">AI에서 시작하기</Link>
                  ) : (
                    <a href="#/ai">AI에서 시작하기</a>
                  )}
                </Button>
              </section>
            ) : assigneeFilter !== ASSIGNEE_FILTER_ALL &&
              ((view === "tree" && treeIssues.length === 0) ||
                (view === "layers" && groupedIssueCount === 0)) ? (
              <section
                aria-label="필터 결과 없음"
                className="mt-[var(--space-6)] grid max-w-2xl justify-items-start gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-6)]"
              >
                <p className="m-0 text-[var(--color-text-muted)]">
                  선택한 담당자에게 배정된 열린 작업이 없습니다.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFilter("all");
                    setReadyOnly(false);
                    setAssigneeFilter(ASSIGNEE_FILTER_ALL);
                  }}
                >
                  필터 초기화
                </Button>
              </section>
            ) : view === "tree" ? (
              <ProjectTree
                issues={treeIssues}
                readinessIndex={readinessIndex}
                onSelectIssue={(issue) => {
                  setSelectedIssueFallback(issue);
                  setSelectedIssueNumber(issue.number);
                }}
              />
            ) : (
        <div className="grid gap-[var(--space-6)]">
          {visibleLayers.map((layer) => (
            <section key={layer.id} aria-label={`${layer.name} 레이어`} className="min-w-0">
              {/* 미지정 레인은 매핑 라벨이 없어 title을 붙이지 않는다. */}
              <h2 className="m-0 mb-[var(--space-3)]" title={layer.label ?? undefined}>
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
                      readinessIndex={readinessIndex}
                      onSelectIssue={(issue) => {
                        setSelectedIssueFallback(issue);
                        setSelectedIssueNumber(issue.number);
                      }}
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

      <ProjectIssueDrawer
        open={selectedIssue !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedIssueNumber(null);
          }
        }}
        issue={selectedIssue}
        detail={issueDetailQuery.data ?? null}
        isLoadingDetail={issueDetailQuery.isPending && Boolean(gateway.getIssueDetail)}
        detailError={
          issueDetailQuery.isError
            ? issueDetailQuery.error instanceof Error
              ? issueDetailQuery.error.message
              : "이슈 상세를 불러오지 못했습니다."
            : null
        }
        readiness={
          selectedIssue && readinessIndex
            ? readinessIndex.getStatus(selectedIssue)
            : null
        }
        isUpdating={updateItemMutation.isPending}
        updateError={
          updateItemMutation.isError
            ? updateItemMutation.error instanceof Error
              ? updateItemMutation.error.message
              : "필드 변경에 실패했습니다."
            : null
        }
        onRetryDetail={() => {
          void issueDetailQuery.refetch();
        }}
        onUpdateField={
          gateway.updateBoardItem && selectedIssue
            ? (patch) =>
                updateItemMutation.mutate({
                  issueNumber: selectedIssue.number,
                  ...patch,
                })
            : undefined
        }
        onStartWithAi={handleStartWithAi}
      />

      {inRouterContext ? (
        <RouterIssueDeepLinkSync
          ready={!isUnlinked && board !== null && !boardLoading && !isFetchingBoard && !isSyncingBoard}
          issues={board?.issues ?? EMPTY_ISSUES}
          onSelectIssueNumber={handleDeepLinkIssueSelect}
        />
      ) : null}

      {inRouterContext && navigateTarget ? (
        <RouterRedirect
          to={navigateTarget}
          onNavigated={() => setNavigateTarget(null)}
        />
      ) : null}
    </section>
  );
}