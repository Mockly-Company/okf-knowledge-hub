import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ghGraphql, ghJson, type GhRunner } from "../gh.js";
import {
  addItemToProject,
  addSubIssue,
  getIssueNodeId,
  getSingleSelectField,
  parseIssueUrl,
  parseRepoFullName,
  setSingleSelectField,
} from "../project.js";
import type { WorkspaceConfig } from "../workspace.js";

interface ResolvedProject {
  id: string;
  owner: string;
  number: number;
  title: string;
}

const AREA_VALUES = ["기획", "디자인", "프론트엔드", "프론트", "백엔드"] as const;
const KIND_VALUES = ["기능", "작업"] as const;

async function resolveProjectForWrite(
  run: GhRunner,
  config: WorkspaceConfig,
): Promise<{ summary: ResolvedProject; isOrganization: boolean }> {
  const orgQuery = `query($l:String!,$n:Int!){organization(login:$l){projectV2(number:$n){id title}}}`;
  const orgResult = await ghGraphql<{
    data?: { organization?: { projectV2?: { id?: string; title?: string } | null } | null };
    errors?: Array<{ message?: string; type?: string }>;
  }>(run, orgQuery, { login: config.project!.owner, number: config.project!.number }).catch(() => null);
  const orgProject = orgResult?.data?.organization?.projectV2;
  if (orgProject?.id) {
    return {
      summary: {
        id: orgProject.id,
        owner: config.project!.owner,
        number: config.project!.number,
        title: orgProject.title ?? "",
      },
      isOrganization: true,
    };
  }
  const userQuery = orgQuery.replace(/organization\(login:\$l\)/g, "user(login:$l)");
  const userResult = await ghGraphql<{
    data?: { user?: { projectV2?: { id?: string; title?: string } | null } | null };
    errors?: Array<{ message?: string }>;
  }>(run, userQuery, { login: config.project!.owner, number: config.project!.number }).catch(() => null);
  const userProject = userResult?.data?.user?.projectV2;
  if (userProject?.id) {
    return {
      summary: {
        id: userProject.id,
        owner: config.project!.owner,
        number: config.project!.number,
        title: userProject.title ?? "",
      },
      isOrganization: false,
    };
  }
  throw new Error(
    "GitHub Project를 찾을 수 없습니다. 번호와 App의 Projects 읽기 권한을 확인하세요.",
  );
}

interface CreatedIssue {
  number: number;
  url: string;
}

async function openIssue(
  run: GhRunner,
  repo: string,
  title: string,
  body: string,
  milestone?: string,
): Promise<CreatedIssue> {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--body",
    body,
    "--json",
    "number,url",
  ];
  if (milestone) {
    args.push("--milestone", milestone);
  }
  return ghJson<CreatedIssue>(run, args);
}

export function registerIssueTools(
  server: McpServer,
  getConfig: () => Promise<WorkspaceConfig>,
  runGh: GhRunner,
): void {
  server.registerTool(
    "get_issue",
    {
      description:
        "GitHub Issue/PR 한 건의 제목, 본문, 라벨, 마일스톤, 상태를 조회한다.",
      inputSchema: {
        repo: z.string().describe("저장소 full name (예: Mockly-Company/mockly-server)"),
        number: z.number().describe("이슈 번호"),
      },
    },
    async ({ repo, number }) => {
      const { owner, repo: name } = await parseRepoFullName(repo);
      const detail = await ghJson<Record<string, unknown>>(runGh, [
        "issue",
        "view",
        String(number),
        "--repo",
        `${owner}/${name}`,
        "--json",
        "number,title,body,labels,milestone,state,url,assignees",
      ]);
      return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
    },
  );

  server.registerTool(
    "create_issue",
    {
      description:
        "형식에 맞춰 GitHub Issue를 만든다. 영역(기획/디자인/프론트엔드/백엔드)과 종류(기능/작업)는 필수이며, Project 보드에 자동 등록되고 상태 Backlog, 영역, 종류가 세팅된다. parent_url을 주면 해당 이슈의 하위 항목으로 연결된다.",
      inputSchema: {
        repo: z.string().describe("저장소 full name (예: Mockly-Company/mockly-server)"),
        title: z.string().describe("이슈 제목"),
        body: z.string().describe("이슈 본문 (목적, 완료 조건 포함 권장)"),
        area: z.enum(AREA_VALUES).describe("영역: 기획, 디자인, 프론트엔드, 백엔드"),
        kind: z.enum(KIND_VALUES).describe("종류: 기능(스토리) 또는 작업(태스크)"),
        milestone: z.string().optional().describe("마일스톤 이름 (예: v1.4.0)"),
        parent_url: z.string().optional().describe("상위 이슈 URL (하위 항목으로 연결)"),
      },
    },
    async ({ repo, title, body, area, kind, milestone, parent_url }) => {
      const config = await getConfig();
      if (!config.project) {
        throw new Error(
          "GitHub Project가 연결되지 않았습니다. .okf/workspace.yml의 github.project를 확인하세요.",
        );
      }
      const created = await openIssue(runGh, repo, title, `${body}\n\n<!-- okhub:area=${area} kind=${kind} -->`, milestone).catch(
        async (error: unknown) => {
          if (
            error instanceof Error &&
            /milestone/i.test(error.message)
          ) {
            return openIssue(runGh, repo, title, body);
          }
          throw error;
        },
      );
      const { owner: repoOwner, repo: repoName } = await parseRepoFullName(repo);
      const { summary, isOrganization } = await resolveProjectForWrite(runGh, config);
      const itemId = await addItemToProject(
        runGh,
        summary.id,
        await getIssueNodeId(runGh, repoOwner, repoName, created.number),
      );
      const statusField = await getSingleSelectField(runGh, config.project.owner, config.project.number, isOrganization, "Status");
      const areaField = await getSingleSelectField(runGh, config.project.owner, config.project.number, isOrganization, "영역");
      const kindField = await getSingleSelectField(runGh, config.project.owner, config.project.number, isOrganization, "타입");
      const statusOption = statusField.options.get("Backlog");
      if (!statusOption) {
        throw new Error("Project에 Backlog 상태가 없습니다.");
      }
      await setSingleSelectField(runGh, summary.id, itemId, statusField.fieldId, statusOption);
      const areaNames = area === "프론트엔드" ? ["프론트", "프론트엔드", area] : [area];
      const areaOption = areaNames.map((name) => areaField.options.get(name)).find((id) => id !== undefined);
      if (areaOption) {
        await setSingleSelectField(runGh, summary.id, itemId, areaField.fieldId, areaOption);
      }
      const kindValue = kind === "기능" ? "기능" : "작업";
      const kindOption = kindField.options.get(kindValue);
      if (kindOption) {
        await setSingleSelectField(runGh, summary.id, itemId, kindField.fieldId, kindOption);
      }
      let parentNote = "";
      if (parent_url) {
        const parent = await parseIssueUrl(parent_url);
        const parentId = await getIssueNodeId(runGh, parent.owner, parent.repo, parent.number);
        const childId = await getIssueNodeId(runGh, repoOwner, repoName, created.number);
        await addSubIssue(runGh, parentId, childId);
        parentNote = `\n상위 이슈 #${parent.number}의 하위 항목으로 연결됨.`;
      }
      const lines = [
        `이슈를 만들었다: #${created.number} ${created.url}`,
        `영역=${area}, 종류=${kind}, 상태=Backlog${milestone ? `, 마일스톤=${milestone}` : ""}${parentNote}`,
        "Project 보드 새로고침을 하면 보인다.",
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
