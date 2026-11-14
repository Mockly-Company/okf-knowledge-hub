import type { BoardLayer, BoardStatus } from "./model";

export interface ProjectWritableRepository {
  key: string;
  label: string;
  fullName: string;
  role: "docs" | "code" | string;
}

export interface CreateBoardIssueInput {
  repositoryFullName?: string | null;
  title: string;
  body: string;
  layer?: BoardLayer;
  status?: BoardStatus;
  kind?: string | null;
  priority?: string | null;
  parentIssueNumber?: number | null;
  parentIssueRepository?: string | null;
  parentBatchIndex?: number | null;
  dependsOn?: number | null;
  dependsOnBatchIndex?: number | null;
}

export function stripLayerPrefix(title: string): string {
  return title
    .trim()
    .replace(/^\[(Epic|기획|디자인|백엔드|프론트엔드|프론트)\]\s*/i, "")
    .trim();
}

export function pickDefaultRepository(
  repositories: ReadonlyArray<ProjectWritableRepository>,
  preferredRole: "docs" | "code",
  fallbackFullName?: string | null,
): string | undefined {
  const matched = repositories.find((repo) => repo.role === preferredRole);
  if (matched) {
    return matched.fullName;
  }
  if (fallbackFullName && fallbackFullName.trim().length > 0) {
    return fallbackFullName.trim();
  }
  return repositories[0]?.fullName;
}

export interface BuildEpicStarterOptions {
  epicTitle: string;
  epicBody?: string;
  documentPath?: string | null;
  priority?: string | null;
  repositories: ReadonlyArray<ProjectWritableRepository>;
}

export function buildEpicStarterDrafts(
  options: BuildEpicStarterOptions,
): CreateBoardIssueInput[] {
  const coreTitle = stripLayerPrefix(options.epicTitle) || "신규 기능";
  const docsRepo = pickDefaultRepository(options.repositories, "docs");
  const codeRepo = pickDefaultRepository(
    options.repositories,
    "code",
    docsRepo,
  );
  const docLine = options.documentPath?.trim()
    ? `\n\n## 참조 문서\n- \`${options.documentPath.trim()}\` (AI 정본 \`.md\` / 사람용 \`.html\`)`
    : "";
  const summarySection = options.epicBody?.trim()
    ? `## 배경 및 목표\n${options.epicBody.trim()}`
    : `## 배경 및 목표\n- ${coreTitle}의 상위 기획·디자인을 확정하고 구현 백로그로 연결합니다.`;

  return [
    {
      repositoryFullName: docsRepo,
      title: `[Epic] ${coreTitle}`,
      body: `${summarySection}${docLine}\n\n## 완료 조건\n- [ ] [기획] 명세 확정 및 PR 승인 완료\n- [ ] [디자인] 화면·인터랙션 기준 확정\n- [ ] 하위 [백엔드]·[프론트엔드] 구현 완료`,
      layer: "planning",
      status: "backlog",
      kind: "기능",
      priority: options.priority ?? null,
    },
    {
      repositoryFullName: docsRepo,
      title: `[기획] ${coreTitle} 상세 명세 확정`,
      body: `## 작업 내용\n- \`${options.documentPath?.trim() || "docs/..."}\` 기준 요구사항·정책·예외 케이스를 확정하고 사람용 \`.html\` 뷰를 함께 갱신합니다.${docLine}\n\n## 완료 조건\n- [ ] \`.md\` 정본 및 \`.html\` 사람용 문서 업데이트\n- [ ] 변경 하이라이트(\`[NEW]\`/\`[CHANGED]\`) 반영 및 기획 PR 승인`,
      layer: "planning",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
    },
    {
      repositoryFullName: codeRepo,
      title: `[디자인] ${coreTitle} 화면·인터랙션 설계`,
      body: `## 작업 내용\n- 확정된 기획 명세를 바탕으로 UI 상태(로딩·빈 화면·오류·성공)와 컴포넌트 구성을 정의합니다.${docLine}\n\n## 완료 조건\n- [ ] 주요 사용자 흐름 및 상태별 UI 명세 확정\n- [ ] 프론트엔드 구현 백로그 연결 준비`,
      layer: "design",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    },
  ];
}

export interface BuildCascadingSubIssuesOptions {
  sourceIssueNumber: number;
  sourceTitle: string;
  sourceLayer: BoardLayer;
  sourceRepositoryFullName?: string | null;
  priority?: string | null;
  documentPath?: string | null;
  repositories: ReadonlyArray<ProjectWritableRepository>;
}

