import { ExternalLink, LoaderCircle } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import type { AuthConnectionState, RecoveryAction } from "../types";
import { ConnectionError } from "./ConnectionError";
import { DeviceCodeCopy } from "./DeviceCodeCopy";

interface GitHubLoginStepProps {
  state: AuthConnectionState;
  onStart(): void;
  onCancel(): void;
  onOpen(url: string): void;
  onRecover(action: RecoveryAction): void;
}

export function GitHubLoginStep({ state, onStart, onOpen, onRecover }: GitHubLoginStepProps) {
  const waiting = state.status === "waiting_for_user";
  const isStarting = state.status === "login_beginning";
  const authorization = waiting ? state.authorization : null;
  return (
    <section className="workspace-connection__step grid gap-[var(--space-4)]" aria-labelledby="github-login-title">
      <p className="workspace-connection__eyebrow m-0">1 / 3</p>
      <PageHeader
        titleId="github-login-title"
        title="GitHub에 연결"
        description={waiting ? "아래 코드를 GitHub에 입력해 인증을 완료하세요." : "OKF 지식 저장소에 접근할 GitHub 계정을 연결합니다."}
      />
      {authorization ? (
        <div className="mt-[var(--space-5)] grid gap-[var(--space-6)]">
          <div className="grid gap-[var(--space-2)]">
          <DeviceCodeCopy code={authorization.userCode} />
          <p className="m-0 text-[length:var(--font-meta-size)] leading-[var(--font-meta-line)] text-[var(--color-text-muted)]">인증 코드는 {new Date(authorization.expiresAtUnix * 1000).toLocaleTimeString("ko-KR")}까지 유효합니다.</p>
          </div>
          <div className="flex justify-end">
            <Button asChild>
              <a href={authorization.verificationUri} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); onOpen(authorization.verificationUri); }}>
                <ExternalLink aria-hidden="true" strokeWidth={1.75} /> GitHub에서 인증 계속
              </a>
            </Button>
          </div>
        </div>
      ) : state.status === "error" ? (
        <ConnectionError error={state.error} onRecover={onRecover} />
      ) : (
        <div className="mt-[var(--space-2)] flex justify-end">
        <Button disabled={isStarting || state.status === "loading"} onClick={onStart}>
          {isStarting ? <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} /> : null}
          GitHub 로그인
        </Button>
        </div>
      )}
    </section>
  );
}
