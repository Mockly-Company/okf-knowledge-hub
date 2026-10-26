import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceConfig, resolveWorkspaceRoot } from "../src/workspace.js";

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "okhub-ws-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

const VALID_YML = `schema_version: 1
workspace:
  id: 00000000-0000-0000-0000-000000000000
  name: Mockly
documents:
  roots:
  - path: docs
repositories:
- key: mockly-server
  label: Mockly 서버
  github:
    id: R_kgDOQOLggw
    full_name: Mockly-Company/mockly-server
github:
  project:
    id: PVT_example
    owner: Mockly-Company
    number: 1
`;

describe("loadWorkspaceConfig", () => {
  it("파싱된 워크스페이스 정의를 반환한다", async () => {
    const dir = makeWorkspace({
      ".okf/workspace.yml": VALID_YML,
      "docs/a.md": "# hello\n",
    });
    const config = await loadWorkspaceConfig(dir);
    expect(config.name).toBe("Mockly");
    expect(config.docRoots).toEqual(["docs"]);
    expect(config.repositories).toHaveLength(1);
    expect(config.repositories[0]?.fullName).toBe("Mockly-Company/mockly-server");
    expect(config.project).toMatchObject({ owner: "Mockly-Company", number: 1 });
  });

  it("프로젝트가 없으면 null을 반환한다", async () => {
    const dir = makeWorkspace({
      ".okf/workspace.yml": "schema_version: 1\nworkspace:\n  id: x\n  name: T\ndocuments:\n  roots: []\n",
    });
    const config = await loadWorkspaceConfig(dir);
    expect(config.project).toBeNull();
  });

  it("잘못된 문서는 에러를 낸다", async () => {
    const dir = makeWorkspace({ ".okf/workspace.yml": "::: not yaml ::: [" });
    await expect(loadWorkspaceConfig(dir)).rejects.toThrow();
  });
});

describe("resolveWorkspaceRoot", () => {
  const OLD_ENV = process.env.OKHUB_WORKSPACE;
  afterEach(() => {
    if (OLD_ENV === undefined) {
      delete process.env.OKHUB_WORKSPACE;
    } else {
      process.env.OKHUB_WORKSPACE = OLD_ENV;
    }
    vi.unstubAllEnvs();
  });

  it("환경변수 오버라이드를 우선한다", async () => {
    process.env.OKHUB_WORKSPACE = "/tmp/ws";
    await expect(resolveWorkspaceRoot("/explicit")).resolves.toBe("/explicit");
    await expect(resolveWorkspaceRoot()).resolves.toBe("/tmp/ws");
  });
});
