import type {
  ActivatedHubWorkspace,
  ConnectedDocsRepository,
  ConnectedHubWorkspace,
  DocsRepositoryGateway,
  HubWorkspace,
  HubWorkspaceList,
  PreparedDocsRepository,
  PullOutcome,
} from "@/features/docs-repository/DocsRepositoryGateway";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import type { DocsRepositoryRef } from "@/features/project-board/ProjectBoardGateway";

function shortRepoName(fullName: string): string {
  const parts = fullName.split("/");
  return parts[parts.length - 1]?.trim() || fullName;
}

export class FakeDocsRepositoryGateway implements DocsRepositoryGateway {
  prepareResult: PreparedDocsRepository = {
    parentDirectory: "/app/repos/Mockly-Company",
    alreadyCloned: false,
  };
  okf = true;
  pullOutcome: PullOutcome = "up_to_date";
  pulls = 0;
  workspaces: HubWorkspace[] = [];
  activeWorkspaceId: string | null = null;
  readonly prepares: string[] = [];
  readonly connects: Array<{ projectId: string; repositoryId: string; fullName: string }> = [];

  /** 지정하면 prepare가 이 약속이 끝날 때까지 기다린다. */
  prepareGate: Promise<void> | null = null;

  async prepare(fullName: string): Promise<PreparedDocsRepository> {
    this.prepares.push(fullName);
    if (this.prepareGate) await this.prepareGate;
    return this.prepareResult;
  }

  async connect(
    projectId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedDocsRepository> {
    this.connects.push({ projectId, repositoryId, fullName });
    const found = this.workspaces.find(
      (workspace) => workspace.id === projectId || workspace.project?.id === projectId,
    );
    if (found) {
      found.docsRepository = { repositoryId, fullName };
      if (!found.project) {
        found.title = shortRepoName(fullName);
      }
    }
    return { fullName, okf: this.okf };
  }

  /** 지정하면 pull이 이 약속이 끝날 때까지 기다린다. 진행 중 상태를 만들 때 쓴다. */
  pullGate: Promise<void> | null = null;

  async pull(): Promise<PullOutcome> {
    this.pulls += 1;
    if (this.pullGate) await this.pullGate;
    return this.pullOutcome;
  }

  private snapshot(): HubWorkspaceList {
    const active =
      this.workspaces.find((workspace) => workspace.id === this.activeWorkspaceId) ??
      this.workspaces[0] ??
      null;
    this.activeWorkspaceId = active?.id ?? null;
    return {
      workspaces: this.workspaces.map((workspace) => ({ ...workspace })),
      activeWorkspaceId: this.activeWorkspaceId,
      activeDocsConnected: Boolean(active?.docsRepository),
    };
  }

  async listWorkspaces(): Promise<HubWorkspaceList> {
    return this.snapshot();
  }

  async setActiveWorkspace(workspaceId: string): Promise<ActivatedHubWorkspace> {
    const found = this.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!found) {
      throw new Error("선택한 워크스페이스를 찾을 수 없습니다.");
    }
    this.activeWorkspaceId = found.id;
    return {
      workspace: { ...found },
      docsConnected: Boolean(found.docsRepository),
    };
  }

