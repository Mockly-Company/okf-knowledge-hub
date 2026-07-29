import { CircleUserRound, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceConnection } from "../WorkspaceConnectionProvider";
import { LogoutConfirmationDialog } from "./LogoutConfirmationDialog";

export function GitHubAccountPanel() {
  const {
    account,
    startLogin,
    cancelLogin,
    logoutGithub,
    openVerificationUrl,
  } = useWorkspaceConnection();

  return (
    <div className="github-account-panel">
      <div>
        <h2 className="m-0 text-xl font-semibold text-[var(--color-text-strong)]">
          외부 연결
        </h2>
        <p className="mt-1 text-[var(--color-text-muted)]">
          GitHub 계정 연결과 인증 상태를 관리합니다.
        </p>
      </div>

      <section className="github-account-card" aria-labelledby="github-account-title">
        <div className="github-account-card__heading">
          <span className="github-account-card__provider-icon" aria-hidden="true">
            <CircleUserRound />
          </span>
          <div>
            <h3 id="github-account-title">GitHub 계정</h3>
            <p>Issue, Pull Request와 저장소 동기화에 사용합니다.</p>
          </div>
        </div>

        {account.status === "loading" ? (
          <p className="github-account-card__status" aria-live="polite">
            계정 상태 확인 중
          </p>
        ) : account.status === "authenticated" || account.status === "logging_out" ? (
          <div className="github-account-card__account">
            <div className="github-account-card__identity">
              <img src={account.user.avatarUrl} alt="" />
              <div>
                <strong>@{account.user.login}</strong>
                <span>연결됨</span>
              </div>
            </div>
            <LogoutConfirmationDialog
              disabled={account.status === "logging_out"}
              onConfirm={logoutGithub}
            />
          </div>
        ) : account.status === "waiting_for_user" ? (
          <div className="github-account-card__device-flow">
            <p>GitHub 인증 페이지에 다음 코드를 입력하세요.</p>
            <code>{account.authorization.userCode}</code>
            <div className="github-account-card__actions">
              <Button
                type="button"
                onClick={() =>
                  void openVerificationUrl(account.authorization.verificationUri)
                }
              >
                <ExternalLink aria-hidden="true" />
                GitHub 인증 페이지 열기
              </Button>
              <Button type="button" variant="secondary" onClick={() => void cancelLogin()}>
                인증 취소
              </Button>
            </div>
          </div>
        ) : account.status === "login_beginning" ? (
          <Button type="button" disabled>
            GitHub 로그인 준비 중
          </Button>
        ) : (
          <div className="github-account-card__signed-out">
            <p>
              {account.status === "reauthentication_required"
                ? "GitHub 인증이 만료되었습니다. 다시 로그인해 주세요."
                : "연결된 GitHub 계정이 없습니다."}
            </p>
            <Button type="button" onClick={() => void startLogin()}>
              GitHub 다시 로그인
            </Button>
          </div>
        )}

        {account.error && (
          <p className="github-account-card__error" role="alert">
            {account.error.message}
          </p>
        )}
      </section>
    </div>
  );
}
