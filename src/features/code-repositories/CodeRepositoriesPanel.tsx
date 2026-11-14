import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCodeRepositoriesGateway,
  type CodeRepositoriesGateway,
  type CodeRepositoryMappingSource,
  type WorkspaceCodeRepositoryStatus,
} from "./CodeRepositoriesGateway";

const defaultGateway = createCodeRepositoriesGateway();
const CODE_REPOSITORIES_QUERY_KEY = ["workspace-code-repositories"] as const;

function statusBadgeLabel(source: CodeRepositoryMappingSource, exists: boolean): string {
  if (source === "manual") {
    return exists ? "수동 연결됨" : "경로 확인 필요";
  }
  if (source === "auto_detected") {
    return "자동 감지됨";
  }
  return "미연결";
}

function statusBadgeClassName(source: CodeRepositoryMappingSource, exists: boolean): string {
  if ((source === "manual" && exists) || source === "auto_detected") {
    return "bg-[var(--color-primary-soft)] text-[var(--color-primary-text)] border-[var(--color-primary)]";
  }
  return "bg-[var(--color-surface-muted)] text-[var(--color-text-default)] border-[var(--color-border)]";
}

export function CodeRepositoriesPanel({
  gateway = defaultGateway,
}: {
  gateway?: CodeRepositoriesGateway;
}) {
  const queryClient = useQueryClient();
  const [draftPaths, setDraftPaths] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reposQuery = useQuery({
    queryKey: CODE_REPOSITORIES_QUERY_KEY,
    queryFn: () => gateway.listWorkspaceCodeRepositories(),
  });

  useEffect(() => {
    if (!reposQuery.data) return;
    setDraftPaths((prev) => {
      const next = { ...prev };
      for (const repo of reposQuery.data) {
        if (next[repo.fullName] === undefined) {
          next[repo.fullName] = repo.localPath ?? "";
        }
      }
      return next;
    });
  }, [reposQuery.data]);

  const saveMutation = useMutation({
    mutationFn: ({
      fullName,
      localPath,
    }: {
      fullName: string;
      localPath: string;
    }) => gateway.setCodeRepositoryLocalPath(fullName, localPath),
    onSuccess: async (updated) => {
      setErrorMessage(null);
      setFeedback(`${updated.fullName} 로컬 경로를 저장했습니다.`);
      setDraftPaths((prev) => ({
        ...prev,
        [updated.fullName]: updated.localPath ?? "",
      }));
      await queryClient.invalidateQueries({
        queryKey: CODE_REPOSITORIES_QUERY_KEY,
      });
    },
    onError: (err: unknown) => {
      setFeedback(null);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "코드 저장소 로컬 경로를 저장하지 못했습니다.",
      );
    },
  });

  const clearMutation = useMutation({
    mutationFn: (fullName: string) =>
      gateway.clearCodeRepositoryLocalPath(fullName),
    onSuccess: async (_, fullName) => {
      setErrorMessage(null);
      setFeedback(`${fullName} 수동 연결을 해제했습니다.`);
      setDraftPaths((prev) => ({
        ...prev,
        [fullName]: "",
      }));
      await queryClient.invalidateQueries({
        queryKey: CODE_REPOSITORIES_QUERY_KEY,
      });
    },
    onError: (err: unknown) => {
      setFeedback(null);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "코드 저장소 연결 해제에 실패했습니다.",
      );
    },
  });

  const handleBrowse = async (repo: WorkspaceCodeRepositoryStatus) => {
    if (!gateway.pickDirectory) return;
    const chosen = await gateway.pickDirectory();
    if (chosen) {
      setDraftPaths((prev) => ({
        ...prev,
        [repo.fullName]: chosen,
      }));
    }
  };

  const repos = reposQuery.data ?? [];

  return (
    <div className="grid gap-[var(--space-6)]">
      <SectionHeader
        title="작업 방식 · 코드 저장소 연결"
        description="현재 문서 워크스페이스(.okf/workspace.yml)에 선언된 코드 저장소의 로컬 클론 경로를 연결합니다. AI 터미널과 문서 내 코드 참조 미리보기가 이 경로를 자동으로 따릅니다."
      />

      {feedback && (
        <p
          role="status"
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-text-default)]"
        >
          {feedback}
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="m-0 rounded-[var(--radius-md)] border border-[var(--color-error-border)] bg-[var(--color-error-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--color-error-text)]"
        >
          {errorMessage}
        </p>
      )}

      {reposQuery.isLoading ? (
        <p className="m-0 text-[var(--color-text-muted)]">
          연결된 코드 저장소 목록을 확인하는 중…
        </p>
      ) : reposQuery.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-error-border)] bg-[var(--color-error-surface)] p-[var(--space-4)] text-[var(--color-error-text)]"
        >
          <span>코드 저장소 목록을 불러오지 못했습니다.</span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void reposQuery.refetch()}
          >
            다시 시도
          </Button>
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-[var(--space-4)] text-[var(--color-text-default)]">
          현재 문서 워크스페이스의 <code>.okf/workspace.yml</code>에 선언된 코드 저장소가 없습니다.
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-[var(--space-4)] p-0">
          {repos.map((repo) => {
            const currentInput =
              draftPaths[repo.fullName] ?? repo.localPath ?? "";
            const inputId = `code-repo-path-${repo.key}`;
            return (
              <li
                key={repo.fullName}
                className="grid gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-4)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                  <div>
                    <strong className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                      {repo.label}
                    </strong>
                    <span className="ml-[var(--space-2)] font-mono text-[length:var(--text-sm)] text-[var(--color-text-muted)]">
                      {repo.fullName}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-[var(--radius-sm)] border px-[var(--space-2)] py-0.5 text-[length:var(--text-xs)] font-[number:var(--font-weight-control)] ${statusBadgeClassName(
                      repo.mappingSource,
                      repo.exists,
                    )}`}
                  >
                    {statusBadgeLabel(repo.mappingSource, repo.exists)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <label htmlFor={inputId} className="sr-only">
                    {repo.fullName} 로컬 폴더 경로
                  </label>
                  <Input
                    id={inputId}
                    aria-label={`${repo.fullName} 로컬 폴더 경로`}
                    value={currentInput}
                    placeholder="로컬 Git 클론 절대 경로 입력"
                    onChange={(event) =>
                      setDraftPaths((prev) => ({
                        ...prev,
                        [repo.fullName]: event.target.value,
                      }))
                    }
                    className="flex-1"
                  />
                  {gateway.pickDirectory && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleBrowse(repo)}
                    >
                      폴더 찾기
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      saveMutation.isPending || currentInput.trim().length === 0
                    }
                    aria-label={`${repo.fullName} 경로 저장`}
                    onClick={() =>
                      saveMutation.mutate({
                        fullName: repo.fullName,
                        localPath: currentInput.trim(),
                      })
                    }
                  >
                    경로 저장
                  </Button>
                  {repo.mappingSource === "manual" && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={clearMutation.isPending}
                      aria-label={`${repo.fullName} 수동 연결 해제`}
                      onClick={() => clearMutation.mutate(repo.fullName)}
                    >
                      연결 해제
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