  async createStandaloneWorkspace(
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace> {
    const existing = this.workspaces.find(
      (workspace) =>
        workspace.project === null &&
        (workspace.docsRepository?.repositoryId === repositoryId ||
          workspace.docsRepository?.fullName.toLowerCase() === fullName.toLowerCase()),
    );
    if (existing) {
      existing.title = shortRepoName(fullName);
      existing.docsRepository = { repositoryId, fullName };
      this.activeWorkspaceId = existing.id;
      return {
        workspace: { ...existing },
        docsConnected: true,
        okf: this.okf,
      };
    }
    const created: HubWorkspace = {
      id: `repo:${repositoryId}`,
      title: shortRepoName(fullName),
      project: null,
      docsRepository: { repositoryId, fullName },
    };
    this.workspaces.push(created);
    this.activeWorkspaceId = created.id;
    return {
      workspace: { ...created },
      docsConnected: true,
      okf: this.okf,
    };
  }

  async createProjectWorkspace(
    project: ResolvedGithubProject,
    repository?: DocsRepositoryRef | null,
  ): Promise<ConnectedHubWorkspace> {
    const existing = this.workspaces.find(
      (workspace) => workspace.project?.id === project.id,
    );
    if (existing) {
      existing.title = project.title;
      existing.project = project;
      if (repository) {
        existing.docsRepository = repository;
      }
      this.activeWorkspaceId = existing.id;
      return {
        workspace: { ...existing },
        docsConnected: Boolean(existing.docsRepository),
        okf: repository ? this.okf : null,
      };
    }
    const created: HubWorkspace = {
      id: project.id,
      title: project.title,
      project,
      docsRepository: repository ?? null,
    };
    this.workspaces.push(created);
    this.activeWorkspaceId = created.id;
    return {
      workspace: { ...created },
      docsConnected: Boolean(created.docsRepository),
      okf: repository ? this.okf : null,
    };
  }

  async connectWorkspaceDocs(
    workspaceId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace> {
    this.connects.push({ projectId: workspaceId, repositoryId, fullName });
    const found = this.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!found) {
      throw new Error("선택한 워크스페이스를 찾을 수 없습니다.");
    }
    found.docsRepository = { repositoryId, fullName };
    if (!found.project) {
      found.title = shortRepoName(fullName);
    }
    return {
      workspace: { ...found },
      docsConnected: true,
      okf: this.okf,
    };
  }

  async attachProject(
    workspaceId: string,
    project: ResolvedGithubProject,
  ): Promise<HubWorkspace> {
    if (
      this.workspaces.some(
        (workspace) =>
          workspace.id !== workspaceId && workspace.project?.id === project.id,
      )
    ) {
      throw new Error("이미 다른 워크스페이스에 연결된 GitHub Project입니다.");
    }
    const found = this.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!found) {
      throw new Error("선택한 워크스페이스를 찾을 수 없습니다.");
    }
    found.title = project.title;
    found.project = project;
    return { ...found };
  }

  async detachProject(workspaceId: string): Promise<HubWorkspaceList> {
    const index = this.workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (index < 0) {
      throw new Error("선택한 워크스페이스를 찾을 수 없습니다.");
    }
    const target = this.workspaces[index];
    if (target.docsRepository) {
      const wasActive = this.activeWorkspaceId === target.id;
      let newId =
        target.project?.id === target.id
          ? `repo:${target.docsRepository.repositoryId}`
          : target.id;
      if (newId !== target.id) {
        const baseId = newId;
        let suffix = 2;
        while (
          this.workspaces.some(
            (item, idx) => idx !== index && item.id === newId,
          )
        ) {
          newId = `${baseId}:${suffix}`;
          suffix += 1;
        }
      }
      target.id = newId;
      target.project = null;
      target.title = shortRepoName(target.docsRepository.fullName);
      if (wasActive) {
        this.activeWorkspaceId = newId;
      }
    } else {
      this.workspaces.splice(index, 1);
      if (this.activeWorkspaceId === workspaceId) {
        this.activeWorkspaceId = this.workspaces[0]?.id ?? null;
      }
    }
    return this.snapshot();
  }

  async removeWorkspace(workspaceId: string): Promise<HubWorkspaceList> {
    const index = this.workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (index < 0) {
      throw new Error("선택한 워크스페이스를 찾을 수 없습니다.");
    }
    this.workspaces.splice(index, 1);
    if (this.activeWorkspaceId === workspaceId) {
      this.activeWorkspaceId = this.workspaces[0]?.id ?? null;
    }
    return this.snapshot();
  }
}
