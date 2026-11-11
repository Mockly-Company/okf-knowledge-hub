import {
  ArrowLeft,
  CircleUserRound,
  ExternalLink,
  FolderGit2,
  SquareKanban,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/patterns/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  StatusFeedback,
  StatusFeedbackDescription,
  StatusFeedbackTitle,
} from "@/components/ui/status-feedback";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveProject } from "@/features/active-project/ActiveProjectProvider";
import { aiKeys } from "@/features/ai/queryKeys";
import type { DocsRepositoryGateway } from "@/features/docs-repository/DocsRepositoryGateway";
import { DocsRepositoryPicker } from "@/features/docs-repository/DocsRepositoryPicker";
import {
  currentDocsRepositoryKey,
  sharedDocsRepositoryGateway,
  sharedRepositoryGateway,
  type ProjectRepositoryGateway,
} from "@/features/docs-repository/ProjectDocsRepository";
import { useOptionalDocuments } from "@/features/documents/DocumentsProvider";
import type { ResolvedGithubProject } from "@/features/project-board/model";
import { DeviceCodeCopy } from "@/features/workspace-connection/components/DeviceCodeCopy";
import { useWorkspaceConnection } from "@/features/workspace-connection/WorkspaceConnectionProvider";
import { ProjectPickerList } from "./ProjectPickerList";

export type WorkspaceSetupMode = "project-with-docs" | "docs-only";

function describeSetupError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.trim() !== ""
  ) {
    return (error as { message: string }).message;
  }
  return "워크스페이스 연결에 실패했습니다.";
}

