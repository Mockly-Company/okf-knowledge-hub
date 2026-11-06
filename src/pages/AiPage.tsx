import { useState } from "react";
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type MutationState,
} from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { AiGateway, AiTaskResult, AiToolId } from "@/features/ai/AiGateway";
import { aiKeys } from "@/features/ai/queryKeys";
import type { ProjectBoardGateway } from "@/features/project-board/ProjectBoardGateway";
import {
  LEGACY_BOARD_ID,
  projectBoardKeys,
} from "@/features/project-board/queryKeys";
import { TauriAiGateway } from "@/infrastructure/ai/TauriAiGateway";
import { TauriProjectBoardGateway } from "@/infrastructure/project-board/TauriProjectBoardGateway";

const sharedAiGateway = new TauriAiGateway();
const sharedProjectGateway = new TauriProjectBoardGateway();

const TOOL_LABELS: Record<AiToolId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  custom: "사용자 지정",
};

const NOT_INSTALLED_MESSAGES: Record<"claude" | "codex", string> = {
  claude: "Claude Code가 설치되어 있지 않습니다.",
  codex: "Codex가 설치되어 있지 않습니다.",
};

interface RunOutcome {
  result: AiTaskResult;
  /** 시도한 새로고침이 전부 성공했을 때만 참이다. 시도가 없었으면 거짓이다. */
  refreshed: boolean;
}

function describeAiError(error: unknown): string {
  return error instanceof Error ? error.message : "아직 지원되지 않습니다";
}

