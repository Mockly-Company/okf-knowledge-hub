import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import type {
  ConnectedDocsRepository,
  DocsRepositoryGateway,
} from "@/features/docs-repository/DocsRepositoryGateway";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import type {
  CloneProgressEvent,
  GithubRepositorySummary,
} from "@/features/workspace-connection/model/protocol";

export const NOT_OKF_WARNING = "OKF 형식에 맞지 않는 저장소입니다.";

type RepositoryGateway = Pick<
  WorkspaceConnectionGateway,
  "listRepositories" | "cloneRepository" | "cancelRepositoryClone" | "onCloneProgress"
>;

type Phase =
  | { kind: "idle" }
  | { kind: "cloning"; requestId: string; fullName: string }
  | { kind: "connecting"; fullName: string }
  | { kind: "failed"; message: string }
  | { kind: "connected"; result: ConnectedDocsRepository };

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  if (typeof error === "string" && error.trim() !== "") return error;
  return "알 수 없는 오류";
}

/** clone 진행률 이벤트에서 이 요청의 끝(완료·실패·취소)을 기다린다. */
async function cloneAndWait(
  gateway: RepositoryGateway,
  requestId: string,
  repository: GithubRepositorySummary,
  parentDirectory: string,
): Promise<"completed" | "cancelled"> {
  let settle: (event: CloneProgressEvent) => void = () => {};
  const finished = new Promise<CloneProgressEvent>((resolve) => {
    settle = resolve;
  });
  const unlisten = await gateway.onCloneProgress((event) => {
    if (event.requestId === requestId && event.status !== "progress") {
      settle(event);
    }
  });
  try {
    await gateway.cloneRepository(requestId, repository, parentDirectory);
    const event = await finished;
    if (event.status === "failed") throw event.error;
    return event.status === "cancelled" ? "cancelled" : "completed";
  } finally {
    unlisten();
  }
}

/** 프로젝트의 문서 저장소를 GitHub 저장소 목록에서 고른다. 앱이 알아서 받아 연결한다. */
export function DocsRepositoryPicker({
  projectId,
  gateway,
  repositoryGateway,
  onConnected,
}: {
  projectId: string;
  gateway: DocsRepositoryGateway;
  repositoryGateway: RepositoryGateway;
  onConnected(result: ConnectedDocsRepository): void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const repositoriesQuery = useInfiniteQuery({
    queryKey: ["docsRepository", "repositories"],
    queryFn: ({ pageParam }) => repositoryGateway.listRepositories(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const repositories = (repositoriesQuery.data?.pages ?? []).flatMap((page) => page.items);
  const needle = query.trim().toLowerCase();
  const visible = repositories.filter((repository) =>
    repository.fullName.toLowerCase().includes(needle),
  );
  const busy = phase.kind === "cloning" || phase.kind === "connecting";

  const choose = async (repository: GithubRepositorySummary) => {
    try {
      const prepared = await gateway.prepare(repository.fullName);
      if (!prepared.alreadyCloned) {
        const requestId = crypto.randomUUID();
        setPhase({ kind: "cloning", requestId, fullName: repository.fullName });
        const outcome = await cloneAndWait(
          repositoryGateway,
          requestId,
          repository,
          prepared.parentDirectory,
        );
        if (outcome === "cancelled") {
          setPhase({ kind: "idle" });
          return;
        }
      }
      setPhase({ kind: "connecting", fullName: repository.fullName });
      const result = await gateway.connect(projectId, repository.id, repository.fullName);
      setPhase({ kind: "connected", result });
      onConnected(result);
    } catch (error) {
      setPhase({ kind: "failed", message: describeError(error) });
    }
  };

  const cancelClone = () => {
    if (phase.kind === "cloning") {
      void repositoryGateway.cancelRepositoryClone(phase.requestId).catch(() => undefined);
    }
  };

  return (
    <div className="grid gap-[var(--space-3)]" role="group" aria-label="문서 저장소 선택">
      <p className="m-0 text-[var(--color-text-muted)]">
        이 프로젝트의 문서를 둘 GitHub 저장소를 고르세요. 앱이 받아서 최신 상태로 유지합니다.
      </p>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="저장소 이름으로 찾기"
        aria-label="저장소 이름"
        disabled={busy}
      />
      {phase.kind === "cloning" ? (
        <div className="flex items-center gap-[var(--space-2)]">
          <p role="status" className="m-0">
            문서 저장소를 받는 중…
          </p>
          <Button type="button" variant="secondary" onClick={cancelClone}>
            취소
          </Button>
        </div>
      ) : null}
      {phase.kind === "connecting" ? (
        <p role="status" className="m-0">
          문서 저장소를 연결하는 중…
        </p>
      ) : null}
      {phase.kind === "failed" ? (
        <StatusFeedback variant="content" tone="error">
          <StatusFeedbackTitle>문서 저장소를 연결하지 못했습니다</StatusFeedbackTitle>
          <StatusFeedbackDescription>{phase.message}</StatusFeedbackDescription>
        </StatusFeedback>
      ) : null}
      {phase.kind === "connected" && !phase.result.okf ? (
        <StatusFeedback variant="content" tone="warning">
          <StatusFeedbackTitle>{NOT_OKF_WARNING}</StatusFeedbackTitle>
          <StatusFeedbackDescription>
            저장소의 마크다운 문서를 그대로 보여 줍니다.
          </StatusFeedbackDescription>
        </StatusFeedback>
      ) : null}
      {repositoriesQuery.isError ? (
        <StatusFeedback variant="field" tone="error">
          저장소 목록을 불러오지 못했습니다. ({describeError(repositoriesQuery.error)})
        </StatusFeedback>
      ) : null}
      {repositoriesQuery.isPending ? (
        <p role="status" className="m-0 text-[var(--color-text-muted)]">
          저장소 목록을 불러오는 중…
        </p>
      ) : (
        <div className="grid max-h-80 gap-[var(--space-1)] overflow-y-auto">
          {visible.map((repository) => (
            <Button
              key={repository.id}
              type="button"
              variant="secondary"
              className="justify-start"
              disabled={busy}
              onClick={() => void choose(repository)}
            >
              {repository.fullName}
            </Button>
          ))}
          {visible.length === 0 && !repositoriesQuery.isError ? (
            <p className="m-0 text-[var(--color-text-muted)]">맞는 저장소가 없습니다.</p>
          ) : null}
        </div>
      )}
      {repositoriesQuery.hasNextPage ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void repositoriesQuery.fetchNextPage()}
            disabled={repositoriesQuery.isFetchingNextPage}
            loading={repositoriesQuery.isFetchingNextPage}
          >
            더 불러오기
          </Button>
        </div>
      ) : null}
    </div>
  );
}