export function WorkspaceSetupFlow({
  docsRepositoryGateway = sharedDocsRepositoryGateway,
  repositoryGateway = sharedRepositoryGateway,
  initialMode = "project-with-docs",
  onComplete,
}: {
  docsRepositoryGateway?: DocsRepositoryGateway;
  repositoryGateway?: ProjectRepositoryGateway;
  initialMode?: WorkspaceSetupMode;
  onComplete?(): void;
}) {
  const { account, startLogin, cancelLogin, openVerificationUrl } =
    useWorkspaceConnection();
  const activeProject = useActiveProject();
  const documents = useOptionalDocuments();
  const queryClient = useQueryClient();

  const tabsId = useId();
  const projectTabRef = useRef<HTMLButtonElement>(null);
  const docsTabRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<WorkspaceSetupMode>(initialMode);
  const [selectedProject, setSelectedProject] =
    useState<ResolvedGithubProject | null>(null);
  const [skippingDocs, setSkippingDocs] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);

  const selectMode = (nextMode: WorkspaceSetupMode) => {
    setMode(nextMode);
    setSelectedProject(null);
    setSkipError(null);
  };

  const refreshConnectedState = async () => {
    await queryClient.invalidateQueries({ queryKey: currentDocsRepositoryKey });
    await queryClient.invalidateQueries({ queryKey: aiKeys.agentsMd });
    documents?.retrySession();
  };

  if (account.status === "loading") {
    return (
      <p role="status" className="m-0 text-[var(--color-text-muted)]">
        GitHub 계정 상태를 확인하는 중…
      </p>
    );
  }

  if (account.status !== "authenticated") {
    return (
      <section
        aria-label="GitHub 로그인"
        className="grid gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
      >
        <div className="flex items-start gap-[var(--space-3)]">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-canvas)] text-[var(--color-text-strong)]"
          >
            <CircleUserRound strokeWidth={1.75} />
          </span>
          <div className="grid gap-[var(--space-1)]">
            <h2 className="m-0 text-[length:var(--font-section-size)] leading-[var(--font-section-line)] font-[number:var(--font-weight-heading)] text-[var(--color-text-strong)]">
              GitHub에 로그인하고 문서 워크스페이스를 시작하세요
            </h2>
            <p className="m-0 text-[var(--color-text-muted)]">
              로그인하면 접근 가능한 GitHub Project 보드와 문서 관리용 저장소를 한 흐름으로 연결할 수 있습니다.
            </p>
          </div>
        </div>

        {account.status === "waiting_for_user" ? (
          <div className="grid gap-[var(--space-3)]">
            <p className="m-0 text-[var(--color-text-default)]">
              GitHub 인증 페이지에 아래 코드를 입력해 로그인을 완료하세요.
            </p>
            <DeviceCodeCopy code={account.authorization.userCode} />
            <div className="flex flex-wrap gap-[var(--space-2)]">
              <Button
                type="button"
                onClick={() =>
                  void openVerificationUrl(account.authorization.verificationUri)
                }
              >
                <ExternalLink aria-hidden="true" strokeWidth={1.75} />
                GitHub 인증 페이지 열기
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void cancelLogin()}
              >
                인증 취소
              </Button>
            </div>
          </div>
        ) : account.status === "login_beginning" ? (
          <div>
            <Button type="button" disabled loading>
              GitHub 로그인 준비 중…
            </Button>
          </div>
        ) : (
          <div>
            <Button type="button" onClick={() => void startLogin()}>
              GitHub로 로그인
            </Button>
          </div>
        )}

        {account.error ? (
          <StatusFeedback variant="field" tone="error">
            {account.error.message}
          </StatusFeedback>
        ) : null}
      </section>
    );
  }

  const linkedProjectIds = activeProject.workspaces.flatMap((workspace) =>
    workspace.project ? [workspace.project.id] : [],
  );

  const connectWithoutDocs = async () => {
    if (!selectedProject) return;
    setSkippingDocs(true);
    setSkipError(null);
    try {
      await activeProject.createProjectWorkspace(selectedProject, null);
      await refreshConnectedState();
      setSelectedProject(null);
      onComplete?.();
    } catch (error) {
      setSkipError(describeSetupError(error));
    } finally {
      setSkippingDocs(false);
    }
  };

  const projectTabId = `${tabsId}-project-tab`;
  const docsTabId = `${tabsId}-docs-tab`;
  const panelId = `${tabsId}-panel`;

  return (
    <section
      aria-label="워크스페이스 연결"
      className="grid gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-5)]"
    >
      <div className="grid gap-[var(--space-1)]">
        <h2 className="m-0 text-[length:var(--font-section-size)] leading-[var(--font-section-line)] font-[number:var(--font-weight-heading)] text-[var(--color-text-strong)]">
          문서 워크스페이스 연결
        </h2>
        <p className="m-0 text-[var(--color-text-muted)]">
          GitHub Project와 소속 문서 저장소를 함께 묶어 시작하거나, Project 없이 문서 저장소만 단독으로 관리할 수 있습니다.
        </p>
      </div>

      <TabsList
        aria-label="워크스페이스 시작 방식"
        onKeyDown={(event) => {
          if (
            !(event.target instanceof HTMLElement) ||
            event.target.getAttribute("role") !== "tab"
          ) {
            return;
          }
          let nextMode: WorkspaceSetupMode | null = null;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            nextMode =
              event.target.id === projectTabId ? "docs-only" : "project-with-docs";
          } else if (event.key === "Home") {
            nextMode = "project-with-docs";
          } else if (event.key === "End") {
            nextMode = "docs-only";
          }
          if (nextMode !== null) {
            event.preventDefault();
            selectMode(nextMode);
            const nextTabRef =
              nextMode === "project-with-docs" ? projectTabRef : docsTabRef;
            nextTabRef.current?.focus();
          }
        }}
      >
        <TabsTrigger
          ref={projectTabRef}
          id={projectTabId}
          aria-controls={panelId}
          selected={mode === "project-with-docs"}
          onClick={() => selectMode("project-with-docs")}
        >
          Project와 함께 시작
        </TabsTrigger>
        <TabsTrigger
          ref={docsTabRef}
          id={docsTabId}
          aria-controls={panelId}
          selected={mode === "docs-only"}
          onClick={() => selectMode("docs-only")}
        >
          문서 저장소만 관리
        </TabsTrigger>
      </TabsList>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={mode === "project-with-docs" ? projectTabId : docsTabId}
      >
        {mode === "project-with-docs" ? (
          selectedProject === null ? (
            <div className="grid gap-[var(--space-3)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--font-meta-size)]">
                <StatusBadge tone="info">1단계 · Project 선택</StatusBadge>
                <span className="text-[var(--color-text-muted)]">
                  → 2단계 · 소속 문서 저장소 연결
                </span>
              </div>
              <p className="m-0 text-[var(--color-text-muted)]">
                칸반 보드로 사용할 GitHub Project를 선택하면, 이어서 그 Project의 기획·명세를 관리할 문서 저장소를 연결합니다.
              </p>
              <ProjectPickerList
                disabledProjectIds={linkedProjectIds}
                onSelectProject={(project) => setSelectedProject(project)}
                onSwitchToDocsOnly={() => selectMode("docs-only")}
              />
            </div>
          ) : (
            <div className="grid gap-[var(--space-4)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--font-meta-size)]">
                <span className="text-[var(--color-text-muted)]">1단계 완료</span>
                <StatusBadge tone="info">2단계 · 소속 문서 저장소 연결</StatusBadge>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-[var(--space-3)] py-[var(--space-2)]">
                <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                  <SquareKanban
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="shrink-0 text-[var(--color-text-muted)]"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-[number:var(--font-weight-control)] text-[var(--color-text-strong)]">
                      선택한 Project: {selectedProject.title}
                    </div>
                    <div className="truncate text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                      {selectedProject.owner} #{selectedProject.number} · 이 Project에 속할 문서 저장소를 고르세요
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSelectedProject(null);
                    setSkipError(null);
                  }}
                >
                  <ArrowLeft aria-hidden="true" strokeWidth={1.75} />
                  Project 다시 선택
                </Button>
              </div>

              <DocsRepositoryPicker
                key={selectedProject.id}
                projectId={selectedProject.id}
                preferredOwner={selectedProject.owner}
                description={`"${selectedProject.title}" 프로젝트의 기획과 명세를 관리할 GitHub 저장소를 선택하세요. 같은 소유자의 저장소를 먼저 보여 줍니다.`}
                gateway={docsRepositoryGateway}
                repositoryGateway={repositoryGateway}
                onConnectRepository={async (repository) => {
                  const connected = await activeProject.createProjectWorkspace(
                    selectedProject,
                    {
                      repositoryId: repository.id,
                      fullName: repository.fullName,
                    },
                  );
                  await refreshConnectedState();
                  return {
                    fullName: repository.fullName,
                    okf: connected.okf !== false,
                  };
                }}
                onConnected={() => {
                  setSelectedProject(null);
                  onComplete?.();
                }}
              />

              {skipError ? (
                <StatusFeedback variant="field" tone="error">
                  {skipError}
                </StatusFeedback>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-t border-[var(--color-border)] pt-[var(--space-3)]">
                <span className="text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
                  아직 문서 저장소가 준비되지 않았다면 보드만 먼저 연결할 수도 있습니다.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={skippingDocs}
                  loading={skippingDocs}
                  onClick={() => void connectWithoutDocs()}
                >
                  문서 저장소 나중에 연결
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="grid gap-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)] text-[length:var(--font-meta-size)] text-[var(--color-text-muted)]">
              <FolderGit2 aria-hidden="true" strokeWidth={1.75} />
              <span>
                GitHub Project 보드 없이 문서 저장소만 단독으로 연결합니다. 필요해지면 나중에 보드를 연결할 수 있습니다.
              </span>
            </div>
            <DocsRepositoryPicker
              key="standalone"
              description="기획·명세 문서를 관리할 GitHub 저장소를 선택하세요. 앱이 자동으로 받아 최신 상태로 유지합니다."
              gateway={docsRepositoryGateway}
              repositoryGateway={repositoryGateway}
              onConnectRepository={async (repository) => {
                const connected = await activeProject.createStandaloneWorkspace(
                  repository.id,
                  repository.fullName,
                );
                await refreshConnectedState();
                return {
                  fullName: repository.fullName,
                  okf: connected.okf !== false,
                };
              }}
              onConnected={() => {
                onComplete?.();
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