export function buildCascadingSubIssuesFromIssue(
  options: BuildCascadingSubIssuesOptions,
): CreateBoardIssueInput[] {
  const coreTitle = stripLayerPrefix(options.sourceTitle) || `이슈 #${options.sourceIssueNumber}`;
  const codeRepo = pickDefaultRepository(
    options.repositories,
    "code",
    options.sourceRepositoryFullName,
  );
  const docRef = options.documentPath?.trim()
    ? `\n- 참조 문서: \`${options.documentPath.trim()}\``
    : "";

  if (options.sourceLayer === "planning") {
    return [
      {
        repositoryFullName: codeRepo,
        title: `[백엔드] ${coreTitle} 도메인·API 구현`,
        body: `## 상위 기획\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 도메인 모델·저장소·커맨드/API 구현\n- [ ] 단위/통합 테스트 통과`,
        layer: "backend",
        status: "backlog",
        kind: "작업",
        priority: options.priority ?? null,
        parentIssueNumber: options.sourceIssueNumber,
        parentIssueRepository: options.sourceRepositoryFullName ?? null,
        dependsOn: options.sourceIssueNumber,
      },
      {
        repositoryFullName: codeRepo,
        title: `[프론트엔드] ${coreTitle} UI·상태 연동 구현`,
        body: `## 상위 기획\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 화면·상호작용 및 상태 연동 구현\n- [ ] 테스트 및 접근성 검증 통과`,
        layer: "frontend",
        status: "backlog",
        kind: "작업",
        priority: options.priority ?? null,
        parentIssueNumber: options.sourceIssueNumber,
        parentIssueRepository: options.sourceRepositoryFullName ?? null,
        dependsOnBatchIndex: 0,
      },
    ];
  }

  if (options.sourceLayer === "design") {
    return [
      {
        repositoryFullName: codeRepo,
        title: `[프론트엔드] ${coreTitle} 화면·컴포넌트 구현`,
        body: `## 상위 디자인\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 디자인 시안 및 상태별 UI 컴포넌트 구현\n- [ ] 테스트 및 Storybook 검증 통과`,
        layer: "frontend",
        status: "backlog",
        kind: "작업",
        priority: options.priority ?? null,
        parentIssueNumber: options.sourceIssueNumber,
        parentIssueRepository: options.sourceRepositoryFullName ?? null,
        dependsOn: options.sourceIssueNumber,
      },
    ];
  }

  return [];
}

export interface BuildDocumentBacklogOptions {
  documentTitle: string;
  documentPath: string;
  markdown?: string;
  mode: "implementation" | "upper";
  priority?: string | null;
  repositories: ReadonlyArray<ProjectWritableRepository>;
}

function summarizeMarkdownLead(markdown?: string): string {
  if (!markdown) {
    return "";
  }
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("```") &&
        !line.startsWith("---"),
    );
  return lines.slice(0, 2).join(" ");
}

export function buildDocumentBacklogDrafts(
  options: BuildDocumentBacklogOptions,
): CreateBoardIssueInput[] {
  const cleanTitle = stripLayerPrefix(options.documentTitle) || options.documentPath;
  const lead = summarizeMarkdownLead(options.markdown);

  if (options.mode === "upper") {
    return buildEpicStarterDrafts({
      epicTitle: cleanTitle,
      epicBody: lead,
      documentPath: options.documentPath,
      priority: options.priority,
      repositories: options.repositories,
    });
  }

  const docsRepo = pickDefaultRepository(options.repositories, "docs");
  const codeRepo = pickDefaultRepository(options.repositories, "code", docsRepo);
  const docSection = `## 기준 명세 문서\n- \`${options.documentPath}\`${lead ? `\n- 요약: ${lead}` : ""}`;

  return [
    {
      repositoryFullName: docsRepo,
      title: `[Epic] ${cleanTitle}`,
      body: `${docSection}\n\n## 완료 조건\n- [ ] [백엔드] 핵심 로직·API 구현 완료\n- [ ] [프론트엔드] UI·상태 연동 완료`,
      layer: "planning",
      status: "backlog",
      kind: "기능",
      priority: options.priority ?? null,
    },
    {
      repositoryFullName: codeRepo,
      title: `[백엔드] ${cleanTitle} 도메인·API 구현`,
      body: `${docSection}\n\n## 완료 조건\n- [ ] \`${options.documentPath}\` 명세 기준 백엔드 도메인·커맨드 구현\n- [ ] 테스트 통과`,
      layer: "backend",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
    },
    {
      repositoryFullName: codeRepo,
      title: `[프론트엔드] ${cleanTitle} UI·상태 연동 구현`,
      body: `${docSection}\n\n## 완료 조건\n- [ ] \`${options.documentPath}\` 명세 기준 화면·인터랙션 구현\n- [ ] 테스트 및 빌드 통과`,
      layer: "frontend",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    },
  ];
}
