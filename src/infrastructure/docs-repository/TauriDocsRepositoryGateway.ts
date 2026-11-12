import { invoke } from "@tauri-apps/api/core";
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

type InvokeDesktop = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class TauriDocsRepositoryGateway implements DocsRepositoryGateway {
  constructor(private readonly invokeCommand: InvokeDesktop = invoke) {}

  prepare(fullName: string): Promise<PreparedDocsRepository> {
    return this.invokeCommand("prepare_docs_repository", { fullName });
  }

  connect(
    projectId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedDocsRepository> {
    return this.invokeCommand("connect_project_docs_repository", {
      projectId,
      repositoryId,
      fullName,
    });
  }

  pull(): Promise<PullOutcome> {
    return this.invokeCommand("pull_docs_repository");
  }

  listWorkspaces(): Promise<HubWorkspaceList> {
    return this.invokeCommand("list_hub_workspaces");
  }

  setActiveWorkspace(workspaceId: string): Promise<ActivatedHubWorkspace> {
    return this.invokeCommand("set_active_hub_workspace", { workspaceId });
  }

  createStandaloneWorkspace(
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace> {
    return this.invokeCommand("create_standalone_docs_workspace", {
      repositoryId,
      fullName,
    });
  }

  createProjectWorkspace(
    project: ResolvedGithubProject,
    repository?: DocsRepositoryRef | null,
  ): Promise<ConnectedHubWorkspace> {
    return this.invokeCommand("create_project_workspace", {
      project,
      repositoryId: repository?.repositoryId ?? null,
      fullName: repository?.fullName ?? null,
    });
  }

  connectWorkspaceDocs(
    workspaceId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedHubWorkspace> {
    return this.invokeCommand("connect_workspace_docs_repository", {
      workspaceId,
      repositoryId,
      fullName,
    });
  }

  attachProject(
    workspaceId: string,
    project: ResolvedGithubProject,
  ): Promise<HubWorkspace> {
    return this.invokeCommand("attach_project_to_workspace", {
      workspaceId,
      project,
    });
  }

  detachProject(workspaceId: string): Promise<HubWorkspaceList> {
    return this.invokeCommand("detach_project_from_workspace", { workspaceId });
  }

  removeWorkspace(workspaceId: string): Promise<HubWorkspaceList> {
    return this.invokeCommand("remove_hub_workspace", { workspaceId });
  }
}
