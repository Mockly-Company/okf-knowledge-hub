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
import type { AiGateway } from "@/features/ai/AiGateway";
import {
  closeWorkspaceTerminals,
  migrateWorkspaceTerminals,
} from "@/features/ai/TerminalSessionStore";
import type {
  ConnectedHubWorkspace,
  DocsRepositoryGateway,
  HubWorkspace,
  HubWorkspaceList,
} from "@/features/docs-repository/DocsRepositoryGateway";
import type {
  DocsRepositoryRef,
  ProjectBoardGateway,
} from "@/features/project-board/ProjectBoardGateway";
import type {
  ProjectList,
  ResolvedGithubProject,
} from "@/features/project-board/model";
import { projectBoardKeys } from "@/features/project-board/queryKeys";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

/** 마지막으로 선택한 워크스페이스(또는 프로젝트) id를 기억하는 localStorage 키. */
export const LAST_ACTIVE_PROJECT_KEY = "okhub.last-active-project-id";

export const hubWorkspaceQueryKey = ["hubWorkspaces", "list"] as const;

export interface ActiveProjectContextValue {
  /** 통합 워크스페이스 목록 (`Project + 문서 저장소` 및 `문서 저장소 단독` 모두 포함). */
  workspaces: HubWorkspace[];
  activeWorkspace: HubWorkspace | null;
  activeWorkspaceId: string | null;
  activeWorkspaceTitle: string;
  activeProjectId: string | null;
  projects: ResolvedGithubProject[];
  /** 활성 프로젝트 표시명. 단독 문서 워크스페이스면 "문서 전용 (보드 연결 없음)", 미선택이면 "선택된 프로젝트 없음". */
  activeProjectTitle: string;
  /** 활성 워크스페이스에 연결된 문서 저장소가 없을 때 true. */
  docsMissing: boolean;
  isListing: boolean;
  isListError?: boolean;
  isSelecting: boolean;
  selectError: string | null;
  /** 연결된 워크스페이스/프로젝트 목록을 다시 불러온다. 실패하면 이전 목록과 선택을 유지한다. */
  listLinkedProjects(): Promise<void>;
  /** Org 검색용. 목록을 덮어쓰지 않고 결과만 반환한다. */
  searchProjects(owner?: string): Promise<ProjectList>;
  /** 연결 후 목록에 반영한다. */
  linkProject(project: ResolvedGithubProject): Promise<void>;
  selectProject(projectId: string): Promise<void>;
  selectWorkspace(workspaceId: string): Promise<void>;
  createStandaloneWorkspace(
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace>;
  createProjectWorkspace(
    project: ResolvedGithubProject,
    repository?: DocsRepositoryRef | null,
  ): Promise<ConnectedHubWorkspace>;
  connectWorkspaceDocs(
    workspaceId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace>;
  attachProjectToWorkspace(
    workspaceId: string,
    project: ResolvedGithubProject,
  ): Promise<HubWorkspace>;
  detachProjectFromWorkspace(workspaceId: string): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
  /** 전환 전 미저장 초안 등을 선저장·검증하는 가드를 등록한다. false를 반환하면 전환을 중단한다. */
  registerBeforeWorkspaceSwitch?(
    guard: (nextWorkspaceId: string) => Promise<boolean>,
  ): () => void;
  /** 명시적 선택 해제. */
  clearActiveProject(): void;
}

const ActiveProjectContext =
  createContext<ActiveProjectContextValue | null>(null);

function shortRepositoryName(fullName: string): string {
  const parts = fullName.split("/");
  return parts[parts.length - 1]?.trim() || fullName;
}

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

const UNSAVED_DRAFT_SWITCH_ERROR =
  "저장하지 못한 문서 초안이 있어 작업 공간을 변경할 수 없습니다. Documents에서 초안 저장 상태를 확인하세요.";

interface ActiveProjectProviderProps extends PropsWithChildren {
  projectGateway?: ProjectBoardGateway;
  docsRepositoryGateway?: DocsRepositoryGateway;
  aiGateway?: AiGateway;
}

export function ActiveProjectProvider({
  projectGateway,
  docsRepositoryGateway,
  aiGateway,
  children,
}: ActiveProjectProviderProps) {
  // Tauri 게이트웨이는 invoke 래퍼라 인스턴스를 공유해도 안전하다.
  const [project] = useState(
    () => projectGateway ?? new TauriProjectBoardGateway(),
  );
  const hasWorkspaceGateway = Boolean(docsRepositoryGateway?.listWorkspaces);
  const queryClient = useQueryClient();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    readLastActiveProjectId(),
  );
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const [docsMissing, setDocsMissing] = useState(false);
  const [guardSelectError, setGuardSelectError] = useState<string | null>(null);

  const beforeSwitchGuardsRef = useRef(
    new Set<(nextWorkspaceId: string) => Promise<boolean>>(),
  );
  const registerBeforeWorkspaceSwitch = useCallback(
    (guard: (nextWorkspaceId: string) => Promise<boolean>) => {
      beforeSwitchGuardsRef.current.add(guard);
      return () => {
        beforeSwitchGuardsRef.current.delete(guard);
      };
    },
    [],
  );
  const runBeforeSwitchGuards = useCallback(
    async (nextWorkspaceId: string): Promise<boolean> => {
      for (const guard of Array.from(beforeSwitchGuardsRef.current)) {
        if (!(await guard(nextWorkspaceId))) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  // projectGateway 단독 모드(기존 테스트·스토리)에서 사용하는 인메모리 보조 상태.
  const [legacyDocsById, setLegacyDocsById] = useState<
    Record<string, DocsRepositoryRef>
  >({});
  const [legacyStandaloneWorkspaces, setLegacyStandaloneWorkspaces] = useState<
    HubWorkspace[]
  >([]);

  /** 이번 세션에서 사용자가 명시적으로 선택 해제한 뒤에는 자동 선택하지 않는다. */
  const userClearedRef = useRef(false);
  /** 기기에 저장된 선택을 백엔드 활성 워크스페이스와 맞췄는지. */
  const alignedStoredRef = useRef(false);

  const workspacesQuery = useQuery({
    queryKey: hubWorkspaceQueryKey,
    enabled: hasWorkspaceGateway,
    queryFn: async (): Promise<HubWorkspaceList> => {
      try {
        return await docsRepositoryGateway!.listWorkspaces!();
      } catch (error) {
        console.warn("[active-project] listWorkspaces failed", error);
        throw error;
      }
    },
  });

  const linkedQuery = useQuery({
    queryKey: projectBoardKeys.linkedProjects,
    enabled: !hasWorkspaceGateway,
    queryFn: async (): Promise<ResolvedGithubProject[]> => {
      try {
        const linked = project.listLinkedProjects
          ? await project.listLinkedProjects()
          : await project
              .listGithubProjects(undefined)
              .then((list) => list.projects);
        return linked ?? [];
      } catch (error) {
        console.warn("[active-project] listLinkedProjects failed", error);
        throw error;
      }
    },
  });

  const workspaces = useMemo<HubWorkspace[]>(() => {
    if (hasWorkspaceGateway) {
      return workspacesQuery.data?.workspaces ?? [];
    }
    const projectWorkspaces: HubWorkspace[] = (linkedQuery.data ?? []).map(
      (linked) => ({
        id: linked.id,
        title: linked.title,
        project: linked,
        docsRepository: legacyDocsById[linked.id] ?? null,
      }),
    );
    return [...projectWorkspaces, ...legacyStandaloneWorkspaces];
  }, [
    hasWorkspaceGateway,
    workspacesQuery.data,
    linkedQuery.data,
    legacyDocsById,
    legacyStandaloneWorkspaces,
  ]);

  const projects = useMemo<ResolvedGithubProject[]>(
    () =>
      workspaces.flatMap((workspace) =>
        workspace.project ? [workspace.project] : [],
      ),
    [workspaces],
  );

  const applyWorkspaceSnapshot = useCallback(
    (snapshot: HubWorkspaceList) => {
      queryClient.setQueryData(hubWorkspaceQueryKey, snapshot);
      userClearedRef.current = false;
      alignedStoredRef.current = true;
      setGuardSelectError(null);
      if (snapshot.activeWorkspaceId) {
        setActiveWorkspaceId(snapshot.activeWorkspaceId);
        rememberLastActiveProjectId(snapshot.activeWorkspaceId);
        setDocsMissing(!snapshot.activeDocsConnected);
      } else {
        setActiveWorkspaceId(null);
        forgetLastActiveProjectId();
        setDocsMissing(false);
      }
    },
    [queryClient],
  );

  const applyOptimisticWorkspace = useCallback(
    (
      workspace: HubWorkspace,
      options: {
        makeActive: boolean;
        docsConnected?: boolean;
        replaceId?: string;
      },
    ) => {
      const prev =
        queryClient.getQueryData<HubWorkspaceList>(hubWorkspaceQueryKey);
      const previousWorkspaces = prev?.workspaces ?? [];
      const filteredWorkspaces =
        options.replaceId && options.replaceId !== workspace.id
          ? previousWorkspaces.filter((item) => item.id !== options.replaceId)
          : previousWorkspaces;
      const exists = filteredWorkspaces.some((item) => item.id === workspace.id);
      const nextWorkspaces = exists
        ? filteredWorkspaces.map((item) =>
            item.id === workspace.id ? workspace : item,
          )
        : [...filteredWorkspaces, workspace];
      const nextActiveId = options.makeActive
        ? workspace.id
        : (prev?.activeWorkspaceId ??
            activeWorkspaceIdRef.current ??
            nextWorkspaces[0]?.id ??
            null);
      const nextActiveWorkspace =
        nextWorkspaces.find((item) => item.id === nextActiveId) ?? null;
      const nextActiveDocsConnected =
        nextActiveId === null
          ? false
          : nextActiveId === workspace.id && options.docsConnected !== undefined
            ? options.docsConnected
            : nextActiveId === prev?.activeWorkspaceId &&
                prev?.activeDocsConnected !== undefined
              ? prev.activeDocsConnected
              : Boolean(nextActiveWorkspace?.docsRepository);
      applyWorkspaceSnapshot({
        workspaces: nextWorkspaces,
        activeWorkspaceId: nextActiveId,
        activeDocsConnected: nextActiveDocsConnected,
      });
      void queryClient.invalidateQueries({ queryKey: hubWorkspaceQueryKey });
    },
    [applyWorkspaceSnapshot, queryClient],
  );

  const listLinkedProjects = useCallback(async (): Promise<void> => {
    if (hasWorkspaceGateway) {
      await queryClient.refetchQueries({ queryKey: hubWorkspaceQueryKey });
      return;
    }
    await queryClient.refetchQueries({
      queryKey: projectBoardKeys.linkedProjects,
    });
  }, [hasWorkspaceGateway, queryClient]);

  const searchProjects = useCallback(
    (owner?: string): Promise<ProjectList> => {
      const trimmed = owner?.trim() === "" ? undefined : owner?.trim();
      return project.listGithubProjects(trimmed);
    },
    [project],
  );

  const selectMutation = useMutation({
    mutationFn: async (
      workspaceId: string,
    ): Promise<{
      workspaceId: string;
      missing: boolean;
      docsRepository: DocsRepositoryRef | null;
    }> => {
      if (hasWorkspaceGateway && docsRepositoryGateway?.setActiveWorkspace) {
        const activated =
          await docsRepositoryGateway.setActiveWorkspace(workspaceId);
        return {
          workspaceId: activated.workspace.id,
          missing: !activated.docsConnected,
          docsRepository: activated.workspace.docsRepository,
        };
      }
      const standalone = legacyStandaloneWorkspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (standalone) {
        return {
          workspaceId: standalone.id,
          missing: standalone.docsRepository === null,
          docsRepository: standalone.docsRepository,
        };
      }
      const result = await project.setActiveProject(workspaceId);
      return {
        workspaceId,
        missing: result.docsRepository === null,
        docsRepository: result.docsRepository,
      };
    },
    onSuccess: ({ workspaceId, missing, docsRepository }) => {
      userClearedRef.current = false;
      setActiveWorkspaceId(workspaceId);
      rememberLastActiveProjectId(workspaceId);
      setDocsMissing(missing);
      if (!hasWorkspaceGateway && docsRepository) {
        setLegacyDocsById((prev) => ({
          ...prev,
          [workspaceId]: docsRepository,
        }));
      }
      if (hasWorkspaceGateway) {
        queryClient.setQueryData<HubWorkspaceList | undefined>(
          hubWorkspaceQueryKey,
          (prev) =>
            prev
              ? {
                  ...prev,
                  activeWorkspaceId: workspaceId,
                  activeDocsConnected: !missing,
                }
              : prev,
        );
      }
    },
  });

  const clearActiveProject = useCallback(() => {
    userClearedRef.current = true;
    setActiveWorkspaceId(null);
    setDocsMissing(false);
    setGuardSelectError(null);
    selectMutation.reset();
    forgetLastActiveProjectId();
  }, [selectMutation.reset]);

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === "") {
        clearActiveProject();
        return;
      }
      setGuardSelectError(null);
      if (
        activeWorkspaceIdRef.current !== null &&
        workspaceId !== activeWorkspaceIdRef.current
      ) {
        if (!(await runBeforeSwitchGuards(workspaceId))) {
          setGuardSelectError(UNSAVED_DRAFT_SWITCH_ERROR);
          return;
        }
      }
      await selectMutation.mutateAsync(workspaceId);
    },
    [clearActiveProject, runBeforeSwitchGuards, selectMutation.mutateAsync],
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      if (projectId === "") {
        clearActiveProject();
        return;
      }
      const matched = workspaces.find(
        (workspace) =>
          workspace.id === projectId || workspace.project?.id === projectId,
      );
      await selectWorkspace(matched?.id ?? projectId);
    },
    [clearActiveProject, selectWorkspace, workspaces],
  );

