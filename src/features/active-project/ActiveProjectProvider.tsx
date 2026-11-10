import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import type {
  ProjectList,
  ResolvedGithubProject,
} from "@/features/project-board/model";
import { projectBoardKeys } from "@/features/project-board/queryKeys";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

/** 마지막으로 선택한 프로젝트 id를 기억하는 localStorage 키. */
export const LAST_ACTIVE_PROJECT_KEY = "okhub.last-active-project-id";

export interface ActiveProjectContextValue {
  activeProjectId: string | null;
  projects: ResolvedGithubProject[];
  /** 활성 프로젝트 표시명. 미선택이면 "선택된 프로젝트 없음". */
  activeProjectTitle: string;
  /** 전환한 프로젝트에 기억된 docs 저장소가 없을 때 true. */
  docsMissing: boolean;
  isListing: boolean;
  isSelecting: boolean;
  selectError: string | null;
  /** 연결된 프로젝트 목록을 다시 불러온다. 실패하면 이전 목록과 선택을 유지한다. */
  listLinkedProjects(): Promise<void>;
  /** Org 검색용. projects를 덮어쓰지 않고 결과만 반환한다. */
  searchProjects(owner?: string): Promise<ProjectList>;
  /** 연결 후 목록에 낙관 반영한다. 선택은 selectProject가 이어받는다. */
  linkProject(project: ResolvedGithubProject): Promise<void>;
  selectProject(projectId: string): Promise<void>;
  /** 명시적 None(로컬)으로 되돌린다. docs 체크아웃은 건드리지 않는다. */
  clearActiveProject(): void;
}

const ActiveProjectContext =
  createContext<ActiveProjectContextValue | null>(null);

function readLastActiveProjectId(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const stored = localStorage.getItem(LAST_ACTIVE_PROJECT_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

function rememberLastActiveProjectId(id: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id);
    }
  } catch {
    // 기기 저장 실패는 무시한다. 전역 선택 자체는 그대로 진행한다.
  }
}

function forgetLastActiveProjectId(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LAST_ACTIVE_PROJECT_KEY);
    }
  } catch {
    // 기기 저장 실패는 무시한다. 전역 선택 해제는 그대로 진행한다.
  }
}

/** 선택 실패 원문을 한 줄로 바꾼다. 사유 없는 문구는 만들지 않는다. */
function describeSelectError(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null;
  }
  if (typeof error === "object" && "message" in error) {
    const { message, details } = error as {
      message: string;
      details?: { reason?: unknown };
    };
    return typeof details?.reason === "string"
      ? `${message} (사유: ${details.reason})`
      : String(message);
  }
  if (typeof error === "string" && error.trim() !== "") {
    return `프로젝트 전환에 실패했습니다. (사유: ${error})`;
  }
  return "프로젝트 전환에 실패했습니다.";
}

interface ActiveProjectProviderProps extends PropsWithChildren {
  projectGateway?: ProjectBoardGateway;
}

