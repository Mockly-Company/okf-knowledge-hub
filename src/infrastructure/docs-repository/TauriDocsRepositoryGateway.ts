import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectedDocsRepository,
  DocsRepositoryGateway,
  PreparedDocsRepository,
} from "@/features/docs-repository/DocsRepositoryGateway";

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
}