export function AiPage({
  aiGateway = sharedAiGateway,
  projectBoardGateway = sharedProjectGateway,
  /** DocumentsProvider의 refresh. 없으면 생략한다. */
  refreshDocuments,
}: {
  aiGateway?: AiGateway;
  projectBoardGateway?: ProjectBoardGateway;
  refreshDocuments?: () => Promise<void>;
}) {
  const activeProject = useOptionalActiveProject();
  const activeProjectId = activeProject?.activeProjectId ?? null;
  const queryProjectId = activeProject ? activeProjectId : LEGACY_BOARD_ID;
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [pickedTool, setPickedTool] = useState<AiToolId | null>(null);

  const configQuery = useQuery({
    queryKey: aiKeys.config,
    queryFn: () => aiGateway.getConfig(),
  });
  const agentsQuery = useQuery({
    queryKey: aiKeys.agentsMd,
    queryFn: () => aiGateway.resolveAgentsMd(),
  });
  const appAgentsQuery = useQuery({
    queryKey: aiKeys.appAgentsMd,
    queryFn: () => aiGateway.resolveAppAgentsMd(),
  });

  const toolsQuery = useQuery({
    queryKey: aiKeys.tools,
    queryFn: () => aiGateway.detectTools(),
  });

  const agents = agentsQuery.data ?? null;
  const appAgents = appAgentsQuery.data ?? null;
  const contextError = agentsQuery.isError
    ? describeAiError(agentsQuery.error)
    : null;
  const appAgentsError = appAgentsQuery.isError
    ? describeAiError(appAgentsQuery.error)
    : null;

  // 감지가 끝나기 전이나 감지에 실패했을 때는 막지 않는다. 최종 판단은 실행 결과에 맡긴다.
  const isInstalled = (tool: "claude" | "codex") =>
    toolsQuery.data?.[tool] !== false;
  const missingTools = (["claude", "codex"] as const).filter(
    (tool) => !isInstalled(tool),
  );
  const presetTools = (["claude", "codex"] as const).filter(isInstalled);
  const hasCustomTask = Boolean(configQuery.data?.command_template.trim());
  const runnableTools: AiToolId[] = hasCustomTask
    ? [...presetTools, "custom"]
    : presetTools;
  const runTool =
    pickedTool !== null && runnableTools.includes(pickedTool)
      ? pickedTool
      : (runnableTools[0] ?? null);

  // 완료 후 보드 동기화 + 문서 새로고침은 최선 노력으로 시도한다.
  // 실패해도 실행 성공 자체는 유지된다.
  const refreshAfterRun = async (): Promise<boolean> => {
    let attempted = 0;
    let succeeded = 0;
    if (queryProjectId !== null) {
      attempted += 1;
      try {
        // AI 실행이 보드를 바꿨을 수 있으므로 캐시를 먼저 무효화한다.
        // 무효화 없이 fetchQuery만 하면 신선한 캐시가 그대로 반환된다.
        await queryClient.invalidateQueries({
          queryKey: projectBoardKeys.board(queryProjectId),
        });
        await queryClient.fetchQuery({
          queryKey: projectBoardKeys.board(queryProjectId),
          queryFn: () => projectBoardGateway.syncProjectBoard(),
        });
        succeeded += 1;
      } catch {
        // 백엔드 미완성 시 무시하고 기존 보드를 그대로 둔다.
      }
    }
    if (refreshDocuments) {
      attempted += 1;
      try {
        await refreshDocuments();
        succeeded += 1;
      } catch {
        // 문서 새로고침 실패는 무시한다.
      }
    }
    return attempted > 0 && succeeded === attempted;
  };
  const runMutation = useMutation({
    mutationKey: aiKeys.run,
    mutationFn: async ({
      input,
      tool,
    }: {
      input: string;
      tool: AiToolId;
    }): Promise<RunOutcome> => {
      const result = await aiGateway.runTask(input, tool);
      return { result, refreshed: await refreshAfterRun() };
    },
  });
  // 실행 결과도 앱 전역 mutation에 남긴다. 화면을 나갔다 와도 마지막 결과를 보여 준다.
  const latestRun = useMutationState({
    filters: { mutationKey: aiKeys.run },
    select: (mutation) => mutation.state as MutationState<RunOutcome>,
  }).at(-1);
  // 실행은 앱 전역 mutation이다. 화면에 다시 들어와도 진행 상태와 취소가 이어진다.
  const isRunning = useIsMutating({ mutationKey: aiKeys.run }) > 0;
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelRun = async () => {
    setCancelError(null);
    try {
      await aiGateway.cancelTask();
    } catch (error) {
      setCancelError(describeAiError(error));
    }
  };
  const lastResult = latestRun?.data?.result ?? null;
  const runStatus = lastResult?.status ?? null;
  const runError =
    latestRun?.status === "error" ? describeAiError(latestRun.error) : null;
  const log = lastResult
    ? `exit_code=${lastResult.exit_code}\n${lastResult.output}`
    : null;
  const refreshed = latestRun?.data?.refreshed ?? false;
  const run = () => {
    if (runTool !== null) {
      runMutation.mutate({ input: prompt, tool: runTool });
    }
  };

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="ai-title"
    >
      <PageHeader titleId="ai-title" title="AI" />
      <div
        aria-label="컨텍스트 요약"
        className="mt-[var(--space-4)] grid gap-[var(--space-1)] text-[var(--font-meta-size)] text-[var(--color-text-muted)]"
      >
        <p className="m-0">
          활성 프로젝트:{" "}
          {activeProject ? activeProject.activeProjectTitle : "미연결(로컬)"}
        </p>
        <p className="m-0">
          워크스페이스: {agents ? agents.workspace_path : "불러오는 중"}
        </p>
        <p className="m-0">
          AGENTS.md:{" "}
          {agents?.path ?? "없음 — .okf/AGENTS.md를 만들면 프로젝트 규칙으로 쓰입니다"}
        </p>
        <p className="m-0">
          앱 AGENTS.md: {appAgents ? appAgents.path : (appAgentsError ?? "불러오는 중")}
        </p>
      </div>
      {contextError ? (
        <div className="mt-[var(--space-4)]">
          <StatusFeedback variant="content" tone="error">
            <StatusFeedbackTitle>컨텍스트를 불러오지 못했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>{contextError}</StatusFeedbackDescription>
          </StatusFeedback>
        </div>
      ) : null}
      <div className="mt-[var(--space-6)] grid gap-[var(--space-3)]">
        <fieldset className="m-0 grid gap-[var(--space-2)] border-0 p-0">
          <legend className="p-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            실행 도구
          </legend>
          <div className="flex flex-wrap gap-[var(--space-4)]">
            {runnableTools.map((tool) => (
              <label key={tool} className="flex items-center gap-[var(--space-2)]">
                <input
                  type="radio"
                  name="ai-run-tool"
                  aria-label={`${TOOL_LABELS[tool]}${tool === "custom" ? "으로" : "로"} 실행`}
                  checked={runTool === tool}
                  disabled={isRunning}
                  onChange={() => setPickedTool(tool)}
                />
                {TOOL_LABELS[tool]}
              </label>
            ))}
          </div>
        </fieldset>
        {missingTools.map((tool) => (
          <p
            key={tool}
            className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]"
          >
            {NOT_INSTALLED_MESSAGES[tool]}
          </p>
        ))}
        <label
          className="font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]"
          htmlFor="ai-prompt"
        >
          요청
        </label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder="AI CLI에 보낼 요청을 입력하세요"
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-3)]"
        />
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button
            type="button"
            variant="primary"
            onClick={run}
            disabled={isRunning || prompt.trim() === "" || runTool === null}
            loading={isRunning}
          >
            실행
          </Button>
          {isRunning ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void cancelRun()}
            >
              취소
            </Button>
          ) : null}
        </div>
        {isRunning ? <p role="status">실행 중…</p> : null}
        {cancelError ? (
          <StatusFeedback variant="field" tone="error">
            {cancelError}
          </StatusFeedback>
        ) : null}
        {runStatus === "cancelled" ? (
          <p role="status" className="m-0 text-[var(--color-text-muted)]">
            실행을 취소했습니다.
          </p>
        ) : null}
        {runStatus === "timed_out" ? (
          <StatusFeedback variant="content" tone="error">
            <StatusFeedbackTitle>시간 제한을 넘어 중단했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>
              30분 안에 끝나지 않아 작업을 멈췄습니다. 요청을 나누거나 터미널에서 실행해 보세요.
            </StatusFeedbackDescription>
          </StatusFeedback>
        ) : null}
        {runError ? (
          <StatusFeedback variant="content" tone="error">
            <StatusFeedbackTitle>실행에 실패했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>{runError}</StatusFeedbackDescription>
          </StatusFeedback>
        ) : null}
        {log !== null ? (
          <pre
            aria-label="실행 결과"
            tabIndex={0}
            className="max-h-96 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] p-[var(--space-3)]"
          >
            {log}
          </pre>
        ) : null}
        {refreshed ? (
          <p role="status" className="m-0 text-[var(--color-text-muted)]">
            보드·문서를 새로고침했습니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
