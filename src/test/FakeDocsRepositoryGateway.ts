import type {
  ConnectedDocsRepository,
  DocsRepositoryGateway,
  PreparedDocsRepository,
  PullOutcome,
} from "@/features/docs-repository/DocsRepositoryGateway";

export class FakeDocsRepositoryGateway implements DocsRepositoryGateway {
  prepareResult: PreparedDocsRepository = {
    parentDirectory: "/app/repos/Mockly-Company",
    alreadyCloned: false,
  };
  okf = true;
  pullOutcome: PullOutcome = "up_to_date";
  pulls = 0;
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

  async pull(): Promise<PullOutcome> {
    this.pulls += 1;
    return this.pullOutcome;
  }
}
