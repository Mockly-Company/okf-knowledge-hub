import type {
  ActiveProjectResult,
  CreateBoardIssuesResult,
  CreatedBoardIssueRef,
  DocsRepositoryRef,
  ProjectBoardGateway,
  ProjectBoardIssueDetail,
  UpdateBoardItemInput,
} from "@/features/project-board/ProjectBoardGateway";
import type {
  CreateBoardIssueInput,
  ProjectWritableRepository,
} from "@/features/project-board/backlogDerivation";
import type {
  BoardAssignee,
  BoardIssue,
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
  WorkspaceTeamAssignees,
  WorkspaceTeamAssigneesSnapshot,
} from "@/features/project-board/model";

export class FakeProjectBoardGateway implements ProjectBoardGateway {
  readonly calls: Array<
    | { method: "getProjectBoard" }
    | { method: "syncProjectBoard" }
    | { method: "resolveGithubProject"; url: string }
    | { method: "listGithubProjects"; owner?: string }
    | { method: "listLinkedProjects" }
    | { method: "linkGithubProject"; project: ResolvedGithubProject }
    | { method: "setActiveProject"; id: string }
    | { method: "unlinkGithubProject"; id: string }
    | { method: "listWritableRepositories" }
    | {
        method: "getIssueDetail";
        issueNumber: number;
        repositoryFullName?: string | null;
      }
    | { method: "createBoardIssues"; items: CreateBoardIssueInput[] }
    | { method: "updateBoardItem"; request: UpdateBoardItemInput }
    | { method: "getWorkspaceTeamAssignees"; forceRefresh?: boolean }
    | {
        method: "saveWorkspaceTeamAssignees";
        assignees: WorkspaceTeamAssignees;
      }
    | {
        method: "assignIssueToSelf";
        issueNumber: number;
        repositoryFullName?: string | null;
      }
  > = [];

  viewerLogin: string | null = null;
  docsRepositoryFullName: string | null = "Acme-Org/acme-docs";
  canWriteDocsRepository = true;
  teamMembers: BoardAssignee[] = [
    { login: "alice", avatarUrl: null, name: "가람" },
    { login: "bob", avatarUrl: null, name: "민수" },
  ];
  teamAssignees: WorkspaceTeamAssignees = {
    planning: [],
    design: [],
    frontend: [],
    backend: [],
  };
  memberFetchFailed = false;
  saveTeamAssigneesError: Error | null = null;
  getTeamAssigneesError: Error | null = null;
  assignIssueToSelfError: Error | null = null;

  writableRepositories: ProjectWritableRepository[] = [
    {
      key: "docs",
      label: "문서 저장소 (Acme-Org/acme-docs)",
      fullName: "Acme-Org/acme-docs",
      role: "docs",
    },
    {
      key: "web",
      label: "웹 앱 (Acme-Org/acme-web)",
      fullName: "Acme-Org/acme-web",
      role: "code",
    },
  ];

  readonly issueDetails = new Map<number, ProjectBoardIssueDetail>();
  private nextIssueNumber = 100;

  projectList: ResolvedGithubProject[] | Error = [
    {
      id: "PVT_kwDOFake",
      owner: "Mockly-Company",
      number: 1,
      title: "Mockly",
      scope: "organization",
    },
  ];

  /** 사이드바용 연결된 프로젝트 목록. 비어 있으면 None(로컬)만 표시. */
  linkedProjects: ResolvedGithubProject[] = [];

  /** 프로젝트별 보드. 있으면 get/sync가 activeProjectId 기준으로 반환한다. */
  readonly boardsByProjectId = new Map<string, ProjectBoard>();

  listTruncated = false;

  /** 프로젝트별 문서 저장소. setActiveProject가 돌려준다. */
  readonly docsRepositories = new Map<string, DocsRepositoryRef>();

  /** 마지막으로 연결·전환된 프로젝트 id. Org 스위처 뼈대용 상태. */
  activeProjectId: string | null = null;

  resolveResult: ResolvedGithubProject | Error = {
    id: "PVT_kwDOFake",
    owner: "Mockly-Company",
    number: 1,
    title: "Mockly Board",
    scope: "organization",
  };

  loadError: Error | null = null;

  constructor(public board: ProjectBoard = { issues: [], fetchedAt: null, skipped: 0, truncated: false }) {}

  static empty(): FakeProjectBoardGateway {
    return new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
  }

