import { ghGraphql, type GhRunner } from "./gh.js";

export type BoardLayer =
  | "planning"
  | "design"
  | "frontend"
  | "backend"
  | "unassigned";

export type BoardStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done";

export interface BoardChild {
  number: number;
  title: string;
  url: string;
}

export interface BoardIssue {
  number: number;
  title: string;
  url: string;
  repository: string;
  layer: BoardLayer;
  status: BoardStatus;
  kind: string | null;
  area: string | null;
  milestone: string | null;
  iteration: string | null;
  children: BoardIssue[];
  parentUrl: string | null;
}

export const LAYER_LABELS: Record<Exclude<BoardLayer, "unassigned">, string> = {
  planning: "layer:planning",
  design: "layer:design",
  frontend: "layer:frontend",
  backend: "layer:backend",
};

const STATUS_BY_NAME: Record<string, BoardStatus> = {
  Backlog: "backlog",
  Ready: "ready",
  "In progress": "in_progress",
  "In review": "in_review",
  Done: "done",
};

export function mapLayer(area: string | null, labels: string[]): BoardLayer {
  if (area) {
    const normalized = area.trim();
    if (normalized === "기획") {
      return "planning";
    }
    if (normalized === "디자인") {
      return "design";
    }
    if (normalized === "프론트엔드" || normalized === "프론트") {
      return "frontend";
    }
    if (normalized === "백엔드") {
      return "backend";
    }
  }
  for (const label of labels) {
    const entry = (Object.entries(LAYER_LABELS) as Array<[BoardLayer, string]>).find(
      ([, value]) => value.toLowerCase() === label.trim().toLowerCase(),
    );
    if (entry) {
      return entry[0];
    }
  }
  return "unassigned";
}

export function mapStatus(status: string | null): BoardStatus {
  if (status && STATUS_BY_NAME[status]) {
    return STATUS_BY_NAME[status];
  }
  return "backlog";
}

interface ProjectItemNode {
  content?: {
    __typename?: string;
    number?: number;
    title?: string;
    url?: string;
    repository?: { nameWithOwner?: string };
    labels?: { nodes?: Array<{ name?: string }> };
    subIssues?: { nodes?: Array<{ number?: number; title?: string; url?: string } | null> | null };
  } | null;
  fieldValues?: {
    nodes?: Array<{
      __typename?: string;
      name?: string | null;
      field?: { name?: string } | null;
    } | null> | null;
  } | null;
}

interface ProjectItemsResponse {
  data?: {
    organization?: { projectV2?: { items?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<ProjectItemNode | null> | null } | null } | null };
    user?: { projectV2?: { items?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<ProjectItemNode | null> | null } | null } | null };
  } | null;
  errors?: Array<{ message?: string; type?: string }>;
}

const ITEMS_QUERY = `query($login:String!,$number:Int!,$after:String,$isOrg:Boolean!){
  organization(login:$login) @include(if:$isOrg) {
    projectV2(number:$number) {
      items(first:100,after:$after) {
        pageInfo{hasNextPage endCursor}
        nodes {
          content {
            __typename
            ... on Issue { number title url repository { nameWithOwner } labels(first:20){nodes{name}} subIssues(first:20){nodes{number title url}} }
            ... on PullRequest { number title url repository { nameWithOwner } labels(first:20){nodes{name}} }
            ... on DraftIssue { title }
          }
          fieldValues(first:30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
              ... on ProjectV2ItemFieldMilestoneValue { milestone { title } }
              ... on ProjectV2ItemFieldIterationValue { title }
            }
          }
        }
      }
    }
  }
  user(login:$login) @skip(if:$isOrg) {
    projectV2(number:$number) {
      items(first:100,after:$after) {
        pageInfo{hasNextPage endCursor}
        nodes {
          content {
            __typename
            ... on Issue { number title url repository { nameWithOwner } labels(first:20){nodes{name}} subIssues(first:20){nodes{number title url}} }
            ... on PullRequest { number title url repository { nameWithOwner } labels(first:20){nodes{name}} }
            ... on DraftIssue { title }
          }
          fieldValues(first:30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
              ... on ProjectV2ItemFieldMilestoneValue { milestone { title } }
              ... on ProjectV2ItemFieldIterationValue { title }
            }
          }
        }
      }
    }
  }
}`;

export interface RawItem {
  kind: string;
  number: number;
  title: string;
  url: string;
  repository: string;
  labels: string[];
  status: string | null;
  area: string | null;
  kindValue: string | null;
  milestone: string | null;
  iteration: string | null;
  subIssues: BoardChild[];
}

