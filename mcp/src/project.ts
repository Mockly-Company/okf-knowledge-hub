import { ghGraphql, ghJson, type GhRunner } from "./gh.js";

export interface SingleSelectField {
  fieldId: string;
  options: Map<string, string>;
}

const PROJECT_FIELDS_QUERY = `query($login:String!,$number:Int!,$after:String,$isOrg:Boolean!){
  organization(login:$login) @include(if:$isOrg) {
    projectV2(number:$number) { ...ProjectFields }
  }
  user(login:$login) @skip(if:$isOrg) {
    projectV2(number:$number) { ...ProjectFields }
  }
}
fragment ProjectFields on ProjectV2 {
  fields(first:30) {
    nodes {
      __typename
      ... on ProjectV2SingleSelectField { id name options { id name } }
      ... on ProjectV2IterationField {
        id
        configuration { iterations { id title } }
      }
    }
  }
}`;

interface ProjectFieldsResponse {
  data?: {
    organization?: { projectV2?: { fields?: { nodes?: unknown[] } } | null } | null;
    user?: { projectV2?: { fields?: { nodes?: unknown[] } | null } | null };
  } | null;
  errors?: Array<{ message?: string; type?: string }>;
}

interface SingleSelectNode {
  __typename?: string;
  id?: string;
  name?: string;
  options?: Array<{ id?: string; name?: string }>;
}

export async function getSingleSelectField(
  run: GhRunner,
  owner: string,
  projectNumber: number,
  isOrganization: boolean,
  fieldName: string,
): Promise<SingleSelectField> {
  const body = await ghGraphql<ProjectFieldsResponse>(run, PROJECT_FIELDS_QUERY, {
    login: owner,
    number: projectNumber,
    isOrg: isOrganization,
  });
  if (body.errors?.length) {
    throw new Error(
      `GitHub Project 필드를 읽지 못했습니다: ${body.errors[0]?.message ?? "unknown error"}`,
    );
  }
  const nodes = isOrganization
    ? body.data?.organization?.projectV2?.fields?.nodes
    : body.data?.user?.projectV2?.fields?.nodes;
  if (!nodes) {
    throw new Error("GitHub Project를 찾을 수 없습니다.");
  }
  for (const node of nodes) {
    const field = node as SingleSelectNode;
    if (
      field?.__typename === "ProjectV2SingleSelectField" &&
      field.name === fieldName
    ) {
      const options = new Map<string, string>();
      for (const option of field.options ?? []) {
        if (option?.id && option?.name) {
          options.set(option.name, option.id);
        }
      }
      if (!field.id) {
        break;
      }
      return { fieldId: field.id, options };
    }
  }
  throw new Error(`Project 필드 '${fieldName}'를 찾을 수 없습니다.`);
}

export async function setSingleSelectField(
  run: GhRunner,
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  await ghGraphql<{ data?: unknown; errors?: Array<{ message?: string }> }>(
    run,
    `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}`,
    { p: projectId, i: itemId, f: fieldId, o: optionId },
  );
}

export async function getIssueNodeId(
  run: GhRunner,
  owner: string,
  repo: string,
  number: number,
): Promise<string> {
  const body = await ghGraphql<{
    data?: { repository?: { issue?: { id?: string } | null } | null };
    errors?: Array<{ message?: string }>;
  }>(
    run,
    `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}`,
    { o: owner, r: repo, n: number },
  );
  const id = body.data?.repository?.issue?.id;
  if (!id) {
    throw new Error(`이슈 #${number}(${owner}/${repo})를 찾을 수 없습니다.`);
  }
  return id;
}

export async function addSubIssue(
  run: GhRunner,
  parentIssueId: string,
  childIssueId: string,
): Promise<void> {
  const body = await ghGraphql<{ data?: unknown; errors?: Array<{ message?: string }> }>(
    run,
    `mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{id}subIssue{id}}}`,
    { p: parentIssueId, c: childIssueId },
  );
  if (body.errors?.length) {
    throw new Error(`하위 이슈 연결에 실패했습니다: ${body.errors[0]?.message ?? "unknown error"}`);
  }
}

export async function addItemToProject(
  run: GhRunner,
  projectId: string,
  contentId: string,
): Promise<string> {
  const body = await ghGraphql<{
    data?: { addProjectV2ItemById?: { item?: { id?: string } | null } | null };
    errors?: Array<{ message?: string }>;
  }>(
    run,
    `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
    { p: projectId, c: contentId },
  );
  const itemId = body.data?.addProjectV2ItemById?.item?.id;
  if (body.errors?.length || !itemId) {
    throw new Error(
      `Project에 항목을 추가하지 못했습니다: ${body.errors?.[0]?.message ?? "unknown error"}`,
    );
  }
  return itemId;
}

export async function parseRepoFullName(fullName: string): Promise<{ owner: string; repo: string }> {
  const [owner, ...rest] = fullName.split("/");
  const repo = rest.join("/");
  if (!owner || !repo) {
    throw new Error(`저장소 이름 형식을 확인하세요: ${fullName} (예: Mockly-Company/mockly-server)`);
  }
  return { owner, repo };
}

export async function parseIssueUrl(url: string): Promise<{ owner: string; repo: string; number: number }> {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/);
  if (!match) {
    throw new Error(`Issue URL 형식을 확인하세요: ${url}`);
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