  static withIssues(issues: BoardIssue[], fetchedAt: string | null = null) {
    return new FakeProjectBoardGateway({ issues, fetchedAt, skipped: 0, truncated: false });
  }

  private boardResult:
    | ProjectBoard
    | { code: string; message: string; details?: Record<string, string> }
    | null = null;

  static unlinked(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_invalid",
      message: "GitHub Project가 연결되지 않았습니다.",
    };
    return gateway;
  }

  static missingWorkspace(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_missing",
      message: "워크스페이스가 연결되지 않았습니다.",
    };
    return gateway;
  }

  static corruptWorkspaceFile(): FakeProjectBoardGateway {
    const gateway = new FakeProjectBoardGateway({ issues: [], fetchedAt: null, skipped: 0, truncated: false });
    gateway.boardResult = {
      code: "workspace_invalid",
      message: "워크스페이스 파일을 읽을 수 없습니다.",
      details: { reason: "workspace_file_unreadable", path: ".okf/workspace.yml" },
    };
    return gateway;
  }

  async getProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "getProjectBoard" });
    if (this.loadError) {
      throw this.loadError;
    }
    if (this.activeProjectId) {
      const perProject = this.boardsByProjectId.get(this.activeProjectId);
      if (perProject) {
        return perProject;
      }
    }
    const current = this.boardResult ?? this.board;
    if ("code" in current) {
      throw current;
    }
    return current;
  }

  async syncProjectBoard(): Promise<ProjectBoard> {
    this.calls.push({ method: "syncProjectBoard" });
    if (this.loadError) {
      throw this.loadError;
    }
    if (this.activeProjectId) {
      const perProject = this.boardsByProjectId.get(this.activeProjectId);
      if (perProject) {
        return perProject;
      }
    }
    const current = this.boardResult ?? this.board;
    if ("code" in current) {
      throw current;
    }
    return current;
  }

  async resolveGithubProject(url: string): Promise<ResolvedGithubProject> {
    this.calls.push({ method: "resolveGithubProject", url });
    if (this.resolveResult instanceof Error) {
      throw this.resolveResult;
    }
    return this.resolveResult;
  }

  async listGithubProjects(owner?: string): Promise<ProjectList> {
    this.calls.push({ method: "listGithubProjects", owner });
    if (this.projectList instanceof Error) {
      throw this.projectList;
    }
    return { projects: this.projectList, truncated: this.listTruncated };
  }

  async listLinkedProjects(): Promise<ResolvedGithubProject[]> {
    this.calls.push({ method: "listLinkedProjects" });
    return [...this.linkedProjects];
  }

  async linkGithubProject(project: ResolvedGithubProject): Promise<void> {
    this.calls.push({ method: "linkGithubProject", project });
    this.activeProjectId = project.id;
    this.boardResult = this.board;
  }

  async setActiveProject(id: string): Promise<ActiveProjectResult> {
    this.calls.push({ method: "setActiveProject", id });
    this.activeProjectId = id;
    this.boardResult = this.board;
    return { docsRepository: this.docsRepositories.get(id) ?? null };
  }

  async unlinkGithubProject(id: string): Promise<void> {
    this.calls.push({ method: "unlinkGithubProject", id });
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
    }
  }

  async listWritableRepositories(): Promise<ProjectWritableRepository[]> {
    this.calls.push({ method: "listWritableRepositories" });
    return [...this.writableRepositories];
  }

  async getIssueDetail(
    issueNumber: number,
    repositoryFullName?: string | null,
  ): Promise<ProjectBoardIssueDetail> {
    this.calls.push({
      method: "getIssueDetail",
      issueNumber,
      repositoryFullName,
    });
    const preset = this.issueDetails.get(issueNumber);
    if (preset) {
      return preset;
    }
    const found = findIssueRecursive(this.board.issues, issueNumber);
    if (!found) {
      throw new Error(`이슈 #${issueNumber}을(를) 찾을 수 없습니다.`);
    }
    return {
      number: found.number,
      title: found.title,
      url: found.url,
      repositoryFullName: repositoryFullName ?? "Acme-Org/acme-web",
      layer: found.layer,
      status: found.status,
      kind: found.kind,
      priority: "P1",
      body: `## 완료 조건\n- [ ] ${found.title} 검증 통과`,
      dependsOn: found.dependsOn ?? null,
      predecessorDone: found.dependsOn == null,
      readyToStart:
        (found.status === "backlog" || found.status === "ready") &&
        found.dependsOn == null,
      subIssues: found.children.map((child) => ({
        number: child.number,
        title: child.title,
        url: child.url,
      })),
      linkedDocuments: [],
      linkedPullRequests: [],
      recommendedWorkingDir: null,
      priorityOptions: ["P0", "P1", "P2"],
      assignees: found.assignees ?? [],
      createdAt: found.createdAt ?? null,
      updatedAt: found.updatedAt ?? null,
    };
  }

  async createBoardIssues(
    items: CreateBoardIssueInput[],
  ): Promise<CreateBoardIssuesResult> {
    this.calls.push({ method: "createBoardIssues", items });
    const created: CreatedBoardIssueRef[] = [];
    const createdIssues: BoardIssue[] = [];

    for (const item of items) {
      const number = this.nextIssueNumber++;
      const repo =
        item.repositoryFullName?.trim() ||
        this.writableRepositories[0]?.fullName ||
        "Acme-Org/acme-docs";
      const url = `https://github.com/${repo}/issues/${number}`;
      const dependsOn =
        item.dependsOnBatchIndex != null
          ? created[item.dependsOnBatchIndex]?.number ?? null
          : item.dependsOn ?? null;
      const newIssue: BoardIssue = {
        number,
        title: item.title,
        url,
        layer: item.layer ?? "planning",
        status: item.status ?? "backlog",
        children: [],
        kind: item.kind ?? "작업",
        dependsOn,
      };
      created.push({
        number,
        title: item.title,
        url,
        repositoryFullName: repo,
      });
      createdIssues.push(newIssue);

      const parentNumber =
        item.parentBatchIndex != null
          ? created[item.parentBatchIndex]?.number ?? null
          : item.parentIssueNumber ?? null;

      if (parentNumber != null) {
        const attached = attachChildRecursive(
          createdIssues,
          this.board.issues,
          parentNumber,
          newIssue,
        );
        if (!attached) {
          this.board = {
            ...this.board,
            issues: [...this.board.issues, newIssue],
          };
        }
      } else {
        this.board = {
          ...this.board,
          issues: [...this.board.issues, newIssue],
        };
      }
    }

    return { created, board: this.board };
  }

  async updateBoardItem(request: UpdateBoardItemInput): Promise<ProjectBoard> {
    this.calls.push({ method: "updateBoardItem", request });
    const updateNodes = (nodes: BoardIssue[]): BoardIssue[] =>
      nodes.map((node) => {
        const updatedChildren =
          node.children.length > 0 ? updateNodes(node.children) : [];
        if (node.number !== request.issueNumber) {
          return updatedChildren === node.children
            ? node
            : { ...node, children: updatedChildren };
        }
        return {
          ...node,
          status: request.status ?? node.status,
          layer: request.layer ?? node.layer,
          kind: request.kind !== undefined ? request.kind : node.kind,
          children: updatedChildren,
        };
      });
    this.board = {
      ...this.board,
      issues: updateNodes(this.board.issues),
    };
    const existingDetail = this.issueDetails.get(request.issueNumber);
    if (existingDetail) {
      this.issueDetails.set(request.issueNumber, {
        ...existingDetail,
        status: request.status ?? existingDetail.status,
        layer: request.layer ?? existingDetail.layer,
        kind: request.kind !== undefined ? request.kind : existingDetail.kind,
        priority:
          request.priority !== undefined
            ? request.priority
            : existingDetail.priority,
      });
    }
    return this.board;
  }

  async getWorkspaceTeamAssignees(options?: {
    forceRefresh?: boolean;
  }): Promise<WorkspaceTeamAssigneesSnapshot> {
    this.calls.push({
      method: "getWorkspaceTeamAssignees",
      forceRefresh: options?.forceRefresh,
    });
    if (this.getTeamAssigneesError) {
      throw this.getTeamAssigneesError;
    }
    const known = new Set(this.teamMembers.map((m) => m.login.toLowerCase()));
    const allConfigured = [
      ...this.teamAssignees.planning,
      ...this.teamAssignees.design,
      ...this.teamAssignees.frontend,
      ...this.teamAssignees.backend,
    ];
    const staleLogins = Array.from(
      new Set(allConfigured.filter((login) => !known.has(login.toLowerCase()))),
    );
    return {
      viewerLogin: this.viewerLogin,
      docsRepositoryFullName: this.docsRepositoryFullName,
      canWriteDocsRepository: this.canWriteDocsRepository,
      members: this.teamMembers,
      assignees: {
        planning: [...this.teamAssignees.planning],
        design: [...this.teamAssignees.design],
        frontend: [...this.teamAssignees.frontend],
        backend: [...this.teamAssignees.backend],
      },
      staleLogins: this.memberFetchFailed && this.teamMembers.length === 0 ? [] : staleLogins,
      memberFetchFailed: this.memberFetchFailed,
      fetchedAt: "2026-11-15T00:00:00Z",
    };
  }

  async saveWorkspaceTeamAssignees(
    assignees: WorkspaceTeamAssignees,
  ): Promise<WorkspaceTeamAssigneesSnapshot> {
    this.calls.push({ method: "saveWorkspaceTeamAssignees", assignees });
    if (!this.canWriteDocsRepository || !this.docsRepositoryFullName) {
      throw new Error("문서 저장소 쓰기 권한이 필요합니다.");
    }
    if (this.saveTeamAssigneesError) {
      throw this.saveTeamAssigneesError;
    }
    this.teamAssignees = {
      planning: [...assignees.planning],
      design: [...assignees.design],
      frontend: [...assignees.frontend],
      backend: [...assignees.backend],
    };
    return this.getWorkspaceTeamAssignees();
  }

  async assignIssueToSelf(input: {
    issueNumber: number;
    repositoryFullName?: string | null;
  }): Promise<ProjectBoard> {
    this.calls.push({
      method: "assignIssueToSelf",
      issueNumber: input.issueNumber,
      repositoryFullName: input.repositoryFullName ?? null,
    });
    if (this.assignIssueToSelfError) {
      throw this.assignIssueToSelfError;
    }
    const login = this.viewerLogin ?? "alice";
    const matchedMember = this.teamMembers.find(
      (m) => m.login.toLowerCase() === login.toLowerCase(),
    );
    const selfAssignee: BoardAssignee = matchedMember ?? {
      login,
      avatarUrl: null,
      name: null,
    };
    const updateAssignees = (nodes: BoardIssue[]): BoardIssue[] =>
      nodes.map((node) => {
        const nextChildren =
          node.children.length > 0 ? updateAssignees(node.children) : [];
        if (node.number !== input.issueNumber) {
          return nextChildren === node.children
            ? node
            : { ...node, children: nextChildren };
        }
        const existing = node.assignees ?? [];
        const hasSelf = existing.some(
          (a) => a.login.toLowerCase() === login.toLowerCase(),
        );
        return {
          ...node,
          assignees: hasSelf ? existing : [...existing, selfAssignee],
          children: nextChildren,
        };
      });
    this.board = {
      ...this.board,
      issues: updateAssignees(this.board.issues),
    };
    const detail = this.issueDetails.get(input.issueNumber);
    if (detail) {
      const existing = detail.assignees ?? [];
      const hasSelf = existing.some(
        (a) => a.login.toLowerCase() === login.toLowerCase(),
      );
      this.issueDetails.set(input.issueNumber, {
        ...detail,
        assignees: hasSelf ? existing : [...existing, selfAssignee],
      });
    }
    return this.board;
  }
}

function findIssueRecursive(
  nodes: ReadonlyArray<BoardIssue>,
  issueNumber: number,
): BoardIssue | null {
  for (const node of nodes) {
    if (node.number === issueNumber) {
      return node;
    }
    if (node.children.length > 0) {
      const child = findIssueRecursive(node.children, issueNumber);
      if (child) {
        return child;
      }
    }
  }
  return null;
}

function attachChildRecursive(
  batchNodes: BoardIssue[],
  boardNodes: BoardIssue[],
  parentNumber: number,
  child: BoardIssue,
): boolean {
  for (const candidate of batchNodes) {
    if (candidate.number === parentNumber && candidate !== child) {
      candidate.children = [...candidate.children, child];
      return true;
    }
  }
  const walk = (list: BoardIssue[]): boolean => {
    for (const node of list) {
      if (node.number === parentNumber) {
        node.children = [...node.children, child];
        return true;
      }
      if (node.children.length > 0 && walk(node.children)) {
        return true;
      }
    }
    return false;
  };
  return walk(boardNodes);
}