export function ActiveProjectProvider({
  projectGateway,
  children,
}: ActiveProjectProviderProps) {
  // Tauri 게이트웨이는 invoke 래퍼라 인스턴스를 공유해도 안전하다.
  const [project] = useState(() => projectGateway ?? new TauriProjectBoardGateway());
  const queryClient = useQueryClient();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    readLastActiveProjectId(),
  );
  const [docsMissing, setDocsMissing] = useState(false);
  /** 이번 세션에서 사용자가 명시적으로 None(로컬)을 고른 뒤에는 자동 선택하지 않는다. */
  const userClearedRef = useRef(false);
  /** 기기에 저장된 선택을 백엔드 활성 프로젝트와 맞췄는지. workspace.yml은 pull로도 바뀐다. */
  const alignedStoredRef = useRef(false);

  const linkedQuery = useQuery({
    queryKey: projectBoardKeys.linkedProjects,
    queryFn: async (): Promise<ResolvedGithubProject[]> => {
      try {
        const linked = project.listLinkedProjects
          ? await project.listLinkedProjects()
          : await project
              .listGithubProjects(undefined)
              .then((list) => list.projects);
        return linked ?? [];
      } catch (error) {
        // 에러 배너는 띄우지 않지만, 일시적 실패가 연결 해제로 처리되면 안 된다.
        console.warn("[active-project] listLinkedProjects failed", error);
        throw error;
      }
    },
  });
  const projects = linkedQuery.data ?? [];

  const listLinkedProjects = useCallback(async (): Promise<void> => {
    await queryClient.refetchQueries({
      queryKey: projectBoardKeys.linkedProjects,
    });
  }, [queryClient]);

  const searchProjects = useCallback(
    (owner?: string): Promise<ProjectList> => {
      const trimmed = owner?.trim() === "" ? undefined : owner?.trim();
      return project.listGithubProjects(trimmed);
    },
    [project],
  );

  const linkProject = useCallback(
    async (resolved: ResolvedGithubProject) => {
      await project.linkGithubProject(resolved);
      queryClient.setQueryData<ResolvedGithubProject[]>(
        projectBoardKeys.linkedProjects,
        (prev = []) =>
          prev.some((candidate) => candidate.id === resolved.id)
            ? prev
            : [...prev, resolved],
      );
    },
    [project, queryClient],
  );

  // 선택 결과를 docs 저장소 유무(boolean)로 돌려준다. 보드는 프로젝트 id를
  // 키로 쓰므로 자동 재조회된다. 별도 invalidate가 필요 없다.
  const selectMutation = useMutation({
    mutationFn: async (projectId: string): Promise<boolean> => {
      // 프로젝트별 문서 저장소는 앱 설정에 있다. 없으면 Documents가 선택을 안내한다.
      const result = await project.setActiveProject(projectId);
      return result.docsRepository === null;
    },
    onSuccess: (missing, projectId) => {
      userClearedRef.current = false;
      setActiveProjectId(projectId);
      rememberLastActiveProjectId(projectId);
      setDocsMissing(missing);
    },
  });

  const clearActiveProject = useCallback(() => {
    userClearedRef.current = true;
    setActiveProjectId(null);
    setDocsMissing(false);
    selectMutation.reset();
    forgetLastActiveProjectId();
  }, [selectMutation.reset]);

  const selectProject = useCallback(
    async (projectId: string) => {
      // 빈 id는 명시적 None(로컬) 해제로 취급한다.
      if (projectId === "") {
        clearActiveProject();
        return;
      }
      await selectMutation.mutateAsync(projectId);
    },
    [clearActiveProject, selectMutation.mutateAsync],
  );

  // 조회된 프로젝트가 있으면 첫 번째를 기본 선택한다.
  // "프로젝트 없음(로컬)" 표시는 목록이 진짜 비어 있을 때만 유지한다.
  useEffect(() => {
    // 조회에 실패하면 목록을 알 수 없으므로 저장된 선택을 건드리지 않는다.
    if (!linkedQuery.isSuccess || userClearedRef.current) return;
    const storedStillListed =
      activeProjectId !== null &&
      projects.some((candidate) => candidate.id === activeProjectId);
    if (storedStillListed) {
      if (!alignedStoredRef.current && activeProjectId !== null) {
        alignedStoredRef.current = true;
        // 맞추기 전에 읽은 보드는 다른 프로젝트의 것일 수 있어 다시 읽는다.
        void selectProject(activeProjectId)
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: projectBoardKeys.board(activeProjectId),
            }),
          )
          .catch(() => undefined);
      }
      return;
    }
    alignedStoredRef.current = true;
    if (projects.length === 0) {
      // 저장된 id가 삭제됐는데 목록도 비었으면 잔재를 지우고 null을 유지한다.
      if (activeProjectId !== null) {
        setActiveProjectId(null);
        forgetLastActiveProjectId();
      }
      return;
    }
    // 선택 실패는 selectError 상태로 노출되고, rejection은 여기서 삼킨다.
    void selectProject(projects[0].id).catch(() => undefined);
  }, [activeProjectId, linkedQuery.isSuccess, projects, queryClient, selectProject]);

  const activeProjectTitle =
    projects.find((candidate) => candidate.id === activeProjectId)?.title ??
    "선택된 프로젝트 없음";

  const value = useMemo<ActiveProjectContextValue>(
    () => ({
      activeProjectId,
      projects,
      activeProjectTitle,
      docsMissing,
      isListing: linkedQuery.isFetching,
      isSelecting: selectMutation.isPending,
      selectError: describeSelectError(selectMutation.error),
      listLinkedProjects,
      searchProjects,
      linkProject,
      selectProject,
      clearActiveProject,
    }),
    [
      activeProjectId,
      projects,
      activeProjectTitle,
      docsMissing,
      linkedQuery.isFetching,
      selectMutation.isPending,
      selectMutation.error,
      listLinkedProjects,
      searchProjects,
      linkProject,
      selectProject,
      clearActiveProject,
    ],
  );

  return (
    <ActiveProjectContext.Provider value={value}>
      {children}
    </ActiveProjectContext.Provider>
  );
}

export function useActiveProject(): ActiveProjectContextValue {
  const value = useContext(ActiveProjectContext);
  if (!value) {
    throw new Error(
      "useActiveProject must be used inside ActiveProjectProvider",
    );
  }
  return value;
}

/** provider 없이 렌더되는 ProjectPage·스토리 폴백용. 없으면 null. */
export function useOptionalActiveProject(): ActiveProjectContextValue | null {
  return useContext(ActiveProjectContext);
}