  const createStandaloneWorkspace = useCallback(
    async (
      repositoryId: string,
      fullName: string,
    ): Promise<ConnectedHubWorkspace> => {
      const candidateId = `repo:${repositoryId}`;
      if (
        activeWorkspaceIdRef.current !== null &&
        activeWorkspaceIdRef.current !== candidateId &&
        !(await runBeforeSwitchGuards(candidateId))
      ) {
        throw new Error(UNSAVED_DRAFT_SWITCH_ERROR);
      }
      if (
        hasWorkspaceGateway &&
        docsRepositoryGateway?.createStandaloneWorkspace
      ) {
        const created = await docsRepositoryGateway.createStandaloneWorkspace(
          repositoryId,
          fullName,
        );
        applyOptimisticWorkspace(created.workspace, {
          makeActive: true,
          docsConnected: created.docsConnected,
        });
        return created;
      }
      const workspace: HubWorkspace = {
        id: `repo:${repositoryId}`,
        title: shortRepositoryName(fullName),
        project: null,
        docsRepository: { repositoryId, fullName },
      };
      setLegacyStandaloneWorkspaces((prev) => {
        const filtered = prev.filter((item) => item.id !== workspace.id);
        return [...filtered, workspace];
      });
      userClearedRef.current = false;
      setGuardSelectError(null);
      setActiveWorkspaceId(workspace.id);
      rememberLastActiveProjectId(workspace.id);
      setDocsMissing(false);
      return { workspace, docsConnected: true, okf: true };
    },
    [
      applyOptimisticWorkspace,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      runBeforeSwitchGuards,
    ],
  );