export async function listProjectItems(
  run: GhRunner,
  owner: string,
  projectNumber: number,
  isOrganization: boolean,
): Promise<RawItem[]> {
  const items: RawItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const body: ProjectItemsResponse = await ghGraphql(run, ITEMS_QUERY, {
      login: owner,
      number: projectNumber,
      after,
      isOrg: isOrganization,
    });
    if (body.errors?.length) {
      const forbidden = body.errors.some((error) =>
        error.type === "FORBIDDEN" ||
        (error.message ?? "").includes("INSUFFICIENT_SCOPES") ||
        (error.message ?? "").includes("scopes"),
      );
      if (forbidden) {
        throw new Error(
          "GitHub Project를 읽을 권한이 없습니다. GitHub App에 Projects 읽기 권한을 주고 다시 로그인하세요.",
        );
      }
      throw new Error(
        `GitHub 요청을 처리하지 못했습니다: ${body.errors[0]?.message ?? "unknown error"}`,
      );
    }
    const connection = isOrganization
      ? body.data?.organization?.projectV2?.items
      : body.data?.user?.projectV2?.items;
    if (!connection) {
      throw new Error(
        "해당 GitHub Project를 찾을 수 없습니다. 번호와 GitHub App의 Projects 읽기 권한을 확인하세요.",
      );
    }
    for (const node of connection.nodes ?? []) {
      if (!node?.content) {
        continue;
      }
      const content = node.content;
      if (content.__typename !== "Issue" && content.__typename !== "PullRequest") {
        continue;
      }
      if (typeof content.number !== "number" || !content.title || !content.url) {
        continue;
      }
      const fields = new Map<string, string | null>();
      let milestone: string | null = null;
      let iteration: string | null = null;
      for (const value of node.fieldValues?.nodes ?? []) {
        if (!value || value.__typename === "ProjectV2ItemFieldMilestoneValue") {
          const milestoneValue = (value as { milestone?: { title?: string } | null })?.milestone;
          if (milestoneValue?.title) {
            milestone = milestoneValue.title;
          }
          continue;
        }
        if (value?.__typename === "ProjectV2ItemFieldIterationValue") {
          iteration = (value as { title?: string }).title ?? null;
          continue;
        }
        if (
          value?.__typename === "ProjectV2ItemFieldSingleSelectValue" &&
          typeof value.name === "string" &&
          value.field?.name
        ) {
          fields.set(value.field.name, value.name);
        }
      }
      items.push({
        kind: content.__typename,
        number: content.number,
        title: content.title,
        url: content.url,
        repository: content.repository?.nameWithOwner ?? "",
        labels: (content.labels?.nodes ?? [])
          .map((label) => label?.name)
          .filter((name): name is string => typeof name === "string"),
        status: fields.get("Status") ?? null,
        area: fields.get("영역") ?? null,
        kindValue: fields.get("타입") ?? null,
        milestone,
        iteration,
        subIssues: (content.subIssues?.nodes ?? [])
          .filter((child): child is { number?: number; title?: string; url?: string } =>
            !!child && typeof child.number === "number" && !!child.title && !!child.url,
          )
          .map((child) => ({
            number: child.number as number,
            title: child.title as string,
            url: child.url as string,
          })),
      });
    }
    if (connection.pageInfo?.hasNextPage && connection.pageInfo?.endCursor) {
      after = connection.pageInfo.endCursor;
    } else {
      break;
    }
  }
  return items;
}

export function toBoardIssues(items: RawItem[]): BoardIssue[] {
  const byUrl = new Map(items.map((item) => [item.url, item]));
  const childUrls = new Set<string>();
  for (const item of items) {
    for (const child of item.subIssues) {
      if (byUrl.has(child.url)) {
        childUrls.add(child.url);
      }
    }
  }
  const visiting = new Set<string>();
  const parentOf = new Map<string, string>();
  for (const item of items) {
    for (const child of item.subIssues) {
      if (!parentOf.has(child.url)) {
        parentOf.set(child.url, item.url);
      }
    }
  }
  const build = (item: RawItem): BoardIssue => {
    const children: BoardIssue[] = [];
    visiting.add(item.url);
    for (const sub of item.subIssues) {
      const found = byUrl.get(sub.url);
      if (found && !visiting.has(found.url)) {
        children.push(build(found));
      }
    }
    visiting.delete(item.url);
    const layer = mapLayer(item.area, item.labels);
    return {
      number: item.number,
      title: item.title,
      url: item.url,
      repository: item.repository,
      layer,
      status: mapStatus(item.status),
      kind: item.kindValue,
      area: item.area,
      milestone: item.milestone,
      iteration: item.iteration,
      children,
      parentUrl: parentOf.get(item.url) ?? null,
    };
  };
  return items
    .filter((item) => !childUrls.has(item.url))
    .map((item) => build(item));
}
