import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { useOptionalActiveProject } from "@/features/active-project/ActiveProjectProvider";
import type { AiGateway, AiToolId } from "@/features/ai/AiGateway";
import { AiTerminalPanel } from "@/features/ai/AiTerminalPanel";
import {
  terminalStoreFor,
  type TerminalRendererFactory,
} from "@/features/ai/TerminalSessionStore";
import { aiKeys } from "@/features/ai/queryKeys";
import { TauriAiGateway } from "@/infrastructure/ai/TauriAiGateway";
import { createXtermRenderer } from "@/infrastructure/ai/XtermRenderer";

const sharedAiGateway = new TauriAiGateway();

const TOOL_LABELS: Record<AiToolId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  custom: "사용자 지정",
};

const NOT_INSTALLED_MESSAGES: Record<"claude" | "codex", string> = {
  claude: "Claude Code가 설치되어 있지 않습니다.",
  codex: "Codex가 설치되어 있지 않습니다.",
};

function describeAiError(error: unknown): string {
  return error instanceof Error ? error.message : "아직 지원되지 않습니다";
}

export function AiPage({
  aiGateway = sharedAiGateway,
  terminalRendererFactory = createXtermRenderer,
}: {
  aiGateway?: AiGateway;
  terminalRendererFactory?: TerminalRendererFactory;
}) {
  const terminalStore = terminalStoreFor(aiGateway, terminalRendererFactory);
  const activeProject = useOptionalActiveProject();
  const [openingTool, setOpeningTool] = useState<AiToolId | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

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
  const hasCustomTerminal = Boolean(configQuery.data?.cli_command.trim());
  const openTerminal = async (tool: AiToolId) => {
    setOpeningTool(tool);
    setOpenError(null);
    try {
      await terminalStore.open(tool);
    } catch (error) {
      setOpenError(
        error instanceof Error ? error.message : "아직 지원되지 않습니다",
      );
    } finally {
      setOpeningTool(null);
    }
  };

  const terminalTools: AiToolId[] = hasCustomTerminal
    ? ["claude", "codex", "custom"]
    : ["claude", "codex"];

  return (
    <section
      className="min-h-full bg-[var(--color-surface)] px-[var(--page-padding-inline)] pt-[var(--page-block-start)] pb-[var(--space-10)]"
      aria-labelledby="ai-title"
    >
      <PageHeader titleId="ai-title" title="AI" />
      <section
        aria-label="컨텍스트 요약"
        className="mt-[var(--space-4)] grid gap-[var(--space-1)] text-[var(--font-meta-size)] text-[var(--color-text-muted)]"
      >
        <p className="m-0">
          프로젝트:{" "}
          {activeProject ? activeProject.activeProjectTitle : "선택된 프로젝트 없음"}
        </p>
        <p className="m-0">
          {agentsQuery.isError ? (
            <Link to="/documents">문서 저장소를 선택하세요</Link>
          ) : agents ? (
            `문서 저장소: ${agents.repository_full_name || "이름 없는 저장소"}`
          ) : (
            "문서 저장소: 불러오는 중"
          )}
        </p>
        <p className="m-0">
          {`AI 규칙: 앱 기본 규칙 + 작업 규칙(worktree·PR)${
            agents?.path ? " + 저장소 규칙(.okf/AGENTS.md)" : ""
          }`}
          {appAgentsError ? ` (앱 기본 규칙을 읽지 못했습니다: ${appAgentsError})` : null}
        </p>
      </section>
      {contextError ? (
        <div className="mt-[var(--space-4)]">
          <StatusFeedback variant="content" tone="error">
            <StatusFeedbackTitle>컨텍스트를 불러오지 못했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>{contextError}</StatusFeedbackDescription>
          </StatusFeedback>
        </div>
      ) : null}
      <div className="mt-[var(--space-6)] grid gap-[var(--space-3)]">
        <div className="grid gap-[var(--space-2)]">
          <h2 className="m-0 font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
            터미널에서 열기
          </h2>
          <p className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]">
            앱 안 터미널에서 워크스페이스 폴더로 바로 실행합니다. Claude Code와 Codex에는 프로젝트 규칙을 함께 전달합니다.
          </p>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {terminalTools.map((tool) => (
              <Button
                key={tool}
                type="button"
                variant="primary"
                onClick={() => void openTerminal(tool)}
                disabled={
                  openingTool !== null ||
                  contextError !== null ||
                  (tool !== "custom" && !isInstalled(tool))
                }
                loading={openingTool === tool}
              >
                {TOOL_LABELS[tool]}
              </Button>
            ))}
          </div>
          {missingTools.map((tool) => (
            <p
              key={tool}
              className="m-0 text-[var(--font-meta-size)] text-[var(--color-text-muted)]"
            >
              {NOT_INSTALLED_MESSAGES[tool]}
            </p>
          ))}
        </div>
        {openError ? (
          <StatusFeedback
            variant="content"
            tone="error"
            action={
              <Button asChild variant="secondary">
                <Link to="/settings">설정에서 확인</Link>
              </Button>
            }
          >
            <StatusFeedbackTitle>터미널을 열지 못했습니다</StatusFeedbackTitle>
            <StatusFeedbackDescription>{openError}</StatusFeedbackDescription>
          </StatusFeedback>
        ) : null}
        <AiTerminalPanel store={terminalStore} labels={TOOL_LABELS} />
      </div>
    </section>
  );
}
