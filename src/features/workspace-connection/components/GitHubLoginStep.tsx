import { ExternalLink, LoaderCircle } from "lucide-react";
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

export function GitHubLoginStep({ state, onStart, onCancel, onOpen, onRecover }: GitHubLoginStepProps) {
  const waiting = state.status === "waiting_for_user";
  const isStarting = state.status === "login_beginning";
  const authorization = waiting ? state.authorization : null;
  return (
    <section className="workspace-connection__step" aria-labelledby="github-login-title">
      <p className="workspace-connection__eyebrow">1 / 3</p>
      <h1 id="github-login-title">GitHub에 연결</h1>
      <p>OKF 지식 저장소에 접근할 GitHub 계정을 연결합니다.</p>
      {authorization ? (
        <div className="workspace-connection__device-flow">
          <p>GitHub에서 아래 코드를 입력해 인증을 계속하세요.</p>
          <DeviceCodeCopy code={authorization.userCode} />
          <p>인증 코드는 {new Date(authorization.expiresAtUnix * 1000).toLocaleTimeString("ko-KR")}까지 유효합니다.</p>
          <div className="workspace-connection__actions">
            <Button variant="secondary" asChild>
              <a href={authorization.verificationUri} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); onOpen(authorization.verificationUri); }}>
                <ExternalLink aria-hidden="true" strokeWidth={1.75} /> GitHub에서 인증 계속
              </a>
            </Button>
            <Button variant="ghost" onClick={onCancel}>로그인 취소</Button>
            <Button variant="secondary" onClick={onStart}>로그인 다시 시작</Button>
          </div>
        </div>
      ) : state.status === "error" ? (
        <ConnectionError error={state.error} onRecover={onRecover} />
      ) : (
        <Button disabled={isStarting || state.status === "loading"} onClick={onStart}>
          {isStarting ? <LoaderCircle className="animate-spin" aria-hidden="true" strokeWidth={1.75} /> : null}
          GitHub 로그인
        </Button>
      )}
    </section>
  );
}