  const createProjectWorkspace = useCallback(
    async (
      resolved: ResolvedGithubProject,
      repository?: DocsRepositoryRef | null,
    ): Promise<ConnectedHubWorkspace> => {
      if (
        activeWorkspaceIdRef.current !== null &&
        activeWorkspaceIdRef.current !== resolved.id &&
        !(await runBeforeSwitchGuards(resolved.id))
      ) {
        throw new Error(UNSAVED_DRAFT_SWITCH_ERROR);
      }
      if (
        hasWorkspaceGateway &&
        docsRepositoryGateway?.createProjectWorkspace
      ) {
        const created = await docsRepositoryGateway.createProjectWorkspace(
          resolved,
          repository ?? null,
        );
        applyOptimisticWorkspace(created.workspace, {
          makeActive: true,
          docsConnected: created.docsConnected,
        });
        return created;
      }
      await project.linkGithubProject(resolved);
      if (repository) {
        setLegacyDocsById((prev) => ({ ...prev, [resolved.id]: repository }));
      }
      queryClient.setQueryData<ResolvedGithubProject[]>(
        projectBoardKeys.linkedProjects,
        (prev = []) =>
          prev.some((candidate) => candidate.id === resolved.id)
            ? prev.map((candidate) =>
                candidate.id === resolved.id ? resolved : candidate,
              )
            : [...prev, resolved],
      );
      userClearedRef.current = false;
      setGuardSelectError(null);
      setActiveWorkspaceId(resolved.id);
      rememberLastActiveProjectId(resolved.id);
      setDocsMissing(!repository);
      return {
        workspace: {
          id: resolved.id,
          title: resolved.title,
          project: resolved,
          docsRepository: repository ?? null,
        },
        docsConnected: Boolean(repository),
        okf: repository ? true : null,
      };
    },
    [
      applyOptimisticWorkspace,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      project,
      queryClient,
      runBeforeSwitchGuards,
    ],
  );

