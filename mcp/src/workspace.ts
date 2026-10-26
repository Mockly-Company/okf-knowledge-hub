import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

export interface LinkedRepo {
  key: string;
  label: string;
  id: string;
  fullName: string;
}

export interface LinkedProject {
  id: string;
  owner: string;
  number: number;
}

export interface WorkspaceConfig {
  root: string;
  name: string;
  docRoots: string[];
  repositories: LinkedRepo[];
  project: LinkedProject | null;
}

interface RawWorkspaceFile {
  schema_version?: number;
  workspace?: { id?: string; name?: string };
  documents?: { roots?: Array<{ path?: string }> };
  repositories?: Array<{
    key?: string;
    label?: string;
    github?: { id?: string; full_name?: string };
  }>;
  github?: { project?: { id?: string; owner?: string; number?: number } };
}

function hubSettingsPath(): string {
  if (platform() === "win32") {
    const base =
      process.env.APPDATA ??
      join(homedir(), "AppData", "Roaming");
    return join(base, "com.okhub.desktop", "settings.json");
  }
  const base =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "com.okhub.desktop", "settings.json");
}

function stripUncPrefix(path: string): string {
  return path.replace(/^\\\\\?\\/, "");
}

export async function resolveWorkspaceRoot(
  override?: string,
): Promise<string> {
  if (override) {
    return override;
  }
  if (process.env.OKHUB_WORKSPACE) {
    return process.env.OKHUB_WORKSPACE;
  }
  try {
    const raw = await readFile(hubSettingsPath(), "utf-8");
    const settings = JSON.parse(raw) as Record<string, string>;
    const current = settings["current-workspace-path"];
    if (current) {
      const parsed = JSON.parse(current) as { path?: string };
      if (parsed.path) {
        return stripUncPrefix(parsed.path);
      }
    }
  } catch {
    // fall through to error below
  }
  throw new Error(
    "OkHub 워크스페이스를 찾을 수 없습니다. Hub 앱에서 워크스페이스를 먼저 연결하거나 OKHUB_WORKSPACE 환경변수를 설정하세요.",
  );
}

export async function loadWorkspaceConfig(
  root: string,
): Promise<WorkspaceConfig> {
  const raw = await readFile(join(root, ".okf", "workspace.yml"), "utf-8");
  const doc = YAML.parse(raw) as RawWorkspaceFile;
  if (typeof doc?.schema_version !== "number") {
    throw new Error(
      "지원하지 않는 워크스페이스 정의입니다. schema_version을 확인하세요.",
    );
  }
  return {
    root,
    name: doc.workspace?.name ?? "OkHub 워크스페이스",
    docRoots: (doc.documents?.roots ?? [])
      .map((entry) => entry?.path)
      .filter((path): path is string => typeof path === "string"),
    repositories: (doc.repositories ?? []).flatMap((repo) => {
      if (!repo?.key || !repo.github?.id || !repo.github?.full_name) {
        return [];
      }
      return [
        {
          key: repo.key,
          label: repo.label ?? repo.key,
          id: repo.github.id,
          fullName: repo.github.full_name,
        },
      ];
    }),
    project: doc.github?.project?.id &&
    doc.github?.project?.owner &&
    typeof doc.github.project.number === "number"
      ? {
        id: doc.github.project.id,
        owner: doc.github.project.owner,
        number: doc.github.project.number,
      }
      : null,
  };
}
