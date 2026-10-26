import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhResult {
  stdout: string;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

export function makeGhRunner(): GhRunner {
  return async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout };
  };
}

export async function ghJson<T>(
  run: GhRunner,
  args: string[],
): Promise<T> {
  const { stdout } = await run(args);
  return JSON.parse(stdout) as T;
}

export type GraphqlVariables = Record<string, string | number | boolean | null | undefined>;

export async function ghGraphql<T>(
  run: GhRunner,
  query: string,
  fields: GraphqlVariables,
): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      args.push("-F", `${key}=${value}`);
    } else {
      args.push("-f", `${key}=${value}`);
    }
  }
  return ghJson<T>(run, args);
}
