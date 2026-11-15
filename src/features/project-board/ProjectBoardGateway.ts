import type {
  BoardAssignee,
  BoardLayer,
  BoardStatus,
  ProjectBoard,
  ProjectList,
  ResolvedGithubProject,
} from "./model";
import type {
  CreateBoardIssueInput,
  ProjectWritableRepository,
} from "./backlogDerivation";

/** 프로젝트가 문서 저장소로 쓰는 GitHub 저장소. */
export interface DocsRepositoryRef {
  repositoryId: string;
  fullName: string;
}

/** 활성 프로젝트 전환 결과. 문서 저장소가 없으면 null이다. */
export interface ActiveProjectResult {
  docsRepository: DocsRepositoryRef | null;
}

export interface BoardSubIssueSummary {
  number: number;
  title: string;
  url: string;
}

export interface BoardLinkedDocument {
  path: string;
  hasCompanionHtml: boolean;
}

export interface BoardLinkedPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  repositoryFullName: string;
  isDraft: boolean;
}

export interface ProjectBoardIssueDetail {
  number: number;
  title: string;
  url: string;
  repositoryFullName: string | null;
  layer: BoardLayer;
  status: BoardStatus | null;
  kind: string | null;
  priority: string | null;
  body: string;
  dependsOn: number | null;
  predecessorDone: boolean;
  readyToStart: boolean;
  subIssues: BoardSubIssueSummary[];
  linkedDocuments: BoardLinkedDocument[];
  linkedPullRequests: BoardLinkedPullRequest[];
  recommendedWorkingDir: string | null;
  priorityOptions: string[];
  assignees?: BoardAssignee[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CreatedBoardIssueRef {
  number: number;
  title: string;
  url: string;
  repositoryFullName: string;
  projectItemId?: string;
}

export interface CreateBoardIssuesResult {
  created: CreatedBoardIssueRef[];
  board: ProjectBoard;
}

export interface UpdateBoardItemInput {
  issueNumber: number;
  repositoryFullName?: string | null;
  status?: BoardStatus;
  layer?: BoardLayer;
  kind?: string | null;
  priority?: string | null;
}

export interface ProjectBoardGateway {
  getProjectBoard(): Promise<ProjectBoard>;
  syncProjectBoard(): Promise<ProjectBoard>;
  resolveGithubProject(url: string): Promise<ResolvedGithubProject>;
  /** owner(Org 로그인)가 있으면 해당 소유자로 필터, 없으면 전체 목록. */
  listGithubProjects(owner?: string): Promise<ProjectList>;
  linkGithubProject(project: ResolvedGithubProject): Promise<void>;
  /** 연결된 프로젝트 중 활성 프로젝트를 바꾸고, 그 프로젝트의 문서 저장소를 알려 준다. */
  setActiveProject(id: string): Promise<ActiveProjectResult>;
  /** 연결된 프로젝트를 해제한다. 백엔드 lane 작업 중이라 optional. */
  unlinkGithubProject?(id: string): Promise<void>;
  /** 사이드바용 연결된 프로젝트 목록. 없으면 listGithubProjects 폴백. 실패 시 [] 취급. */
  listLinkedProjects?(): Promise<ResolvedGithubProject[]>;
  /** 활성 프로젝트/워크스페이스가 이슈를 생성할 수 있는 동적 저장소 목록(문서 저장소 + 코드 저장소). */
  listWritableRepositories?(): Promise<ProjectWritableRepository[]>;
  /** 보드 이슈 상세 조회(본문, 연결 문서/PR, Sub-issues, Priority 옵션 포함). */
  getIssueDetail?(
    issueNumber: number,
    repositoryFullName?: string | null,
  ): Promise<ProjectBoardIssueDetail>;
  /** 단건 또는 계층형 배치(Epic + Sub-issues + 선행 체인) 이슈 생성 후 최신 보드 반환. */
  createBoardIssues?(
    items: CreateBoardIssueInput[],
  ): Promise<CreateBoardIssuesResult>;
  /** 보드 카드 Status·영역·타입·Priority 변경 후 최신 보드 반환. */
  updateBoardItem?(request: UpdateBoardItemInput): Promise<ProjectBoard>;
}