  const linkProject = useCallback(
    async (resolved: ResolvedGithubProject) => {
      if (
        hasWorkspaceGateway &&
        docsRepositoryGateway?.createProjectWorkspace
      ) {
        await createProjectWorkspace(resolved, null);
        return;
      }
      await project.linkGithubProject(resolved);
      queryClient.setQueryData<ResolvedGithubProject[]>(
        projectBoardKeys.linkedProjects,
        (prev = []) =>
          prev.some((candidate) => candidate.id === resolved.id)
            ? prev
            : [...prev, resolved],
      );
    },
    [
      createProjectWorkspace,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      project,
      queryClient,
    ],
  );

  const connectWorkspaceDocs = useCallback(
    async (
      workspaceId: string,
      repositoryId: string,
      fullName: string,
    ): Promise<ConnectedHubWorkspace> => {
      const previous = workspaces.find((item) => item.id === workspaceId);
      const previousRepoId =
        previous?.docsRepository?.repositoryId ??
        legacyDocsById[workspaceId]?.repositoryId ??
        null;
      if (
        activeWorkspaceIdRef.current === workspaceId &&
        previousRepoId !== null &&
        previousRepoId !== repositoryId &&
        !(await runBeforeSwitchGuards(workspaceId))
      ) {
        throw new Error(UNSAVED_DRAFT_SWITCH_ERROR);
      }
      const syncTerminalsAfterDocsConnect = (nextWorkspaceId: string) => {
        if (!aiGateway) return;
        if (previousRepoId !== null && previousRepoId !== repositoryId) {
          closeWorkspaceTerminals(aiGateway, workspaceId);
          return;
        }
        if (nextWorkspaceId !== workspaceId) {
          migrateWorkspaceTerminals(aiGateway, workspaceId, nextWorkspaceId);
        }
      };

      if (hasWorkspaceGateway && docsRepositoryGateway?.connectWorkspaceDocs) {
        const connected = await docsRepositoryGateway.connectWorkspaceDocs(
          workspaceId,
          repositoryId,
          fullName,
        );
        syncTerminalsAfterDocsConnect(connected.workspace.id);
        applyOptimisticWorkspace(connected.workspace, {
          makeActive: activeWorkspaceIdRef.current === workspaceId,
          docsConnected: connected.docsConnected,
          replaceId: workspaceId,
        });
        return connected;
      }
      if (docsRepositoryGateway) {
        const result = await docsRepositoryGateway.connect(
          workspaceId,
          repositoryId,
          fullName,
        );
        syncTerminalsAfterDocsConnect(workspaceId);
        setLegacyDocsById((prev) => ({
          ...prev,
          [workspaceId]: { repositoryId, fullName },
        }));
        if (activeWorkspaceId === workspaceId) {
          setDocsMissing(false);
        }
        const existing = workspaces.find((item) => item.id === workspaceId);
        return {
          workspace: existing
            ? {
                ...existing,
                docsRepository: { repositoryId, fullName },
              }
            : {
                id: workspaceId,
                title: shortRepositoryName(fullName),
                project: null,
                docsRepository: { repositoryId, fullName },
              },
          docsConnected: true,
          okf: result.okf,
        };
      }
      syncTerminalsAfterDocsConnect(workspaceId);
      setLegacyDocsById((prev) => ({
        ...prev,
        [workspaceId]: { repositoryId, fullName },
      }));
      if (activeWorkspaceId === workspaceId) {
        setDocsMissing(false);
      }
      return {
        workspace: {
          id: workspaceId,
          title: shortRepositoryName(fullName),
          project: null,
          docsRepository: { repositoryId, fullName },
        },
        docsConnected: true,
        okf: true,
      };
    },
    [
      activeWorkspaceId,
      aiGateway,
      applyOptimisticWorkspace,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      legacyDocsById,
      runBeforeSwitchGuards,
      workspaces,
    ],
  );

