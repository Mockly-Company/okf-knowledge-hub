import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { AiGateway } from "@/features/ai/AiGateway";
import { aiKeys } from "@/features/ai/queryKeys";
import { DEFAULT_WORKSPACE_SCOPE } from "@/features/ai/TerminalSessionStore";
import { TauriAiGateway } from "@/infrastructure/ai/TauriAiGateway";

const sharedGateway = new TauriAiGateway();

/** AGENTS.md 내용 앞 N줄 미리보기. */
function previewLines(content: string, max = 20): string {
  return content.split("\n").slice(0, max).join("\n");
}

function describeAiSettingsError(error: unknown): string | null {
  if (error === null || error === undefined) {
    return null;
  }
  return error instanceof Error ? error.message : "아직 지원되지 않습니다";
}

export function AiSettingsPanel({
  gateway = sharedGateway,
}: {
  gateway?: AiGateway;
}) {
  const queryClient = useQueryClient();
  const activeProject = useOptionalActiveProject();
  const scopeKey =
    activeProject?.activeWorkspaceId ??
    activeProject?.activeWorkspace?.id ??
    DEFAULT_WORKSPACE_SCOPE;
  const [cliCommand, setCliCommand] = useState("");
  const seededRef = useRef(false);

  // AI 화면과 같은 스코프 키를 쓴다. 상위 prefix(aiKeys.agentsMd)로 invalidate하면 양쪽이 함께 갱신된다.
  const configQuery = useQuery({
    queryKey: aiKeys.config,
    queryFn: () => gateway.getConfig(),
  });
  const agentsQuery = useQuery({
    queryKey: aiKeys.agentsMdFor(scopeKey),
    queryFn: () => gateway.resolveAgentsMd(),
  });
  const appAgentsQuery = useQuery({
    queryKey: aiKeys.appAgentsMd,
    queryFn: () => gateway.resolveAppAgentsMd(),
  });

  // 폼 초기값은 최초 1회만 심는다. 이후 백그라운드 재조회가 입력 중
  // 내용을 덮어쓰면 안 된다.
  useEffect(() => {
    if (configQuery.data && !seededRef.current) {
      seededRef.current = true;
      setCliCommand(configQuery.data.cli_command);
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => gateway.setConfig(cliCommand),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.config });
    },
  });
  const createMutation = useMutation({
    mutationFn: () => gateway.createAgentsMd(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.agentsMd });
    },
  });

  const isLoading = configQuery.isPending || agentsQuery.isPending;
  const loadError = describeAiSettingsError(
    configQuery.error ?? agentsQuery.error,
  );
  const isSaving = saveMutation.isPending;
  const saveError = saveMutation.isError
    ? describeAiSettingsError(saveMutation.error)
    : null;
  const saved = saveMutation.isSuccess;
  const agentsContent = agentsQuery.data?.content ?? null;
  const appAgentsContent = appAgentsQuery.data?.content ?? null;
  const isCreating = createMutation.isPending;
  const createError = createMutation.isError
    ? describeAiSettingsError(createMutation.error)
    : null;

  const save = () => saveMutation.mutate();
  const createFromTemplate = () => createMutation.mutate();

  return (
    <div>
      <SectionHeader
        title="AI 연동"
        description="Claude Code, Codex, Antigravity는 설정 없이 AI 화면의 버튼으로 실행됩니다. 다른 CLI를 쓸 때만 아래 명령을 입력하세요."
      />
      {loadError ? (
        <div className="mt-[var(--space-4)]">
          <StatusFeedback variant="content" tone="error">
            <StatusFeedbackTitle>AI 설정을 불러오지 못했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>{loadError}</StatusFeedbackDescription>
          </StatusFeedback>
        </div>
      ) : null}
      <div className="mt-[var(--space-6)] grid gap-[var(--space-3)]">
        <label
          className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]"
          htmlFor="ai-cli-command"
        >
          터미널용 CLI 명령
        </label>
        <input
          id="ai-cli-command"
          value={cliCommand}
          onChange={(event) => {
            setCliCommand(event.target.value);
            saveMutation.reset();
          }}
          placeholder="my-ai-cli"
          disabled={isLoading}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)] font-mono text-[var(--font-meta-size)]"
        />
        <p className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
          AI 화면의 &apos;사용자 지정&apos; 버튼이 이 명령을 앱 안 터미널에서 실행합니다
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void save()}
            disabled={isLoading || isSaving}
            loading={isSaving}
          >
            저장
          </Button>
        </div>
        {saveError ? (
          <StatusFeedback variant="field" tone="error">
            {saveError}
          </StatusFeedback>
        ) : null}
        {saved ? (
          <p role="status" className="m-0 text-[var(--color-text-muted)]">
            저장했습니다.
          </p>
        ) : null}
      </div>
      <section
        aria-label="저장소 공통 규칙"
        className="mt-[var(--space-6)] grid gap-[var(--space-3)]"
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <h3 className="m-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            저장소 공통 규칙
          </h3>
          {!isLoading ? (
            <StatusBadge tone={agentsContent ? "success" : "neutral"}>
              {agentsContent ? "적용 중" : "미설정"}
            </StatusBadge>
          ) : null}
        </div>
        {isLoading ? (
          <p role="status" className="m-0 text-[var(--color-text-muted)]">
            불러오는 중
          </p>
        ) : agentsContent ? (
          <pre
            aria-label="저장소 공통 규칙 미리보기"
            tabIndex={0}
            className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] text-[var(--font-meta-size)]"
          >
            {previewLines(agentsContent)}
          </pre>
        ) : (
          <>
            <p className="m-0 text-[var(--color-text-muted)]">
              아직 저장소 공통 규칙이 없습니다. 기본 템플릿으로 만들면 이 저장소의 AI 작업 규칙으로 사용됩니다.
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void createFromTemplate()}
                disabled={isLoading || isCreating}
                loading={isCreating}
              >
                템플릿으로 만들기
              </Button>
            </div>
            {createError ? (
              <StatusFeedback variant="field" tone="error">
                {createError}
              </StatusFeedback>
            ) : null}
          </>
        )}
      </section>
      <section
        aria-label="허브 공통 규칙"
        className="mt-[var(--space-6)] grid gap-[var(--space-3)]"
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <h3 className="m-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            허브 공통 규칙
          </h3>
          {!(isLoading || appAgentsQuery.isPending) ? (
            <StatusBadge tone={appAgentsContent ? "success" : "neutral"}>
              {appAgentsContent ? "적용 중" : "미설정"}
            </StatusBadge>
          ) : null}
        </div>
        {isLoading || appAgentsQuery.isPending ? (
          <p role="status" className="m-0 text-[var(--color-text-muted)]">
            불러오는 중
          </p>
        ) : appAgentsContent ? (
          <pre
            aria-label="허브 공통 규칙 미리보기"
            tabIndex={0}
            className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)] text-[var(--font-meta-size)]"
          >
            {previewLines(appAgentsContent, 10)}
          </pre>
        ) : (
          <p className="m-0 text-[var(--color-text-muted)]">
            허브 공통 규칙을 불러오지 못했습니다.
          </p>
        )}
      </section>
    </div>
  );
}
