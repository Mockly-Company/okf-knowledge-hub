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
    return { fullName, okf: this.okf };
  }

  /** 지정하면 pull이 이 약속이 끝날 때까지 기다린다. 진행 중 상태를 만들 때 쓴다. */
  pullGate: Promise<void> | null = null;

  async pull(): Promise<PullOutcome> {
    this.pulls += 1;
    if (this.pullGate) await this.pullGate;
    return this.pullOutcome;
  }
}