  const attachProjectToWorkspace = useCallback(
    async (
      workspaceId: string,
      resolved: ResolvedGithubProject,
    ): Promise<HubWorkspace> => {
      if (
        activeWorkspaceIdRef.current === workspaceId &&
        !(await runBeforeSwitchGuards(resolved.id))
      ) {
        throw new Error(UNSAVED_DRAFT_SWITCH_ERROR);
      }
      if (hasWorkspaceGateway && docsRepositoryGateway?.attachProject) {
        const updated = await docsRepositoryGateway.attachProject(
          workspaceId,
          resolved,
        );
        if (aiGateway && updated.id !== workspaceId) {
          migrateWorkspaceTerminals(aiGateway, workspaceId, updated.id);
        }
        applyOptimisticWorkspace(updated, {
          makeActive: activeWorkspaceIdRef.current === workspaceId,
          replaceId: workspaceId,
        });
        return updated;
      }
      await project.linkGithubProject(resolved);
      const standalone = legacyStandaloneWorkspaces.find(
        (item) => item.id === workspaceId,
      );
      if (standalone?.docsRepository) {
        const repo = standalone.docsRepository;
        setLegacyDocsById((prev) => ({ ...prev, [resolved.id]: repo }));
      }
      if (aiGateway && resolved.id !== workspaceId) {
        migrateWorkspaceTerminals(aiGateway, workspaceId, resolved.id);
      }
      setLegacyStandaloneWorkspaces((prev) =>
        prev.filter((item) => item.id !== workspaceId),
      );
      await listLinkedProjects();
      setActiveWorkspaceId(resolved.id);
      rememberLastActiveProjectId(resolved.id);
      return {
        id: resolved.id,
        title: resolved.title,
        project: resolved,
        docsRepository: standalone?.docsRepository ?? null,
      };
    },
    [
      aiGateway,
      applyOptimisticWorkspace,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      legacyStandaloneWorkspaces,
      listLinkedProjects,
      project,
      runBeforeSwitchGuards,
    ],
  );

