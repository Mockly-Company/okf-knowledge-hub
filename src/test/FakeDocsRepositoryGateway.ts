import type {
  ConnectedDocsRepository,
  DocsRepositoryGateway,
  PreparedDocsRepository,
} from "@/features/docs-repository/DocsRepositoryGateway";

export class FakeDocsRepositoryGateway implements DocsRepositoryGateway {
  prepareResult: PreparedDocsRepository = {
    parentDirectory: "/app/repos/Mockly-Company",
    alreadyCloned: false,
  };
  okf = true;
  readonly prepares: string[] = [];
  readonly connects: Array<{ projectId: string; repositoryId: string; fullName: string }> = [];

  async prepare(fullName: string): Promise<PreparedDocsRepository> {
    this.prepares.push(fullName);
    return this.prepareResult;
  }

  async connect(
    projectId: string,
    repositoryId: string,
    fullName: string,
  ): Promise<ConnectedDocsRepository> {
    this.connects.push({ projectId, repositoryId, fullName });
    return { fullName, okf: this.okf };
  }
}
