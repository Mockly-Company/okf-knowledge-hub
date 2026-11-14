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
  screenSpecPath?: string | null;
  priority?: string | null;
  /** 기획·디자인 백로그와 함께 개발자용([백엔드]·[프론트엔드]) 백로그까지 한 번에 출제할지 여부. */
  includeDeveloperBacklog?: boolean;
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
  const prdPath = options.documentPath?.trim() || "";
  const screenPath = options.screenSpecPath?.trim() || "";
  const docLines = [
    prdPath ? `- PRD / 기획서: \`${prdPath}\` (\`.md\` 정본 + \`.html\` 사람용 뷰)` : "",
    screenPath
      ? `- 화면명세서: \`${screenPath}\` (\`.md\` 정본 + \`.html\` 사람용 뷰)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const docSection = docLines ? `\n\n## 산출 문서\n${docLines}` : "";
  const summarySection = options.epicBody?.trim()
    ? `## 아이디어 및 목표\n${options.epicBody.trim()}`
    : `## 아이디어 및 목표\n- ${coreTitle} 아이디어를 PRD·화면명세서로 구체화하고 기획자·디자이너·개발자 백로그를 연결합니다.`;

  const drafts: CreateBoardIssueInput[] = [
    {
      repositoryFullName: docsRepo,
      title: `[Epic] ${coreTitle}`,
      body: `${summarySection}${docSection}\n\n## 완료 조건 (OkHub 수행 경계)\n- [ ] [기획] PRD·기획 문서(\`.md\`+\`.html\`) 작성 및 PR 승인 (OkHub 자율 수행)\n- [ ] [디자인] 화면명세서·인터랙션 명세(\`.md\`+\`.html\`) 작성 및 PR 승인 (OkHub 자율 수행)\n- [ ] [백엔드]·[프론트엔드] 개발자 핸드오프 백로그 정리 완료 (코드 구현은 개발 환경에서 수행)`,
      layer: "planning",
      status: "backlog",
      kind: "기능",
      priority: options.priority ?? null,
    },
    {
      repositoryFullName: docsRepo,
      title: `[기획] ${coreTitle} PRD·상세 기획서 작성`,
      body: `## 작업 내용 (OkHub 문서화 대상)\n- 아이디어를 바탕으로 \`${prdPath || "docs/product/...md"}\` PRD(목표·범위·사용자 흐름·예외 정책) 정본과 사람용 \`.html\` 뷰를 작성합니다.${docSection}\n\n## 완료 조건\n- [ ] PRD \`.md\` 정본 및 \`.html\` 사람용 문서 2벌 작성\n- [ ] 변경 하이라이트(\`[NEW]\`/\`[CHANGED]\`) 반영 및 문서 저장소 PR 제출`,
      layer: "planning",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
    },
    {
      repositoryFullName: docsRepo,
      title: `[디자인] ${coreTitle} 화면명세서·인터랙션 설계 문서 작성`,
      body: `## 작업 내용 (OkHub 문서화 대상)\n- 확정된 PRD를 바탕으로 \`${screenPath || "docs/product/...-screen-spec.md"}\` 화면명세서(화면 구성·상태별 UI[로딩/빈 화면/오류/성공]·인터랙션 흐름) 정본과 사람용 \`.html\` 뷰를 작성합니다.${docSection}\n\n## 완료 조건\n- [ ] 화면명세서 \`.md\` 정본 및 \`.html\` 사람용 문서 2벌 작성\n- [ ] 개발자용 프론트엔드 백로그에 화면명세서 링크 및 완료 조건 반영`,
      layer: "design",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    },
  ];

  if (options.includeDeveloperBacklog) {
    drafts.push(
      {
        repositoryFullName: codeRepo,
        title: `[백엔드] ${coreTitle} 도메인·API 구현`,
        body: `## 개발자 핸드오프 백로그 (OkHub 코드 구현 비수행)\n- 확정된 PRD를 기준으로 백엔드 도메인 모델·API 계약을 구현합니다.${docSection}\n\n## 완료 조건\n- [ ] PRD 명세 기준 도메인·API 구현 및 테스트 통과`,
        layer: "backend",
        status: "backlog",
        kind: "작업",
        priority: options.priority ?? null,
        parentBatchIndex: 0,
        dependsOnBatchIndex: 1,
      },
      {
        repositoryFullName: codeRepo,
        title: `[프론트엔드] ${coreTitle} 화면·상태 연동 구현`,
        body: `## 개발자 핸드오프 백로그 (OkHub 코드 구현 비수행)\n- 확정된 PRD·화면명세서 및 선행 백엔드 API를 기준으로 화면과 인터랙션을 구현합니다.${docSection}\n\n## 완료 조건\n- [ ] 화면명세서 기준 UI·상태별 처리 및 테스트 통과`,
        layer: "frontend",
        status: "backlog",
        kind: "작업",
        priority: options.priority ?? null,
        parentBatchIndex: 0,
        dependsOnBatchIndex: 2,
      },
    );
  }

  return drafts;
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
  const coreTitle =
    stripLayerPrefix(options.sourceTitle) || `이슈 #${options.sourceIssueNumber}`;
  const codeRepo = pickDefaultRepository(
    options.repositories,
    "code",
    options.sourceRepositoryFullName,
  );
  const docRef = options.documentPath?.trim()
    ? `\n- 기준 문서(PRD/화면명세서): \`${options.documentPath.trim()}\``
    : "";

  if (options.sourceLayer === "planning") {
    return [
      {
        repositoryFullName: codeRepo,
        title: `[백엔드] ${coreTitle} 도메인·API 구현`,
        body: `## 상위 기획 (개발자 핸드오프 백로그 — OkHub 비수행)\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 확정 PRD 기준 도메인 모델·저장소·API 구현\n- [ ] 단위/통합 테스트 통과`,
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
        body: `## 상위 기획 (개발자 핸드오프 백로그 — OkHub 비수행)\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 확정 PRD·화면명세서 기준 화면·상호작용 구현\n- [ ] 테스트 및 접근성 검증 통과`,
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
        body: `## 상위 디자인 화면명세서 (개발자 핸드오프 백로그 — OkHub 비수행)\n- 상위 이슈: #${options.sourceIssueNumber}${docRef}\n\n## 완료 조건\n- [ ] 화면명세서 상태별 UI 컴포넌트 및 인터랙션 구현\n- [ ] 테스트 및 Storybook 검증 통과`,
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
      includeDeveloperBacklog: true,
      repositories: options.repositories,
    });
  }

  const docsRepo = pickDefaultRepository(options.repositories, "docs");
  const codeRepo = pickDefaultRepository(options.repositories, "code", docsRepo);
  const docSection = `## 기준 명세 문서 (PRD / 화면명세서)\n- \`${options.documentPath}\`${lead ? `\n- 요약: ${lead}` : ""}`;

  return [
    {
      repositoryFullName: docsRepo,
      title: `[Epic] ${cleanTitle}`,
      body: `${docSection}\n\n## 완료 조건\n- [ ] [백엔드] 핵심 로직·API 구현 완료 (개발자 핸드오프)\n- [ ] [프론트엔드] UI·상태 연동 완료 (개발자 핸드오프)`,
      layer: "planning",
      status: "backlog",
      kind: "기능",
      priority: options.priority ?? null,
    },
    {
      repositoryFullName: codeRepo,
      title: `[백엔드] ${cleanTitle} 도메인·API 구현`,
      body: `${docSection}\n\n> 개발자 핸드오프 백로그 (OkHub에서는 코드 구현을 수행하지 않습니다.)\n\n## 완료 조건\n- [ ] \`${options.documentPath}\` 명세 기준 백엔드 도메인·API 구현\n- [ ] 테스트 통과`,
      layer: "backend",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
    },
    {
      repositoryFullName: codeRepo,
      title: `[프론트엔드] ${cleanTitle} UI·상태 연동 구현`,
      body: `${docSection}\n\n> 개발자 핸드오프 백로그 (OkHub에서는 코드 구현을 수행하지 않습니다.)\n\n## 완료 조건\n- [ ] \`${options.documentPath}\` 명세 기준 화면·인터랙션 구현\n- [ ] 테스트 및 빌드 통과`,
      layer: "frontend",
      status: "backlog",
      kind: "작업",
      priority: options.priority ?? null,
      parentBatchIndex: 0,
      dependsOnBatchIndex: 1,
    },
  ];
}