  const detachProjectFromWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      const previous = workspaces.find((item) => item.id === workspaceId);
      if (activeWorkspaceIdRef.current === workspaceId) {
        const nextHintId = previous?.docsRepository
          ? `repo:${previous.docsRepository.repositoryId}`
          : "";
        if (!(await runBeforeSwitchGuards(nextHintId))) {
          throw new Error(UNSAVED_DRAFT_SWITCH_ERROR);
        }
      }
      if (hasWorkspaceGateway && docsRepositoryGateway?.detachProject) {
        const otherWorkspaceIds = new Set(
          workspaces
            .filter((item) => item.id !== workspaceId)
            .map((item) => item.id),
        );
        const list = await docsRepositoryGateway.detachProject(workspaceId);
        if (aiGateway) {
          const prevRepoId = previous?.docsRepository?.repositoryId ?? null;
          const retained = prevRepoId
            ? list.workspaces.find(
                (item) =>
                  item.id === workspaceId ||
                  (!otherWorkspaceIds.has(item.id) &&
                    item.project === null &&
                    item.docsRepository?.repositoryId === prevRepoId),
              )
            : null;
          if (retained) {
            if (retained.id !== workspaceId) {
              migrateWorkspaceTerminals(aiGateway, workspaceId, retained.id);
            }
          } else {
            closeWorkspaceTerminals(aiGateway, workspaceId);
          }
        }
        applyWorkspaceSnapshot(list);
        return;
      }
      const target = previous;
      if (target?.project && project.unlinkGithubProject) {
        await project.unlinkGithubProject(target.project.id);
      }
      if (target?.docsRepository) {
        const standaloneId = `repo:${target.docsRepository.repositoryId}`;
        if (aiGateway && standaloneId !== workspaceId) {
          migrateWorkspaceTerminals(aiGateway, workspaceId, standaloneId);
        }
        const standalone: HubWorkspace = {
          id: standaloneId,
          title: shortRepositoryName(target.docsRepository.fullName),
          project: null,
          docsRepository: target.docsRepository,
        };
        setLegacyStandaloneWorkspaces((prev) => [
          ...prev.filter((item) => item.id !== standalone.id),
          standalone,
        ]);
        setActiveWorkspaceId(standaloneId);
        rememberLastActiveProjectId(standaloneId);
        setDocsMissing(false);
      } else if (aiGateway) {
        closeWorkspaceTerminals(aiGateway, workspaceId);
      }
      await listLinkedProjects();
    },
    [
      aiGateway,
      applyWorkspaceSnapshot,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      listLinkedProjects,
      project,
      runBeforeSwitchGuards,
      workspaces,
    ],
  );

  const removeWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (hasWorkspaceGateway && docsRepositoryGateway?.removeWorkspace) {
        const list = await docsRepositoryGateway.removeWorkspace(workspaceId);
        if (aiGateway) {
          closeWorkspaceTerminals(aiGateway, workspaceId);
        }
        applyWorkspaceSnapshot(list);
        return;
      }
      const target = workspaces.find((item) => item.id === workspaceId);
      if (target?.project && project.unlinkGithubProject) {
        await project.unlinkGithubProject(target.project.id);
      }
      setLegacyStandaloneWorkspaces((prev) =>
        prev.filter((item) => item.id !== workspaceId),
      );
      if (aiGateway) {
        closeWorkspaceTerminals(aiGateway, workspaceId);
      }
      await listLinkedProjects();
    },
    [
      aiGateway,
      applyWorkspaceSnapshot,
      docsRepositoryGateway,
      hasWorkspaceGateway,
      listLinkedProjects,
      project,
      workspaces,
    ],
  );

  // 통합 워크스페이스 게이트웨이 모드 초기 정렬
  useEffect(() => {
    if (!hasWorkspaceGateway || !workspacesQuery.isSuccess || userClearedRef.current) {
      return;
    }
    const snapshot = workspacesQuery.data;
    const listed = snapshot.workspaces;
    const storedStillListed =
      activeWorkspaceId !== null &&
      listed.some((candidate) => candidate.id === activeWorkspaceId);

    if (storedStillListed) {
      if (!alignedStoredRef.current && activeWorkspaceId !== null) {
        alignedStoredRef.current = true;
        if (snapshot.activeWorkspaceId !== activeWorkspaceId) {
          void selectWorkspace(activeWorkspaceId)
            .then(() => {
              const matched = listed.find((item) => item.id === activeWorkspaceId);
              if (matched?.project) {
                return queryClient.invalidateQueries({
                  queryKey: projectBoardKeys.board(matched.project.id),
                });
              }
              return undefined;
            })
            .catch(() => undefined);
          return;
        }
        setDocsMissing(!snapshot.activeDocsConnected);
      }
      return;
    }

    alignedStoredRef.current = true;
    if (listed.length === 0) {
      if (activeWorkspaceId !== null) {
        setActiveWorkspaceId(null);
        forgetLastActiveProjectId();
      }
      setDocsMissing(false);
      return;
    }

    const fallbackId = snapshot.activeWorkspaceId ?? listed[0].id;
    if (snapshot.activeWorkspaceId === fallbackId) {
      setActiveWorkspaceId(fallbackId);
      rememberLastActiveProjectId(fallbackId);
      setDocsMissing(!snapshot.activeDocsConnected);
      return;
    }
    void selectWorkspace(fallbackId).catch(() => undefined);
  }, [
    activeWorkspaceId,
    hasWorkspaceGateway,
    queryClient,
    selectWorkspace,
    workspacesQuery.data,
    workspacesQuery.isSuccess,
  ]);

  // projectGateway 단독 모드(기존 테스트·스토리) 초기 정렬
  useEffect(() => {
    if (hasWorkspaceGateway || !linkedQuery.isSuccess || userClearedRef.current) {
      return;
    }
    const storedStillListed =
      activeWorkspaceId !== null &&
      workspaces.some((candidate) => candidate.id === activeWorkspaceId);
    if (storedStillListed) {
      if (!alignedStoredRef.current && activeWorkspaceId !== null) {
        alignedStoredRef.current = true;
        void selectWorkspace(activeWorkspaceId)
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: projectBoardKeys.board(activeWorkspaceId),
            }),
          )
          .catch(() => undefined);
      }
      return;
    }
    alignedStoredRef.current = true;
    if (workspaces.length === 0) {
      if (activeWorkspaceId !== null) {
        setActiveWorkspaceId(null);
        forgetLastActiveProjectId();
      }
      return;
    }
    void selectWorkspace(workspaces[0].id).catch(() => undefined);
  }, [
    activeWorkspaceId,
    hasWorkspaceGateway,
    linkedQuery.isSuccess,
    queryClient,
    selectWorkspace,
    workspaces,
  ]);

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((candidate) => candidate.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const querySucceeded = hasWorkspaceGateway
    ? workspacesQuery.isSuccess
    : linkedQuery.isSuccess;

  const activeProjectId = activeWorkspace
    ? (activeWorkspace.project?.id ?? null)
    : !querySucceeded &&
        activeWorkspaceId !== null &&
        !activeWorkspaceId.startsWith("repo:")
      ? activeWorkspaceId
      : null;

  const activeWorkspaceTitle =
    activeWorkspace?.title ?? "연결된 워크스페이스 없음";

  const activeProjectTitle = activeWorkspace
    ? activeWorkspace.project
      ? activeWorkspace.project.title
      : "문서 전용 (보드 연결 없음)"
    : (projects.find((candidate) => candidate.id === activeProjectId)?.title ??
      "선택된 프로젝트 없음");

  const isListing = hasWorkspaceGateway
    ? workspacesQuery.isPending
    : linkedQuery.isPending;
  const isListError = hasWorkspaceGateway
    ? workspacesQuery.isError
    : linkedQuery.isError;

  const value = useMemo<ActiveProjectContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      activeWorkspaceTitle,
      activeProjectId,
      projects,
      activeProjectTitle,
      docsMissing,
      isListing,
      isListError,
      isSelecting: selectMutation.isPending,
      selectError: guardSelectError ?? describeSelectError(selectMutation.error),
      listLinkedProjects,
      searchProjects,
      linkProject,
      selectProject,
      selectWorkspace,
      createStandaloneWorkspace,
      createProjectWorkspace,
      connectWorkspaceDocs,
      attachProjectToWorkspace,
      detachProjectFromWorkspace,
      removeWorkspace,
      registerBeforeWorkspaceSwitch,
      clearActiveProject,
    }),
    [
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      activeWorkspaceTitle,
      activeProjectId,
      projects,
      activeProjectTitle,
      docsMissing,
      isListing,
      isListError,
      selectMutation.isPending,
      selectMutation.error,
      guardSelectError,
      listLinkedProjects,
      searchProjects,
      linkProject,
      selectProject,
      selectWorkspace,
      createStandaloneWorkspace,
      createProjectWorkspace,
      connectWorkspaceDocs,
      attachProjectToWorkspace,
      detachProjectFromWorkspace,
      removeWorkspace,
      registerBeforeWorkspaceSwitch,
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
